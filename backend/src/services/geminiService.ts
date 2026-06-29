// backend/src/services/geminiService.ts
import axios from 'axios';
import { GeminiResponse, AppState } from '../types';

export class GeminiService {
  private apiKey: string;
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not set in environment variables');
    }
  }

  /**
   * Execute user command and return action plan
   */
  async executeCommand(userMessage: string, appState: AppState): Promise<GeminiResponse> {
    const systemPrompt = this.buildSystemPrompt(appState);
    const fullPrompt = `${systemPrompt}\n\nUser command: ${userMessage}`;

    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiUrl}?key=${this.apiKey}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: fullPrompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 2048,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('No response from Gemini');
        }

        // Extract JSON from response (handles markdown code blocks too)
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) {
          throw new Error('No JSON found in Gemini response');
        }

        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const actionPlan = JSON.parse(jsonStr) as GeminiResponse;
        return actionPlan;
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : null;

        // Retry on 503 (overloaded) or 429 (rate limit)
        if ((status === 503 || status === 429) && attempt < MAX_RETRIES) {
          const delay = attempt * 2000; // 2s, 4s backoff
          console.warn(`[Gemini] Got ${status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (axios.isAxiosError(error) && error.response) {
          console.error('Gemini API error response:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('Gemini API error:', error);
        
        // If rate limit (429) or connection fails, do NOT crash the UI!
        // Intercept with the rule-based local parser!
        console.warn('[Gemini] Rate limit hit or API key exhausted. Activating offline rule-based command parser fallback...');
        try {
          return this.fallbackParseCommand(userMessage, appState);
        } catch (fallbackErr) {
          console.error('Fallback parser also failed:', fallbackErr);
        }
        
        throw new Error(`Failed to execute AI command: ${(error as Error).message}`);
      }
    }

    throw new Error('Failed to execute AI command after retries');
  }

  /**
   * Rule-based local NLP parser that executes commands locally if Gemini is rate-limited (429)
   */
  fallbackParseCommand(userMessage: string, appState: AppState): GeminiResponse {
    const msg = userMessage.toLowerCase().trim();
    
    // 1. Context-aware direct replies
    if (msg === 'reply to this' || msg.startsWith('reply to this email') || msg.startsWith('reply to the open email')) {
      const replyText = userMessage.match(/saying[:\s]+['"]?([^'"]+)['"]?/i)?.[1] || 'Thanks for the email.';
      return {
        reasoning: 'Fallback: Context-aware reply command detected.',
        actions: [
          { type: 'reply', body: replyText },
          { type: 'message', text: `Drafted reply saying: "${replyText}"` }
        ]
      };
    }
    
    // 2. Reply to latest/last email
    if (msg.startsWith('reply to the last email') || msg.startsWith('reply to the latest email')) {
      const replyText = userMessage.match(/saying[:\s]+['"]?([^'"]+)['"]?/i)?.[1] || 'Thanks for the email.';
      return {
        reasoning: 'Fallback: Reply to latest email command detected.',
        actions: [
          { type: 'search', query: 'is:inbox', filters: {} },
          { type: 'reply', body: replyText },
          { type: 'message', text: `Drafting reply to the latest email.` }
        ]
      };
    }

    // 3. Forward email
    if (msg.startsWith('forward this email to') || msg.startsWith('forward to')) {
      const toEmail = userMessage.match(/to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)?.[1] || '';
      return {
        reasoning: 'Fallback: Forward email command detected.',
        actions: [
          { type: 'forward', to: toEmail },
          { type: 'message', text: `Drafting forward to ${toEmail}.` }
        ]
      };
    }

    // 4. Delete active email
    if (msg === 'delete this' || msg.startsWith('delete this email') || msg.startsWith('delete the open email')) {
      return {
        reasoning: 'Fallback: Delete open email command detected.',
        actions: [
          { type: 'delete' },
          { type: 'message', text: 'Deleting the open email.' }
        ]
      };
    }

    // 5. Compose/Send email: "Send an email to john@example.com with subject 'Meeting Tomorrow' and body 'Let’s meet at 3pm'"
    if (msg.includes('send') && msg.includes('email to')) {
      const toEmail = userMessage.match(/to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)?.[1] || '';
      const subject = userMessage.match(/subject\s+['"]?([^'"]+?)['"]?(\s+and|$)/i)?.[1] || 'No Subject';
      const body = userMessage.match(/body\s+['"]?([^'"]+?)['"]?$/i)?.[1] || 'No Content';
      
      return {
        reasoning: 'Fallback: Send email command parsed.',
        actions: [
          { type: 'navigate', view: 'compose' },
          { type: 'fillForm', formId: 'composeForm', fields: { to: toEmail, subject, body } },
          { type: 'message', text: `Drafted email to ${toEmail} with subject: "${subject}"` }
        ]
      };
    }

    // 6. Search date filters: "Show me emails from the last 10 days"
    const lastDaysMatch = msg.match(/(emails|search|find|show).*last\s+(\d+)\s+days/i);
    if (lastDaysMatch) {
      const days = lastDaysMatch[2];
      return {
        reasoning: `Fallback: Filter emails from last ${days} days.`,
        actions: [
          { type: 'search', query: 'is:inbox', filters: { dateRange: `${days}d` } },
          { type: 'message', text: `Filtered emails from the last ${days} days.` }
        ]
      };
    }

    // 7. Unread status filters: "Show only unread emails from this week"
    if (msg.includes('unread')) {
      const dateRange = msg.includes('week') ? '7d' : undefined;
      return {
        reasoning: 'Fallback: Filter by unread status.',
        actions: [
          { type: 'search', query: 'is:unread', filters: { isRead: false, dateRange } },
          { type: 'message', text: 'Showing unread emails.' }
        ]
      };
    }

    // 8. Search sender/keyword: "Find the email from Sarah about the project update"
    const senderMatch = msg.match(/(from|by)\s+(\w+)/i);
    const keywordMatch = msg.match(/(about|regarding)\s+([\w\s]+)/i);
    
    let sender = senderMatch ? senderMatch[2] : undefined;
    const ignoredSenders = ['this', 'last', 'the', 'me', 'a', 'my', 'yesterday', 'today', 'week', 'month', 'year', 'emails', 'email'];
    if (sender && ignoredSenders.includes(sender.toLowerCase())) {
      sender = undefined;
    }

    const keyword = keywordMatch ? keywordMatch[2].trim() : undefined;

    if (sender || keyword) {
      return {
        reasoning: 'Fallback: Search filter applied.',
        actions: [
          { type: 'search', query: 'is:inbox', filters: { sender, keyword } },
          { type: 'message', text: `Searching for emails${sender ? ` from ${sender}` : ''}${keyword ? ` about "${keyword}"` : ''}.` }
        ]
      };
    }

    // 9. Open latest email: "Open the latest email from David"
    if (msg.startsWith('open the latest email') || msg.startsWith('open latest email') || msg.startsWith('open latest')) {
      const fromDavid = userMessage.match(/(from|by)\s+(\w+)/i)?.[2] || '';
      return {
        reasoning: 'Fallback: Open latest email command detected.',
        actions: [
          { type: 'search', query: fromDavid ? `from:${fromDavid}` : 'is:inbox', filters: { sender: fromDavid || undefined } },
          { type: 'message', text: `Opening latest email${fromDavid ? ` from ${fromDavid}` : ''}.` }
        ]
      };
    }

    // Default message
    return {
      reasoning: 'Fallback: Simple message response.',
      actions: [
        { type: 'message', text: `Connection to Gemini is limited (Rate limit 429). Please try typing direct commands like "send email to...", "reply to this", or "unread emails".` }
      ]
    };
  }

  private buildSystemPrompt(appState: AppState): string {
    const currentEmailInfo = appState.currentEmail
      ? `From: ${appState.currentEmail.from_address}, Subject: "${appState.currentEmail.subject}", ID: ${appState.currentEmail.id}, Body: "${appState.currentEmail.body.substring(0, 300)}"`
      : 'None';

    return `You are an AI assistant for a mail application. You control the UI by returning a structured JSON action plan. You are NOT a chatbot — you take actions.

CURRENT APP STATE:
- View: ${appState.currentView}
- Current Email Open: ${currentEmailInfo}
- Total Emails Visible: ${appState.emails.length}
- Unread Count: ${appState.unreadCount}
- Active Filters: ${JSON.stringify(appState.filters)}
- Current Date/Time: ${new Date().toISOString()} (Use this as reference to calculate exact ISO strings for relative times like "tomorrow at 5 PM", "in 2 hours", etc.)

AVAILABLE ACTIONS:
You MUST respond with ONLY a valid JSON object — no markdown, no explanation outside JSON.

1. "navigate" — Go to a different view
   { "type": "navigate", "view": "inbox|sent|compose|detail", "emailId": "msg123" }

2. "fillForm" — Fill compose form fields  
   { "type": "fillForm", "formId": "composeForm", "fields": { "to": "email@example.com", "subject": "...", "body": "..." } }

3. "search" — Search/filter emails
   { "type": "search", "query": "from:alice@example.com", "filters": { "dateRange": "7d", "sender": "alice@example.com", "keyword": "hello", "isRead": false } }

4. "submit" — Submit compose form (actually sends the email)
   { "type": "submit", "formId": "composeForm" }

5. "openEmail" — Open a specific email by its ID
   { "type": "openEmail", "emailId": "the-email-id-here" }

6. "reply" — Open reply form or send reply to the currently open email
   { "type": "reply", "body": "My reply body here" }

7. "forward" — Forward the currently open email to another address
   { "type": "forward", "to": "recipient@example.com" }

8. "delete" — Delete an email
   { "type": "delete", "emailId": "id" }

9. "markRead" — Mark an email as read
   { "type": "markRead", "emailId": "id" }

10. "schedule" — Schedule an email to be sent at a specific time in the future
    { "type": "schedule", "to": "recipient@example.com", "subject": "...", "body": "...", "scheduledAt": "ISOString" }

11. "message" — Show a message to the user
    { "type": "message", "text": "Your message here" }

EXAMPLES:

User: "Send an email to john@example.com with subject Hello and body Hi there"
{
  "reasoning": "User wants to compose and send an email.",
  "actions": [
    { "type": "navigate", "view": "compose" },
    { "type": "fillForm", "formId": "composeForm", "fields": { "to": "john@example.com", "subject": "Hello", "body": "Hi there" } },
    { "type": "submit", "formId": "composeForm" },
    { "type": "message", "text": "Email sent to john@example.com successfully!" }
  ]
}

User: "Reply to the last email saying thanks" (when not viewing any email, or when viewing inbox)
{
  "reasoning": "First search for the latest email, open it, then reply to it.",
  "actions": [
    { "type": "search", "query": "is:inbox", "filters": {} },
    { "type": "reply", "body": "Thanks" },
    { "type": "submit", "formId": "composeForm" },
    { "type": "message", "text": "Sent reply 'Thanks' to the latest email." }
  ]
}

User: "Reply to this email saying I will join" (when an email is currently open)
{
  "reasoning": "Reply to the currently open email with the specified body and send it.",
  "actions": [
    { "type": "reply", "body": "I will join" },
    { "type": "submit", "formId": "composeForm" },
    { "type": "message", "text": "Reply sent successfully." }
  ]
}

User: "Forward this email to boss@company.com"
{
  "reasoning": "Forward the currently open email to the specified address.",
  "actions": [
    { "type": "forward", "to": "boss@company.com" },
    { "type": "submit", "formId": "composeForm" },
    { "type": "message", "text": "Email forwarded to boss@company.com." }
  ]
}

User: "Delete the open email"
{
  "reasoning": "Delete the currently active email.",
  "actions": [
    { "type": "delete" },
    { "type": "message", "text": "Email deleted." }
  ]
}

User: "Schedule an email to HR at hr@company.com with subject Application and body Hello at 4:30 PM tomorrow"
{
  "reasoning": "User wants to schedule an email to HR for tomorrow at 4:30 PM. I will calculate the exact ISO string based on the current time.",
  "actions": [
    { 
      "type": "schedule", 
      "to": "hr@company.com", 
      "subject": "Application", 
      "body": "Hello", 
      "scheduledAt": "2026-06-30T11:00:00.000Z" 
    },
    { "type": "message", "text": "I have scheduled the email to hr@company.com for tomorrow at 4:30 PM." }
  ]
}

RULES:
1. ALWAYS return valid JSON only — nothing else
2. For "reply" or "forward" commands: if an email is not currently open, you MUST first search for the email (e.g. "search" action with "query": "is:inbox") to open it, then perform the "reply" or "forward" action.
3. If the user asks to "send" the reply/forward/email, ALWAYS include the "submit" action at the end of the action pipeline. If they just say "write a reply" or "draft a reply", do not include "submit" so they can review the draft.
4. When performing a "reply", write a contextually appropriate, professional body if the user doesn't specify the exact text.
5. Avoid any HTML tags in the preview or message text.`;
  }

  /**
   * Dynamically generate smart reply suggestions for an email
   */
  async generateSuggestions(subject: string, body: string): Promise<{ label: string; prompt: string }[]> {
    const promptText = `Analyze the following email subject and body, and generate exactly 3 smart reply suggestion options.
For each option, provide:
1. A short, actionable button label (2-4 words) describing the reply's intent (e.g. "Confirm meeting", "Politely decline", "Ask for agenda", "Interested in role").
2. A clear natural language command that the user would say to the AI to draft that specific response (e.g. "Reply to this email saying: Yes, I can join. Please send the calendar invite.").

Format your response as a valid JSON array of objects, each containing "label" and "prompt" fields. Do NOT return markdown code block wrappers (like \`\`\`json), just the plain JSON array itself.

EMAIL DETAILS:
Subject: ${subject}
Body: ${body}`;

    try {
      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 600,
          }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No response from Gemini');

      // Extract JSON array
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/) || text.match(/(\[[\s\S]*\])/);
      if (!jsonMatch) throw new Error('No JSON array found in suggestions response');

      return JSON.parse(jsonMatch[0].trim());
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
      // Fallback suggestions
      return [
        { label: 'Say thank you', prompt: 'Reply to this email saying: Thank you for the update. I appreciate it.' },
        { label: 'Acknowledge receipt', prompt: 'Reply to this email saying: Received with thanks. I will review this and get back to you soon.' },
        { label: 'Politely decline', prompt: 'Reply to this email saying: Thank you for reaching out, but I am unable to proceed with this.' }
      ];
    }
  }
}
