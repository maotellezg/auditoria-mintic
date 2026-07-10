import { LayoutDashboard, UploadCloud, BookOpen, LogOut, FileText, Users, History, KeyRound, MessageSquare, Settings, Building2, Database, BarChart2 } from 'lucide-react';

import { useAuth } from '../context/AuthContext';

export default function Sidebar({ activeTab, setActiveTab, onOpenChangePassword }) {
  const { logout, userRole } = useAuth();

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <FileText size={28} color="#00f2fe" />
        <span>Auditoria MinTic</span>
      </div>

      <ul className="sidebar-menu">
        <li>
          <div 
            className={`sidebar-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </div>
        </li>
        
        {userRole === 'administrador' && (
          <li>
            <div 
              className={`sidebar-link ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <UploadCloud size={20} />
              <span>Cargar Archivos</span>
            </div>
          </li>
        )}

        {/* WikiDoc — oculto temporalmente, código intacto */}
        <li style={{ display: 'none' }}>
          <div 
            className={`sidebar-link ${activeTab === 'wiki' ? 'active' : ''}`}
            onClick={() => setActiveTab('wiki')}
          >
            <BookOpen size={20} />
            <span>WikiDoc</span>
          </div>
        </li>

        <li>
          <div 
            className={`sidebar-link ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={20} />
            <span>Chat con IA</span>
          </div>
        </li>

        <li>
          <div 
            className={`sidebar-link ${activeTab === 'secop' ? 'active' : ''}`}
            onClick={() => setActiveTab('secop')}
          >
            <Building2 size={20} />
            <span>Sector TIC — SECOP</span>
          </div>
        </li>

        <li>
          <div 
            className={`sidebar-link ${activeTab === 'bigquery' ? 'active' : ''}`}
            onClick={() => setActiveTab('bigquery')}
          >
            <Database size={20} />
            <span>BigQuery SECOP</span>
          </div>
        </li>

        <li>
          <div
            className={`sidebar-link ${activeTab === 'analisis' ? 'active' : ''}`}
            onClick={() => setActiveTab('analisis')}
          >
            <BarChart2 size={20} />
            <span>📊 Análisis Sector TIC</span>
          </div>
        </li>

        {/* ── Sector Ambiente ── */}
        <li style={{ padding: '12px 16px 4px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Sector Ambiente
        </li>

        <li>
          <div
            className={`sidebar-link ${activeTab === 'secop_ambiente' ? 'active' : ''}`}
            onClick={() => setActiveTab('secop_ambiente')}
          >
            <Building2 size={20} />
            <span>🌿 Sector Ambiente — SECOP</span>
          </div>
        </li>

        <li>
          <div
            className={`sidebar-link ${activeTab === 'analisis_ambiente' ? 'active' : ''}`}
            onClick={() => setActiveTab('analisis_ambiente')}
          >
            <BarChart2 size={20} />
            <span>📊 Análisis Sector Ambiente</span>
          </div>
        </li>

        <li>
          <div 
            className={`sidebar-link ${activeTab === 'auditoria' ? 'active' : ''}`}
            onClick={() => setActiveTab('auditoria')}
          >
            <History size={20} />
            <span>Auditoría</span>
          </div>
        </li>

        {userRole === 'administrador' && (
          <li>
            <div 
              className={`sidebar-link ${activeTab === 'usuarios' ? 'active' : ''}`}
              onClick={() => setActiveTab('usuarios')}
            >
              <Users size={20} />
              <span>Gestión Usuarios</span>
            </div>
          </li>
        )}

        {userRole === 'administrador' && (
          <li>
            <div 
              className={`sidebar-link ${activeTab === 'configuracion' ? 'active' : ''}`}
              onClick={() => setActiveTab('configuracion')}
            >
              <Settings size={20} />
              <span>Configuración</span>
            </div>
          </li>
        )}
      </ul>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button 
          onClick={onOpenChangePassword} 
          className="sidebar-link" 
          style={{ 
            width: '100%', 
            background: 'none', 
            border: 'none', 
            textAlign: 'left', 
            color: 'var(--text-secondary)' 
          }}
        >
          <KeyRound size={20} />
          <span>Cambiar Clave</span>
        </button>

        <button 
          onClick={logout} 
          className="sidebar-link" 
          style={{ 
            width: '100%', 
            background: 'none', 
            border: 'none', 
            textAlign: 'left', 
            color: 'var(--color-error)' 
          }}
        >
          <LogOut size={20} />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </div>
  );
}
