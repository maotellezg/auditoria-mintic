import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import UploadArea from './components/UploadArea';
import DocViewer from './components/DocViewer';
import WikiView from './components/WikiView';
import UserManagement from './components/UserManagement';
import UserAudit from './components/UserAudit';
import Chat from './components/Chat';
import SettingsView from './components/Settings';
import SecopView from './components/SecopView';
import BigQueryView from './components/BigQueryView';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { KeyRound, ShieldAlert, AlertCircle, CheckCircle, Eye, EyeOff, X } from 'lucide-react';

function AppContent() {
  const { currentUser, userRole, requirePasswordChange, setRequirePasswordChange, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'upload', 'wiki', 'usuarios', 'auditoria'
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Estados para el cambio obligatorio de contraseña
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Estados para cambio voluntario de contraseña
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [voluntaryNewPassword, setVoluntaryNewPassword] = useState('');
  const [voluntaryConfirmPassword, setVoluntaryConfirmPassword] = useState('');
  const [voluntaryError, setVoluntaryError] = useState('');
  const [voluntarySuccess, setVoluntarySuccess] = useState('');
  const [voluntaryLoading, setVoluntaryLoading] = useState(false);

  // Si no hay usuario autenticado, mostramos login
  if (!currentUser) {
    return <Auth />;
  }

  // Manejo de cambio de contraseña voluntario
  const handleVoluntaryPasswordChange = async (e) => {
    e.preventDefault();
    setVoluntaryError('');
    setVoluntarySuccess('');
    
    if (voluntaryNewPassword.length < 6) {
      setVoluntaryError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (voluntaryNewPassword !== voluntaryConfirmPassword) {
      setVoluntaryError('Las nuevas contraseñas no coinciden.');
      return;
    }

    setVoluntaryLoading(true);

    try {
      // 1. Re-autenticar al usuario por seguridad
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);

      // 2. Actualizar la contraseña en Firebase Auth
      await updatePassword(currentUser, voluntaryNewPassword);

      setVoluntarySuccess('¡Contraseña actualizada con éxito!');
      setCurrentPassword('');
      setVoluntaryNewPassword('');
      setVoluntaryConfirmPassword('');

      // Cerrar modal tras un breve retraso
      setTimeout(() => {
        setIsChangePasswordOpen(false);
        setVoluntarySuccess('');
      }, 2000);

    } catch (err) {
      console.error('Error al cambiar contraseña voluntariamente:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setVoluntaryError('La contraseña actual es incorrecta.');
      } else {
        setVoluntaryError(err.message || 'No se pudo actualizar la contraseña. Inténtalo de nuevo.');
      }
    } finally {
      setVoluntaryLoading(false);
    }
  };

  // Manejo del cambio de contraseña obligatorio
  const handleMandatoryPasswordChange = async (e) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess('');

    if (newPassword.length < 6) {
      setPwdError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('Las contraseñas no coinciden.');
      return;
    }

    setPwdLoading(true);

    try {
      // 1. Cambiar contraseña en Firebase Auth de forma nativa
      await updatePassword(currentUser, newPassword);

      // 2. Comunicar al backend para cambiar el estado en Firestore a ACTIVE y remover flags
      const idToken = await currentUser.getIdToken(true);
      const response = await fetch('/api/user/complete-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al actualizar el estado de tu perfil en la base de datos.');
      }

      setPwdSuccess('¡Contraseña configurada con éxito! Accediendo a la plataforma...');
      
      // Esperar un momento para la animación de éxito y desbloquear
      setTimeout(() => {
        setRequirePasswordChange(false);
      }, 2000);

    } catch (err) {
      console.error('Error durante el cambio de contraseña obligatorio:', err);
      // Errores comunes de Firebase Auth
      if (err.code === 'auth/requires-recent-login') {
        setPwdError('Por seguridad, debes cerrar sesión y volver a ingresar para cambiar tu contraseña.');
      } else {
        setPwdError(err.message || 'No se pudo guardar la contraseña. Por favor, intenta de nuevo.');
      }
    } finally {
      setPwdLoading(false);
    }
  };

  // Si requiere cambio de contraseña obligatorio, mostramos blocker screen
  if (requirePasswordChange) {
    return (
      <div style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        width: '100vw', 
        height: '100vh', 
        background: 'rgba(3, 7, 18, 0.85)', 
        backdropFilter: 'blur(16px)', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        zIndex: 9999, 
        padding: '24px' 
      }}>
        <div className="glass-panel" style={{ 
          width: '100%', 
          maxWidth: '460px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px', 
          padding: '32px',
          border: '1px solid rgba(0, 242, 254, 0.25)', 
          boxShadow: '0 8px 32px 0 rgba(0, 242, 254, 0.15)' 
        }}>
          
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div className="dropzone-icon" style={{ background: 'rgba(0, 242, 254, 0.1)', color: 'var(--color-primary)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <KeyRound size={32} />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
              Configuración de Contraseña
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Para garantizar la seguridad de tu cuenta, es obligatorio configurar una contraseña nueva y personal antes de acceder al sistema.
            </p>
          </div>

          {pwdError && (
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              color: 'var(--color-error)', 
              fontSize: '0.85rem', 
              background: 'rgba(255, 94, 98, 0.08)', 
              padding: '12px', 
              borderRadius: '8px', 
              border: '1px solid rgba(255, 94, 98, 0.15)',
              alignItems: 'center'
            }}>
              <AlertCircle size={20} style={{ flexShrink: 0 }} />
              <span>{pwdError}</span>
            </div>
          )}

          {pwdSuccess && (
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              color: 'var(--color-success)', 
              fontSize: '0.85rem', 
              background: 'rgba(67, 233, 123, 0.08)', 
              padding: '12px', 
              borderRadius: '8px', 
              border: '1px solid rgba(67, 233, 123, 0.15)',
              alignItems: 'center'
            }}>
              <CheckCircle size={20} style={{ flexShrink: 0 }} />
              <span>{pwdSuccess}</span>
            </div>
          )}

          <form onSubmit={handleMandatoryPasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="mandatoryPassword">Nueva Contraseña</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="mandatoryPassword"
                  type={showPass ? 'text' : 'password'}
                  className="form-input"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ paddingRight: '40px' }}
                  disabled={pwdLoading}
                />
                <button
                  type="button"
                  style={{ 
                    position: 'absolute', 
                    right: '12px', 
                    top: '50%', 
                    transform: 'translateY(-50%)', 
                    background: 'none', 
                    border: 'none', 
                    color: 'var(--text-secondary)', 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onClick={() => setShowPass(!showPass)}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="mandatoryConfirmPassword">Confirmar Nueva Contraseña</label>
              <input
                id="mandatoryConfirmPassword"
                type="password"
                className="form-input"
                required
                placeholder="Repite la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={pwdLoading}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', height: '42px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} 
                disabled={pwdLoading}
              >
                {pwdLoading ? (
                  <span className="loading-spin" style={{ display: 'inline-block', width: '18px', height: '16px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                ) : 'Guardar y Activar Cuenta'}
              </button>

              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ width: '100%', height: '42px', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)' }} 
                onClick={() => logout()}
                disabled={pwdLoading}
              >
                Cancelar y Salir
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Si hay un documento seleccionado, mostramos el visor de detalle (ocupa todo el contenido principal)
  const renderMainContent = () => {
    if (selectedDoc) {
      return (
        <DocViewer 
          doc={selectedDoc} 
          onBack={() => setSelectedDoc(null)} 
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            onSelectDoc={(doc) => setSelectedDoc(doc)} 
          />
        );
      case 'upload':
        return userRole === 'administrador' ? (
          <UploadArea 
            onUploadSuccess={() => setActiveTab('dashboard')} 
          />
        ) : (
          <Dashboard onSelectDoc={(doc) => setSelectedDoc(doc)} />
        );
      case 'wiki':
        return (
          <WikiView 
            onSelectDoc={(doc) => setSelectedDoc(doc)} 
          />
        );
      case 'chat':
        return (
          <Chat onSelectDoc={(doc) => setSelectedDoc(doc)} />
        );
      case 'usuarios':
        return userRole === 'administrador' ? (
          <UserManagement />
        ) : (
          <Dashboard onSelectDoc={(doc) => setSelectedDoc(doc)} />
        );
      case 'auditoria':
        return (
          <UserAudit />
        );
      case 'secop':
        return <SecopView />;
      case 'bigquery':
        return <BigQueryView />;
      case 'configuracion':
        return userRole === 'administrador' ? (
          <SettingsView />
        ) : (
          <Dashboard onSelectDoc={(doc) => setSelectedDoc(doc)} />
        );
      default:
        return <Dashboard onSelectDoc={(doc) => setSelectedDoc(doc)} />;
    }
  };

  const getHeaderTitleAndSubtitle = () => {
    if (selectedDoc) {
      return {
        title: 'Visor de Documento',
        subtitle: 'Análisis inteligente del expediente ambiental'
      };
    }

    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Dashboard de Auditoría MinTic',
          subtitle: 'Contratos, declaraciones y documentos del ecosistema MinTic analizados por IA'
        };
      case 'upload':
        return {
          title: 'Cargar Documentos',
          subtitle: 'Sube contratos, declaraciones de renta, resoluciones o cualquier documento MinTic'
        };
      case 'wiki':
        return {
          title: 'Wiki de Conocimiento MinTic',
          subtitle: 'Red de entidades, personas y contratos interconectados automáticamente'
        };
      case 'chat':
        return {
          title: 'Asistente de Auditoría IA',
          subtitle: 'Consulta contratos, personas y documentos mediante inteligencia artificial con citas en tiempo real'
        };
      case 'usuarios':
        return {
          title: 'Gestión de Usuarios',
          subtitle: 'Administración de accesos, roles y contraseñas del sistema'
        };
      case 'auditoria':
        return {
          title: 'Módulo de Auditoría Integral',
          subtitle: 'Trazabilidad de acciones, justificaciones de carga y rendimiento de Vertex AI'
        };
      default:
        return {
          title: 'Dashboard MinTic',
          subtitle: 'Documentos analizados'
        };
    }
  };

  const { title, subtitle } = getHeaderTitleAndSubtitle();

  return (
    <div className="app-container">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(tab) => {
          setSelectedDoc(null); // Limpiar selección al cambiar de pestaña
          setActiveTab(tab);
        }} 
        onOpenChangePassword={() => setIsChangePasswordOpen(true)}
      />
      
      <main className="main-content">
        <Header title={title} subtitle={subtitle} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {renderMainContent()}
        </div>
      </main>

      {/* Modal de Cambio de Contraseña Voluntario */}
      {isChangePasswordOpen && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          width: '100vw', 
          height: '100vh', 
          background: 'rgba(3, 7, 18, 0.75)', 
          backdropFilter: 'blur(8px)', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          zIndex: 10000, 
          padding: '16px' 
        }}>
          <div className="glass-panel" style={{ 
            width: '100%', 
            maxWidth: '420px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '16px', 
            border: '1px solid rgba(0, 242, 254, 0.25)', 
            boxShadow: '0 8px 32px 0 rgba(0, 242, 254, 0.15)' 
          }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={18} color="var(--color-accent)" />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Cambiar Contraseña</h3>
              </div>
              <button 
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex' }} 
                onClick={() => {
                  setIsChangePasswordOpen(false);
                  setVoluntaryError('');
                  setVoluntarySuccess('');
                  setCurrentPassword('');
                  setVoluntaryNewPassword('');
                  setVoluntaryConfirmPassword('');
                }}
              >
                <X size={18} />
              </button>
            </div>

            {voluntaryError && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--color-error)', fontSize: '0.85rem', background: 'rgba(255, 94, 98, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255, 94, 98, 0.15)' }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{voluntaryError}</span>
              </div>
            )}

            {voluntarySuccess && (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--color-success)', fontSize: '0.85rem', background: 'rgba(67, 233, 123, 0.08)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(67, 233, 123, 0.15)' }}>
                <CheckCircle size={16} style={{ flexShrink: 0 }} />
                <span>{voluntarySuccess}</span>
              </div>
            )}

            <form onSubmit={handleVoluntaryPasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="voluntaryCurrentPassword">Contraseña Actual</label>
                <input
                  id="voluntaryCurrentPassword"
                  type="password"
                  className="form-input"
                  required
                  placeholder="Introduce tu clave actual"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={voluntaryLoading}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="voluntaryNewPassword">Nueva Contraseña</label>
                <input
                  id="voluntaryNewPassword"
                  type="password"
                  className="form-input"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={voluntaryNewPassword}
                  onChange={(e) => setVoluntaryNewPassword(e.target.value)}
                  disabled={voluntaryLoading}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="voluntaryConfirmPassword">Confirmar Nueva Contraseña</label>
                <input
                  id="voluntaryConfirmPassword"
                  type="password"
                  className="form-input"
                  required
                  placeholder="Repite tu nueva clave"
                  value={voluntaryConfirmPassword}
                  onChange={(e) => setVoluntaryConfirmPassword(e.target.value)}
                  disabled={voluntaryLoading}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => {
                    setIsChangePasswordOpen(false);
                    setVoluntaryError('');
                    setVoluntarySuccess('');
                    setCurrentPassword('');
                    setVoluntaryNewPassword('');
                    setVoluntaryConfirmPassword('');
                  }} 
                  disabled={voluntaryLoading}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={voluntaryLoading}>
                  {voluntaryLoading ? (
                    <span className="loading-spin" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                  ) : 'Actualizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
