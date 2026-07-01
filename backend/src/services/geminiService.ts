// backend/src/services/geminiService.ts
import axios from 'axios';
import { GeminiResponse, AppState } from '../types';

export class GeminiService {
  private apiKey: string;
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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
      actions.push({ type: 'message', text: `Forwarding email to ${toEmail}. Review the draft and click Send.` });
      
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
      
      // Check if user provided specific reply text
      const customSaying = userMessage.match(/(saying|with|response)[:\s]+['"]?([^'"]+)['"]?/i)?.[2] || 
                           userMessage.match(/reply\s+['"]?([^'"]+?)['"]?$/i)?.[1];
      if (customSaying && !customSaying.includes('to the') && !customSaying.includes('to this')) {
        // User gave specific text — make it into a natural reply
        replyText = GeminiService.generateNaturalReplyBody(
          targetEmail?.subject || '', 
          targetEmail?.body || '', 
          customSaying
        );
      } else if (targetEmail) {
        // No specific text — generate contextual reply from email content
        replyText = GeminiService.generateNaturalReplyBody(
          targetEmail.subject, 
          targetEmail.body, 
          ''
        );
      }
      
      const actions: any[] = [];
      if (isRecent) {
        actions.push({ type: 'search', query: 'is:inbox', filters: {} });
      }
      actions.push({ type: 'reply', body: replyText });
      actions.push({ type: 'message', text: `Drafted a reply. Review the draft and click Send when ready.` });
      
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

    // 6. Schedule email: triggered by explicit "schedule" keyword OR a precise time indicator (e.g. HH:MM format like "at 11:28pm")
    const hasPreciseTime = /\bat\s+\d{1,2}[.:]\d{2}\s*(pm|am)?/i.test(userMessage) ||
                           /\bin\s+\d+\s+(hour|min)/i.test(userMessage);
    const hasScheduleKeyword = msg.includes('schedule');
    const isSchedule = (hasScheduleKeyword || hasPreciseTime) && msg.includes('email') && emailMatch;

    if (isSchedule) {
      const toEmail = emailMatch[1];
      const subject = GeminiService.extractSubject(userMessage);
      let rawBody = GeminiService.extractBody(userMessage);
      
      // Strip trailing precise schedule time from the body so it is not literally in the email
      rawBody = rawBody.replace(/\s*at\s+\d{1,2}[.:]\d{2}\s*(pm|am)?\s*$/i, '').trim();
      rawBody = rawBody.replace(/\s*in\s+\d+\s+(hour|min)s?\s*$/i, '').trim();
      // Strip any unmatched trailing quote resulting from the split
      rawBody = rawBody.replace(/['"]$/, '').trim();

      const body = GeminiService.generateNaturalEmailBody(subject, rawBody, toEmail);
      const timezoneOffset = (appState as any).clientTimezoneOffset;
      const scheduledAt = GeminiService.extractScheduleTime(userMessage, timezoneOffset);
      
      return {
        reasoning: 'Fallback: Schedule email command parsed.',
        actions: [
          { type: 'schedule', to: toEmail, subject, body, scheduledAt },
          { type: 'message', text: `Scheduled email to ${toEmail} with subject: "${subject}" for ${new Date(scheduledAt).toLocaleString()}` }
        ]
      };
    }

    // 7. Compose/Send email: "Send an email to john@example.com with subject 'Meeting' and body 'Let's meet'"
    if ((msg.includes('send') || msg.includes('compose') || msg.includes('write')) && msg.includes('email') && emailMatch) {
      const toEmail = emailMatch[1];
      const subject = GeminiService.extractSubject(userMessage);
      const rawBody = GeminiService.extractBody(userMessage);
      
      // Generate a professional, natural email body from the user's raw intent
      const body = GeminiService.generateNaturalEmailBody(subject, rawBody, toEmail);
      
      const actions: any[] = [
        { type: 'navigate', view: 'compose' },
        { type: 'fillForm', formId: 'composeForm', fields: { to: toEmail, subject, body } },
        { type: 'message', text: `Drafted email to ${toEmail} with subject: "${subject}". Review and click Send.` }
      ];
      
      return {
        reasoning: 'Fallback: Compose email command parsed.',
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

  private buildSystemPrompt(appState: any): string {
    const currentEmailInfo = appState.currentEmail
      ? `From: ${appState.currentEmail.from_address}, Subject: "${appState.currentEmail.subject}", ID: ${appState.currentEmail.id}, Body: "${appState.currentEmail.body.substring(0, 300)}"`
      : 'None';

    const clientTimeStr = appState.clientTime || new Date().toString();
    const timezoneOffset = appState.clientTimezoneOffset !== undefined ? appState.clientTimezoneOffset : new Date().getTimezoneOffset();
    const clientLocalIso = appState.clientLocalIso || new Date().toLocaleString();

    return `You are an AI assistant for a mail application. You control the UI by returning a structured JSON action plan. You are NOT a chatbot — you take actions.

CURRENT APP STATE:
- View: ${appState.currentView}
- Current Email Open: ${currentEmailInfo}
- Total Emails Visible: ${appState.emails.length}
- Unread Count: ${appState.unreadCount}
- Active Filters: ${JSON.stringify(appState.filters)}
- Current User Local Date/Time: ${clientTimeStr} (Format: ${clientLocalIso})
- User Timezone Offset: ${timezoneOffset} minutes (Difference from UTC)
- Reference UTC Date/Time: ${new Date().toISOString()}

INSTRUCTIONS FOR TIME CALCULATION:
1. The user's current local date and time is "${clientTimeStr}".
2. If the user mentions any relative or exact time (e.g. "tomorrow at 5 PM", "in 2 hours", "at 11:36pm"), you MUST calculate the target date and time relative to this local time, convert the calculated local time to a UTC ISO string, and return that UTC ISO string as the value for "scheduledAt".
3. E.g., if user local time is 11:36 PM (offset -330 mins / +05:30) and they say "at 11:36pm", the target is 11:36 PM local time of today. Since local time is 23:36 and offset is -330 mins (+05:30), the target UTC time is 18:06 UTC of today, so return "2026-07-01T18:06:00.000Z".

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
5. Avoid any HTML tags in the preview or message text.
6. When composing or scheduling an email ("fillForm" or "schedule" actions): if the user's raw message or body contains brief notes, fragmented sentences, or grammatical stutters (e.g. "Let's meet and about the new tech news with new tech news"), you MUST rewrite and expand it into a naturally written, professional email body (including a greeting like "Hi,", coherent paragraphs, and a professional sign-off like "Best regards"). Do not copy stutters or raw shorthand text literally.`;
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
   * Generates a professional, natural email body from raw user intent
   * Transforms brief notes like "Let's meet about tech news" into a proper email
   */
  private static generateNaturalEmailBody(subject: string, rawBody: string, toEmail: string): string {
    // If the user already wrote a long, complete body, don't over-process it
    if (rawBody.length > 150 || rawBody.includes('\n')) {
      return `Hi,\n\n${rawBody}\n\nBest regards`;
    }
    
    // If body is "No Content" or empty, generate from subject
    if (!rawBody || rawBody === 'No Content') {
      const sub = (subject || '').toLowerCase();
      if (sub.includes('meeting')) {
        return `Hi,\n\nI wanted to reach out regarding ${subject}. Could we schedule a time to connect and discuss? Please let me know your availability, and I will send over a calendar invite.\n\nLooking forward to hearing from you.\n\nBest regards`;
      }
      if (sub.includes('update') || sub.includes('report')) {
        return `Hi,\n\nI hope this email finds you well. I am writing to provide you with an update on ${subject}. Please find the details below, and feel free to reach out if you have any questions.\n\nBest regards`;
      }
      return `Hi,\n\nI hope this email finds you well. I am writing to you regarding ${subject}. I would love to discuss this further at your convenience.\n\nPlease let me know if you have any questions.\n\nBest regards`;
    }
    
    // Transform short raw body into a professional email
    const sub = (subject || '').toLowerCase();
    const raw = rawBody.trim();
    
    if (sub.includes('meeting') || raw.includes('meet') || raw.includes('discuss')) {
      return `Hi,\n\n${raw.charAt(0).toUpperCase() + raw.slice(1)}. Please let me know your availability so we can coordinate. I look forward to our conversation.\n\nBest regards`;
    }
    
    if (sub.includes('follow') || raw.includes('follow')) {
      return `Hi,\n\nI am following up on our earlier discussion. ${raw.charAt(0).toUpperCase() + raw.slice(1)}. Please let me know if there are any updates on your end.\n\nThank you,\nBest regards`;
    }
    
    if (sub.includes('thank') || raw.includes('thank')) {
      return `Hi,\n\n${raw.charAt(0).toUpperCase() + raw.slice(1)}. I truly appreciate your help and support.\n\nWarm regards`;
    }
    
    // General case — wrap raw content in a professional email format
    return `Hi,\n\n${raw.charAt(0).toUpperCase() + raw.slice(1)}.\n\nPlease feel free to reach out if you have any questions or need further details.\n\nBest regards`;
  }

  /**
   * Generates a context-aware, natural reply body from original email content
   * If userIntent is provided, incorporates it; otherwise generates from context
   */
  private static generateNaturalReplyBody(originalSubject: string, originalBody: string, userIntent: string): string {
    const sub = (originalSubject || '').toLowerCase().replace(/^(re:|fwd:)\s*/gi, '').trim();
    const content = (originalBody || '').toLowerCase();
    const intent = (userIntent || '').trim();
    
    // If user provided specific intent, wrap it naturally
    if (intent) {
      return `Hi,\n\n${intent.charAt(0).toUpperCase() + intent.slice(1)}.\n\nPlease let me know if you need anything else.\n\nBest regards`;
    }
    
    // Context-aware auto-reply based on email content analysis
    if (sub.includes('storage') || sub.includes('space') || content.includes('storage') || content.includes('quota')) {
      return `Hi,\n\nThank you for the notification regarding the storage limit. I will review my account storage and clean up unnecessary files to free up space right away.\n\nBest regards`;
    }
    
    if (sub.includes('failure') || sub.includes('failed') || sub.includes('delivery') || sub.includes('undelivered') || sub.includes('bounce')) {
      return `Hi,\n\nI have received the delivery failure notice. I will verify the recipient's email address for any errors and attempt to resend the message.\n\nThank you for the alert.\n\nBest regards`;
    }

    if (sub.includes('security') || sub.includes('alert') || sub.includes('sign-in') || sub.includes('suspicious')) {
      return `Hi,\n\nThank you for the security alert. I have reviewed the sign-in activity and can confirm that it was authorized. I will continue to monitor my account for any unusual activity.\n\nBest regards`;
    }

    if (sub.includes('meeting') || sub.includes('schedule') || sub.includes('call') || sub.includes('zoom') || sub.includes('invite')) {
      return `Hi,\n\nThank you for the meeting invitation. I have noted the details and will be available at the scheduled time. Looking forward to our discussion.\n\nBest regards`;
    }
    
    if (sub.includes('interview') || sub.includes('application') || sub.includes('hiring') || sub.includes('job') || sub.includes('position')) {
      return `Hi,\n\nThank you for reaching out regarding this opportunity. I am very interested and would be happy to discuss further at your convenience.\n\nPlease let me know the next steps.\n\nBest regards`;
    }
    
    if (sub.includes('invoice') || sub.includes('payment') || sub.includes('billing') || sub.includes('receipt')) {
      return `Hi,\n\nThank you for sending this over. I have received the document and will review the details. I will get back to you shortly if I have any questions.\n\nBest regards`;
    }

    if (sub.includes('newsletter') || sub.includes('weekly') || sub.includes('digest') || sub.includes('update') || sub.includes('announcement')) {
      return `Hi,\n\nThank you for the update. I have gone through the details and appreciate you sharing this information.\n\nBest regards`;
    }
    
    if (content.includes('question') || content.includes('help') || content.includes('assist') || content.includes('support')) {
      return `Hi,\n\nThank you for reaching out. I would be happy to help with this. Let me look into the details and I will get back to you with a response shortly.\n\nBest regards`;
    }
    
    if (content.includes('congratulat') || content.includes('welcome') || content.includes('great news')) {
      return `Hi,\n\nThank you so much! I really appreciate the kind words. Looking forward to continuing to work together.\n\nBest regards`;
    }

    // Generic contextual fallback using the subject
    if (sub && sub !== '(no subject)') {
      return `Hi,\n\nThank you for your email regarding "${originalSubject.replace(/^(re:|fwd:)\s*/gi, '').trim()}". I have reviewed the details and will follow up accordingly.\n\nPlease feel free to reach out if there is anything else to discuss.\n\nBest regards`;
    }

    return `Hi,\n\nThank you for your email. I have received it and will review the details. I will get back to you shortly.\n\nBest regards`;
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
  private static extractScheduleTime(msg: string, timezoneOffsetMins?: number): string {
    const timeMatch = msg.match(/at\s+(\d{1,2})[.:](\d{2})\s*(pm|am)?/i);
    const date = new Date();
    
    // Default to server offset if not specified
    const offset = timezoneOffsetMins !== undefined ? timezoneOffsetMins : new Date().getTimezoneOffset();
    
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      // Calculate server-user timezone offset difference in milliseconds
      const serverOffset = date.getTimezoneOffset();
      const diffMs = (serverOffset - offset) * 60 * 1000;
      
      // Represent server time in user's local timezone
      const userLocalDate = new Date(date.getTime() + diffMs);
      userLocalDate.setHours(hours, minutes, 0, 0);
      
      // Convert back to UTC server time
      const targetUtcDate = new Date(userLocalDate.getTime() - diffMs);
      
      // Calculate user's current local date/time
      const nowUserLocalDate = new Date(new Date().getTime() + diffMs);
      if (userLocalDate <= nowUserLocalDate) {
        const diffMsBetween = nowUserLocalDate.getTime() - userLocalDate.getTime();
        // If it's within the last 5 minutes of local time, schedule 1 minute in the future
        if (diffMsBetween > 0 && diffMsBetween < 5 * 60 * 1000) {
          return new Date(Date.now() + 60 * 1000).toISOString();
        } else {
          // Assume tomorrow
          userLocalDate.setDate(userLocalDate.getDate() + 1);
          return new Date(userLocalDate.getTime() - diffMs).toISOString();
        }
      }
      return targetUtcDate.toISOString();
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
