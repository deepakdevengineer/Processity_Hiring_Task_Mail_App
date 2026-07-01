import React from 'react';
import { useMailStore } from '../store/mailStore';
import { emailAPI } from '../api/client';
import { Send, Trash2, X, Clock } from 'lucide-react';

export const ComposeModal: React.FC = () => {
  const { 
    setCurrentView, 
    loading, 
    setLoading, 
    setError,
    composeFields,
    setComposeFields,
    resetComposeFields,
    showScheduler,
    setShowScheduler,
    scheduleTime,
    setScheduleTime
  } = useMailStore();

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const { to, subject, body } = composeFields;

    if (!to || !subject || !body) {
      setError('Please fill in all fields (To, Subject, Message)');
      return;
    }

    try {
      setLoading(true);
      if (showScheduler && scheduleTime) {
        const date = new Date(scheduleTime);
        if (date <= new Date()) {
          alert('Scheduled time must be in the future');
          setLoading(false);
          return;
        }
        await emailAPI.schedule(to, subject, body, date.toISOString());
        alert(`Email scheduled successfully for ${date.toLocaleString()}`);
      } else {
        await emailAPI.send(to, subject, body);
      }
      resetComposeFields();
      setCurrentView(showScheduler ? 'inbox' : 'sent');
    } catch (err) {
      setError((err as Error).message || 'Failed to process request');
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = () => {
    if (window.confirm('Discard draft?')) {
      resetComposeFields();
      setCurrentView('inbox');
    }
  };

  return (
    <div className="fade-in" style={{
      padding: '24px 30px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--border)',
        marginBottom: '20px'
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'white', letterSpacing: '-0.01em' }}>NEW MESSAGE</h2>
        <button
          onClick={() => setCurrentView('inbox')}
          className="btn-ghost"
          style={{ width: '32px', height: '32px', padding: 0, justifyContent: 'center', borderRadius: '50%' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Form Container */}
      <form 
        id="composeForm" 
        onSubmit={handleSend}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        {/* Recipient */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 650, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            To
          </label>
          <input
            type="email"
            name="to"
            placeholder="recipient@example.com"
            value={composeFields.to}
            onChange={(e) => setComposeFields({ to: e.target.value })}
            className="input"
            required
            disabled={loading}
          />
        </div>

        {/* Subject */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 650, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Subject
          </label>
          <input
            type="text"
            name="subject"
            placeholder="Enter subject header"
            value={composeFields.subject}
            onChange={(e) => setComposeFields({ subject: e.target.value })}
            className="input"
            required
            disabled={loading}
          />
        </div>

        {/* Body Textarea */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '11px', fontWeight: 650, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Message Body
          </label>
          <textarea
            name="body"
            placeholder="Write your email draft details here..."
            value={composeFields.body}
            onChange={(e) => setComposeFields({ body: e.target.value })}
            className="textarea"
            required
            disabled={loading}
            style={{ flex: 1, minHeight: '200px' }}
          />
        </div>

        {/* Scheduler DateTime Picker */}
        {showScheduler && (
          <div className="fade-in" style={{
            padding: '12px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Select Schedule Time
            </label>
            <input
              type="datetime-local"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="input"
              style={{ width: '240px', colorScheme: 'dark' }}
              required={showScheduler}
            />
          </div>
        )}

        {/* Action Panel */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '16px',
          borderTop: '1px solid var(--border)',
          marginTop: '10px'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ height: '38px', fontSize: '13px' }}
            >
              <Send size={14} />
              {loading 
                ? 'Processing...' 
                : showScheduler 
                  ? 'Schedule Send' 
                  : 'Send Email'
              }
            </button>
            
            <button
              type="button"
              onClick={() => setShowScheduler(!showScheduler)}
              className="btn-ghost"
              style={{ 
                height: '38px', 
                fontSize: '13px',
                borderColor: showScheduler ? 'var(--accent-1)' : 'var(--border)',
                color: showScheduler ? 'var(--accent-2)' : 'var(--text-secondary)'
              }}
              title="Schedule send"
            >
              <Clock size={14} />
            </button>

            <button
              type="button"
              onClick={handleDiscard}
              disabled={loading}
              className="btn-ghost"
              style={{ color: 'var(--text-secondary)', height: '38px', fontSize: '13px' }}
            >
              <Trash2 size={14} />
              Discard
            </button>
          </div>
          
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Gemini co-pilot is active.
          </div>
        </div>
      </form>
    </div>
  );
};
export default ComposeModal;
