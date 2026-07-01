// frontend/src/store/mailStore.ts
import { create } from 'zustand';
import { Email, AppState, AuthUser, EmailFilters } from '../types';

interface MailStore extends AppState {
  // State
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authToken: string | null;
  
  // View-specific email caches to make folder navigation instant
  inboxEmails: Email[];
  sentEmails: Email[];
  scheduledEmails: Email[];
  
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
  inboxEmails: [],
  sentEmails: [],
  scheduledEmails: [],
  
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
  setCurrentView: (view) => set((state) => {
    // When switching folders, instantly populate the view with cached emails
    // to prevent any lag or old folder's emails showing up while new ones load
    let activeEmails = state.emails;
    if (view === 'inbox') {
      activeEmails = state.inboxEmails;
    } else if (view === 'sent') {
      activeEmails = state.sentEmails;
    } else if (view === 'scheduled') {
      activeEmails = state.scheduledEmails;
    }
    return { currentView: view, emails: activeEmails };
  }),
  setCurrentEmail: (email) => set({ currentEmail: email }),
  setEmails: (emails) => {
    set((state) => {
      const updates: Partial<MailStore> = { emails };
      // Cache results based on the view if we are not actively searching
      if (!state.isSearching) {
        if (state.currentView === 'inbox' || state.currentView === 'detail') {
          updates.inboxEmails = emails;
        } else if (state.currentView === 'sent') {
          updates.sentEmails = emails;
        } else if (state.currentView === 'scheduled') {
          updates.scheduledEmails = emails;
        }
      }
      return updates;
    });
  },
  setFilters: (filters) => {
    set({ filters });
  },
  setUnreadCount: (count) => set({ unreadCount: count }),
  setIsSearching: (isSearching) => {
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
