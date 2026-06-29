// frontend/src/components/EmailDetail.tsx
import React, { useState, useEffect } from 'react';
import { useMailStore } from '../store/mailStore';
import { emailAPI, aiAPI } from '../api/client';
import { ArrowLeft, Trash2, Reply, ReplyAll, Forward, MoreHorizontal, Star, Archive, Clock, AlertTriangle, Sparkles, Loader } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

// Strip HTML tags for plain text reply quoting
const stripHtml = (html: string): string => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .trim();
};

interface AISuggestion {
  label: string;
  prompt: string;
}

export const EmailDetail: React.FC = () => {
  const { 
    currentEmail, 
    setCurrentView, 
    setCurrentEmail, 
    setComposeFields,
    emails,
    setEmails,
    setPendingAiCommand
  } = useMailStore();

  const [deleting, setDeleting] = useState(false);
  const [showMore, setShowMore] = useState(false);
  
  // Custom AI Suggestions states
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Fetch suggestions from AI dynamically on email change
  useEffect(() => {
    if (!currentEmail || !!currentEmail.status) {
      setAiSuggestions([]);
      return;
    }

    const fetchAISuggestions = async () => {
      try {
        setLoadingSuggestions(true);
        const response = await aiAPI.getSuggestions(currentEmail.subject, currentEmail.body);
        if (response.data?.success && Array.isArray(response.data.data)) {
          setAiSuggestions(response.data.data);
        } else {
          // Fallback if formatting was off
          throw new Error('Invalid response structure');
        }
      } catch (err) {
        console.error('Failed to load AI suggestions:', err);
        // Fallback default suggestions
        setAiSuggestions([
          { label: 'Say thank you', prompt: 'Reply to this email saying: Thank you for the update. I appreciate it.' },
          { label: 'Acknowledge receipt', prompt: 'Reply to this email saying: Received with thanks. I will review this and get back to you soon.' },
          { label: 'Politely decline', prompt: 'Reply to this email saying: Thank you for reaching out, but I am unable to proceed with this.' }
        ]);
      } finally {
        setLoadingSuggestions(false);
      }
    };

    fetchAISuggestions();
  }, [currentEmail]);

  if (!currentEmail) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-muted)',
        fontSize: '14px'
      }}>
        Select an email to read
      </div>
    );
  }

  const isScheduled = !!currentEmail.status;

  const handleDelete = async () => {
    if (isScheduled) {
      handleCancelScheduled();
      return;
    }

    if (!window.confirm('Move this email to trash?')) return;
    try {
      setDeleting(true);
      await emailAPI.delete(currentEmail.id);
      setEmails(emails.filter(e => e.id !== currentEmail.id));
      setCurrentEmail(null);
      setCurrentView('inbox');
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete email');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelScheduled = async () => {
    if (!window.confirm('Cancel this scheduled email?')) return;
    try {
      setDeleting(true);
      await emailAPI.deleteScheduled(Number(currentEmail.id));
      setEmails(emails.filter(e => e.id !== currentEmail.id));
      setCurrentEmail(null);
      setCurrentView('scheduled');
    } catch (err) {
      console.error('Cancel scheduled error:', err);
      alert('Failed to cancel scheduled email');
    } finally {
      setDeleting(false);
    }
  };

  const handleReply = () => {
    const plainBody = stripHtml(currentEmail.body);
    const formattedDate = new Date(currentEmail.date).toLocaleString();
    const replyBody = `\n\n\nOn ${formattedDate}, ${currentEmail.from_address} wrote:\n> ${plainBody.split('\n').join('\n> ')}`;
    
    setComposeFields({
      to: currentEmail.from_address,
      subject: currentEmail.subject.startsWith('Re:') ? currentEmail.subject : `Re: ${currentEmail.subject}`,
      body: replyBody
    });
    setCurrentView('compose');
  };

  const handleReplyAll = () => {
    const plainBody = stripHtml(currentEmail.body);
    const formattedDate = new Date(currentEmail.date).toLocaleString();
    const allRecipients = [currentEmail.from_address, ...currentEmail.to_addresses].filter(
      (addr, i, arr) => arr.indexOf(addr) === i
    ).join(', ');
    const replyBody = `\n\n\nOn ${formattedDate}, ${currentEmail.from_address} wrote:\n> ${plainBody.split('\n').join('\n> ')}`;
    
    setComposeFields({
      to: allRecipients,
      subject: currentEmail.subject.startsWith('Re:') ? currentEmail.subject : `Re: ${currentEmail.subject}`,
      body: replyBody
    });
    setCurrentView('compose');
  };

  const handleForward = () => {
    const plainBody = stripHtml(currentEmail.body);
    const formattedDate = new Date(currentEmail.date).toLocaleString();
    const fwdBody = `\n\n\n---------- Forwarded message ----------\nFrom: ${currentEmail.from_address}\nDate: ${formattedDate}\nSubject: ${currentEmail.subject}\nTo: ${currentEmail.to_addresses.join(', ')}\n\n${plainBody}`;
    
    setComposeFields({
      to: '',
      subject: currentEmail.subject.startsWith('Fwd:') ? currentEmail.subject : `Fwd: ${currentEmail.subject}`,
      body: fwdBody
    });
    setCurrentView('compose');
  };

  const emailDate = currentEmail.date ? new Date(currentEmail.date) : new Date();
  let timeStr = '';
  let fullDateStr = '';
  try {
    timeStr = formatDistanceToNow(emailDate, { addSuffix: true });
    fullDateStr = format(emailDate, 'EEE, MMM d, yyyy \'at\' h:mm a');
  } catch {
    timeStr = String(currentEmail.date);
    fullDateStr = String(currentEmail.date);
  }

  const parseSenderName = (addr: string) => {
    const match = addr.match(/^"?(.*?)"?\s*<.*?>/);
    return match ? match[1].trim() : addr.split('@')[0];
  };

  const getInitials = (addr: string) => {
    const name = parseSenderName(addr);
    const parts = name.split(/[\s._-]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const senderName = isScheduled ? 'Me' : parseSenderName(currentEmail.from_address);
  const senderEmail = currentEmail.from_address.match(/<(.+?)>/)?.[1] || currentEmail.from_address;

  const isHtmlBody = currentEmail.body && 
    currentEmail.body.includes('<') && 
    (currentEmail.body.includes('</') || currentEmail.body.includes('/>'));

  return (
    <div className="fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top toolbar */}
      <div style={{
        padding: '10px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-secondary)',
        flexShrink: 0
      }}>
        <button
          onClick={() => { setCurrentEmail(null); setCurrentView(isScheduled ? 'scheduled' : 'inbox'); }}
          className="btn-ghost"
          style={{ padding: '6px 10px', height: '32px', fontSize: '12px' }}
        >
          <ArrowLeft size={14} />
          Back to {isScheduled ? 'Scheduled' : 'Inbox'}
        </button>

        <div style={{ display: 'flex', gap: '4px' }}>
          {!isScheduled && (
            <button className="btn-ghost" style={{ padding: '6px 8px', height: '32px' }} title="Archive">
              <Archive size={14} />
            </button>
          )}
          <button 
            onClick={handleDelete} 
            disabled={deleting} 
            className="btn-ghost" 
            style={{ padding: '6px 8px', height: '32px', color: 'var(--danger)' }} 
            title={isScheduled ? 'Cancel Schedule' : 'Delete'}
          >
            <Trash2 size={14} />
          </button>
          {!isScheduled && (
            <>
              <button className="btn-ghost" style={{ padding: '6px 8px', height: '32px' }} title="Snooze">
                <Clock size={14} />
              </button>
              <button className="btn-ghost" style={{ padding: '6px 8px', height: '32px' }} title="More">
                <MoreHorizontal size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scheduled Status Banner */}
      {isScheduled && (
        <div style={{
          padding: '12px 32px',
          background: currentEmail.status === 'failed' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.08)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          color: currentEmail.status === 'failed' ? 'var(--danger)' : 'var(--accent-2)'
        }}>
          {currentEmail.status === 'failed' ? (
            <>
              <AlertTriangle size={16} />
              <div>
                <strong>Sending Failed:</strong> {currentEmail.error_message || 'Unknown error occurred.'}
              </div>
            </>
          ) : (
            <>
              <Clock size={16} />
              <div>
                <strong>Scheduled:</strong> This email will be sent automatically at {fullDateStr} ({timeStr}).
              </div>
            </>
          )}
        </div>
      )}

      {/* Email Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        {/* Subject */}
        <div style={{
          padding: '24px 32px 0',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px'
        }}>
          <h1 style={{ 
            fontSize: '20px', 
            fontWeight: 600, 
            lineHeight: 1.35, 
            color: 'var(--text-primary)',
            flex: 1
          }}>
            {currentEmail.subject}
          </h1>
          {!isScheduled && (
            <button className="btn-ghost" style={{ padding: '4px', height: '28px', width: '28px', flexShrink: 0 }} title="Star">
              <Star size={14} />
            </button>
          )}
        </div>

        {/* Sender Info Bar */}
        <div style={{
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '14px'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: '14px',
            color: '#fff',
            flexShrink: 0
          }}>
            {getInitials(isScheduled ? currentEmail.to_addresses[0] : currentEmail.from_address)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                {isScheduled ? 'To: ' + parseSenderName(currentEmail.to_addresses[0]) : senderName}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                &lt;{isScheduled ? currentEmail.to_addresses[0] : senderEmail}&gt;
              </span>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>{isScheduled ? 'from Me' : 'to ' + currentEmail.to_addresses.map(a => {
                const m = a.match(/<(.+?)>/);
                return m ? m[1] : a;
              }).join(', ')}</span>
              <button 
                onClick={() => setShowMore(!showMore)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '0 2px'
                }}
              >
                ▾
              </button>
            </div>

            {showMore && (
              <div style={{ 
                marginTop: '8px', 
                padding: '10px 12px',
                background: 'var(--bg-primary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div><strong style={{ color: 'var(--text-primary)' }}>From:</strong> {isScheduled ? 'Me' : currentEmail.from_address}</div>
                <div><strong style={{ color: 'var(--text-primary)' }}>To:</strong> {currentEmail.to_addresses.join(', ')}</div>
                <div><strong style={{ color: 'var(--text-primary)' }}>{isScheduled ? 'Scheduled At' : 'Date'}:</strong> {fullDateStr}</div>
                <div><strong style={{ color: 'var(--text-primary)' }}>Subject:</strong> {currentEmail.subject}</div>
              </div>
            )}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
            <div>{isScheduled ? 'Scheduled For' : fullDateStr}</div>
            <div style={{ fontSize: '11px', marginTop: '2px' }}>({timeStr})</div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ margin: '0 32px', borderTop: '1px solid var(--border)' }} />

        {/* Email Body */}
        <div style={{
          padding: '24px 32px 32px',
          fontSize: '14px',
          lineHeight: '1.65',
          color: 'var(--text-primary)',
          wordBreak: 'break-word'
        }}>
          {!currentEmail.body ? (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(No content)</span>
          ) : isHtmlBody ? (
            <div 
              className="email-html-body"
              dangerouslySetInnerHTML={{ __html: currentEmail.body }}
            />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{currentEmail.body}</div>
          )}
        </div>

        {/* Smart Reply Suggestions */}
        {!isScheduled && (
          <div style={{
            margin: '0 32px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={12} style={{ color: 'var(--accent-2)' }} />
              <span style={{ 
                fontSize: '10px', 
                fontWeight: 600, 
                color: 'var(--text-muted)', 
                textTransform: 'uppercase', 
                letterSpacing: '0.05em' 
              }}>
                Smart Reply Suggestions
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minHeight: '36px', alignItems: 'center' }}>
              {loadingSuggestions ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <Loader size={12} className="spin-anim" />
                  Generating suggestions...
                </div>
              ) : aiSuggestions.length > 0 ? (
                aiSuggestions.map((sug, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPendingAiCommand(sug.prompt)}
                    className="btn-ghost"
                    style={{
                      fontSize: '12px',
                      padding: '6px 12px',
                      background: 'rgba(59, 130, 246, 0.04)',
                      borderColor: 'rgba(59, 130, 246, 0.25)',
                      color: 'var(--accent-2)',
                      borderRadius: 'var(--radius-md)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                      e.currentTarget.style.borderColor = 'var(--accent-1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.04)';
                      e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.25)';
                    }}
                  >
                    {sug.label}
                  </button>
                ))
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No suggestions available</span>
              )}
            </div>
          </div>
        )}

        {/* Reply / Reply All / Forward action bar (like Gmail) */}
        {isScheduled ? (
          <div style={{
            margin: '0 32px 32px',
            padding: '16px 20px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-secondary)'
          }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              This email is scheduled to be sent. You can cancel it before it goes out.
            </div>
            <button 
              onClick={handleCancelScheduled} 
              disabled={deleting} 
              className="btn-danger"
              style={{ fontSize: '13px', height: '36px' }}
            >
              <Trash2 size={14} />
              Cancel Send
            </button>
          </div>
        ) : (
          <div style={{
            margin: '0 32px 32px',
            padding: '16px 20px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            gap: '8px'
          }}>
            <button onClick={handleReply} className="btn-ghost" style={{ fontSize: '13px' }}>
              <Reply size={14} />
              Reply
            </button>
            <button onClick={handleReplyAll} className="btn-ghost" style={{ fontSize: '13px' }}>
              <ReplyAll size={14} />
              Reply All
            </button>
            <button onClick={handleForward} className="btn-ghost" style={{ fontSize: '13px' }}>
              <Forward size={14} />
              Forward
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailDetail;
