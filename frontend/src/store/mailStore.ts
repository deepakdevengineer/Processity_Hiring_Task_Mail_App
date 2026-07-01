// frontend/src/store/mailStore.ts
import { create } from 'zustand';
import { Email, AppState, AuthUser, EmailFilters } from '../types';

interface MailStore extends AppState {
  // State
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authToken: string | null;
  
  // Compose Form Fields (for AI UI Control)
  composeFields: {
    to: string;
    subject: string;
    body: string;
  };
  setComposeFields: (fields: Partial<{ to: string; subject: string; body: string }>) => void;
  resetComposeFields: () => void;

  // UI Actions
  setCurrentView: (view: 'inbox' | 'sent' | 'compose' | 'detail' | 'scheduled') => void;
  setCurrentEmail: (email: Email | null) => void;
  setEmails: (emails: Email[]) => void;
  setFilters: (filters: EmailFilters) => void;
  setUnreadCount: (count: number) => void;
  
  // User Actions
  setUser: (user: AuthUser | null) => void;
  setAuthToken: (token: string | null) => void;
  // UI State
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;

  // AI Trigger State
  pendingAiCommand: string | null;
  setPendingAiCommand: (command: string | null) => void;

  // Auto-Reply & Notifications State
  autoReplyEnabled: boolean;
  setAutoReplyEnabled: (enabled: boolean) => void;
  scheduledCount: number;
  setScheduledCount: (count: number) => void;
  isSearching: boolean;
  setIsSearching: (isSearching: boolean) => void;

  // Scheduler UI States (for AI Control)
  showScheduler: boolean;
  setShowScheduler: (show: boolean) => void;
  scheduleTime: string;
  setScheduleTime: (time: string) => void;
}

export const useMailStore = create<MailStore>((set) => ({
  // Initial state
  user: null,
  currentView: 'inbox',
  currentEmail: null,
  emails: [],
  filters: {},
  unreadCount: 0,
  loading: false,
  error: null,
  authToken: localStorage.getItem('auth_token'),
  isSearching: false,
  
  // Compose Form Fields State
  composeFields: {
    to: '',
    subject: '',
    body: '',
  },
  setComposeFields: (fields) =>
    set((state) => ({
      composeFields: { ...state.composeFields, ...fields },
    })),
  resetComposeFields: () =>
    set({
      composeFields: { to: '', subject: '', body: '' },
      showScheduler: false,
      scheduleTime: ''
    }),

  // UI Actions
  setCurrentView: (view) => set({ currentView: view }),
  setCurrentEmail: (email) => set({ currentEmail: email }),
  setEmails: (emails) => {
    const stack = new Error().stack;
    const token = localStorage.getItem('auth_token');
    fetch('http://localhost:3001/api/ai/log', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ event: 'setEmails', count: emails.length, stack })
    }).catch(() => {});
    set({ emails });
  },
  setFilters: (filters) => {
    set({ filters });
  },
  setUnreadCount: (count) => set({ unreadCount: count }),
  setIsSearching: (isSearching) => {
    const stack = new Error().stack;
    const token = localStorage.getItem('auth_token');
    fetch('http://localhost:3001/api/ai/log', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ event: 'setIsSearching', value: isSearching, stack })
    }).catch(() => {});
    set({ isSearching });
  },
  
  // User Actions
  setUser: (user) => set({ user }),
  setAuthToken: (token) => {
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
    set({ authToken: token });
  },
  
  // UI State
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),

  // AI Trigger State
  pendingAiCommand: null,
  setPendingAiCommand: (command) => set({ pendingAiCommand: command }),

  // Auto-Reply & Notifications State Implementation
  autoReplyEnabled: localStorage.getItem('ai_autopilot') === 'true',
  setAutoReplyEnabled: (enabled) => {
    localStorage.setItem('ai_autopilot', String(enabled));
    set({ autoReplyEnabled: enabled });
  },
  scheduledCount: 0,
  setScheduledCount: (count) => set({ scheduledCount: count }),

  // Scheduler State Initialization
  showScheduler: false,
  setShowScheduler: (show) => set({ showScheduler: show }),
  scheduleTime: '',
  setScheduleTime: (time) => set({ scheduleTime: time }),
}));
