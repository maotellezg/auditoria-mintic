import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Search, RefreshCw, FileText, UploadCloud, Eye, 
  Cpu, AlertTriangle, ChevronDown, ChevronUp, Clock, 
  Database, User, BarChart2, ShieldAlert
} from 'lucide-react';

export default function UserAudit() {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveTab] = useState('ALL'); // 'ALL', 'UPLOADS', 'VIEWS', 'IA', 'CANCELLATIONS', 'RELOADS'
  const [expandedRow, setExpandedRow] = useState(null); // id of expanded row

  const fetchAuditLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/audit', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      } else {
        const errRes = await response.json();
        setError(errRes.error || 'No se pudieron recuperar los registros de auditoría.');
      }
    } catch (err) {
      console.error('Error al recuperar logs de auditoría:', err);
      setError('Error al conectar con el servidor backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchAuditLogs();
    }
  }, [currentUser]);

  // Filtrar logs según texto y tab activa
  const filteredLogs = logs.filter(log => {
    // 1. Filtrar por término de búsqueda (case insensitive)
    const matchesSearch = 
      (log.userEmail || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.details?.fileName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.details?.uploadReason || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // 2. Filtrar por tipo de pestaña de acción
    switch (activeFilter) {
      case 'UPLOADS':
        return log.action === 'UPLOAD_DOCUMENT';
      case 'VIEWS':
        return log.action === 'VIEW_DOCUMENT';
      case 'IA':
        return log.action === 'IA_ANALYSIS';
      case 'CANCELLATIONS':
        return log.action === 'CANCEL_ANALYSIS' || log.action === 'CANCEL_ALL';
      case 'RELOADS':
        return log.action === 'REANALYZE_DOCUMENT' || log.action === 'REANALYZE_ALL';
      case 'ALL':
      default:
        return true;
    }
  });

  const toggleRow = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const formatTimestamp = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const getActionBadge = (action) => {
    switch (action) {
      case 'UPLOAD_DOCUMENT':
        return (
          <span className="badge" style={{ 
            background: 'rgba(16, 185, 129, 0.08)', 
            color: '#10b981', 
            borderColor: 'rgba(16, 185, 129, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            <UploadCloud size={12} />
            Carga de Archivo
          </span>
        );
      case 'VIEW_DOCUMENT':
        return (
          <span className="badge" style={{ 
            background: 'rgba(59, 130, 246, 0.08)', 
            color: '#3b82f6', 
            borderColor: 'rgba(59, 130, 246, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            <Eye size={12} />
            Visualización
          </span>
        );
      case 'IA_ANALYSIS':
        return (
          <span className="badge" style={{ 
            background: 'rgba(139, 92, 246, 0.08)', 
            color: '#a78bfa', 
            borderColor: 'rgba(139, 92, 246, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            <Cpu size={12} />
            Análisis de IA
          </span>
        );
      case 'CANCEL_ANALYSIS':
      case 'CANCEL_ALL':
        return (
          <span className="badge" style={{ 
            background: 'rgba(239, 68, 68, 0.08)', 
            color: '#ef4444', 
            borderColor: 'rgba(239, 68, 68, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            <ShieldAlert size={12} />
            Cancelación
          </span>
        );
      case 'REANALYZE_DOCUMENT':
      case 'REANALYZE_ALL':
        return (
          <span className="badge" style={{ 
            background: 'rgba(245, 158, 11, 0.08)', 
            color: '#f59e0b', 
            borderColor: 'rgba(245, 158, 11, 0.2)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            <RefreshCw size={12} />
            Re-análisis
          </span>
        );
      default:
        return (
          <span className="badge" style={{ 
            textTransform: 'none',
            fontSize: '0.8rem',
            padding: '5px 10px'
          }}>
            {action}
          </span>
        );
    }
  };

  const getActionSummary = (log) => {
    const details = log.details || {};
    switch (log.action) {
      case 'UPLOAD_DOCUMENT': {
        const fileExt = details.fileType || (details.fileName ? details.fileName.split('.').pop().toUpperCase() : 'DOCUMENTO');
        const sizeInMb = details.fileSize ? (details.fileSize / (1024 * 1024)).toFixed(2) : null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
              Subió el archivo "{details.fileName}"
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Tipo: {fileExt} 
              {sizeInMb && ` • Peso: ${sizeInMb} MB`}
              {details.pageCount && ` • Cantidad de hojas: ${details.pageCount}`}
              {" • Justificación obligatoria ingresada"}
            </span>
          </div>
        );
      }
      case 'VIEW_DOCUMENT':
        return (
          <span style={{ color: 'var(--text-main)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
            Abrió el documento <strong style={{ color: 'var(--color-primary)' }}>"{details.fileName}"</strong> para visualización
          </span>
        );
      case 'IA_ANALYSIS': {
        const fileExt = details.fileType || (details.fileName ? details.fileName.split('.').pop().toUpperCase() : 'DOCUMENTO');
        const sizeInMb = details.fileSize ? (details.fileSize / (1024 * 1024)).toFixed(2) : null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: 'var(--text-main)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
              Gemini analizó exitosamente <strong style={{ color: '#a78bfa' }}>"{details.fileName}"</strong>
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span>Modelo: {details.modelUsed}</span>
              <span>Duración: {(details.durationMs / 1000).toFixed(2)}s</span>
              <span>Tokens: {details.tokens?.total || 0}</span>
              <span>Tipo: {fileExt}</span>
              {sizeInMb && <span>Peso: {sizeInMb} MB</span>}
              {details.pageCount && <span>Hojas: {details.pageCount}</span>}
            </span>
          </div>
        );
      }
      case 'CANCEL_ANALYSIS':
        return (
          <span style={{ color: 'var(--text-main)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
            Canceló el análisis activo del documento <strong>"{details.fileName}"</strong>
          </span>
        );
      case 'CANCEL_ALL':
        return (
          <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
            Ejecutó cancelación masiva. Detuvo <strong>{details.count}</strong> análisis en proceso
          </span>
        );
      case 'REANALYZE_DOCUMENT':
        return (
          <span style={{ color: 'var(--text-main)', fontSize: '0.9rem', wordBreak: 'break-all' }}>
            Solicitó re-análisis individual para el documento <strong>"{details.fileName}"</strong>
          </span>
        );
      case 'REANALYZE_ALL':
        return (
          <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
            Solicitó re-análisis masivo. Iniciando reprocesamiento de <strong>{details.count}</strong> documentos
          </span>
        );
      default:
        return <span style={{ color: 'var(--text-muted)' }}>Acción general de auditoría</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Panel de Controles / Filtros de Auditoría */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Buscador inteligente */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, position: 'relative', minWidth: '280px' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              <Search size={18} />
            </span>
            <input 
              type="text" 
              placeholder="Buscar por correo, archivo, justificación o acción..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 12px 10px 38px',
                color: 'var(--text-main)',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--color-primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
            />
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={fetchAuditLogs} 
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '11px 16px' }}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'loading-spin' : ''} />
            Recargar Historial
          </button>
        </div>

        {/* Filtros rápidos con Chips */}
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
          {[
            { id: 'ALL', label: 'Todos los Registros', count: logs.length },
            { id: 'UPLOADS', label: 'Cargas', count: logs.filter(l => l.action === 'UPLOAD_DOCUMENT').length },
            { id: 'VIEWS', label: 'Visualizaciones', count: logs.filter(l => l.action === 'VIEW_DOCUMENT').length },
            { id: 'IA', label: 'Análisis de IA', count: logs.filter(l => l.action === 'IA_ANALYSIS').length },
            { id: 'CANCELLATIONS', label: 'Cancelaciones', count: logs.filter(l => l.action === 'CANCEL_ANALYSIS' || l.action === 'CANCEL_ALL').length },
            { id: 'RELOADS', label: 'Recargas', count: logs.filter(l => l.action === 'REANALYZE_DOCUMENT' || l.action === 'REANALYZE_ALL').length },
          ].map(chip => (
            <button
              key={chip.id}
              onClick={() => {
                setActiveTab(chip.id);
                setExpandedRow(null);
              }}
              style={{
                background: activeFilter === chip.id ? 'var(--color-primary-dark, rgba(0, 242, 254, 0.15))' : 'rgba(255, 255, 255, 0.01)',
                color: activeFilter === chip.id ? 'var(--color-primary)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: activeFilter === chip.id ? 'var(--color-primary)' : 'var(--border-color)',
                borderRadius: '50px',
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: activeFilter === chip.id ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>{chip.label}</span>
              <span style={{ 
                background: activeFilter === chip.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)', 
                color: activeFilter === chip.id ? '#0d1117' : 'var(--text-muted)', 
                borderRadius: '50%', 
                width: '18px', 
                height: '18px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700
              }}>
                {chip.count}
              </span>
            </button>
          ))}
        </div>

      </div>

      {/* Alerta de error */}
      {error && (
        <div className="glass-panel" style={{ borderColor: 'var(--color-error)', background: 'rgba(239, 68, 68, 0.02)', padding: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <AlertTriangle color="var(--color-error)" size={20} />
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {/* Tabla de Auditoría */}
      <div className="glass-panel" style={{ padding: '0px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' }}>
            <div className="loading-spin" style={{ width: '40px', height: '40px', border: '3px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Recuperando bitácora de auditoría segura...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
            <FileText size={48} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ color: 'var(--text-main)', fontSize: '1.1rem', fontWeight: 700, marginBottom: '4px' }}>
              No se encontraron registros
            </h3>
            <p style={{ fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto' }}>
              No hay acciones de auditoría guardadas que coincidan con la pestaña de filtro o término de búsqueda ingresado.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dashboard-table" style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.01)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '22%' }}>Fecha y Hora</th>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '22%' }}>Usuario</th>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '20%' }}>Acción</th>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '30%' }}>Descripción del Evento</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '6%' }}>Info</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const hasDetails = log.action === 'UPLOAD_DOCUMENT' || log.action === 'IA_ANALYSIS';
                  const isExpanded = expandedRow === log.id;
                  
                  return (
                    <React.Fragment key={log.id}>
                      <tr 
                        onClick={() => hasDetails && toggleRow(log.id)}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          cursor: hasDetails ? 'pointer' : 'default',
                          background: isExpanded ? 'rgba(255, 255, 255, 0.02)' : '',
                          transition: 'background 0.2s'
                        }}
                        className={hasDetails ? 'hover-row' : ''}
                      >
                        {/* Fecha */}
                        <td style={{ padding: '16px 20px', fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatTimestamp(log.timestamp)}
                        </td>

                        {/* Usuario */}
                        <td style={{ padding: '16px 20px', fontSize: '0.88rem', color: 'var(--text-main)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ 
                              width: '24px', 
                              height: '24px', 
                              borderRadius: '50%', 
                              background: log.userEmail === 'sistema' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(0, 242, 254, 0.15)',
                              color: log.userEmail === 'sistema' ? '#a78bfa' : 'var(--color-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.75rem',
                              fontWeight: 700
                            }}>
                              {log.userEmail === 'sistema' ? 'S' : (log.userEmail || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ 
                              maxWidth: '180px', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap',
                              fontWeight: log.userEmail === currentUser.email ? 600 : 400
                            }} title={log.userEmail}>
                              {log.userEmail || 'sistema'}
                            </span>
                          </div>
                        </td>

                        {/* Badge de Acción */}
                        <td style={{ padding: '16px 20px' }}>
                          {getActionBadge(log.action)}
                        </td>

                        {/* Resumen */}
                        <td style={{ padding: '16px 20px' }}>
                          {getActionSummary(log)}
                        </td>

                        {/* Botón de Expansión */}
                        <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                          {hasDetails ? (
                            <button 
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '4px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(log.id);
                              }}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.05)', fontSize: '1.2rem' }}>•</span>
                          )}
                        </td>
                      </tr>

                      {/* Fila Expansible */}
                      {hasDetails && isExpanded && (
                        <tr style={{ background: 'rgba(0, 242, 254, 0.01)' }}>
                          <td colSpan={5} style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)' }}>
                            
                            {/* Detalle para Carga de Documento */}
                            {log.action === 'UPLOAD_DOCUMENT' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                  <span>📝</span> Explicación de los documentos cargados por el usuario:
                                </div>
                                <div style={{ 
                                  background: 'rgba(255,255,255,0.02)', 
                                  border: '1px solid var(--border-color)', 
                                  borderRadius: '6px', 
                                  padding: '14px 18px', 
                                  fontSize: '0.9rem', 
                                  color: 'var(--text-main)', 
                                  lineHeight: '1.6',
                                  whiteSpace: 'pre-wrap',
                                  fontStyle: 'italic',
                                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
                                }}>
                                  "{log.details?.uploadReason}"
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  ID del Documento en Firestore: {log.details?.docId}
                                </div>
                              </div>
                            )}

                            {/* Detalle para Análisis de IA */}
                            {log.action === 'IA_ANALYSIS' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontWeight: 700, color: '#a78bfa' }}>
                                  <BarChart2 size={16} />
                                  Métricas Técnicas de Procesamiento con Gemini (Vertex AI)
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                                  {/* Caja de Modelo */}
                                  <div className="glass-panel" style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.01)', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(167, 139, 250, 0.1)', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyOrigin: 'center', justifyContent: 'center' }}>
                                      <Cpu size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Modelo Utilizado</div>
                                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{log.details?.modelUsed}</div>
                                    </div>
                                  </div>

                                  {/* Caja de Tiempo */}
                                  <div className="glass-panel" style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.01)', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyOrigin: 'center', justifyContent: 'center' }}>
                                      <Clock size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tiempo de Análisis</div>
                                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                        {log.details?.durationMs ? `${(log.details.durationMs / 1000).toFixed(2)} segundos` : 'No medido'}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Caja de Tokens */}
                                  <div className="glass-panel" style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.01)', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--border-color)' }}>
                                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyOrigin: 'center', justifyContent: 'center' }}>
                                      <Database size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tokens Totales</div>
                                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                        {log.details?.tokens?.total || 0} tokens
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Barra de desglose de tokens */}
                                {log.details?.tokens && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                      <span>Distribución de Tokens en Vertex AI</span>
                                      <span>Total: {log.details.tokens.total} tokens</span>
                                    </div>
                                    
                                    {/* Barra apilada */}
                                    <div style={{ height: '8px', width: '100%', borderRadius: '50px', background: 'rgba(255,255,255,0.05)', display: 'flex', overflow: 'hidden' }}>
                                      <div 
                                        style={{ 
                                          width: `${Math.max(5, (log.details.tokens.prompt / log.details.tokens.total) * 100)}%`, 
                                          background: '#3b82f6', 
                                          height: '100%' 
                                        }} 
                                        title={`Prompt (Entrada): ${log.details.tokens.prompt}`}
                                      />
                                      <div 
                                        style={{ 
                                          width: `${Math.max(5, (log.details.tokens.candidates / log.details.tokens.total) * 100)}%`, 
                                          background: '#10b981', 
                                          height: '100%' 
                                        }} 
                                        title={`Candidates (Salida): ${log.details.tokens.candidates}`}
                                      />
                                    </div>

                                    {/* Leyenda */}
                                    <div style={{ display: 'flex', gap: '20px', marginTop: '4px', fontSize: '0.78rem' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#3b82f6' }}></div>
                                        <span style={{ color: 'var(--text-muted)' }}>Prompt (Entrada):</span>
                                        <strong style={{ color: 'var(--text-main)' }}>{log.details.tokens.prompt} tokens</strong>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#10b981' }}></div>
                                        <span style={{ color: 'var(--text-muted)' }}>Candidates (Salida/Generados):</span>
                                        <strong style={{ color: 'var(--text-main)' }}>{log.details.tokens.candidates} tokens</strong>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
