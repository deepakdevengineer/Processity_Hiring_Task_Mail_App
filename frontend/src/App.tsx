// frontend/src/App.tsx
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMailStore } from './store/mailStore';
import { authAPI, emailAPI, aiAPI } from './api/client';
import { Inbox } from './components/Inbox';
import { EmailDetail } from './components/EmailDetail';
import { ComposeModal } from './components/ComposeModal';
import { AIAssistantPanel } from './components/AIAssistantPanel';
import { Mail, LogOut, Edit, Send, Inbox as InboxIcon, Loader, User, Clock, ToggleLeft, ToggleRight, Sparkles } from 'lucide-react';

export const MainApp: React.FC = () => {
  const { 
    currentView, 
    setCurrentView, 
    user, 
    setUser, 
    authToken, 
    setAuthToken,
    unreadCount,
    setUnreadCount,
    setEmails,
    autoReplyEnabled,
    setAutoReplyEnabled,
    scheduledCount,
    setScheduledCount
  } = useMailStore();
  
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [autopilotProcessing, setAutopilotProcessing] = useState(false);

  useEffect(() => {
    const verifyUser = async () => {
      try {
        if (authToken) {
          const response = await authAPI.me();
          setUser(response.data);
        } else {
          setUser(null);
        }
      } catch {
        setAuthToken(null);
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    };
    verifyUser();
  }, [authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authToken || !user) return;

    const pollEmails = async () => {
      try {
        const store = useMailStore.getState();
        // 1. Fetch inbox emails
        const response = await emailAPI.getInbox(20);
        const inboxEmails = response.data.data || [];
        if (currentView === 'inbox' && !store.isSearching) {
          setEmails(inboxEmails);
        }
        
        const unread = inboxEmails.filter((e: any) => !e.is_read);
        setUnreadCount(unread.length);

        // 2. Fetch scheduled count
        const schedRes = await emailAPI.getScheduled();
        const pendingScheduled = (schedRes.data.data || []).filter((item: any) => item.status === 'pending');
        setScheduledCount(pendingScheduled.length);

        // 3. AI Autopilot auto-reply logic
        if (store.autoReplyEnabled && unread.length > 0 && !autopilotProcessing) {
          setAutopilotProcessing(true);
          const repliedIds = JSON.parse(localStorage.getItem('ai_replied_ids') || '[]');
          
          for (const email of unread) {
            if (!repliedIds.includes(email.id)) {
              console.log(`[Autopilot] Triggering auto-reply for: ${email.subject}`);
              
              const appState = {
                currentView: 'detail' as const,
                currentEmail: email,
                emails: inboxEmails,
                filters: {},
                unreadCount: unread.length
              };

              const command = `Draft a polite, professional reply to this email to address their points and submit/send it immediately.`;
              
              try {
                // Call AI endpoint to draft and send reply
                await aiAPI.execute(command, appState, {
                  to: email.from_address,
                  subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
                  body: ''
                });

                repliedIds.push(email.id);
                localStorage.setItem('ai_replied_ids', JSON.stringify(repliedIds));

                // Mark read locally and on server
                await emailAPI.markRead(email.id);
              } catch (aiErr) {
                console.error('[Autopilot] Auto-reply failed:', aiErr);
              }
            }
          }
          setAutopilotProcessing(false);
          // Refresh inbox list after replies are sent
          if (!store.isSearching) {
            const updatedRes = await emailAPI.getInbox(20);
            setEmails(updatedRes.data.data || []);
            setUnreadCount((updatedRes.data.data || []).filter((e: any) => !e.is_read).length);
          }
        }
      } catch (err) {
        console.error('Error polling inbox:', err);
        setAutopilotProcessing(false);
      }
    };

    pollEmails();
    const interval = setInterval(pollEmails, 15000); // Poll every 15s for snappy responsiveness
    return () => clearInterval(interval);
  }, [authToken, user, currentView, autopilotProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    try { await authAPI.logout(); } catch {}
    setAuthToken(null);
    setUser(null);
    window.location.href = '/login';
  };

  if (checkingAuth) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary)',
        gap: '12px'
      }}>
        <Loader size={24} className="spin-anim" style={{ color: 'var(--accent-1)' }} />
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading...</span>
      </div>
    );
  }

  if (!authToken || !user) return <Navigate to="/login" replace />;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
      overflow: 'hidden'
    }}>
      {/* Top Nav Bar */}
      <header style={{
        height: '56px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            background: 'var(--accent-1)',
            padding: '7px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Mail size={16} style={{ color: 'white' }} />
          </div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Mail<span style={{ color: 'var(--accent-2)' }}>AI</span>
          </span>
        </div>

        {/* Global Notification Banner / Scheduler Info & AI Autopilot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Scheduled Emails Notification bar */}
          {scheduledCount > 0 ? (
            <div 
              onClick={() => setCurrentView('scheduled')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: '99px',
                fontSize: '12px',
                color: 'var(--accent-2)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)'; }}
            >
              <Clock size={12} className="spin-anim" style={{ animationDuration: '6s' }} />
              <span><strong>{scheduledCount} email{scheduledCount !== 1 ? 's' : ''}</strong> scheduled to send</span>
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--text-muted)'
            }}>
              <Clock size={12} />
              <span>No pending scheduled sends</span>
            </div>
          )}

          {/* AI Autopilot Mode Toggle */}
          <div 
            onClick={() => setAutoReplyEnabled(!autoReplyEnabled)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: autoReplyEnabled ? 'rgba(34, 197, 94, 0.08)' : 'var(--bg-primary)',
              border: `1px solid ${autoReplyEnabled ? 'rgba(34, 197, 94, 0.3)' : 'var(--border)'}`,
              borderRadius: '99px',
              fontSize: '12px',
              cursor: 'pointer',
              color: autoReplyEnabled ? 'var(--success)' : 'var(--text-secondary)',
              transition: 'all 0.15s ease',
              fontWeight: 500
            }}
          >
            <Sparkles size={12} style={{ color: autoReplyEnabled ? 'var(--success)' : 'var(--text-muted)' }} />
            <span>AI Auto-Reply</span>
            {autoReplyEnabled ? (
              <ToggleRight size={18} style={{ color: 'var(--success)' }} />
            ) : (
              <ToggleLeft size={18} style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
        </div>

        {/* User profile / Logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'var(--accent-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <User size={13} style={{ color: '#fff' }} />
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{user.email}</span>
          </div>
          <button onClick={handleLogout} className="btn-ghost" style={{ padding: '6px 12px', height: '32px', fontSize: '12px' }}>
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <aside style={{
          width: '200px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
          padding: '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flexShrink: 0
        }}>
          <button
            onClick={() => setCurrentView('compose')}
            className="btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '13px'
            }}
          >
            <Edit size={14} />
            Compose
          </button>

          {/* Inbox nav */}
          <button
            onClick={() => {
              const store = useMailStore.getState();
              store.setFilters({});
              store.setIsSearching(false);
              setCurrentView('inbox');
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 12px',
              background: currentView === 'inbox' || currentView === 'detail' ? 'var(--bg-active)' : 'transparent',
              color: currentView === 'inbox' || currentView === 'detail' ? 'var(--accent-2)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              fontWeight: currentView === 'inbox' || currentView === 'detail' ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <InboxIcon size={15} />
              Inbox
            </div>
            {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
          </button>

          {/* Sent nav */}
          <button
            onClick={() => setCurrentView('sent')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 12px',
              background: currentView === 'sent' ? 'var(--bg-active)' : 'transparent',
              color: currentView === 'sent' ? 'var(--accent-2)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              fontWeight: currentView === 'sent' ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
              justifyContent: 'flex-start'
            }}
          >
            <Send size={15} />
            Sent
          </button>

          {/* Scheduled nav */}
          <button
            onClick={() => setCurrentView('scheduled')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 12px',
              background: currentView === 'scheduled' ? 'var(--bg-active)' : 'transparent',
              color: currentView === 'scheduled' ? 'var(--accent-2)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '13px',
              fontWeight: currentView === 'scheduled' ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: 'inherit',
              justifyContent: 'flex-start'
            }}
          >
            <Clock size={15} />
            Scheduled
          </button>
        </aside>

        {/* Main email area */}
        <main style={{
          flex: 1,
          overflow: 'hidden',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {currentView === 'inbox' && <Inbox />}
          {currentView === 'sent' && <Inbox isSent={true} />}
          {currentView === 'scheduled' && <Inbox isScheduled={true} />}
          {currentView === 'compose' && <ComposeModal />}
          {currentView === 'detail' && <EmailDetail />}
        </main>

        {/* AI Panel */}
        <aside style={{
          width: '340px',
          background: 'var(--bg-secondary)',
          overflow: 'hidden',
          flexShrink: 0
        }}>
          <AIAssistantPanel />
        </aside>
      </div>
    </div>
  );
};

export default MainApp;
