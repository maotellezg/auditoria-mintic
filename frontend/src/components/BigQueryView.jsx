import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Database, Play, CheckCircle, AlertTriangle, Clock, RefreshCw, Zap, HardDrive, BarChart2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const COP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const FMT_TS = (ts) => ts ? new Date(ts).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';
const NUM = (v) => Number(v || 0).toLocaleString('es-CO');

export default function BigQueryView() {
  const { currentUser } = useAuth();
  const [stats, setStats]       = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [syncActivo, setSyncActivo]     = useState(false);
  const [log, setLog]           = useState([]);
  const [resumen, setResumen]   = useState(null);
  const [syncDone, setSyncDone] = useState(false);
  const logRef  = useRef(null);
  const esRef   = useRef(null);

  const cargarStats = useCallback(async () => {
    if (!currentUser) return;
    setLoadingStats(true);
    try {
      const token = await currentUser.getIdToken();
      const resp  = await fetch('/api/secop/bigquery/stats', { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) setStats(await resp.json());
    } catch {}
    setLoadingStats(false);
  }, [currentUser]);

  useEffect(() => { cargarStats(); }, [cargarStats]);

  // Auto-scroll del log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const addLog = (msg, tipo = 'info') => {
    setLog(prev => [...prev, { msg, tipo, ts: new Date().toLocaleTimeString('es-CO') }]);
  };

  const iniciarSync = async () => {
    if (syncActivo || !currentUser) return;
    setSyncActivo(true); setSyncDone(false); setLog([]); setResumen(null);
    addLog('🚀 Conectando con el servidor...', 'inicio');

    try {
      const token = await currentUser.getIdToken();
      const es = new EventSource(`/api/secop/sync-bigquery/stream?token=${token}`);
      esRef.current = es;

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.tipo === 'fin') {
            es.close(); setSyncActivo(false); setSyncDone(true);
            cargarStats();
          } else if (data.tipo === 'resumen') {
            setResumen(data.resumen);
          } else {
            addLog(data.msg || '', data.tipo || 'info');
          }
        } catch {}
      };

      es.onerror = () => {
        addLog('❌ Conexión SSE interrumpida.', 'error');
        es.close(); setSyncActivo(false);
      };

    } catch (err) {
      addLog(`❌ Error: ${err.message}`, 'error');
      setSyncActivo(false);
    }
  };

  const cancelarSync = () => {
    esRef.current?.close();
    setSyncActivo(false);
    addLog('⛔ Sincronización cancelada por el usuario.', 'aviso');
  };

  const logColor = (tipo) => {
    if (tipo === 'inicio') return '#214E92';
    if (tipo === 'fin')    return '#0D7C3D';
    if (tipo === 'error')  return '#C0392B';
    if (tipo === 'aviso')  return '#E67E22';
    if (String(tipo).includes('✅') || String(tipo).includes('💾')) return '#0D7C3D';
    return '#475569';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Título */}
      <div>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database size={22} color="#214E92"/> BigQuery — SECOP MinTic
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: '4px 0 0' }}>
          Dataset <code style={{ background: '#F1F5F9', padding: '1px 6px', borderRadius: '4px' }}>secop_mintic</code> · 3 tablas · sincronización incremental diaria · proyecto <code style={{ background: '#F1F5F9', padding: '1px 6px', borderRadius: '4px' }}>auditoria-mintc</code>
        </p>
      </div>

      {/* Estadísticas de tablas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
        {(stats?.tablas || [
          { id: 'secop_ii_contratos', label: 'SECOP II — Contratos' },
          { id: 'secop_ii_procesos',  label: 'SECOP II — Procesos' },
          { id: 'tienda_virtual',     label: 'Tienda Virtual' },
        ]).map((t, i) => {
          const iconos  = ['📄', '📋', '🏪'];
          const colores = ['#214E92', '#0D7C3D', '#7B2D8B'];
          const c = colores[i];
          return (
            <div key={t.id} style={{ background: '#FFF', border: `1.5px solid ${c}20`, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
              <div style={{ background: `${c}10`, borderBottom: `3px solid ${c}`, padding: '12px 16px' }}>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: c }}>{iconos[i]} {t.label}</div>
                <div style={{ fontSize: '0.65rem', color: '#94A3B8', fontWeight: 600, marginTop: '2px', textTransform: 'uppercase' }}>{t.id}</div>
              </div>
              <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.4rem', color: c }}>{t.total ? NUM(t.total) : '—'}</div>
                  <div style={{ fontSize: '0.65rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Total filas</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0D7C3D' }}>{t.filas_mintic ? NUM(t.filas_mintic) : '—'}</div>
                  <div style={{ fontSize: '0.65rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Filas MinTic</div>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={10}/> Última carga: <strong>{FMT_TS(t.ultima_carga)}</strong>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button onClick={cargarStats} disabled={loadingStats}
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', background: loadingStats ? '#F8FAFC' : '#FFF', border: '2px dashed #E0E6ED', borderRadius: '12px', cursor: loadingStats ? 'wait' : 'pointer', color: '#94A3B8', padding: '24px', minHeight: '120px' }}>
          <RefreshCw size={20} color="#94A3B8" style={{ animation: loadingStats ? 'spin 1s linear infinite' : 'none' }}/>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{loadingStats ? 'Actualizando...' : 'Actualizar stats'}</span>
        </button>
      </div>

      {/* Panel de Sincronización */}
      <div style={{ background: '#FFF', border: '1.5px solid #E0E6ED', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        {/* Cabecera */}
        <div style={{ background: syncActivo ? '#EBF1FB' : syncDone ? '#E8F7EE' : '#F8FAFC', borderBottom: `3px solid ${syncActivo ? '#214E92' : syncDone ? '#0D7C3D' : '#E0E6ED'}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: syncActivo ? '#214E92' : syncDone ? '#0D7C3D' : '#1E293B', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={16}/> Carga Completa → BigQuery
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '3px' }}>
              Descarga TODOS los registros · 3 fuentes · 7 entidades · desde 2018-08-07 · MERGE automático (sin duplicados)
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!syncActivo ? (
              <button onClick={iniciarSync}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 22px', borderRadius: '8px', background: syncDone ? '#0D7C3D' : '#214E92', color: '#FFF', border: 'none', fontWeight: 800, fontSize: '0.88rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(33,78,146,0.35)' }}>
                <Play size={14}/> {syncDone ? 'Volver a Sincronizar' : 'Iniciar Carga Completa'}
              </button>
            ) : (
              <button onClick={cancelarSync}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 22px', borderRadius: '8px', background: '#C0392B', color: '#FFF', border: 'none', fontWeight: 800, fontSize: '0.88rem', cursor: 'pointer' }}>
                ⛔ Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Progreso animado */}
        {syncActivo && (
          <div style={{ height: '4px', background: '#EBF1FB', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'linear-gradient(90deg, #214E92, #0D7C3D, #7B2D8B)', backgroundSize: '200% 100%', animation: 'slideGradient 2s linear infinite' }}/>
          </div>
        )}

        {/* Log de progreso */}
        {log.length > 0 && (
          <div ref={logRef}
            style={{ height: '340px', overflowY: 'auto', padding: '12px 16px', background: '#0F172A', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.7 }}>
            {log.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', color: l.msg.includes('❌') ? '#F87171' : l.msg.includes('✅') || l.msg.includes('💾') ? '#4ADE80' : l.msg.includes('⚠️') ? '#FBBF24' : l.msg.includes('🚀') || l.msg.includes('━') ? '#93C5FD' : '#94A3B8' }}>
                <span style={{ color: '#475569', flexShrink: 0 }}>[{l.ts}]</span>
                <span style={{ wordBreak: 'break-all' }}>{l.msg}</span>
              </div>
            ))}
            {syncActivo && (
              <div style={{ color: '#60A5FA', display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ animation: 'pulse 1s ease-in-out infinite' }}>▋</span> Procesando...
              </div>
            )}
          </div>
        )}

        {/* Resumen final */}
        {syncDone && resumen && (
          <div style={{ padding: '18px 20px', background: '#E8F7EE', borderTop: '2px solid #0D7C3D' }}>
            <div style={{ fontWeight: 800, color: '#0D7C3D', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.95rem' }}>
              <CheckCircle size={16}/> Sincronización completada
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              {[
                { label: '⏱ Duración', val: `${resumen.duracionSeg}s` },
                { label: '📄 Total procesados', val: NUM(resumen.totalFilas) },
                { label: '🔑 Filas únicas en BQ', val: NUM(resumen.filasUnicas), color: '#0D7C3D' },
                { label: '⚠️ Errores', val: resumen.errores?.length || 0, color: resumen.errores?.length ? '#C0392B' : '#0D7C3D' },
              ].map((k, i) => (
                <div key={i} style={{ background: '#FFF', borderRadius: '8px', padding: '10px 14px' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem', color: k.color || '#1E293B' }}>{k.val}</div>
                  <div style={{ fontSize: '0.67rem', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                </div>
              ))}
            </div>
            {resumen.detalles && (
              <div style={{ marginTop: '14px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#D1FAE5' }}>
                      {['Entidad', 'Fuente', 'Modo', 'Registros'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: '#065F46', textTransform: 'uppercase', fontSize: '0.65rem' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.detalles.map((d, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : '#F0FDF4', borderBottom: '1px solid #D1FAE5' }}>
                        <td style={{ padding: '5px 10px', fontWeight: 600 }}>{d.entidad}</td>
                        <td style={{ padding: '5px 10px', color: '#64748B' }}>{d.fuente}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <span style={{ background: d.modo === 'contratante' ? '#EBF1FB' : '#E8F8F5', color: d.modo === 'contratante' ? '#214E92' : '#0D7C3D', borderRadius: '5px', padding: '2px 7px', fontWeight: 700, fontSize: '0.7rem' }}>{d.modo}</span>
                        </td>
                        <td style={{ padding: '5px 10px', fontWeight: 800, color: d.filas > 0 ? '#0D7C3D' : '#94A3B8' }}>{NUM(d.filas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Estado vacío */}
        {!syncActivo && !syncDone && log.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Zap size={32} color="#E0E6ED" style={{ marginBottom: '12px' }}/>
            <p style={{ color: '#94A3B8', fontSize: '0.88rem', margin: 0 }}>
              Presiona <strong>"Iniciar Carga Completa"</strong> para descargar todos los registros de las 3 APIs<br/>
              y guardarlos en BigQuery con deduplicación automática.
            </p>
            <p style={{ color: '#CBD5E1', fontSize: '0.78rem', marginTop: '8px' }}>
              💡 Cloud Scheduler ejecuta esto automáticamente cada día a las <strong>2:00 AM (Bogotá)</strong>
            </p>
          </div>
        )}
      </div>

      {/* Info técnica */}
      <div style={{ background: '#F8FAFC', border: '1px solid #E0E6ED', borderRadius: '10px', padding: '16px 18px' }}>
        <div style={{ fontWeight: 700, color: '#475569', marginBottom: '10px', fontSize: '0.85rem' }}>
          <BarChart2 size={13} style={{ marginRight: '6px', verticalAlign: 'middle' }}/> Tablas BigQuery — <code>auditoria-mintc.secop_mintic</code>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
          {[
            { id: 'secop_ii_contratos', desc: 'Contratos electrónicos firmados', pk: 'id_contrato', color: '#214E92' },
            { id: 'secop_ii_procesos',  desc: 'Procesos de contratación publicados', pk: 'id_del_proceso', color: '#0D7C3D' },
            { id: 'tienda_virtual',     desc: 'Órdenes de la Tienda Virtual', pk: 'identificador_de_la_orden', color: '#7B2D8B' },
          ].map(t => (
            <div key={t.id} style={{ background: '#FFF', border: `1px solid ${t.color}20`, borderRadius: '7px', padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: t.color, fontFamily: 'monospace' }}>{t.id}</div>
              <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '2px' }}>{t.desc}</div>
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '4px' }}>PK: <code>{t.pk}</code> · Particionado por <code>_fecha_carga</code></div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes slideGradient { 0%{background-position:200% 0} 100%{background-position:0 0} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}
