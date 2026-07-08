import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, KeyRound, Trash2, Shield, Eye, Check, X, AlertCircle, CheckCircle, ShieldAlert, Mail, Send, Loader } from 'lucide-react';

export default function UserManagement() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Estados para Migración de Corpus
  const [indexStatus, setIndexStatus] = useState({ total: 0, indexed: 0, failed: 0, pending: 0, percentage: 0 });
  const [indexingActive, setIndexingActive] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [triggerCount, setTriggerCount] = useState(0);
  const consoleRef = useRef(null);
  
  // Formulario creación
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('visualizador');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [domainError, setDomainError] = useState(null); // { domain, hint }

  // Enlace setup link tras creación passwordless
  const [createdSetupLink, setCreatedSetupLink] = useState(null);
  const [createdUserEmail, setCreatedUserEmail] = useState('');

  // Modal contraseña
  const [editingUser, setEditingUser] = useState(null); // { id, email }
  const [newPassword, setNewPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  // Notificaciones generales
  const [generalError, setGeneralError] = useState('');
  const [generalSuccess, setGeneralSuccess] = useState('');

  // Reenviar correo
  const [resendingUid, setResendingUid] = useState(null);
  const [emailSentStatus, setEmailSentStatus] = useState(null); // { ok, message }

  // Probar correo
  const [testEmail, setTestEmail] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const formatUserDate = (createdAt) => {
    if (!createdAt) return 'Pre-existente';
    if (typeof createdAt === 'string') {
      return createdAt.slice(0, 10);
    }
    // Si es un objeto de tipo Firebase Timestamp {_seconds, _nanoseconds} o similar
    if (typeof createdAt === 'object') {
      const seconds = createdAt._seconds !== undefined ? createdAt._seconds : createdAt.seconds;
      if (seconds !== undefined) {
        try {
          return new Date(seconds * 1000).toISOString().slice(0, 10);
        } catch (e) {
          console.error('Error al formatear fecha de usuario:', e);
        }
      }
    }
    return 'Pre-existente';
  };

  const fetchUsers = async () => {
    setLoading(true);
    setGeneralError('');
    try {
      if (!currentUser) {
        throw new Error('Sesión de usuario no disponible. Por favor, inicia sesión.');
      }
      const idToken = await currentUser.getIdToken(true);
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'No se pudo cargar la lista de usuarios.');
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.error('La respuesta de /api/users no es un arreglo:', data);
        setUsers([]);
        setGeneralError('La respuesta del servidor no tiene un formato válido.');
      }
    } catch (err) {
      console.error(err);
      setGeneralError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs(prev => [...prev, `[${timestamp}] ${msg}`]);
  };

  const fetchIndexStatus = async (silent = false) => {
    try {
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken(true);
      const response = await fetch('/api/admin/index-status', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setIndexStatus(data);
        if (!silent) {
          const timestamp = new Date().toLocaleTimeString();
          setConsoleLogs(prev => [
            ...prev,
            `[${timestamp}] Estado del Corpus: ${data.indexed}/${data.total} indexados (${data.percentage}%). Pendientes: ${data.pending}, Fallidos: ${data.failed}.`
          ]);
        }
      }
    } catch (err) {
      console.error('Error al obtener estado de indexación:', err);
      if (!silent) {
        addLog(`Error al conectar con la base de datos para obtener el estado.`);
      }
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchUsers();
      fetchIndexStatus();
    }
  }, [currentUser]);

  // Bucle de indexación continuo
  useEffect(() => {
    let active = true;

    const runLoop = async () => {
      if (!indexingActive || !currentUser) return;
      
      setIndexLoading(true);
      addLog(`[BUCLE CONTINUO] Iniciando lote de indexación automática...`);

      try {
        const idToken = await currentUser.getIdToken();
        const response = await fetch('/api/admin/index-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ limit: 10 })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Fallo en la comunicación con Vertex AI.');
        }

        const data = await response.json();
        
        if (!active) return;

        if (data.processedCount === 0) {
          addLog(`¡Éxito! Todos los documentos en el corpus se encuentran completamente indexados.`);
          setIndexingActive(false);
          setIndexLoading(false);
          fetchIndexStatus(true);
          return;
        }

        // Procesar resultados para el log de la consola
        const successful = data.results.filter(r => r.status === 'success');
        const failed = data.results.filter(r => r.status === 'error');
        const empty = data.results.filter(r => r.status === 'empty' || r.status === 'empty_chunks');
        
        addLog(`Lote procesado: ${data.processedCount} documentos.`);
        if (successful.length > 0) {
          addLog(`  - Éxito: ${successful.length} documentos indexados de forma semántica.`);
        }
        if (empty.length > 0) {
          addLog(`  - Sin Texto: ${empty.length} documentos se marcaron como procesados pero no tenían texto legible.`);
        }
        if (failed.length > 0) {
          addLog(`  - Errores: ${failed.length} documentos fallaron.`);
        }

        // Actualizar estado general
        await fetchIndexStatus(true);

        // Si sigue activo el bucle, lanzar otro lote tras un breve retardo de 2 segundos para no saturar la cuota
        if (indexingActive && active) {
          addLog(`Esperando 2 segundos antes del siguiente lote...`);
          setTimeout(() => {
            if (indexingActive && active) {
              setTriggerCount(prev => prev + 1);
            }
          }, 2000);
        } else {
          setIndexLoading(false);
        }

      } catch (err) {
        console.error(err);
        if (active) {
          addLog(`Bucle interrumpido por error: ${err.message}`);
          setIndexingActive(false);
          setIndexLoading(false);
        }
      }
    };

    if (indexingActive) {
      runLoop();
    }

    return () => {
      active = false;
    };
  }, [indexingActive, triggerCount]);

  const handleManualIndexBatch = async () => {
    if (indexLoading || indexingActive) return;
    setIndexLoading(true);
    addLog(`[MANUAL] Iniciando indexación de un único lote (10 documentos)...`);

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/index-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ limit: 10 })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al procesar el lote.');
      }

      const data = await response.json();
      
      if (data.processedCount === 0) {
        addLog(`[MANUAL] Todos los documentos ya están indexados.`);
      } else {
        const successful = data.results.filter(r => r.status === 'success');
        const failed = data.results.filter(r => r.status === 'error');
        const empty = data.results.filter(r => r.status === 'empty' || r.status === 'empty_chunks');
        
        addLog(`[MANUAL] Lote completado: ${data.processedCount} documentos procesados.`);
        if (successful.length > 0) {
          addLog(`  - Éxito: ${successful.length} indexados.`);
        }
        if (empty.length > 0) {
          addLog(`  - Vacíos/Sin Texto: ${empty.length} omitidos.`);
        }
        if (failed.length > 0) {
          addLog(`  - Errores: ${failed.length} documentos fallaron.`);
        }
      }

      await fetchIndexStatus(true);
    } catch (err) {
      console.error(err);
      addLog(`[MANUAL] Error al procesar: ${err.message}`);
    } finally {
      setIndexLoading(false);
    }
  };

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLogs]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setDomainError(null);
    setCreatedSetupLink(null);
    setCreatedUserEmail('');
    setEmailSentStatus(null);
    setCreateLoading(true);

    try {
      if (password && password.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres.');
      }

      if (!currentUser) {
        throw new Error('Sesión de usuario no disponible.');
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ email, password, role })
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.domainError) {
          const domain = email.split('@')[1];
          setDomainError({ domain, hint: data.hint });
          return; // No lanzar error genérico, el UI de domainError lo muestra
        }
        throw new Error(data.error || 'Error al crear el usuario.');
      }

      const data = await response.json();
      // Mostrar si el correo fue enviado o no
      setEmailSentStatus({
        ok: data.emailSent,
        message: data.emailSent
          ? `✅ Correo de bienvenida enviado automáticamente a ${email}.`
          : `⚠️ Usuario creado. ${data.message}`
      });
      setCreateSuccess(data.message);
      
      if (data.isPasswordless && data.setupLink && !data.emailSent) {
        setCreatedSetupLink(data.setupLink);
        setCreatedUserEmail(email);
      }

      setEmail('');
      setPassword('');
      setRole('visualizador');
      
      // Actualizar listado
      fetchUsers();
    } catch (err) {
      console.error(err);
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess('');
    setPwdLoading(true);

    try {
      if (newPassword.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres.');
      }

      if (!currentUser) {
        throw new Error('Sesión de usuario no disponible.');
      }

      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid: editingUser?.id || editingUser?.uid, newPassword })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al restablecer la contraseña.');
      }

      const data = await response.json();
      setPwdSuccess(data.message);
      setNewPassword('');
      setTimeout(() => {
        setEditingUser(null);
        setPwdSuccess('');
      }, 2000);
    } catch (err) {
      console.error(err);
      setPwdError(err.message);
    } finally {
      setPwdLoading(false);
    }
  };

  const handleDeleteUser = async (uid, userEmail) => {
    if (!currentUser) return;
    if (uid === currentUser.uid) {
      alert('No puedes eliminar tu propia cuenta de administrador.');
      return;
    }

    if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario ${userEmail}?`)) {
      return;
    }

    setGeneralError('');
    setGeneralSuccess('');

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Error al eliminar el usuario.');
      }

      const data = await response.json();
      setGeneralSuccess(data.message);
      fetchUsers();
    } catch (err) {
      console.error(err);
      setGeneralError(err.message);
    }
  };

  const handleResendEmail = async (u) => {
    setResendingUid(u.id);
    setGeneralError('');
    setGeneralSuccess('');
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/admin/resend-welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ uid: u.id, email: u.email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al reenviar correo.');
      setGeneralSuccess(data.message);
      fetchUsers();
    } catch (err) {
      setGeneralError(err.message);
    } finally {
      setResendingUid(null);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail.trim()) return;
    setTestLoading(true);
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
      setTestLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {generalError && (
        <div className="toast toast-error" style={{ position: 'relative', bottom: '0', right: '0', width: '100%', transform: 'none' }}>
          <AlertCircle size={20} />
          <span>{generalError}</span>
        </div>
      )}

      {generalSuccess && (
        <div className="toast toast-success" style={{ position: 'relative', bottom: '0', right: '0', width: '100%', transform: 'none' }}>
          <CheckCircle size={20} />
          <span>{generalSuccess}</span>
        </div>
      )}

      {/* Enlace setup link tras creación passwordless */}
      {createdSetupLink && (
        <div className="glass-panel" style={{ 
          border: '1px solid rgba(0, 242, 254, 0.4)', 
          background: 'rgba(0, 242, 254, 0.05)', 
          padding: '20px', 
          borderRadius: '12px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px',
          boxShadow: '0 8px 32px 0 rgba(0, 242, 254, 0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ 
                background: 'rgba(0, 242, 254, 0.1)', 
                color: 'var(--color-primary)', 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%', 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                flexShrink: 0
              }}>
                <KeyRound size={20} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Enlace de Activación Generado
                </h4>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Se ha generado una invitación de acceso para <strong style={{ color: 'var(--text-main)' }}>{createdUserEmail}</strong>. Copia este enlace seguro de configuración y compártelo con el usuario para que establezca su contraseña.
                </p>
              </div>
            </div>
            <button 
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: '4px' }}
              onClick={() => setCreatedSetupLink(null)}
            >
              <X size={16} />
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '4px' }}>
            <input 
              type="text" 
              readOnly 
              className="form-input" 
              value={createdSetupLink} 
              style={{ 
                flex: 1, 
                fontSize: '0.8rem', 
                background: 'rgba(15, 23, 42, 0.6)', 
                border: '1px solid rgba(255, 255, 255, 0.1)', 
                color: 'var(--text-secondary)',
                fontFamily: 'monospace'
              }}
              onClick={(e) => e.target.select()}
            />
            <button 
              type="button"
              className="btn btn-primary" 
              style={{ padding: '0 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
              onClick={() => {
                navigator.clipboard.writeText(createdSetupLink);
                alert('¡Enlace de activación copiado al portapapeles!');
              }}
            >
              <Check size={16} />
              Copiar Enlace
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Formulario de Registro de Usuario */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <UserPlus size={22} color="var(--color-accent)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Crear Nuevo Usuario</h3>
          </div>

          {domainError && (
            <div style={{
              display: 'flex', gap: '12px', alignItems: 'flex-start',
              background: 'rgba(255, 94, 98, 0.08)',
              border: '1px solid rgba(255, 94, 98, 0.3)',
              borderRadius: '8px', padding: '14px'
            }}>
              <AlertCircle size={18} color="var(--color-error)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.83rem', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--color-error)', display: 'block', marginBottom: '4px' }}>
                  Dominio "@{domainError.domain}" no autorizado
                </strong>
                <span style={{ color: 'var(--text-secondary)' }}>El usuario NO fue creado. Para habilitar este dominio:</span>
                <ol style={{ margin: '8px 0 8px 16px', padding: 0, color: 'var(--text-secondary)' }}>
                  <li>Ve a <a href="https://console.firebase.google.com/project/auditoria-mintc/authentication/settings" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>Firebase Console → Authentication → Configuración</a></li>
                  <li>Busca <strong style={{ color: 'var(--text-main)' }}>"Dominios autorizados"</strong> y haz clic en <strong style={{ color: 'var(--text-main)' }}>"Agregar dominio"</strong></li>
                  <li>Escribe <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: '4px', color: 'var(--color-primary)' }}>{domainError.domain}</code> y guarda</li>
                </ol>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline' }}
                  onClick={() => setDomainError(null)}
                >
                  Cerrar aviso
                </button>
              </div>
            </div>
          )}

          {createError && (
            <div style={{ display: 'flex', gap: '8px', color: 'var(--color-error)', fontSize: '0.85rem', background: 'rgba(255, 94, 98, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255, 94, 98, 0.15)' }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{createError}</span>
            </div>
          )}

          {emailSentStatus && (
            <div
              style={{
                display: 'flex', gap: '10px', fontSize: '0.85rem',
                background: emailSentStatus.ok ? 'rgba(67, 233, 123, 0.08)' : 'rgba(243, 156, 18, 0.08)',
                padding: '10px 14px', borderRadius: '8px',
                border: `1px solid ${emailSentStatus.ok ? 'rgba(67,233,123,0.2)' : 'rgba(243,156,18,0.2)'}`,
                color: emailSentStatus.ok ? 'var(--color-success)' : '#f39c12',
                alignItems: 'flex-start'
              }}
            >
              {emailSentStatus.ok ? <CheckCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <Mail size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
              <span>{emailSentStatus.message}</span>
            </div>
          )}

          {createSuccess && (
            <div style={{ display: 'flex', gap: '8px', color: 'var(--color-success)', fontSize: '0.85rem', background: 'rgba(67, 233, 123, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(67, 233, 123, 0.15)' }}>
              <CheckCircle size={16} style={{ flexShrink: 0 }} />
              <span>{createSuccess}</span>
            </div>
          )}

          <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* Info badge */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: 'rgba(0, 242, 254, 0.05)',
              border: '1px solid rgba(0, 242, 254, 0.15)',
              borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem',
              color: 'var(--text-secondary)', lineHeight: 1.5
            }}>
              <Mail size={15} color="var(--color-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>El usuario recibirá un <strong style={{ color: 'var(--text-main)' }}>correo de activación automático</strong> con un enlace para crear su propia contraseña.</span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="newUserEmail">Correo Electrónico</label>
              <input
                id="newUserEmail"
                type="email"
                className="form-input"
                required
                placeholder="usuario@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="newUserRole">Rol asignado</label>
              <select
                id="newUserRole"
                className="form-input"
                style={{ background: '#0f172a' }}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="visualizador">Visualizador (Solo lectura)</option>
                <option value="administrador">Administrador (Control total)</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }} disabled={createLoading}>
              {createLoading
                ? <><span className="loading-spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }}></span> Creando...</>
                : <><UserPlus size={16} /> Crear y Enviar Correo</>
              }
            </button>
          </form>

        </div>

        {/* Tabla / Listado de Usuarios */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '350px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Users size={22} color="var(--color-primary)" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Usuarios del Sistema ({Array.isArray(users) ? users.length : 0})</h3>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={fetchUsers} disabled={loading}>
              Actualizar lista
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '40px' }}>
              <div className="loading-spin" style={{ width: '32px', height: '32px', border: '3px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
            </div>
          ) : !Array.isArray(users) || users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
              No hay usuarios registrados en Firestore.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    <th style={{ padding: '12px 8px' }}>Usuario</th>
                    <th style={{ padding: '12px 8px' }}>Rol</th>
                    <th style={{ padding: '12px 8px' }}>Estado</th>
                    <th style={{ padding: '12px 8px' }}>Fecha Registro</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(users) && users.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', transition: 'background 0.2s' }} className="user-row">
                      <td style={{ padding: '12px 8px', wordBreak: 'break-all', fontWeight: 500, color: 'var(--text-main)' }}>
                        {u.email}
                        {u.id === currentUser?.uid && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginLeft: '6px', background: 'rgba(0, 242, 254, 0.08)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(0, 242, 254, 0.15)' }}>
                            Tú
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {u.role === 'administrador' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#00f2fe', background: 'rgba(0, 242, 254, 0.05)', border: '1px solid rgba(0, 242, 254, 0.25)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                            <Shield size={10} />
                            Administrador
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#ba55d3', background: 'rgba(186, 85, 211, 0.05)', border: '1px solid rgba(186, 85, 211, 0.25)', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                            <Eye size={10} />
                            Visualizador
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {(!u.status || u.status === 'ACTIVE') && !u.requirePasswordChange && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#43e97b', background: 'rgba(67, 233, 123, 0.05)', border: '1px solid rgba(67, 233, 123, 0.25)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                            Activo
                          </span>
                        )}
                        {u.status === 'PENDING_SETUP' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#f39c12', background: 'rgba(243, 156, 18, 0.05)', border: '1px solid rgba(243, 156, 18, 0.25)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                            Onboarding
                          </span>
                        )}
                        {u.status === 'ACTIVE_TEMPORARY' || (u.requirePasswordChange && u.status !== 'PENDING_SETUP') ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#ff5e62', background: 'rgba(255, 94, 98, 0.05)', border: '1px solid rgba(255, 94, 98, 0.25)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                            Clave Temp
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {formatUserDate(u.createdAt)}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            title="Reenviar correo de activación"
                            className="btn btn-secondary"
                            style={{ padding: '6px', minWidth: '32px', height: '32px', borderRadius: '6px' }}
                            onClick={() => handleResendEmail(u)}
                            disabled={resendingUid === u.id}
                          >
                            {resendingUid === u.id
                              ? <Loader size={14} color="var(--color-primary)" className="loading-spin" />
                              : <Mail size={14} color="var(--color-primary)" />}
                          </button>

                          <button
                            title="Cambiar contraseña"
                            className="btn btn-secondary"
                            style={{ padding: '6px', minWidth: '32px', height: '32px', borderRadius: '6px' }}
                            onClick={() => {
                              setEditingUser(u);
                              setNewPassword('');
                              setPwdError('');
                              setPwdSuccess('');
                            }}
                          >
                            <KeyRound size={14} color="var(--text-secondary)" />
                          </button>
                          
                          <button
                            title="Eliminar usuario"
                            className="btn btn-secondary"
                            style={{ padding: '6px', minWidth: '32px', height: '32px', borderRadius: '6px', borderColor: u.id === currentUser?.uid ? 'transparent' : 'rgba(255, 94, 98, 0.15)', background: u.id === currentUser?.uid ? 'none' : 'rgba(255, 94, 98, 0.02)' }}
                            disabled={u.id === currentUser?.uid}
                            onClick={() => handleDeleteUser(u.id, u.email)}
                          >
                            <Trash2 size={14} color={u.id === currentUser?.uid ? 'var(--text-muted)' : 'var(--color-error)'} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Panel Probar Correo */}
      <div className="glass-panel" style={{ padding: '20px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Mail size={18} color="var(--color-primary)" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Probar Configuración de Correo</h3>
        </div>
        <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
          Envía un correo de prueba para verificar que el SMTP esté funcionando. Si aún no configuraste el correo, ve a <strong>⚙️ Configuración</strong>.
        </p>

        {testResult && (
          <div
            className={testResult.ok ? 'toast toast-success' : 'toast toast-error'}
            style={{ position: 'relative', bottom: 0, right: 0, width: '100%', transform: 'none', marginBottom: '12px' }}
          >
            {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{testResult.message}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <input
            type="email"
            className="form-input"
            style={{ flex: 1 }}
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="correo@destino.com"
          />
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: '42px', paddingInline: '18px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            onClick={handleTestEmail}
            disabled={testLoading || !testEmail.trim()}
          >
            {testLoading
              ? <><Loader size={14} className="loading-spin" /> Enviando...</>
              : <><Send size={14} /> Enviar Prueba</>}
          </button>
        </div>
      </div>

      {/* Sección de Migración de Corpus & Indexación Semántica (RAG) */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid rgba(0, 242, 254, 0.25)', boxShadow: '0 8px 32px 0 rgba(0, 242, 254, 0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
          <ShieldAlert size={22} color="var(--color-primary)" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Migración de Corpus & Indexación Semántica (RAG)</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '24px', alignItems: 'stretch' }}>
          {/* Métricas y Progreso */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Progreso General</span>
              <span style={{ fontSize: '1.2rem', color: 'var(--color-primary)', fontWeight: 800 }}>{indexStatus.percentage}%</span>
            </div>

            {/* Barra de progreso */}
            <div style={{ width: '100%', height: '10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '5px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ 
                width: `${indexStatus.percentage}%`, 
                height: '100%', 
                background: 'linear-gradient(90deg, #00f2fe 0%, #4facfe 100%)', 
                borderRadius: '5px',
                transition: 'width 0.5s ease',
                boxShadow: '0 0 10px rgba(0, 242, 254, 0.5)'
              }}></div>
            </div>

            {/* Desglose de métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '4px' }}>
              <div style={{ padding: '8px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Documentos</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>{indexStatus.total}</div>
              </div>
              <div style={{ padding: '8px', background: 'rgba(67, 233, 123, 0.04)', borderRadius: '6px', border: '1px solid rgba(67, 233, 123, 0.15)' }}>
                <div style={{ fontSize: '0.75rem', color: '#43e97b' }}>Indexados con Éxito</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#43e97b' }}>{indexStatus.indexed}</div>
              </div>
              <div style={{ padding: '8px', background: 'rgba(243, 156, 18, 0.04)', borderRadius: '6px', border: '1px solid rgba(243, 156, 18, 0.15)' }}>
                <div style={{ fontSize: '0.75rem', color: '#f39c12' }}>Pendientes</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f39c12' }}>{indexStatus.pending}</div>
              </div>
              <div style={{ padding: '8px', background: 'rgba(255, 94, 98, 0.04)', borderRadius: '6px', border: '1px solid rgba(255, 94, 98, 0.15)' }}>
                <div style={{ fontSize: '0.75rem', color: '#ff5e62' }}>Fallidos</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ff5e62' }}>{indexStatus.failed}</div>
              </div>
            </div>

            {/* Botones de acción */}
            <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '10px' }}>
              {indexingActive ? (
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, height: '40px', background: 'rgba(255, 94, 98, 0.1)', borderColor: 'rgba(255, 94, 98, 0.3)', color: '#ff5e62' }}
                  onClick={() => {
                    setIndexingActive(false);
                    addLog(`[BUCLE] Solicitud de pausa enviada. Se detendrá al finalizar el lote actual.`);
                  }}
                >
                  Pausar Proceso
                </button>
              ) : (
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  style={{ flex: 1, height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 0 12px rgba(0, 242, 254, 0.25)' }}
                  onClick={() => {
                    if (indexStatus.pending === 0 && indexStatus.failed === 0) {
                      addLog(`Todos los documentos del corpus ya están indexados.`);
                      return;
                    }
                    setIndexingActive(true);
                  }}
                  disabled={indexLoading || (indexStatus.pending === 0 && indexStatus.failed === 0)}
                >
                  Indexar todo el Corpus
                </button>
              )}

              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ flex: 1, height: '40px' }}
                onClick={handleManualIndexBatch}
                disabled={indexLoading || indexingActive || (indexStatus.pending === 0 && indexStatus.failed === 0)}
              >
                Indexar Lote (10)
              </button>
            </div>
          </div>

          {/* Consola de Logs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Terminal de Indexación Semántica</span>
              {indexingActive && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
                  <span className="loading-spin" style={{ display: 'inline-block', width: '10px', height: '10px', border: '1.5px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                  Indexación automática activa...
                </span>
              )}
            </div>

            <div 
              ref={consoleRef}
              style={{ 
                flex: 1,
                minHeight: '200px',
                maxHeight: '260px',
                background: '#040711', 
                border: '1px solid rgba(255,255,255,0.06)', 
                borderRadius: '8px', 
                padding: '12px', 
                fontFamily: 'Consolas, Monaco, "Lucida Console", monospace', 
                fontSize: '0.75rem', 
                color: '#a5b4fc', 
                overflowY: 'auto',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {consoleLogs.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', paddingTop: '80px' }}>
                  No hay logs en la terminal. Inicia un proceso para ver la traza.
                </div>
              ) : (
                consoleLogs.map((log, idx) => (
                  <div key={idx} style={{ marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.01)', pb: '2px' }}>
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal para restablecer contraseña */}
      {editingUser && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(3, 7, 18, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '16px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid rgba(0, 242, 254, 0.25)', boxShadow: '0 8px 32px 0 rgba(0, 242, 254, 0.15)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={18} color="var(--color-accent)" />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Restablecer Contraseña</h3>
              </div>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex' }} onClick={() => setEditingUser(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              Estás sobreescribiendo de forma inmediata la contraseña del usuario: <strong style={{ color: 'var(--text-main)', wordBreak: 'break-all' }}>{editingUser.email}</strong>
            </div>

            {pwdError && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--color-error)', fontSize: '0.85rem', background: 'rgba(255, 94, 98, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255, 94, 98, 0.15)' }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--color-success)', fontSize: '0.85rem', background: 'rgba(67, 233, 123, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(67, 233, 123, 0.15)' }}>
                <CheckCircle size={16} style={{ flexShrink: 0 }} />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="newPassword">Nueva Contraseña</label>
                <input
                  id="newPassword"
                  type="password"
                  className="form-input"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditingUser(null)} disabled={pwdLoading}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={pwdLoading}>
                  {pwdLoading ? (
                    <span className="loading-spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                  ) : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
