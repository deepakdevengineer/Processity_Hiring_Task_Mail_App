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

        // Retry on 503 (overloaded) but immediately fall back on 429 (rate limits) to keep response instant
        if (status === 503 && attempt < MAX_RETRIES) {
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
    const emailMatch = userMessage.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    
    // 1. Navigation Commands: "go to inbox", "show sent", "open compose"
    if (msg.includes('go to') || msg.includes('show folder') || msg.includes('open view') || msg.startsWith('compose') || msg.startsWith('write') || msg.includes('folder') || msg === 'inbox' || msg === 'sent' || msg === 'scheduled') {
      if (msg.includes('sent')) {
        return {
          reasoning: 'Fallback: Navigation to Sent view.',
          actions: [
            { type: 'navigate', view: 'sent' },
            { type: 'message', text: 'Navigated to Sent Mail.' }
          ]
        };
      }
      if (msg.includes('schedul') || msg.includes('pending')) {
        return {
          reasoning: 'Fallback: Navigation to Scheduled view.',
          actions: [
            { type: 'navigate', view: 'scheduled' },
            { type: 'message', text: 'Navigated to Scheduled Mail.' }
          ]
        };
      }
      if (msg.includes('inbox')) {
        return {
          reasoning: 'Fallback: Navigation to Inbox view.',
          actions: [
            { type: 'navigate', view: 'inbox' },
            { type: 'message', text: 'Navigated to Inbox.' }
          ]
        };
      }
      if (msg.includes('compose') || msg.includes('write') || msg.includes('create') || msg.includes('new message')) {
        return {
          reasoning: 'Fallback: Navigation to Compose view.',
          actions: [
            { type: 'navigate', view: 'compose' },
            { type: 'message', text: 'Opened compose window.' }
          ]
        };
      }
    }

    // 2. Forward email: "forward the recent email to dk78834@gmail.com", "forward this email to boss@company.com"
    if ((msg.includes('forward') || msg.includes('fwd') || msg.includes('share this')) && emailMatch) {
      const toEmail = emailMatch[1];
      const isRecent = msg.includes('recent') || msg.includes('latest') || msg.includes('last') || !appState.currentEmail;
      
      const actions: any[] = [];
      if (isRecent) {
        actions.push({ type: 'search', query: 'is:inbox', filters: {} });
      }
      actions.push({ type: 'forward', to: toEmail });
      
      const isDraftForward = msg.includes('draft');
      if (!isDraftForward) {
        actions.push({ type: 'submit', formId: 'composeForm' });
        actions.push({ type: 'message', text: `Sending forward to ${toEmail}.` });
      } else {
        actions.push({ type: 'message', text: `Drafting forward to ${toEmail}.` });
      }
      
      return {
        reasoning: 'Fallback: Forward email command detected.',
        actions
      };
    }
    
    // 3. Reply to email: "reply to the recent email saying...", "reply to this saying...", "answer with Got it"
    if (msg.includes('reply') || msg.includes('answer') || msg.includes('respond') || msg.includes('write back')) {
      const isRecent = msg.includes('recent') || msg.includes('latest') || msg.includes('last') || !appState.currentEmail;
      const targetEmail = isRecent ? appState.emails[0] : appState.currentEmail;
      
      let replyText = 'Thanks for the email.';
      
      const customSaying = userMessage.match(/(saying|with|response)[:\s]+['"]?([^'"]+)['"]?/i)?.[2] || 
                           userMessage.match(/reply\s+['"]?([^'"]+?)['"]?$/i)?.[1];
      if (customSaying && !customSaying.includes('to the') && !customSaying.includes('to this')) {
        replyText = customSaying;
      } else if (targetEmail) {
        replyText = GeminiService.generateLocalContextualReply(targetEmail.subject, targetEmail.body);
      }
      
      const actions: any[] = [];
      if (isRecent) {
        actions.push({ type: 'search', query: 'is:inbox', filters: {} });
      }
      actions.push({ type: 'reply', body: replyText });
      
      const isDraftReply = msg.includes('draft');
      if (!isDraftReply) {
        actions.push({ type: 'submit', formId: 'composeForm' });
        actions.push({ type: 'message', text: `Sending reply: "${replyText}"` });
      } else {
        actions.push({ type: 'message', text: `Drafting reply: "${replyText}"` });
      }
      
      return {
        reasoning: 'Fallback: Reply command detected.',
        actions
      };
    }

    // 4. Delete email: "delete the recent email", "delete this email", "trash the open email", "remove this"
    if (msg.includes('delete') || msg.includes('remove') || msg.includes('trash') || msg.includes('discard') || msg.includes('bin') || msg.includes('throw away')) {
      const isRecent = msg.includes('recent') || msg.includes('latest') || msg.includes('last') || !appState.currentEmail;
      
      const actions: any[] = [];
      if (isRecent) {
        actions.push({ type: 'search', query: 'is:inbox', filters: {} });
      }
      actions.push({ type: 'delete' });
      actions.push({ type: 'message', text: 'Deleting email.' });
      
      return {
        reasoning: 'Fallback: Delete email command detected.',
        actions
      };
    }

    // 5. Mark Read/Unread: "mark as read", "mark the last email read", "mark this as seen"
    if (msg.includes('mark') && (msg.includes('read') || msg.includes('seen'))) {
      const isRecent = msg.includes('recent') || msg.includes('latest') || msg.includes('last') || !appState.currentEmail;
      const targetEmailId = isRecent ? appState.emails[0]?.id : appState.currentEmail?.id;
      
      if (targetEmailId) {
        return {
          reasoning: 'Fallback: Mark email as read.',
          actions: [
            { type: 'markRead', emailId: targetEmailId },
            { type: 'message', text: 'Email marked as read.' }
          ]
        };
      }
    }

    // 6. Schedule email: "schedule an email to john@example.com at 5pm with subject 'meeting' and body 'hello'"
    const hasTimeIndicator = msg.includes('schedule') || 
                             /\bat\s+\d{1,2}[.:]\d{2}/i.test(userMessage) || 
                             /\bat\s+\d{1,2}\s*(pm|am)/i.test(userMessage) ||
                             /\bin\s+\d+\s+(hour|min)/i.test(userMessage);

    if (hasTimeIndicator && msg.includes('email') && emailMatch) {
      const toEmail = emailMatch[1];
      const subject = GeminiService.extractSubject(userMessage);
      const body = GeminiService.extractBody(userMessage);
      const scheduledAt = GeminiService.extractScheduleTime(userMessage);
      
      return {
        reasoning: 'Fallback: Schedule email command parsed.',
        actions: [
          { type: 'schedule', to: toEmail, subject, body, scheduledAt },
          { type: 'message', text: `Scheduling email to ${toEmail} with subject: "${subject}" at ${new Date(scheduledAt).toLocaleString()}` }
        ]
      };
    }

    // 7. Compose/Send email: "Send an email to john@example.com with subject 'Meeting' and body 'Let's meet'"
    if ((msg.includes('send') || msg.includes('compose') || msg.includes('write')) && msg.includes('email') && emailMatch) {
      const toEmail = emailMatch[1];
      const subject = GeminiService.extractSubject(userMessage);
      const body = GeminiService.extractBody(userMessage);
      
      const actions: any[] = [
        { type: 'navigate', view: 'compose' },
        { type: 'fillForm', formId: 'composeForm', fields: { to: toEmail, subject, body } }
      ];
      
      const isSend = msg.includes('send');
      if (isSend) {
        actions.push({ type: 'submit', formId: 'composeForm' });
        actions.push({ type: 'message', text: `Sending email to ${toEmail} with subject: "${subject}"` });
      } else {
        actions.push({ type: 'message', text: `Drafting email to ${toEmail} with subject: "${subject}"` });
      }
      
      return {
        reasoning: isSend ? 'Fallback: Send email command parsed.' : 'Fallback: Draft email command parsed.',
        actions
      };
    }

    // 8. Unified Search & Filters: Handles "unread emails from this week", "emails from Sarah about storage", "sent emails yesterday", etc.
    const isSearchCommand = msg.includes('show') || msg.includes('find') || msg.includes('search') || 
                            msg.includes('list') || msg.includes('get') || msg.includes('unread') ||
                            msg.includes('sent') || msg.includes('from') || msg.includes('about') || 
                            msg.includes('yesterday') || msg.includes('today') || msg.includes('week') ||
                            msg.includes('month');

    const isExplicitOpen = msg.startsWith('open') || msg.startsWith('view') || msg.includes('open the') || msg.includes('open this');

    if (isSearchCommand && !isExplicitOpen) {
      // A. Detect read/unread status
      let isRead: boolean | undefined = undefined;
      if (msg.includes('unread')) {
        isRead = false;
      } else if (msg.includes(' read ')) {
        isRead = true;
      }

      // B. Detect sent/replied folder vs inbox
      let queryVal = 'is:inbox';
      let messageLabel = 'emails';
      if (msg.includes('sent') || msg.includes('replied to') || msg.includes('i sent') || msg.includes('i replied')) {
        queryVal = 'is:sent';
        messageLabel = 'sent/replied emails';
      } else if (isRead === false) {
        queryVal = 'is:unread';
        messageLabel = 'unread emails';
      }

      // C. Detect date ranges
      let dateRange: string | undefined = undefined;
      const lastDaysMatch = msg.match(/last\s+(\d+)\s+days/i);
      if (lastDaysMatch) {
        dateRange = `${lastDaysMatch[1]}d`;
      } else if (msg.includes('yesterday')) {
        dateRange = '2d';
      } else if (msg.includes('today')) {
        dateRange = '1d';
      } else if (msg.includes('week')) {
        dateRange = '7d';
      } else if (msg.includes('month')) {
        dateRange = '30d';
      }

      // D. Extract sender (matches names with spaces and raw email addresses)
      let sender: string | undefined = undefined;
      const fromIndex = msg.indexOf('from ');
      const byIndex = msg.indexOf('by ');
      const fromStart = fromIndex !== -1 ? fromIndex + 5 : (byIndex !== -1 ? byIndex + 3 : -1);
      if (fromStart !== -1) {
        const rest = msg.substring(fromStart);
        const boundaryMatch = rest.match(/^(.*?)\s+(about|regarding|between|on|subject|last|latest|this|yesterday|today)\b/i);
        sender = (boundaryMatch ? boundaryMatch[1].trim() : rest.trim()).replace(/^["']|["']$/g, '');
        const ignored = ['this', 'last', 'the', 'me', 'a', 'my', 'yesterday', 'today', 'week', 'month', 'year', 'emails', 'email'];
        if (ignored.includes(sender.toLowerCase())) {
          sender = undefined;
        }
      }

      // E. Extract keyword/subject topic
      let keyword: string | undefined = undefined;
      const aboutIndex = msg.indexOf('about ');
      const regardingIndex = msg.indexOf('regarding ');
      const subjectIndex = msg.indexOf('subject ');
      const keywordStart = aboutIndex !== -1 ? aboutIndex + 6 : 
                           (regardingIndex !== -1 ? regardingIndex + 10 : 
                           (subjectIndex !== -1 ? subjectIndex + 8 : -1));
      if (keywordStart !== -1) {
        const rest = msg.substring(keywordStart);
        const boundaryMatch = rest.match(/^(.*?)\s+(from|by|between|on|last|latest|this|yesterday|today)\b/i);
        keyword = (boundaryMatch ? boundaryMatch[1].trim() : rest.trim()).replace(/^["']|["']$/g, '');
      }

      // F. Construct user-facing description
      let descriptionText = `Showing ${messageLabel}`;
      if (sender) descriptionText += ` from "${sender}"`;
      if (keyword) descriptionText += ` about "${keyword}"`;
      if (dateRange) {
        const days = dateRange.replace('d', '');
        descriptionText += ` from the last ${days === '1' ? 'day' : days + ' days'}`;
      }
      descriptionText += '.';

      return {
        reasoning: 'Fallback: Search command parsed.',
        actions: [
          { type: 'search', query: queryVal, filters: { isRead, dateRange, sender, keyword } },
          { type: 'message', text: descriptionText }
        ]
      };
    }

    // 9. Open latest/recent email: "Open the latest email from David", "open the recent email"
    if (msg.includes('open') || msg.includes('view') || msg.includes('show')) {
      const fromDavid = userMessage.match(/(from|by)\s+(\w+)/i)?.[2] || '';
      return {
        reasoning: 'Fallback: Open email command detected.',
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
        { type: 'message', text: `Command not fully recognized. Connection to Gemini is limited (Rate limit 429). Please try direct commands like "send email to...", "reply to this", or "unread emails".` }
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

  /**
   * Generates a context-aware draft reply locally when Gemini is rate-limited
   */
  private static generateLocalContextualReply(subject: string, body: string): string {
    const sub = (subject || '').toLowerCase();
    const content = (body || '').toLowerCase();

    if (sub.includes('storage') || sub.includes('space') || content.includes('storage') || content.includes('full')) {
      return "Thank you for the notification regarding the Google Account storage limit. I will review my Gmail storage and clean up unnecessary files to free up space.";
    }
    
    if (sub.includes('failure') || sub.includes('failed') || sub.includes('delivery status') || sub.includes('undelivered')) {
      return "I have received the delivery failure notice. I will check the recipient's email address for any typos and attempt to resend the message.";
    }

    if (sub.includes('security') || sub.includes('alert') || sub.includes('sign-in')) {
      return "Thank you for the security alert. I have checked the sign-in details and verified that this was an authorized activity.";
    }

    if (sub.includes('meeting') || sub.includes('schedule') || sub.includes('call') || sub.includes('zoom')) {
      return "Thank you for the invitation. I have checked my calendar, noted the meeting details, and will join at the scheduled time.";
    }

    if (sub.includes('newsletter') || sub.includes('weekly') || sub.includes('digest') || sub.includes('codepen') || sub.includes('update')) {
      return "Thank you for sharing the latest update. I will check out the details and let you know if I have any questions.";
    }

    // Dynamic fallback using the subject
    const cleanSubject = (subject || '').replace(/^re:\s*/i, '').trim();
    if (cleanSubject && cleanSubject !== '(no subject)') {
      return `Thank you for your email regarding "${cleanSubject}". I have received your message and will review the details to get back to you as soon as possible.`;
    }

    return "Thank you for your email. I have received it and will review the details to get back to you shortly.";
  }

  /**
   * Helper to robustly extract subject from natural language compose commands
   */
  private static extractSubject(msg: string): string {
    const subjMarker = 'subject ';
    const subjIdx = msg.toLowerCase().indexOf(subjMarker);
    if (subjIdx === -1) return 'No Subject';
    
    let endIdx = msg.toLowerCase().indexOf(' and body', subjIdx);
    if (endIdx === -1) {
      endIdx = msg.toLowerCase().indexOf(' body', subjIdx);
    }
    
    let subjContent = '';
    if (endIdx !== -1) {
      subjContent = msg.substring(subjIdx + subjMarker.length, endIdx).trim();
    } else {
      subjContent = msg.substring(subjIdx + subjMarker.length).trim();
    }
    
    // Strip opening and closing quotes if present
    const firstChar = subjContent.charAt(0);
    if (firstChar === "'" || firstChar === '"' || firstChar === '‘' || firstChar === '“') {
      subjContent = subjContent.substring(1);
      const lastChar = subjContent.charAt(subjContent.length - 1);
      if (lastChar === firstChar || 
          (firstChar === '‘' && lastChar === '’') || 
          (firstChar === '“' && lastChar === '”')) {
        subjContent = subjContent.substring(0, subjContent.length - 1);
      }
    }
    
    return subjContent.trim();
  }

  /**
   * Helper to robustly extract body from natural language compose commands
   */
  private static extractBody(msg: string): string {
    const bodyMarker = 'body ';
    const bodyIdx = msg.toLowerCase().indexOf(bodyMarker);
    if (bodyIdx === -1) return 'No Content';
    
    let bodyContent = msg.substring(bodyIdx + bodyMarker.length).trim();
    
    // Strip opening and closing quotes if present
    const firstChar = bodyContent.charAt(0);
    if (firstChar === "'" || firstChar === '"' || firstChar === '‘' || firstChar === '“') {
      bodyContent = bodyContent.substring(1);
      const lastChar = bodyContent.charAt(bodyContent.length - 1);
      if (lastChar === firstChar || 
          (firstChar === '‘' && lastChar === '’') || 
          (firstChar === '“' && lastChar === '”')) {
        bodyContent = bodyContent.substring(0, bodyContent.length - 1);
      }
    }
    
    return bodyContent.trim();
  }

  /**
   * Helper to extract relative/exact scheduled time from natural language commands
   */
  private static extractScheduleTime(msg: string): string {
    const timeMatch = msg.match(/at\s+(\d{1,2})[.:](\d{2})\s*(pm|am)?/i);
    const date = new Date();
    
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      date.setHours(hours, minutes, 0, 0);
      
      // If the time has already passed today, assume they mean tomorrow
      if (date <= new Date()) {
        date.setDate(date.getDate() + 1);
      }
      return date.toISOString();
    }
    
    // Check for "in X hours" or "in X minutes"
    const inHoursMatch = msg.match(/in\s+(\d+)\s+hour/i);
    if (inHoursMatch) {
      return new Date(Date.now() + parseInt(inHoursMatch[1], 10) * 3600 * 1000).toISOString();
    }
    const inMinsMatch = msg.match(/in\s+(\d+)\s+min/i);
    if (inMinsMatch) {
      return new Date(Date.now() + parseInt(inMinsMatch[1], 10) * 60 * 1000).toISOString();
    }
    
    // Default to 1 hour from now
    return new Date(Date.now() + 3600 * 1000).toISOString();
  }
}
