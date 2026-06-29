// frontend/src/types/index.ts

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
  date: string | Date;
  gmail_message_id: string;
  created_at: string | Date;
  updated_at: string | Date;
  status?: string;
  error_message?: string;
}

export interface EmailFilters {
  dateRange?: string;
  sender?: string;
  keyword?: string;
  isRead?: boolean;
}

export interface AppState {
  currentView: 'inbox' | 'sent' | 'compose' | 'detail' | 'scheduled';
  currentEmail?: Email | null;
  emails: Email[];
  filters: EmailFilters;
  unreadCount: number;
  user?: AuthUser | null;
}

export type AIActionType = 'navigate' | 'fillForm' | 'search' | 'submit' | 'message' | 'openEmail' | 'reply' | 'forward' | 'delete' | 'markRead' | 'schedule';

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
