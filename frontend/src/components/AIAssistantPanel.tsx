// frontend/src/components/AIAssistantPanel.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useMailStore } from '../store/mailStore';
import { aiAPI, emailAPI } from '../api/client';
import { Send, Sparkles, Terminal, ArrowRight, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { AIAction } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: AIAction[];
}

// Extract raw email address from formatted string (e.g. "Name" <email@domain.com>)
const extractEmailAddress = (addr: string): string => {
  if (!addr) return '';
  const match = addr.match(/<(.+?)>/);
  return match ? match[1].trim() : addr.trim();
};

export const AIAssistantPanel: React.FC = () => {
  const mailStore = useMailStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, executingAction]);

  const { pendingAiCommand, setPendingAiCommand } = mailStore;

  useEffect(() => {
    if (pendingAiCommand) {
      handleSendMessage(pendingAiCommand);
      setPendingAiCommand(null);
    }
  }, [pendingAiCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSendMessage = async (overrideMessage?: string) => {
    const userMessage = overrideMessage || input.trim();
    if (!userMessage.trim() || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    if (!overrideMessage) setInput('');
    setLoading(true);

    try {
      const appState = {
        currentView: mailStore.currentView,
        currentEmail: mailStore.currentEmail,
        emails: mailStore.emails,
        filters: mailStore.filters,
        unreadCount: mailStore.unreadCount,
      };

      const response = await aiAPI.execute(userMessage, appState, mailStore.composeFields);
      const data = response.data.data;
      
      // Extract user-friendly message from actions if available
      const messageAction = data.actions?.find((a: any) => a.type === 'message');
      let displayContent = messageAction?.text || data.reasoning || 'Done.';
      
      // Clean up fallback/internal prefixes if displaying reasoning
      if (!messageAction && displayContent.startsWith('Fallback:')) {
        displayContent = displayContent.replace(/^Fallback:\s*/i, '');
      }
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: displayContent,
        actions: data.actions
      }]);

      await runFrontendActions(data.actions, userMessage);

    } catch (error) {
      const errMsg = (error as any).response?.data?.error || (error as Error).message;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${errMsg}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  const runFrontendActions = async (actions: AIAction[], userMessage: string) => {
    for (const action of actions) {
      try {
        setExecutingAction(action.type);
        const store = useMailStore.getState();
        
        switch (action.type) {
          case 'navigate':
            store.setCurrentView(action.view);
            if (action.emailId && action.view === 'detail') {
              const response = await emailAPI.getEmail(action.emailId);
              store.setCurrentEmail(response.data.data);
              if (!response.data.data.is_read) await emailAPI.markRead(action.emailId);
            }
            break;

          case 'fillForm':
            if (action.formId === 'composeForm' && action.fields) {
              const fields = { ...action.fields };
              if (fields.to) {
                fields.to = extractEmailAddress(fields.to);
              }
              store.setComposeFields(fields);
            }
            store.setCurrentView('compose');
            break;

          case 'search':
            if (action.results) {
              store.setIsSearching(true);
              store.setFilters(action.filters || { isAiSearch: true });
              store.setEmails(action.results);
              store.setCurrentView('inbox');
              
              // Add rich email preview cards to chat
              if (action.results.length > 0) {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `__RICH_RESULTS__`,
                  actions: undefined,
                  richResults: action.results.slice(0, 5)
                } as any]);
              }
              
              const lowerMsg = userMessage.toLowerCase();
              // Only auto-open if the command has an explicit action (open/read/view/reply/forward/delete)
              // or specifies a single recent email but NOT listing plural emails or unreads.
              const needsOpening = /\b(open|read|view|reply|forward|delete)\b/i.test(lowerMsg) || 
                                   (/\b(last|latest|recent)\b/i.test(lowerMsg) && !/\b(emails|unread)\b/i.test(lowerMsg));
              
              if (needsOpening && action.results.length > 0) {
                const firstEmail = action.results[0];
                store.setCurrentEmail(firstEmail);
                store.setCurrentView('detail');
                if (!firstEmail.is_read) await emailAPI.markRead(firstEmail.id);
              }
            }
            break;

          case 'openEmail':
            if (action.email) {
              store.setCurrentEmail(action.email);
              store.setCurrentView('detail');
              if (!action.email.is_read) await emailAPI.markRead(action.email.id);
            }
            break;

          case 'reply':
            {
              const email = store.currentEmail || store.emails[0] || (action as any).email;
              if (email) {
                const plainBody = email.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const date = new Date(email.date).toLocaleString();
                const replyBody = action.body || `\n\nOn ${date}, ${email.from_address} wrote:\n> ${plainBody.substring(0, 500)}`;
                
                store.setComposeFields({
                  to: extractEmailAddress(email.from_address),
                  subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
                  body: replyBody
                });
                store.setCurrentView('compose');
              }
            }
            break;

          case 'forward':
            {
              const email = store.currentEmail || store.emails[0] || (action as any).email;
              if (email) {
                const plainBody = email.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const date = new Date(email.date).toLocaleString();
                const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.from_address}\nDate: ${date}\nSubject: ${email.subject}\n\n${plainBody.substring(0, 1000)}`;
                
                store.setComposeFields({
                  to: action.to || '',
                  subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
                  body: fwdBody
                });
                store.setCurrentView('compose');
              }
            }
            break;

          case 'submit':
            if (action.formId === 'composeForm') {
              const freshStore = useMailStore.getState();
              const { to, subject, body } = freshStore.composeFields;
              if (to && subject) {
                // Human-in-the-loop confirmation
                const confirmed = window.confirm(
                  `📧 Confirm sending email?\n\nTo: ${to}\nSubject: ${subject}\nBody: ${body?.substring(0, 100)}${(body?.length || 0) > 100 ? '...' : ''}`
                );
                if (confirmed) {
                  try {
                    await emailAPI.send(to, subject, body || '');
                    freshStore.resetComposeFields();
                    freshStore.setCurrentView('sent');
                    const response = await emailAPI.getSent(20);
                    freshStore.setEmails(response.data.data);
                  } catch (err) {
                    console.error('Send failed:', err);
                  }
                } else {
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: '✋ Send cancelled. Your draft is still in the compose window — review and send when ready.'
                  }]);
                }
              }
            }
            break;

          case 'delete':
            {
              const eid = action.emailId || store.currentEmail?.id || store.emails[0]?.id;
              if (eid) {
                try {
                  await emailAPI.delete(eid);
                  store.setEmails(store.emails.filter(e => e.id !== eid));
                  if (store.currentEmail?.id === eid) {
                    store.setCurrentEmail(null);
                  }
                  store.setCurrentView('inbox');
                } catch (err) {
                  console.error('Delete failed:', err);
                }
              }
            }
            break;

          case 'markRead':
            if (action.emailId) {
              try {
                await emailAPI.markRead(action.emailId);
                store.setEmails(store.emails.map(e =>
                  e.id === action.emailId ? { ...e, is_read: true } : e
                ));
              } catch (err) {
                console.error('Mark read failed:', err);
              }
            }
            break;

          case 'schedule':
            if (action.to && action.subject && action.body && action.scheduledAt) {
              try {
                // Automatically schedule the email in backend
                await emailAPI.schedule(
                  extractEmailAddress(action.to),
                  action.subject,
                  action.body,
                  action.scheduledAt
                );
                
                // Clear compose inputs and switch to scheduled view
                store.resetComposeFields();
                store.setCurrentView('scheduled');
                
                // Re-fetch scheduled email list to display the newly scheduled email instantly
                const response = await emailAPI.getScheduled();
                const mapped = (response.data.data || []).map((item: any) => ({
                  id: String(item.id),
                  from_address: 'Me',
                  to_addresses: [item.to_address],
                  subject: item.subject,
                  body: item.body,
                  date: item.scheduled_at,
                  is_read: true,
                  is_sent: false,
                  status: item.status,
                  error_message: item.error_message
                }));
                store.setEmails(mapped);
                
                const parsedDate = new Date(action.scheduledAt);
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `✅ Email scheduled successfully to send to ${action.to} at ${parsedDate.toLocaleString()}.`
                }]);
              } catch (err) {
                console.error('Scheduling failed:', err);
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `❌ Failed to schedule email: ${(err as Error).message}`
                }]);
              }
            }
            break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`Action ${action.type} failed:`, err);
      } finally {
        setExecutingAction(null);
      }
    }
  };

  const suggestedCommands = [
    'Reply to the last email',
    'Show me unread emails from this week',
    'Send an email to user@test.com about project update',
    'Forward this email to someone@test.com',
    'Show only unread emails',
    'Find emails from the last 10 days'
  ];

  // Helper: render rich email preview card
  const renderRichEmailCard = (email: any) => {
    const senderName = email.from_address?.match(/^"?(.*?)"?\s*<.*?>/)?.[1] || email.from_address?.split('@')[0] || 'Unknown';
    const bodyPreview = email.body?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 80) || '';
    let timeAgo = '';
    try { timeAgo = formatDistanceToNow(new Date(email.date), { addSuffix: true }); } catch { timeAgo = ''; }
    
    return (
      <div
        key={email.id}
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}
      >
        <div 
          onClick={() => {
            const store = useMailStore.getState();
            store.setCurrentEmail(email);
            store.setCurrentView('detail');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{senderName}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{timeAgo}</span>
          </div>
          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {email.subject || '(No Subject)'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {bodyPreview || '(No preview)'}
          </div>
        </div>
        
        {/* Quick action buttons row */}
        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
          <button
            onClick={() => {
              const store = useMailStore.getState();
              store.setCurrentEmail(email);
              store.setCurrentView('detail');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-2)',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--accent-2)'}
          >
            Open
          </button>
          <button
            onClick={() => {
              const store = useMailStore.getState();
              store.setCurrentEmail(email);
              store.setCurrentView('detail');
              handleSendMessage('Reply to this email');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-2)',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--accent-2)'}
          >
            Reply
          </button>
          <button
            onClick={() => {
              const store = useMailStore.getState();
              store.setCurrentEmail(email);
              const plainBody = email.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const date = new Date(email.date).toLocaleString();
              const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.from_address}\nDate: ${date}\nSubject: ${email.subject}\n\n${plainBody.substring(0, 1000)}`;
              
              store.setComposeFields({
                to: '',
                subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
                body: fwdBody
              });
              store.setCurrentView('compose');
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-2)',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '2px 4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--accent-2)'}
          >
            Forward
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <Sparkles size={14} style={{ color: 'var(--accent-1)' }} />
        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>AI Assistant</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Delete all messages and clear chat history?')) {
                  setMessages([]);
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '4px',
                transition: 'all 0.15s ease'
              }}
              title="Clear conversation"
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <Trash2 size={11} />
              Clear Chat
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Online</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              padding: '14px',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)'
            }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Type commands in natural language to control your inbox. I can compose, reply, forward, search, delete, schedule, and send emails for you.
              </p>
            </div>
            
            <div>
              <span style={{ 
                fontSize: '10px', 
                color: 'var(--text-muted)', 
                display: 'block', 
                marginBottom: '8px', 
                textTransform: 'uppercase', 
                fontWeight: 600,
                letterSpacing: '0.05em'
              }}>
                Try these
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {suggestedCommands.map((cmd, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(cmd)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      fontSize: '12px',
                      width: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'inherit'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    <span>{cmd}</span>
                    <ArrowRight size={10} style={{ opacity: 0.4 }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg: any, idx) => (
            <div
              key={idx}
              className="fade-in"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%'
              }}
            >
              {/* Rich email preview cards */}
              {msg.content === '__RICH_RESULTS__' && msg.richResults ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
                    Found {msg.richResults.length} email{msg.richResults.length !== 1 ? 's' : ''} — click to open
                  </span>
                  {msg.richResults.map((email: any) => renderRichEmailCard(email))}
                </div>
              ) : (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user' ? 'var(--accent-1)' : 'var(--bg-primary)',
                  color: msg.role === 'user' ? '#ffffff' : 'var(--text-primary)',
                  fontSize: '13px',
                  lineHeight: 1.45,
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border)'
                }}>
                  {msg.content}
                </div>
              )}
              
              {msg.actions && msg.actions.length > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '4px',
                  paddingLeft: '4px',
                  fontSize: '10px',
                  color: 'var(--text-muted)'
                }}>
                  <Terminal size={10} />
                  {msg.actions.map((a: any) => a.type).join(' → ')}
                </div>
              )}
            </div>
          ))
        )}

        {executingAction && (
          <div className="fade-in" style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            fontSize: '11px',
            color: 'var(--accent-1)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(59, 130, 246, 0.06)',
            border: '1px solid rgba(59, 130, 246, 0.15)',
            alignSelf: 'center'
          }}>
            <Terminal size={12} className="spin-anim" />
            Executing: {executingAction}
          </div>
        )}

        {loading && !executingAction && (
          <div style={{
            display: 'flex',
            gap: '4px',
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            alignSelf: 'flex-start'
          }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--text-muted)',
                animation: `fadeIn 0.6s ease ${i * 0.15}s infinite alternate`
              }} />
            ))}
          </div>
        )}
        
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)'
      }}>
        <form
          onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
          style={{ display: 'flex', gap: '6px' }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            disabled={loading}
            className="input"
            style={{ height: '38px', fontSize: '13px' }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="btn-primary"
            style={{ width: '38px', height: '38px', padding: 0, flexShrink: 0 }}
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
};

