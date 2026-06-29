// frontend/src/components/Login.tsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMailStore } from '../store/mailStore';
import { authAPI } from '../api/client';
import { Mail, LogIn, Sparkles } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { authToken } = useMailStore();
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (authToken) {
      navigate('/');
    }
  }, [authToken, navigate]);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const response = await authAPI.login();
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to initiate login');
    } finally {
      setLoading(false);
    }
  };

  const handleSandboxLogin = async () => {
    try {
      setLoading(true);
      const response = await authAPI.sandbox();
      if (response.data?.success && response.data.token) {
        const store = useMailStore.getState();
        store.setAuthToken(response.data.token);
        store.setUser(response.data.user);
        navigate('/');
      } else {
        throw new Error('Invalid token response');
      }
    } catch (error) {
      console.error('Sandbox login error:', error);
      alert('Failed to launch sandbox mode. Ensure the postgres database is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      width: '100vw',
      background: 'radial-gradient(circle at center, #1b1b3a 0%, #0d0d1a 100%)',
      padding: '20px'
    }}>
      <div 
        className="glass fade-in"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '40px 30px',
          borderRadius: 'var(--radius-lg)',
          textAlign: 'center',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{
          position: 'relative',
          display: 'inline-flex',
          marginBottom: '24px'
        }}>
          <div style={{
            padding: '20px',
            borderRadius: '50%',
            background: 'rgba(108, 99, 255, 0.1)',
            border: '1px solid rgba(108, 99, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(108, 99, 255, 0.15)'
          }}>
            <Mail size={40} style={{ color: '#a78bfa' }} />
          </div>
          <Sparkles size={18} style={{
            position: 'absolute',
            top: '0',
            right: '-5px',
            color: '#fbbf24',
            animation: 'pulse 2s infinite'
          }} />
        </div>

        <h1 style={{ 
          fontSize: '28px', 
          fontWeight: 700, 
          marginBottom: '8px',
          letterSpacing: '-0.5px'
        }}>
          Welcome to <span className="text-gradient">MailAI</span>
        </h1>
        
        <p style={{ 
          color: 'var(--text-secondary)', 
          fontSize: '14px', 
          marginBottom: '36px',
          lineHeight: '1.6'
        }}>
          An AI-powered email client with Google Gemini. Control your inbox with natural language commands.
        </p>
        
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="btn-primary"
          style={{
            width: '100%',
            padding: '14px 20px',
            justifyContent: 'center',
            fontSize: '15px',
            marginBottom: '12px'
          }}
        >
          <LogIn size={18} />
          {loading ? 'Connecting Google...' : 'Sign in with Google'}
        </button>

        <button
          onClick={handleSandboxLogin}
          disabled={loading}
          className="btn-ghost"
          style={{
            width: '100%',
            padding: '12px 20px',
            justifyContent: 'center',
            fontSize: '14px',
            border: '1px dashed rgba(108, 99, 255, 0.3)',
            color: 'var(--accent-2)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Sparkles size={16} style={{ color: 'var(--accent-2)' }} />
          {loading ? 'Loading Sandbox...' : 'Try Demo / Sandbox Mode'}
        </button>

        <div style={{
          marginTop: '32px',
          paddingTop: '20px',
          borderTop: '1px solid var(--border)',
          width: '100%',
          fontSize: '12px',
          color: 'var(--text-muted)'
        }}>
          Protected by Google OAuth 2.0 and Gemini 3.5 Flash
        </div>
      </div>
    </div>
  );
};
