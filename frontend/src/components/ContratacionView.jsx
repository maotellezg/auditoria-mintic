import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, TrendingUp, TrendingDown, Users, DollarSign, FileText,
  RefreshCw, AlertCircle, ChevronDown, ChevronUp, Search,
  BarChart3, ArrowRightLeft, UserCheck, Database, CloudUpload, CheckCircle2, Clock
} from 'lucide-react';
import { auth } from '../services/firebase';

// ─── Configuración de entidades por sector ─────────────────────────────────────
const SECTORES = {
  mintic: {
    nombre: 'Sector MINTIC',
    color: '#00f2fe',
    colorBg: 'rgba(0,242,254,0.08)',
    colorBorder: 'rgba(0,242,254,0.2)',
    entidades: [
      { nombre: 'MINISTERIO TIC',           nit: '830050660', sigla: 'MinTIC' },
      { nombre: 'COMPUTADORES PARA EDUCAR', nit: '830079479', sigla: 'CPE'   },
    ]
  },
  ambiente: {
    nombre: 'Sector Ambiente',
    color: '#43e97b',
    colorBg: 'rgba(67,233,123,0.08)',
    colorBorder: 'rgba(67,233,123,0.2)',
    entidades: [
      { nombre: 'FONDO NACIONAL AMBIENTAL',                        nit: '830025267', sigla: 'FONAM'       },
      { nombre: 'MINISTERIO DE AMBIENTE Y DESARROLLO SOSTENIBLE',  nit: '830115395', sigla: 'MinAmbiente' },
      { nombre: 'AUTORIDAD NACIONAL DE LICENCIAS AMBIENTALES ANLA',nit: '900467239', sigla: 'ANLA'        },
    ]
  }
};

const PERIODOS = [
  { key: 'duque_ult', label: 'Duque Último Año', gov: 'duque', emoji: '🔵' },
  { key: 'petro_1',   label: 'Petro Año 1',      gov: 'petro', emoji: '🟡' },
  { key: 'petro_2',   label: 'Petro Año 2',      gov: 'petro', emoji: '🟡' },
  { key: 'petro_3',   label: 'Petro Año 3',      gov: 'petro', emoji: '🟡' },
  { key: 'petro_4',   label: 'Petro Año 4',      gov: 'petro', emoji: '🟡' },
];

// ─── Utilidades ────────────────────────────────────────────────────────────────
const fmtCOP = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtNum = (n) => Number(n || 0).toLocaleString('es-CO');
const pct = (a, b) => { if (!b) return null; return ((a - b) / b * 100).toFixed(1); };

// ─── Helper API autenticado ────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Procesamiento de contratos PS en tabla de contratistas ───────────────────
function buildTabla(contratos) {
  const map = {};
  contratos.forEach(c => {
    const key = c.nit_del_contratista || c.nombre_del_contratista || '';
    if (!key) return;
    const per = c.periodo || 'fuera_rango';
    if (!map[key]) map[key] = { nombre: c.nombre_del_contratista, nit: c.nit_del_contratista, periodos: {}, total: 0, totalValor: 0 };
    if (!map[key].periodos[per]) map[key].periodos[per] = { count: 0, valor: 0 };
    map[key].periodos[per].count += 1;
    map[key].periodos[per].valor += Number(c.valor_del_contrato) || 0;
    map[key].total += 1;
    map[key].totalValor += Number(c.valor_del_contrato) || 0;
  });
  return Object.values(map).sort((a, b) => b.totalValor - a.totalValor);
}

// ─── Componente principal ──────────────────────────────────────────────────────
export default function ContratacionView({ sector = 'mintic' }) {
  const cfg  = SECTORES[sector];
  const [statusBQ, setStatusBQ]     = useState(null);   // info de última ingesta
  const [syncing, setSyncing]       = useState(false);
  const [syncMsg, setSyncMsg]       = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [resumen, setResumen]       = useState([]);
  const [psData, setPsData]         = useState([]);
  const [otrosData, setOtrosData]   = useState([]);
  const [cruceData, setCruceData]   = useState([]);
  const [contData, setContData]     = useState([]);
  const [tabAnalisis, setTabAnalisis] = useState('ps');
  const [search, setSearch]         = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  // ── Verificar estado BigQuery ────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    try {
      const info = await apiFetch(`/api/secop/status/${sector}`);
      setStatusBQ(info);
    } catch (_) { setStatusBQ(null); }
  }, [sector]);

  // ── Cargar datos analíticos desde BigQuery ───────────────────────────────────
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, ps, otros, cruce, cont] = await Promise.all([
        apiFetch(`/api/secop/resumen/${sector}`),
        apiFetch(`/api/secop/ps-directos/${sector}`),
        apiFetch(`/api/secop/otros-directos/${sector}`),
        apiFetch(`/api/secop/cruce/${sector}`),
        apiFetch(`/api/secop/continuaciones/${sector}`),
      ]);
      setResumen(res);
      setPsData(ps);
      setOtrosData(otros);
      setCruceData(cruce);
      setContData(cont);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sector]);

  // ── Sincronizar SECOP II → BigQuery ─────────────────────────────────────────
  const sincronizar = async () => {
    setSyncing(true);
    setSyncMsg('Descargando datos de SECOP II y cargando a BigQuery… (puede tardar 2–5 min)');
    setError(null);
    try {
      const r = await apiFetch(`/api/secop/sync/${sector}`, { method: 'POST' });
      setSyncMsg(`✅ Sincronización completa — ${fmtNum(r.total)} contratos cargados a BigQuery.`);
      await checkStatus();
      await cargarDatos();
    } catch (e) {
      setSyncMsg('');
      setError(`Error de sincronización: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    checkStatus();
    cargarDatos();
  }, [checkStatus, cargarDatos]);

  // ── Tablas ──────────────────────────────────────────────────────────────────
  const tablaPS    = buildTabla(psData);
  const tablaOtros = buildTabla(otrosData);

  const filtered = (arr) => arr.filter(r => !search || (r.nombre || '').toLowerCase().includes(search.toLowerCase()));

  // ── Resumen por período ─────────────────────────────────────────────────────
  const resumenMap = {};
  resumen.forEach(r => { resumenMap[r.periodo] = r; });
  const maxValor = Math.max(...PERIODOS.map(p => Number(resumenMap[p.key]?.valor_ps) || 0), 1);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Header sector ── */}
      <div className="glass-panel" style={{ background: cfg.colorBg, border: `1px solid ${cfg.colorBorder}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Building2 size={22} color={cfg.color} />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: cfg.color }}>Contratación Directa — {cfg.nombre}</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0 32px', fontSize: '0.82rem' }}>
              Entidades: {cfg.entidades.map(e => `${e.sigla} (NIT ${e.nit})`).join(' · ')}
            </p>
            {/* Estado BigQuery */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0 32px', fontSize: '0.75rem' }}>
              <Database size={13} color={statusBQ?.total > 0 ? cfg.color : 'var(--text-muted)'} />
              {statusBQ?.total > 0
                ? <span style={{ color: 'var(--text-secondary)' }}>BigQuery: <strong style={{ color: cfg.color }}>{fmtNum(statusBQ.total)}</strong> contratos · Ingesta: {statusBQ.ultima_ingesta ? new Date(statusBQ.ultima_ingesta.value || statusBQ.ultima_ingesta).toLocaleString('es-CO') : '—'}</span>
                : <span style={{ color: 'var(--text-muted)' }}>Sin datos en BigQuery — usa "Sincronizar SECOP" para cargar</span>
              }
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={cargarDatos} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Actualizar
            </button>
            <button className="btn btn-primary" onClick={sincronizar} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', background: cfg.color, color: '#000' }}>
              <CloudUpload size={14} /> {syncing ? 'Sincronizando…' : 'Sincronizar SECOP'}
            </button>
          </div>
        </div>
        {syncMsg && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: syncing ? 'var(--text-secondary)' : cfg.color }}>
            {syncing ? <Clock size={13} /> : <CheckCircle2 size={13} />} {syncMsg}
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(255,94,98,0.08)', border: '1px solid rgba(255,94,98,0.3)', borderRadius: 10, padding: 16 }}>
          <AlertCircle size={18} color="var(--color-error)" />
          <div>
            <strong style={{ color: 'var(--color-error)' }}>Error</strong>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 8px 0', fontSize: '0.83rem' }}>{error}</p>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.78rem' }}>
              💡 Si los datos aún no están en BigQuery, haz clic en <strong>"Sincronizar SECOP"</strong> primero.
            </p>
          </div>
        </div>
      )}

      {/* ── Tarjetas resumen PS por período ── */}
      {resumen.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
            📊 Prestación de Servicios Directos — Resumen por Gobierno
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {PERIODOS.map((p, i) => {
              const s  = resumenMap[p.key] || {};
              const prev = i > 0 ? Number(resumenMap[PERIODOS[i-1].key]?.valor_ps) : null;
              const cambio = pct(Number(s.valor_ps), prev);
              const subiendo = cambio && Number(cambio) > 0;
              return (
                <div key={p.key} className="glass-panel" style={{ borderLeft: `3px solid ${p.gov === 'duque' ? '#60a5fa' : cfg.color}`, padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>{p.emoji} {p.label}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: p.gov === 'duque' ? '#60a5fa' : cfg.color }}>{fmtCOP(s.valor_ps)}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {fmtNum(s.contratos_ps)} contratos · {fmtNum(s.contratistas_unicos)} contratistas
                  </div>
                  {cambio && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.75rem', color: subiendo ? '#f87171' : '#43e97b' }}>
                      {subiendo ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {subiendo ? '+' : ''}{cambio}% vs período anterior
                    </div>
                  )}
                  <div style={{ marginTop: 8, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(100, (Number(s.valor_ps) / maxValor) * 100)}%`, height: '100%', background: p.gov === 'duque' ? '#60a5fa' : cfg.color, borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loader ── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Consultando BigQuery…
        </div>
      )}

      {/* ── Tabs analíticos ── */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)', overflowX: 'auto' }}>
          {[
            { key: 'ps',    icon: <FileText size={14} />,        label: `PS Directos (${tablaPS.length})` },
            { key: 'otros', icon: <BarChart3 size={14} />,       label: `Otros Directos (${tablaOtros.length})` },
            { key: 'cruce', icon: <ArrowRightLeft size={14} />,  label: `Cruce Entidades (${cruceData.length})` },
            { key: '2026',  icon: <UserCheck size={14} />,       label: `Duque→2026 (${contData.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => { setTabAnalisis(t.key); setExpandedRow(null); }} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '11px 16px', border: 'none',
              background: tabAnalisis === t.key ? cfg.colorBg : 'transparent',
              color: tabAnalisis === t.key ? cfg.color : 'var(--text-secondary)',
              borderBottom: tabAnalisis === t.key ? `2px solid ${cfg.color}` : '2px solid transparent',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: tabAnalisis === t.key ? 700 : 400,
              whiteSpace: 'nowrap', transition: 'all 0.2s'
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Buscador */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-input" style={{ paddingLeft: 30, fontSize: '0.82rem', height: 34 }} placeholder="Buscar contratista..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* ── TAB: PS DIRECTOS ── */}
        {tabAnalisis === 'ps' && (
          <div style={{ padding: 14 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>Contratos de Prestación de Servicios directos por contratista y período de gobierno.</p>
            <TablaContratistas rows={filtered(tablaPS)} cfg={cfg} expandedRow={expandedRow} setExpandedRow={setExpandedRow} />
          </div>
        )}

        {/* ── TAB: OTROS DIRECTOS ── */}
        {tabAnalisis === 'otros' && (
          <div style={{ padding: 14 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>Contratos directos que NO son Prestación de Servicios — suministros, obra, consultoría, compras, etc.</p>
            <TablaContratistas rows={filtered(tablaOtros)} cfg={cfg} expandedRow={expandedRow} setExpandedRow={setExpandedRow} />
          </div>
        )}

        {/* ── TAB: CRUCE ENTIDADES ── */}
        {tabAnalisis === 'cruce' && (
          <div style={{ padding: 14 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>Contratistas que aparecen en más de una entidad del sector.</p>
            {filtered(cruceData).length === 0
              ? <EmptyState />
              : filtered(cruceData).slice(0, 200).map((r, i) => (
                <div key={i} className="glass-panel" style={{ padding: '12px 14px', marginBottom: 8, borderLeft: `3px solid ${cfg.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>{r.nombre_del_contratista || '—'}</div>
                      {r.nit_del_contratista && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NIT: {r.nit_del_contratista}</div>}
                      <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {(r.entidades || []).map((e, j) => (
                          <span key={j} style={{ fontSize: '0.68rem', background: cfg.colorBg, border: `1px solid ${cfg.colorBorder}`, color: cfg.color, borderRadius: 4, padding: '2px 6px' }}>{e}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: cfg.color, fontSize: '1rem' }}>{fmtCOP(r.total_valor)}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{fmtNum(r.total_contratos)} contratos · {r.num_entidades} entidades</div>
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── TAB: DUQUE → 2026 ── */}
        {tabAnalisis === '2026' && (
          <div style={{ padding: 14 }}>
            <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              🔵 Contratistas del gobierno <strong style={{ color: '#60a5fa' }}>Duque (2018–2022)</strong> con contratos activos en <strong style={{ color: cfg.color }}>2026</strong>. Total identificados: <strong style={{ color: cfg.color }}>{fmtNum(contData.length)}</strong>
            </div>
            {filtered(contData).length === 0
              ? <EmptyState msg="No se encontraron contratistas de Duque con contratos en 2026." />
              : filtered(contData).slice(0, 300).map((r, i) => (
                <div key={i} className="glass-panel" style={{ padding: '12px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>{r.nombre_del_contratista || '—'}</div>
                    {r.nit_del_contratista && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NIT: {r.nit_del_contratista}</div>}
                    <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {(r.entidades || []).map((e, j) => (
                        <span key={j} style={{ fontSize: '0.68rem', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa', borderRadius: 4, padding: '2px 6px' }}>{e}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: cfg.color, fontSize: '1rem' }}>{fmtCOP(r.valor_2026)}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{fmtNum(r.contratos_2026)} contratos en 2026</div>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Datos almacenados en BigQuery · {cfg.nombre} · Fuente: SECOP II datos.gov.co
      </div>
    </div>
  );
}

// ── Subcomponente: tabla de contratistas por período ───────────────────────────
function TablaContratistas({ rows, cfg, expandedRow, setExpandedRow }) {
  if (!rows.length) return <EmptyState />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', minWidth: 200 }}>Contratista</th>
            {PERIODOS.map(p => (
              <th key={p.key} style={{ padding: '7px 8px', textAlign: 'center', color: p.gov === 'duque' ? '#60a5fa' : cfg.color, borderBottom: '1px solid var(--border-color)', minWidth: 95, fontSize: '0.7rem' }}>
                {p.emoji} {p.label}
              </th>
            ))}
            <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map((r, idx) => (
            <React.Fragment key={idx}>
              <tr
                style={{ cursor: 'pointer', background: expandedRow === idx ? cfg.colorBg : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
              >
                <td style={{ padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {expandedRow === idx ? <ChevronUp size={11} color="var(--text-muted)" /> : <ChevronDown size={11} color="var(--text-muted)" />}
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{r.nombre || '—'}</div>
                      {r.nit && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>NIT: {r.nit}</div>}
                    </div>
                  </div>
                </td>
                {PERIODOS.map(p => {
                  const pp = r.periodos[p.key];
                  return (
                    <td key={p.key} style={{ padding: '7px 8px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {pp ? (
                        <>
                          <div style={{ color: p.gov === 'duque' ? '#60a5fa' : cfg.color, fontWeight: 600 }}>{fmtCOP(pp.valor)}</div>
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{pp.count} cto{pp.count !== 1 ? 's' : ''}</div>
                        </>
                      ) : <span style={{ color: 'rgba(255,255,255,0.1)' }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ padding: '7px 12px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)', fontWeight: 700, color: cfg.color }}>
                  {fmtCOP(r.totalValor)}<br />
                  <span style={{ fontSize: '0.66rem', fontWeight: 400, color: 'var(--text-muted)' }}>{fmtNum(r.total)} ctos</span>
                </td>
              </tr>
              {expandedRow === idx && (
                <tr>
                  <td colSpan={PERIODOS.length + 2} style={{ padding: '6px 28px 10px', background: cfg.colorBg, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                    💰 <strong>Valor total acumulado:</strong> ${Number(r.totalValor).toLocaleString('es-CO')} &nbsp;·&nbsp;
                    📋 <strong>Total contratos:</strong> {r.total}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ msg = 'Sin datos para los filtros aplicados.' }) {
  return <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40, fontSize: '0.85rem' }}>{msg}</div>;
}
