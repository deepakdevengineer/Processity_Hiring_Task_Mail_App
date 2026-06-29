// frontend/src/components/Inbox.tsx
import React, { useEffect, useState } from 'react';
import { useMailStore } from '../store/mailStore';
import { emailAPI } from '../api/client';
import { Mail, Search, RefreshCw, AlertCircle, Trash2, Clock, AlertTriangle, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface EmailListProps {
  isSent?: boolean;
  isScheduled?: boolean;
}

// Strip HTML tags to show clean text preview
const stripHtml = (html: string): string => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

export const Inbox: React.FC<EmailListProps> = ({ isSent = false, isScheduled = false }) => {
  const { 
    emails, 
    setEmails, 
    setCurrentEmail, 
    setCurrentView, 
    loading, 
    setLoading 
  } = useMailStore();
  
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI Filtering State
  const [showFilters, setShowFilters] = useState(false);
  const [filterRead, setFilterRead] = useState<'all' | 'read' | 'unread'>('all');
  const [filterDate, setFilterDate] = useState<'any' | '7d' | '30d' | '90d'>('any');
  const [filterSender, setFilterSender] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  useEffect(() => {
    loadEmails();
  }, [isSent, isScheduled, filterRead, filterDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const getAppliedFilters = () => {
    const f: any = {};
    if (filterRead !== 'all') f.isRead = filterRead === 'read';
    if (filterDate !== 'any') f.dateRange = filterDate;
    if (filterSender.trim()) f.sender = filterSender.trim();
    if (filterKeyword.trim()) f.keyword = filterKeyword.trim();
    return f;
  };

  const loadEmails = async () => {
    try {
      setLoading(true);
      setError(null);
      
      let response;
      if (isScheduled) {
        response = await emailAPI.getScheduled();
      } else {
        const activeFilters = getAppliedFilters();
        const hasActiveFilters = Object.keys(activeFilters).length > 0;
        
        if (hasActiveFilters || searchQuery.trim()) {
          // If we have filters or query search, use search route
          response = await emailAPI.search(searchQuery, activeFilters);
        } else {
          // Normal fetch
          response = isSent ? await emailAPI.getSent(20) : await emailAPI.getInbox(20);
        }
      }

      const data = response.data.data || [];
      
      if (isScheduled) {
        // Map scheduled_emails database structure to Email interface
        const mapped = data.map((item: any) => ({
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
        setEmails(mapped);
      } else {
        setEmails(data);
      }
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    loadEmails();
  };

  const handleClearFilters = () => {
    setFilterRead('all');
    setFilterDate('any');
    setFilterSender('');
    setFilterKeyword('');
    setSearchQuery('');
  };

  const handleEmailClick = async (emailId: string) => {
    if (isScheduled) {
      const selected = emails.find(e => e.id === emailId);
      if (selected) {
        setCurrentEmail(selected);
        setCurrentView('detail');
      }
      return;
    }

    try {
      const response = await emailAPI.getEmail(emailId);
      const email = response.data.data;
      setCurrentEmail(email);
      setCurrentView('detail');
      
      if (!email.is_read && !isSent) {
        setEmails(emails.map(e => e.id === emailId ? { ...e, is_read: true } : e));
        await emailAPI.markRead(emailId);
      }
    } catch (err) {
      console.error('Error loading email details:', err);
    }
  };

  const handleCancelSchedule = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Cancel this scheduled email?')) return;

    try {
      setLoading(true);
      await emailAPI.deleteScheduled(Number(id));
      setEmails(emails.filter(email => email.id !== id));
      alert('Scheduled email cancelled successfully.');
    } catch (err) {
      console.error('Cancel scheduled error:', err);
      alert('Failed to cancel scheduled email.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (isScheduled) return;
    loadEmails();
  };

  const parseSenderName = (fromAddress: string) => {
    const match = fromAddress.match(/^"?(.*?)"?\s*<.*?>/);
    return match ? match[1].trim() : fromAddress.split('@')[0];
  };

  const getInitials = (fromAddress: string) => {
    const name = parseSenderName(fromAddress);
    const parts = name.split(/[\s._-]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const getAvatarColor = (str: string) => {
    const colors = [
      '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
      '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#e11d48'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        background: 'var(--bg-secondary)'
      }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {isScheduled ? 'Scheduled Queue' : isSent ? 'Sent' : 'Inbox'}
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {emails.length} message{emails.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isScheduled && (
            <>
              {/* Search Bar */}
              <form onSubmit={handleSearch} style={{ position: 'relative', width: '240px' }}>
                <input
                  type="text"
                  placeholder="Search mail..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input"
                  style={{ paddingLeft: '34px', height: '36px', fontSize: '13px' }}
                />
                <Search size={14} style={{
                  position: 'absolute',
                  left: '11px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)'
                }} />
              </form>

              {/* Filters Toggle Button */}
              <button 
                onClick={() => setShowFilters(!showFilters)} 
                className="btn-ghost"
                style={{ 
                  height: '36px', 
                  borderColor: showFilters ? 'var(--accent-1)' : 'var(--border)',
                  color: showFilters ? 'var(--accent-2)' : 'var(--text-secondary)'
                }}
                title="Filters"
              >
                <Filter size={14} />
                Filters
                {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </>
          )}

          <button 
            onClick={loadEmails} 
            disabled={loading}
            className="btn-ghost"
            style={{ width: '36px', height: '36px', padding: 0, justifyContent: 'center' }}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
          </button>
        </div>
      </div>

      {/* Dynamic Collapsible Filter Controls Panel */}
      {showFilters && !isScheduled && (
        <div className="fade-in" style={{
          padding: '16px 24px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <form onSubmit={handleApplyFilters} style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
            {/* Status Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Status</label>
              <select
                value={filterRead}
                onChange={(e) => setFilterRead(e.target.value as any)}
                className="input"
                style={{ width: '120px', height: '34px', padding: '0 8px' }}
              >
                <option value="all">All Mail</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
            </div>

            {/* Date Range Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Date Range</label>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value as any)}
                className="input"
                style={{ width: '140px', height: '34px', padding: '0 8px' }}
              >
                <option value="any">Anytime</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>

            {/* Sender Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Sender</label>
              <input
                type="text"
                placeholder="email@example.com"
                value={filterSender}
                onChange={(e) => setFilterSender(e.target.value)}
                className="input"
                style={{ width: '180px', height: '34px' }}
              />
            </div>

            {/* Keyword Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Keyword</label>
              <input
                type="text"
                placeholder="Contains words..."
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                className="input"
                style={{ width: '160px', height: '34px' }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '6px', height: '34px' }}>
              <button type="submit" className="btn-primary" style={{ padding: '0 14px', fontSize: '12px' }}>
                Apply
              </button>
              <button 
                type="button" 
                onClick={handleClearFilters} 
                className="btn-ghost" 
                style={{ padding: '0 14px', fontSize: '12px' }}
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Email List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{
            padding: '12px 24px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--danger)'
          }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {loading && emails.length === 0 ? (
          <div style={{ padding: '24px' }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton" style={{ height: '72px', marginBottom: '1px' }} />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 20px',
            color: 'var(--text-muted)'
          }}>
            <Mail size={40} style={{ marginBottom: '12px', strokeWidth: 1.5 }} />
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              {isScheduled ? 'No scheduled emails' : 'No messages'}
            </p>
            <p style={{ fontSize: '12px', marginTop: '4px' }}>
              {isScheduled 
                ? 'Emails scheduled for the future will appear here.'
                : (searchQuery || filterSender || filterKeyword || filterRead !== 'all' || filterDate !== 'any') 
                  ? 'No results matched your active filters.' 
                  : 'Your inbox is empty.'
              }
            </p>
          </div>
        ) : (
          emails.map((email: any, idx) => {
            let formattedDate = '';
            let exactDateStr = '';
            try {
              const d = new Date(email.date);
              formattedDate = formatDistanceToNow(d, { addSuffix: true });
              exactDateStr = format(d, 'MMM d, yyyy h:mm a');
            } catch { 
              formattedDate = String(email.date); 
              exactDateStr = String(email.date);
            }

            const isUnread = !email.is_read && !isSent;
            const senderName = isSent || isScheduled ? email.to_addresses.join(', ') : parseSenderName(email.from_address);
            const bodyPreview = stripHtml(email.body);

            return (
              <div
                key={email.id}
                onClick={() => handleEmailClick(email.id)}
                className="list-item-anim"
                style={{
                  display: 'flex',
                  gap: '14px',
                  padding: '14px 24px',
                  borderBottom: '1px solid var(--border)',
                  background: isUnread ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  alignItems: 'center',
                  animationDelay: `${idx * 0.02}s`
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? 'rgba(59, 130, 246, 0.04)' : 'transparent'; }}
              >
                {/* Avatar */}
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: getAvatarColor(isScheduled ? email.to_addresses[0] : email.from_address),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '12px',
                  color: '#ffffff',
                  flexShrink: 0
                }}>
                  {getInitials(isScheduled ? email.to_addresses[0] : email.from_address)}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
                    <span style={{ 
                      fontWeight: isUnread ? 600 : 400,
                      fontSize: '13px',
                      color: isUnread ? 'var(--text-primary)' : 'var(--text-secondary)'
                    }}>
                      {isScheduled ? `To: ${senderName}` : isSent ? `To: ${senderName}` : senderName}
                    </span>
                    
                    {!isScheduled && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                        {formattedDate}
                      </span>
                    )}
                  </div>

                  <div style={{ 
                    fontSize: '13px', 
                    fontWeight: isUnread ? 600 : 400,
                    color: isUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: '2px'
                  }}>
                    {email.subject || '(No Subject)'}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <p style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1
                    }}>
                      {bodyPreview || '(No preview available)'}
                    </p>

                    {/* Status/Estimated Time display for scheduled emails */}
                    {isScheduled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {email.status === 'failed' ? (
                          <span style={{
                            fontSize: '11px',
                            color: 'var(--danger)',
                            background: 'rgba(239, 68, 68, 0.1)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }} title={email.error_message}>
                            <AlertTriangle size={11} />
                            Failed
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '11px',
                            color: 'var(--accent-2)',
                            background: 'rgba(59, 130, 246, 0.08)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <Clock size={11} />
                            Send: {exactDateStr} ({formattedDate})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Cancel scheduled email button */}
                {isScheduled && (
                  <button
                    onClick={(e) => handleCancelSchedule(e, email.id)}
                    className="btn-ghost"
                    style={{
                      width: '32px',
                      height: '32px',
                      padding: 0,
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      border: 'none',
                      flexShrink: 0
                    }}
                    title="Cancel Send"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}

                {/* Unread dot */}
                {isUnread && (
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--accent-1)',
                    flexShrink: 0
                  }} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
export default Inbox;
