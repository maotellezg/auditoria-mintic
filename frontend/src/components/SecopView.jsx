import React, { useState, useEffect, useCallback } from 'react';
import { Search, ExternalLink, RefreshCw, Download, TrendingUp, AlertTriangle, CheckCircle2, Clock, ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Entidades MinTic con metadatos visuales ─────────────────────────────────
const ENTIDADES = [
  { id: 'mintic', nombre: 'MinTIC',  color: '#FF6900', bg: '#FFF4EC', icono: '🏛️', desc: 'Ministerio de Tecnologías de la Información y las Comunicaciones' },
  { id: 'ane',    nombre: 'ANE',     color: '#214E92', bg: '#EBF1FB', icono: '📡', desc: 'Agencia Nacional del Espectro' },
  { id: 'crc',    nombre: 'CRC',     color: '#0D7C3D', bg: '#E8F7EE', icono: '⚖️', desc: 'Comisión de Regulación de Comunicaciones' },
  { id: 'and',    nombre: 'AND',     color: '#7B2D8B', bg: '#F5EBF8', icono: '💻', desc: 'Agencia Nacional Digital' },
  { id: 'futic',  nombre: 'FUTIC',   color: '#C0392B', bg: '#FDECEA', icono: '💰', desc: 'Fondo Único TIC' },
  { id: 'rtvc',   nombre: 'RTVC',    color: '#E67E22', bg: '#FEF5EC', icono: '📺', desc: 'Sistema de Medios Públicos' },
  { id: '472',    nombre: '4-72',    color: '#16A085', bg: '#E8F8F5', icono: '📮', desc: 'Servicios Postales Nacionales' },
];

const COP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const FMT = (d) => d ? d.slice(0, 10) : '—';
const entidad_nit = () => ENTIDADES.find(e => e.id === window.__secopEntidadActiva)?.nit || '';

const TIPOS_CONTRATO = ['Prestación de servicios', 'Suministros', 'Compraventa', 'Obra', 'Consultoría', 'Interadministrativo', 'Otro'];
const ESTADOS = ['En ejecución', 'Cerrado', 'Aprobado', 'Liquidado', 'Terminado'];

export default function SecopView() {
  const { currentUser } = useAuth();

  // ── Estado principal ──────────────────────────────────────────────────────
  const [entidadActiva, setEntidadActiva] = useState(null);
  const [modo, setModo] = useState('contratante'); // 'contratante' | 'proveedor'
  const [contratos, setContratos] = useState([]);
  const [estadisticas, setEstadisticas] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [filterValorMin, setFilterValorMin] = useState('');
  const [filterValorMax, setFilterValorMax] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // ── Detalle contrato expandido ────────────────────────────────────────────
  const [contratoDetalle, setContratoDetalle] = useState(null);

  // ── Fetch contratos ───────────────────────────────────────────────────────
  const fetchContratos = useCallback(async (entidad, pg = 1) => {
    if (!entidad || !currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      const params = new URLSearchParams({
        page: String(pg), pageSize: String(pageSize), fuente: 'secop_ii'
      });
      if (filterTipo)     params.append('tipoContrato', filterTipo);
      if (filterEstado)   params.append('estado', filterEstado);
      if (filterValorMin) params.append('valorMin', filterValorMin);
      if (filterValorMax) params.append('valorMax', filterValorMax);
      if (search)         params.append('search', search);

      // Endpoint distinto según modo
      const endpoint = modo === 'proveedor'
        ? `/api/secop/como-proveedor/${entidad.id}?${params}`
        : `/api/secop/contratos/${entidad.id}?${params}`;

      const resp = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`Error ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      setContratos(data.contratos || []);
      setTotal(data.total || 0);
      if (data.estadisticas) setEstadisticas(data.estadisticas);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser, modo, filterTipo, filterEstado, filterValorMin, filterValorMax, search, pageSize]);

  useEffect(() => {
    if (entidadActiva) {
      setPage(1);
      setContratos([]);
      setEstadisticas(null);
      fetchContratos(entidadActiva, 1);
    }
  }, [entidadActiva, modo, filterTipo, filterEstado, search]);

  // Búsqueda local con debounce
  useEffect(() => {
    const t = setTimeout(() => setSearch(localSearch), 600);
    return () => clearTimeout(t);
  }, [localSearch]);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchContratos(entidadActiva, newPage);
  };

  const totalPages = Math.ceil(total / pageSize);

  // ── Exportar CSV ──────────────────────────────────────────────────────────
  const entidad_nit = () => entidadActiva?.nit || '';

  // Expose to window for inline references
  useEffect(() => { if (entidadActiva) window.__secopEntidadActiva = entidadActiva.id; }, [entidadActiva]);

  const exportarCSV = () => {
    if (!contratos.length) return;
    const cols = ['id', 'referencia', 'entidad', 'objeto', 'tipo', 'modalidad', 'estado',
                  'fechaFirma', 'fechaInicio', 'fechaFin', 'valor', 'valorPagado',
                  'contratista', 'docContratista', 'supervisor', 'ordenador',
                  'departamento', 'ciudad', 'duracion', 'esPyme', 'diasAdicionados', '_fuente'];
    const header = cols.join(',');
    const rows = contratos.map(c =>
      cols.map(k => {
        const v = c[k] ?? '';
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
      }).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SECOP_${entidadActiva?.nombre}_p${page}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const estadoBadge = (estado) => {
    if (!estado) return null;
    const low = estado.toLowerCase();
    let bg = '#E8F7EE', color = '#0D7C3D';
    if (low.includes('ejecuci')) { bg = '#EBF1FB'; color = '#214E92'; }
    else if (low.includes('cerrad') || low.includes('liquidado') || low.includes('terminado')) { bg = '#F0F0F0'; color = '#666'; }
    else if (low.includes('suspendido') || low.includes('cancelado')) { bg = '#FDECEA'; color = '#C0392B'; }
    return (
      <span style={{ background: bg, color, fontSize: '0.72rem', fontWeight: 700,
        padding: '3px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
        {estado}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '100%' }}>

      {/* ── Título ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
            📋 Contratación Pública MinTic — SECOP
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '4px 0 0' }}>
            Contratos desde el <strong>7 de agosto de 2020</strong> · Fuente: datos.gov.co · SECOP II en tiempo real
          </p>
        </div>
      </div>

      {/* ── Botones de entidad ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {ENTIDADES.map(ent => {
          const activo = entidadActiva?.id === ent.id;
          return (
            <button
              key={ent.id}
              onClick={() => { setEntidadActiva(ent); setContratoDetalle(null); setContratos([]); setEstadisticas(null); setModo('contratante'); }}
              title={ent.desc}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px',
                borderRadius: '50px',
                border: `2px solid ${activo ? ent.color : '#E0E6ED'}`,
                background: activo ? ent.color : '#FFFFFF',
                color: activo ? '#FFFFFF' : ent.color,
                fontWeight: 700, fontSize: '0.9rem',
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: activo ? `0 4px 16px ${ent.color}40` : 'none',
                transform: activo ? 'translateY(-2px)' : 'none'
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{ent.icono}</span>
              {ent.nombre}
            </button>
          );
        })}
      </div>

      {/* ── Panel principal ──────────────────────────────────────────────────── */}
      {!entidadActiva ? (
        <div style={{
          background: '#F8FAFC', border: '2px dashed #E0E6ED',
          borderRadius: '16px', padding: '60px 32px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🏛️</div>
          <h3 style={{ color: 'var(--text-main)', fontWeight: 700, marginBottom: '8px' }}>
            Selecciona una entidad para ver sus contratos
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Consulta en tiempo real los contratos registrados en SECOP II desde el 7 de agosto de 2020.
          </p>
        </div>
      ) : (
        <>
      {/* ── Toggle Contratante / Proveedor ──────────────────────────────── */}
          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: '50px', padding: '4px', gap: '4px', width: 'fit-content' }}>
            {[{ id: 'contratante', label: '🏛️ Como Contratante', desc: 'Contratos que publica esta entidad' },
              { id: 'proveedor',   label: '🤝 Como Proveedor',   desc: 'Contratos que recibe esta entidad de otros' }]
              .map(m => (
                <button key={m.id} onClick={() => setModo(m.id)} title={m.desc}
                  style={{
                    padding: '8px 22px', borderRadius: '50px', border: 'none',
                    background: modo === m.id ? entidadActiva.color : 'transparent',
                    color: modo === m.id ? '#FFFFFF' : '#64748B',
                    fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', transition: 'all 0.2s'
                  }}>
                  {m.label}
                </button>
              ))}
          </div>

          {/* ── Alerta modo proveedor ─────────────────────────────────────── */}
          {modo === 'proveedor' && (
            <div style={{ background: '#FFF4EC', border: '1px solid #FFD0A8', borderRadius: '10px', padding: '10px 16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '1.1rem' }}>🔍</span>
              <span style={{ color: '#C05A00', fontSize: '0.85rem', fontWeight: 500 }}>
                Modo auditoría: mostrando contratos donde <strong>{entidadActiva.nombre}</strong> aparece en el campo
                <code style={{ background: '#FFE8CC', padding: '1px 6px', borderRadius: '4px', margin: '0 4px', fontSize: '0.8rem' }}>documento_proveedor</code>
                con NIT <strong>{entidad_nit()}</strong> — contratos que esta entidad <strong>recibió</strong> de otras entidades del Estado.
              </span>
            </div>
          )}

          {/* ── KPIs ─────────────────────────────────────────────────────── */}
          {estadisticas && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                {modo === 'contratante' ? [
                  { label: 'Total contratos', value: estadisticas.totalContratos?.toLocaleString('es-CO') || '—', icon: '📋', color: entidadActiva.color },
                  { label: 'Valor muestra', value: COP(estadisticas.valorTotal), icon: '💰', color: '#0D7C3D' },
                  { label: 'Valor promedio', value: COP(estadisticas.valorPromedio), icon: '📊', color: '#214E92' },
                  { label: 'En ejecución', value: estadisticas.contratosEnEjecucion, icon: '⚡', color: '#E67E22' },
                  { label: 'Con adición', value: estadisticas.contratosConAdicion, icon: '⚠️', color: '#C0392B' },
                ] : [
                  { label: 'Contratos recibidos', value: estadisticas.totalContratos?.toLocaleString('es-CO') || '—', icon: '🤝', color: entidadActiva.color },
                  { label: 'Total recibido', value: COP(estadisticas.valorTotalRecibido), icon: '💵', color: '#0D7C3D' },
                  { label: 'Valor promedio', value: COP(estadisticas.valorPromedio), icon: '📊', color: '#214E92' },
                  { label: 'Contrato máximo', value: COP(estadisticas.valorMaximo), icon: '🔝', color: '#C0392B' },
                ].map((kpi, i) => (
                  <div key={i} style={{ background: '#FFFFFF', borderRadius: '12px', padding: '16px', border: '1px solid #E8EDF3', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>{kpi.icon}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>{kpi.label}</div>
                  </div>
                ))}
              </div>

              {/* Top entidades que contrataron a esta entidad (modo proveedor) */}
              {modo === 'proveedor' && estadisticas.topContratantes?.length > 0 && (
                <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '16px', border: '1px solid #E8EDF3' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B', marginBottom: '12px' }}>
                    🏆 Top entidades que contrataron a <strong>{entidadActiva.nombre}</strong>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {estadisticas.topContratantes.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F8FAFC', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 800, color: entidadActiva.color, fontSize: '0.85rem' }}>#{i + 1}</span>
                          <span style={{ fontSize: '0.85rem', color: '#1E293B' }}>{c.nombre}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', color: '#64748B' }}>{c.count} contratos</span>
                          <span style={{ fontWeight: 700, color: '#0D7C3D', fontSize: '0.85rem' }}>{COP(c.valor)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Búsqueda y filtros ───────────────────────────────────────────── */}
          <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '16px', border: '1px solid #E8EDF3', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                <Search size={16} color="#94A3B8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  placeholder="Buscar contratista, objeto, número de contrato..."
                  value={localSearch}
                  onChange={e => setLocalSearch(e.target.value)}
                  style={{
                    width: '100%', paddingLeft: '36px', paddingRight: '12px',
                    padding: '10px 12px 10px 36px',
                    border: '1.5px solid #E0E6ED', borderRadius: '8px',
                    fontSize: '0.88rem', outline: 'none', background: '#F8FAFC',
                    color: '#2F3D42', fontFamily: 'Roboto, sans-serif', boxSizing: 'border-box'
                  }}
                />
              </div>
              <button
                onClick={() => setShowFilters(f => !f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 16px', borderRadius: '8px',
                  border: '1.5px solid #E0E6ED', background: showFilters ? '#EBF1FB' : '#FFFFFF',
                  color: '#214E92', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
                }}
              >
                <Filter size={14} /> Filtros
              </button>
              <button onClick={exportarCSV} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 16px', borderRadius: '8px',
                border: '1.5px solid #E0E6ED', background: '#FFFFFF',
                color: '#0D7C3D', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
              }}>
                <Download size={14} /> Exportar CSV
              </button>
              <button onClick={() => fetchContratos(entidadActiva, page)} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 16px', borderRadius: '8px',
                border: '1.5px solid #E0E6ED', background: '#FFFFFF',
                color: '#666', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
              }}>
                <RefreshCw size={14} /> Actualizar
              </button>
            </div>

            {showFilters && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', paddingTop: '8px', borderTop: '1px solid #E8EDF3' }}>
                {[
                  { label: 'Tipo de contrato', value: filterTipo, setter: setFilterTipo, opts: TIPOS_CONTRATO },
                  { label: 'Estado', value: filterEstado, setter: setFilterEstado, opts: ESTADOS }
                ].map(f => (
                  <div key={f.label}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>{f.label}</label>
                    <select value={f.value} onChange={e => f.setter(e.target.value)} style={{
                      width: '100%', padding: '8px 10px', borderRadius: '8px',
                      border: '1.5px solid #E0E6ED', background: '#FFFFFF', color: '#2F3D42',
                      fontSize: '0.85rem', fontFamily: 'Roboto, sans-serif'
                    }}>
                      <option value="">— Todos —</option>
                      {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Valor mínimo (COP)</label>
                  <input type="number" placeholder="ej: 50000000" value={filterValorMin} onChange={e => setFilterValorMin(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #E0E6ED', background: '#FFFFFF', color: '#2F3D42', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Valor máximo (COP)</label>
                  <input type="number" placeholder="ej: 1000000000" value={filterValorMax} onChange={e => setFilterValorMax(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #E0E6ED', background: '#FFFFFF', color: '#2F3D42', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={() => { setFilterTipo(''); setFilterEstado(''); setFilterValorMin(''); setFilterValorMax(''); setLocalSearch(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #E0E6ED', background: '#FFF', color: '#C0392B', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600 }}>
                    <X size={13} /> Limpiar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Error ─────────────────────────────────────────────────────────── */}
          {error && (
            <div style={{ background: '#FDECEA', border: '1px solid #F5C6C0', borderRadius: '10px', padding: '14px 18px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <AlertTriangle size={18} color="#C0392B" />
              <span style={{ color: '#C0392B', fontSize: '0.9rem' }}>{error}</span>
            </div>
          )}

          {/* ── Tabla de contratos ───────────────────────────────────────────── */}
          <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E8EDF3', overflow: 'hidden' }}>
            {/* Header de tabla */}
            <div style={{
              background: entidadActiva.bg, borderBottom: `3px solid ${entidadActiva.color}`,
              padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.3rem' }}>{entidadActiva.icono}</span>
                <div>
                  <span style={{ fontWeight: 800, color: entidadActiva.color, fontSize: '1rem' }}>{entidadActiva.nombre}</span>
                  <span style={{ color: '#64748B', fontSize: '0.8rem', marginLeft: '8px' }}>{entidadActiva.desc}</span>
                </div>
              </div>
              <div style={{ color: '#64748B', fontSize: '0.8rem', fontWeight: 600 }}>
                {loading ? '⏳ Cargando...' : `${contratos.length} de ${total?.toLocaleString('es-CO') || '?'} contratos`}
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
                <p style={{ color: '#64748B', fontSize: '0.95rem' }}>Consultando SECOP en tiempo real...</p>
              </div>
            ) : contratos.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📭</div>
                <p style={{ color: '#64748B' }}>No se encontraron contratos con los filtros aplicados.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E8EDF3' }}>
                      {(modo === 'proveedor'
                        ? ['No. Contrato', 'Entidad que contrató 🏢', 'Objeto', 'Tipo', 'Estado', 'Fecha Firma', 'Valor COP', 'Supervisor', 'SECOP']
                        : ['No. Contrato', 'Objeto', 'Contratista', 'Tipo', 'Estado', 'Fecha Firma', 'Valor COP', 'Supervisor', 'SECOP']
                      ).map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contratos.map((c, idx) => (
                      <tr
                        key={c.id + idx}
                        onClick={() => setContratoDetalle(contratoDetalle?.id === c.id ? null : c)}
                        style={{
                          borderBottom: '1px solid #F1F5F9',
                          background: contratoDetalle?.id === c.id ? entidadActiva.bg : (idx % 2 === 0 ? '#FFFFFF' : '#FAFBFC'),
                          cursor: 'pointer', transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => { if (contratoDetalle?.id !== c.id) e.currentTarget.style.background = '#F0F7FF'; }}
                        onMouseLeave={e => { if (contratoDetalle?.id !== c.id) e.currentTarget.style.background = idx % 2 === 0 ? '#FFFFFF' : '#FAFBFC'; }}
                      >
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: entidadActiva.color, whiteSpace: 'nowrap', minWidth: '140px' }}>
                          {c.referencia || c.id || '—'}
                          {c.diasAdicionados > 0 && <span title={`Adicionado ${c.diasAdicionados} días`} style={{ marginLeft: '5px', fontSize: '0.7rem', color: '#E67E22' }}>⚠️</span>}
                        </td>
                        {modo === 'proveedor' ? (
                          <td style={{ padding: '10px 14px', maxWidth: '220px' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#214E92', fontWeight: 600 }} title={c._contratante}>{c._contratante || '—'}</div>
                            {c._nitContratante && <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>NIT {c._nitContratante}</div>}
                          </td>
                        ) : (
                          <td style={{ padding: '10px 14px', maxWidth: '280px' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2F3D42' }} title={c.objeto}>{c.objeto || '—'}</div>
                          </td>
                        )}
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#2F3D42' }}>
                          <div>{c.contratista || '—'}</div>
                          {c.docContratista && <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{c.tipoDocContratista} {c.docContratista}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#475569' }}>{c.tipo || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>{estadoBadge(c.estado)}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#475569' }}>{FMT(c.fechaFirma)}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: c.valor > 1000000000 ? '#C0392B' : '#0D7C3D' }}>
                          {COP(c.valor)}
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#475569', fontSize: '0.79rem' }}>
                          {c.supervisor || '—'}
                          {c.docSupervisor && <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{c.docSupervisor}</div>}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {c.urlSecop ? (
                            <a href={c.urlSecop} target="_blank" rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ color: '#214E92', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600, fontSize: '0.78rem' }}>
                              Ver <ExternalLink size={11} />
                            </a>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginación */}
            {!loading && total > pageSize && (
              <div style={{ padding: '14px 20px', borderTop: '1px solid #E8EDF3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748B' }}>
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong> · {total?.toLocaleString('es-CO')} contratos totales
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button disabled={page === 1} onClick={() => handlePageChange(page - 1)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', borderRadius: '8px', border: '1px solid #E0E6ED', background: page === 1 ? '#F8FAFC' : '#FFF', color: page === 1 ? '#CBD5E1' : '#214E92', cursor: page === 1 ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.83rem' }}>
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <button disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', borderRadius: '8px', border: '1px solid #E0E6ED', background: page >= totalPages ? '#F8FAFC' : '#FFF', color: page >= totalPages ? '#CBD5E1' : '#214E92', cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.83rem' }}>
                    Siguiente <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Panel detalle contrato ───────────────────────────────────────── */}
          {contratoDetalle && (
            <div style={{ background: '#FFFFFF', borderRadius: '14px', border: `2px solid ${entidadActiva.color}40`, padding: '24px', boxShadow: `0 4px 24px ${entidadActiva.color}15` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: entidadActiva.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Detalle del Contrato</div>
                  <h3 style={{ margin: '4px 0', fontSize: '1.1rem', fontWeight: 800, color: '#1E293B' }}>{contratoDetalle.referencia || contratoDetalle.id}</h3>
                </div>
                <button onClick={() => setContratoDetalle(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px' }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {[
                  { label: '📄 Objeto del contrato', value: contratoDetalle.objeto, full: true },
                  { label: '🏢 Contratista', value: `${contratoDetalle.contratista} · ${contratoDetalle.tipoDocContratista} ${contratoDetalle.docContratista}` },
                  { label: '👤 Representante Legal', value: `${contratoDetalle.representante}${contratoDetalle.docRepresentante ? ` · CC: ${contratoDetalle.docRepresentante}` : ''}` },
                  { label: '🔍 Supervisor', value: `${contratoDetalle.supervisor}${contratoDetalle.docSupervisor ? ` · CC: ${contratoDetalle.docSupervisor}` : ''}` },
                  { label: '✍️ Ordenador del gasto', value: `${contratoDetalle.ordenador}${contratoDetalle.docOrdenador ? ` · CC: ${contratoDetalle.docOrdenador}` : ''}` },
                  { label: '📋 Tipo / Modalidad', value: `${contratoDetalle.tipo} / ${contratoDetalle.modalidad}` },
                  { label: '📅 Firma / Inicio / Fin', value: `${FMT(contratoDetalle.fechaFirma)} → ${FMT(contratoDetalle.fechaInicio)} → ${FMT(contratoDetalle.fechaFin)}` },
                  { label: '⏱ Duración', value: contratoDetalle.duracion },
                  { label: '💰 Valor total', value: COP(contratoDetalle.valor) },
                  { label: '✅ Valor pagado', value: COP(contratoDetalle.valorPagado) },
                  { label: '⏳ Valor pendiente', value: COP(contratoDetalle.valorPendiente) },
                  { label: '📍 Departamento / Ciudad', value: `${contratoDetalle.departamento} / ${contratoDetalle.ciudad}` },
                  { label: '🏭 Es PYME', value: contratoDetalle.esPyme },
                  { label: '⚠️ Días adicionados', value: contratoDetalle.diasAdicionados > 0 ? `${contratoDetalle.diasAdicionados} días` : 'Ninguno' },
                ].filter(r => r.value && r.value !== ' · ' && r.value !== 'undefined').map((row, i) => (
                  <div key={i} style={{ gridColumn: row.full ? '1 / -1' : undefined }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: '3px' }}>{row.label}</div>
                    <div style={{ fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5 }}>{row.value}</div>
                  </div>
                ))}
              </div>

              {contratoDetalle.urlSecop && (
                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #E8EDF3' }}>
                  <a href={contratoDetalle.urlSecop} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', background: entidadActiva.color, color: '#FFFFFF', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none' }}>
                    <ExternalLink size={15} /> Ver proceso completo en SECOP II
                  </a>
                </div>
              )}

              {contratoDetalle.diasAdicionados > 0 && (
                <div style={{ marginTop: '12px', background: '#FEF5EC', border: '1px solid #F5D0A9', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <AlertTriangle size={16} color="#E67E22" />
                  <span style={{ color: '#E67E22', fontSize: '0.85rem', fontWeight: 600 }}>
                    ⚠️ Alerta auditoría: Este contrato fue adicionado en <strong>{contratoDetalle.diasAdicionados} días</strong>. Revisar justificación de adición.
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
