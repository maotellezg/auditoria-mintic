import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Settings, Mail, Save, Send, CheckCircle, AlertCircle,
  Eye, EyeOff, Server, Loader, ShieldCheck, Building
} from 'lucide-react';

export default function SettingsView() {
  const { currentUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [showPass, setShowPass] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState(null);

  // Configuración SMTP
  const [host, setHost] = useState('smtp.gmail.com');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [fromName, setFromName] = useState('Auditoria MinTic');
  const [platformName, setPlatformName] = useState('Auditoria MinTic');

  const [configExists, setConfigExists] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [currentUser]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/admin/settings', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.host) {
          setHost(data.host || 'smtp.gmail.com');
          setPort(data.port || '587');
          setSecure(data.secure || false);
          setUser(data.user || '');
          setPass(data.pass || '');
          setFromName(data.fromName || 'Auditoria MinTic');
          setPlatformName(data.platformName || 'Auditoria MinTic');
          setConfigExists(true);
        }
      }
    } catch (err) {
      console.error('Error al cargar configuración:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ host, port, secure, user, pass, fromName, platformName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar.');
      setSuccess(data.message);
      setConfigExists(true);
      // Recargar para mostrar la contraseña enmascarada
      await loadSettings();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const idToken = await currentUser.getIdToken();
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ to: testEmail })
      });
      const data = await res.json();
      setTestResult({ ok: res.ok, message: data.message || data.error });
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const inputStyle = {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-main)',
    padding: '10px 14px',
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s'
  };

  const labelStyle = {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
    display: 'block',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', gap: '12px' }}>
        <Loader size={24} color="var(--color-primary)" className="loading-spin" />
        <span style={{ color: 'var(--text-muted)' }}>Cargando configuración...</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: '10px',
          background: 'rgba(0, 242, 254, 0.1)', border: '1px solid rgba(0, 242, 254, 0.2)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--color-primary)'
        }}>
          <Settings size={22} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>Configuración del Sistema</h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Gestiona el correo saliente y la identidad de la plataforma
          </p>
        </div>
        {configExists && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', color: '#43e97b', fontSize: '0.8rem', fontWeight: 600 }}>
            <ShieldCheck size={16} />
            SMTP Configurado
          </div>
        )}
      </div>

      {/* Alertas */}
      {success && (
        <div className="toast toast-success" style={{ position: 'relative', bottom: 0, right: 0, width: '100%', transform: 'none' }}>
          <CheckCircle size={18} /><span>{success}</span>
        </div>
      )}
      {error && (
        <div className="toast toast-error" style={{ position: 'relative', bottom: 0, right: 0, width: '100%', transform: 'none' }}>
          <AlertCircle size={18} /><span>{error}</span>
        </div>
      )}

      {/* Panel General */}
      <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Building size={18} color="var(--color-primary)" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Identidad de la Plataforma</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Nombre de la Plataforma</label>
            <input style={inputStyle} value={platformName} onChange={e => setPlatformName(e.target.value)} placeholder="Ej: Auditoria MinTic" />
            <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Aparece en los correos enviados</p>
          </div>
          <div>
            <label style={labelStyle}>Nombre del Remitente</label>
            <input style={inputStyle} value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Ej: Equipo Auditoria MinTic" />
            <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>El nombre que verá el destinatario</p>
          </div>
        </div>
      </div>

      {/* Panel SMTP */}
      <form onSubmit={handleSave}>
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Server size={18} color="var(--color-primary)" />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Servidor de Correo Saliente (SMTP)</h3>
          </div>

          {/* Nota Gmail */}
          <div style={{
            background: 'rgba(0, 242, 254, 0.05)',
            border: '1px solid rgba(0, 242, 254, 0.15)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6
          }}>
            <strong style={{ color: 'var(--color-primary)' }}>📧 Gmail / Google Workspace:</strong> Para usar Gmail o cuentas
            <strong> @tudominio.com</strong> de Google, necesitas generar una <strong>App Password</strong>:
            Ir a <strong>myaccount.google.com → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones</strong>.
            Pega esa clave de 16 caracteres en el campo <em>Contraseña</em> abajo.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.5fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>Host SMTP</label>
              <input required style={inputStyle} value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label style={labelStyle}>Puerto</label>
              <input required style={inputStyle} value={port} onChange={e => setPort(e.target.value)} placeholder="587" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>Correo / Usuario SMTP</label>
              <input required type="email" style={inputStyle} value={user} onChange={e => setUser(e.target.value)} placeholder="gerencia@agenticatech.ai" />
            </div>
            <div>
              <label style={labelStyle}>Contraseña / App Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  required
                  type={showPass ? 'text' : 'password'}
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  placeholder="Contraseña de aplicación de 16 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={secure} onChange={e => setSecure(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }} />
              Usar SSL/TLS (puerto 465) en lugar de STARTTLS (puerto 587)
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', height: '44px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
            disabled={saving}
          >
            {saving
              ? <><Loader size={16} className="loading-spin" /> Guardando...</>
              : <><Save size={16} /> Guardar Configuración</>
            }
          </button>
        </div>
      </form>

      {/* Panel de Prueba */}
      {configExists && (
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Mail size={18} color="var(--color-primary)" />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Probar Configuración de Correo</h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Envía un correo de prueba para verificar que la configuración SMTP esté funcionando correctamente.
          </p>

          {testResult && (
            <div
              className={testResult.ok ? 'toast toast-success' : 'toast toast-error'}
              style={{ position: 'relative', bottom: 0, right: 0, width: '100%', transform: 'none', marginBottom: '16px' }}
            >
              {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.message}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="email"
              style={{ ...inputStyle, flex: 1 }}
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="correo@destinatario.com"
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: '42px', paddingInline: '20px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
              onClick={handleTestEmail}
              disabled={testing || !testEmail.trim()}
            >
              {testing
                ? <><Loader size={14} className="loading-spin" /> Enviando...</>
                : <><Send size={14} /> Enviar Prueba</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
