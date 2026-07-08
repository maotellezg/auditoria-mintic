import React from 'react';
import { useAuth } from '../context/AuthContext';
import { User } from 'lucide-react';

export default function Header({ title, subtitle }) {
  const { currentUser } = useAuth();

  const userInitial = currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'U';

  return (
    <header className="header">
      <div className="header-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>

      <div className="user-profile">
        <div className="user-avatar">
          {userInitial}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {currentUser?.email ? currentUser.email.split('@')[0] : 'Usuario'}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Auditoria MinTic
          </span>
        </div>
      </div>
    </header>
  );
}
