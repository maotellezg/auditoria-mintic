import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogIn, KeyRound, AlertCircle, CheckCircle } from 'lucide-react';

export default function Auth() {
  const [mode, setMode] = useState('login'); // 'login', 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, resetPassword } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setMessage('Se ha enviado un correo electrónico para restablecer tu contraseña. Revisa tu bandeja de entrada o spam.');
      }
    } catch (err) {
      console.error(err);
      let localizedError = 'Ocurrió un error. Por favor intenta de nuevo.';
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        localizedError = 'Usuario o contraseña incorrectos.';
      } else if (err.code === 'auth/weak-password') {
        localizedError = 'La contraseña debe tener al menos 6 caracteres.';
      } else if (err.code === 'auth/invalid-email') {
        localizedError = 'El formato del correo es inválido.';
      } else if (err.message) {
        localizedError = err.message;
      }
      setError(localizedError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <div className="dropzone-icon">
              {mode === 'login' && <LogIn size={32} />}
              {mode === 'forgot' && <KeyRound size={32} />}
            </div>
          </div>
          <h2>
            {mode === 'login' && 'Auditoria MinTic'}
            {mode === 'forgot' && 'Recuperar Contraseña'}
          </h2>
          <p>
            {mode === 'login' && 'Ingresa tus credenciales para acceder a la herramienta.'}
            {mode === 'forgot' && 'Ingresa tu correo para recibir las instrucciones.'}
          </p>
        </div>

        {error && (
          <div className="toast toast-error" style={{ position: 'relative', bottom: '0', right: '0', width: '100%', marginBottom: '20px', transform: 'none' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="toast toast-success" style={{ position: 'relative', bottom: '0', right: '0', width: '100%', marginBottom: '20px', transform: 'none' }}>
            <CheckCircle size={20} />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              className="form-input"
              required
              placeholder="ejemplo@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode !== 'forgot' && (
            <div className="form-group">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                className="form-input"
                required
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
            {loading ? (
              <span className="loading-spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
            ) : (
              <>
                {mode === 'login' && 'Iniciar Sesión'}
                {mode === 'forgot' && 'Enviar Correo'}
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          {mode === 'login' && (
            <p style={{ marginBottom: '10px' }}>
              <span className="auth-link" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>
                ¿Olvidaste tu contraseña?
              </span>
            </p>
          )}

          {mode === 'forgot' && (
            <p>
              Volver al{' '}
              <span className="auth-link" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>
                Inicio de sesión
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
