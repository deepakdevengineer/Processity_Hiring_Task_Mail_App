// frontend/src/Callback.tsx
import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMailStore } from './store/mailStore';
import { Loader } from 'lucide-react';

export const Callback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuthToken } = useMailStore();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      alert(`Login failed: ${error}`);
      navigate('/login');
    } else if (token) {
      setAuthToken(token);
      navigate('/');
    }
  }, [searchParams, navigate, setAuthToken]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
      color: 'var(--text-secondary)',
      gap: '12px'
    }}>
      <Loader size={30} className="spin-anim" style={{ color: 'var(--accent-1)' }} />
      <p style={{ fontSize: '13.5px', fontWeight: 500 }}>Completing Google sign in...</p>
    </div>
  );
};
export default Callback;
