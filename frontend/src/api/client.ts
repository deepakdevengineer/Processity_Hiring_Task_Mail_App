// frontend/src/api/client.ts
import axios, { AxiosInstance } from 'axios';
import { useMailStore } from '../store/mailStore';

let API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Auto-switch to live Render backend if frontend is hosted on Vercel/Render but API_URL is localhost
if (typeof window !== 'undefined' && window.location) {
  const host = window.location.hostname;
  if ((host.includes('vercel.app') || host.includes('render.com')) && API_URL.includes('localhost')) {
    API_URL = 'https://processity-hiring-task-mail-app.onrender.com';
  }
}

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle errors
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('auth_token');
      useMailStore.setState({ authToken: null, user: null });
      // Only redirect if not already on login page to avoid loops
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: () => client.get('/auth/login'),
  logout: () => client.post('/auth/logout'),
  me: () => client.get('/auth/me'),
  verify: () => client.get('/auth/verify'),
  sandbox: () => client.post('/auth/sandbox'),
};

// Email API
export const emailAPI = {
  getInbox: (limit?: number) => 
    client.get('/api/emails/inbox', { params: { limit } }),
  
  getSent: (limit?: number) => 
    client.get('/api/emails/sent', { params: { limit } }),
  
  getEmail: (id: string) => 
    client.get(`/api/emails/${id}`),
  
  send: (to: string, subject: string, body: string, cc?: string[], bcc?: string[]) =>
    client.post('/api/emails/send', { to, subject, body, cc, bcc }),
  
  search: (query: string, filters?: any, limit?: number) =>
    client.post('/api/emails/search', { query, filters, limit }),
  
  markRead: (id: string) =>
    client.post(`/api/emails/${id}/mark-read`),
  
  delete: (id: string) =>
    client.delete(`/api/emails/${id}`),
    
  schedule: (to: string, subject: string, body: string, scheduledAt: string) =>
    client.post('/api/emails/schedule', { to, subject, body, scheduledAt }),
    
  getScheduled: () =>
    client.get('/api/emails/scheduled'),
    
  deleteScheduled: (id: number) =>
    client.delete(`/api/emails/scheduled/${id}`),
};

// AI API
export const aiAPI = {
  execute: (userMessage: string, appState: any, composeData?: any) =>
    client.post('/api/ai/execute', { userMessage, appState, composeData }),
  
  parse: (userMessage: string, appState: any) =>
    client.post('/api/ai/parse', { userMessage, appState }),
  
  test: () =>
    client.post('/api/ai/test'),
  
  health: () =>
    client.get('/api/ai/health'),
    
  getSuggestions: (subject: string, body: string) =>
    client.post('/api/ai/suggestions', { subject, body }),
};

export default client;
