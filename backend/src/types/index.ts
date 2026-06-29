// backend/src/types/index.ts

export interface User {
  id: number;
  email: string;
  google_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AuthUser {
  id: number;
  email: string;
  google_id: string;
}

export interface Email {
  id: string;
  user_id: number;
  from_address: string;
  to_addresses: string[];
  subject: string;
  body: string;
  thread_id: string;
  is_read: boolean;
  is_sent: boolean;
  date: Date;
  gmail_message_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface EmailFilters {
  dateRange?: string;
  sender?: string;
  keyword?: string;
  isRead?: boolean;
}

export interface AppState {
  currentView: 'inbox' | 'sent' | 'compose' | 'detail';
  currentEmail?: Email | null;
  emails: Email[];
  filters: EmailFilters;
  unreadCount: number;
  user?: AuthUser;
}

export type AIActionType = 'navigate' | 'fillForm' | 'search' | 'submit' | 'message' | 'openEmail';

export interface AIAction {
  type: AIActionType;
  [key: string]: any;
}

export interface GeminiResponse {
  reasoning: string;
  actions: AIAction[];
}

export interface SendEmailRequest {
  to: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export interface SearchEmailsRequest {
  query: string;
  filters?: EmailFilters;
  limit?: number;
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number | null;
  token_type: string;
  id_token?: string | null;
}

export interface GoogleOAuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
}

// Express augmented request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
