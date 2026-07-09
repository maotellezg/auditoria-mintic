import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, TrendingUp, TrendingDown, Users, DollarSign, FileText,
  RefreshCw, AlertCircle, ChevronDown, ChevronUp, Search, Filter,
  BarChart3, ArrowRightLeft, UserCheck, Calendar, ExternalLink
} from 'lucide-react';

// ─── Configuración de entidades por sector ────────────────────────────────────
const SECTORES = {
  mintic: {
    nombre: 'Sector MINTIC',
    color: '#00f2fe',
    colorBg: 'rgba(0,242,254,0.08)',
    colorBorder: 'rgba(0,242,254,0.2)',
    entidades: [
      { nombre: 'MINISTERIO TIC', nit: '830050660', sigla: 'MinTIC' },
      { nombre: 'COMPUTADORES PARA EDUCAR', nit: '830079479', sigla: 'CPE' },
    ]
  },
  ambiente: {
    nombre: 'Sector Ambiente',
    color: '#43e97b',
    colorBg: 'rgba(67,233,123,0.08)',
    colorBorder: 'rgba(67,233,123,0.2)',
    entidades: [
      { nombre: 'FONDO NACIONAL AMBIENTAL', nit: '830025267', sigla: 'FONAM' },
      { nombre: 'MINISTERIO DE AMBIENTE Y DESARROLLO SOSTENIBLE', nit: '830115395', sigla: 'MinAmbiente' },
      { nombre: 'AUTORIDAD NACIONAL DE LICENCIAS AMBIENTALES', nit: '900467239', sigla: 'ANLA' },
    ]
  }
};

// ─── Períodos de gobierno ─────────────────────────────────────────────────────
const PERIODOS = [
  { key: 'duque_ult', label: 'Duque Último Año', desde: '2021-08-07', hasta: '2022-08-06', gov: 'duque', emoji: '🔵' },
  { key: 'petro_1',   label: 'Petro Año 1',      desde: '2022-08-07', hasta: '2023-08-06', gov: 'petro', emoji: '🟡' },
  { key: 'petro_2',   label: 'Petro Año 2',      desde: '2023-08-07', hasta: '2024-08-06', gov: 'petro', emoji: '🟡' },
  { key: 'petro_3',   label: 'Petro Año 3',      desde: '2024-08-07', hasta: '2025-08-06', gov: 'petro', emoji: '🟡' },
  { key: 'petro_4',   label: 'Petro Año 4',      desde: '2025-08-07', hasta: '2026-07-09', gov: 'petro', emoji: '🟡' },
];

const DUQUE_RANGO = { desde: '2018-08-07', hasta: '2022-08-06' };
const ANIO_2026   = { desde: '2026-01-01', hasta: '2026-12-31' };

const SECOP_BASE = 'https://www.datos.gov.co/resource/jbjy-vk9h.json';
const LIMIT = 5000;

// ─── Utilidades ───────────────────────────────────────────────────────────────
const fmtCOP = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtNum = (n) => Number(n || 0).toLocaleString('es-CO');

const pct = (a, b) => {
  if (!b) return null;
  return ((a - b) / b * 100).toFixed(1);
};

const esPS = (tipo = '', objeto = '') => {
  const t = (tipo + objeto).toLowerCase();
  return t.includes('prestaci') && t.includes('servicio');
};

async function fetchSECOP(nits, desde, hasta, offset = 0) {
  const nitsStr = nits.map(n => `'${n}'`).join(',');
  const q = `$where=nit_entidad in(${nitsStr}) AND fecha_de_firma >= '${desde}T00:00:00' AND fecha_de_firma <= '${hasta}T23:59:59' AND modalidad_de_contratacion='Contratación directa'&$limit=${LIMIT}&$offset=${offset}&$select=nit_entidad,nombre_entidad,fecha_de_firma,valor_del_contrato,nombre_del_contratista,nit_del_contratista,objeto_del_contrato,tipo_de_contrato`;
  const url = `${SECOP_BASE}?${q}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(nits, desde, hasta) {
  let all = [];
  let offset = 0;
  while (true) {
    const batch = await fetchSECOP(nits, desde, hasta, offset);
    all = all.concat(batch);
    if (batch.length < LIMIT) break;
    offset += LIMIT;
  }
  return all;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ContratacionView({ sector = 'mintic' }) {
  const cfg = SECTORES[sector];
  const nits = cfg.entidades.map(e => e.nit);

  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const [data, setData]     = useState(null); // { periodos, duque, p2026, cross }
  const [tabAnalisis, setTabAnalisis] = useState('ps'); // 'ps' | 'otros' | 'cruce' | '2026'
  const [searchContratista, setSearchContratista] = useState('');
  const [entidadFiltro, setEntidadFiltro] = useState('Todas');
  const [expandedRow, setExpandedRow] = useState(null);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Datos por período
      const porPeriodo = {};
      for (const p of PERIODOS) {
        porPeriodo[p.key] = await fetchAll(nits, p.desde, p.hasta);
      }

      // 2. Todos los contratos Duque
      const duqueAll = await fetchAll(nits, DUQUE_RANGO.desde, DUQUE_RANGO.hasta);

      // 3. Contratos 2026
      const p2026 = await fetchAll(nits, ANIO_2026.desde, ANIO_2026.hasta);

      // 4. Análisis cruzado: contratistas en múltiples entidades (en todos los datos)
      const todosContratos = Object.values(porPeriodo).flat().concat(duqueAll, p2026);
      const crossMap = {};
      todosContratos.forEach(c => {
        const key = (c.nit_del_contratista || c.nombre_del_contratista || '').trim();
        if (!key) return;
        if (!crossMap[key]) crossMap[key] = { nombre: c.nombre_del_contratista, nit: c.nit_del_contratista, entidades: new Set(), contratos: 0, valor: 0 };
        crossMap[key].entidades.add(c.nombre_entidad || c.nit_entidad);
        crossMap[key].contratos += 1;
        crossMap[key].valor += Number(c.valor_del_contrato) || 0;
      });
      const cross = Object.values(crossMap)
        .filter(x => x.entidades.size > 1)
        .map(x => ({ ...x, entidades: [...x.entidades] }))
        .sort((a, b) => b.valor - a.valor);

      // 5. Personas del gobierno Duque que continúan en 2026
      const nitsDuque = new Set(duqueAll.map(c => (c.nit_del_contratista || c.nombre_del_contratista || '').trim()).filter(Boolean));
      const continuan = p2026.filter(c => {
        const k = (c.nit_del_contratista || c.nombre_del_contratista || '').trim();
        return k && nitsDuque.has(k);
      });
      // Agrupar continuaciones
      const continuanMap = {};
      continuan.forEach(c => {
        const k = (c.nit_del_contratista || c.nombre_del_contratista || '').trim();
        if (!continuanMap[k]) continuanMap[k] = { nombre: c.nombre_del_contratista, nit: c.nit_del_contratista, entidades: new Set(), contratos2026: 0, valor2026: 0 };
        continuanMap[k].entidades.add(c.nombre_entidad || c.nit_entidad);
        continuanMap[k].contratos2026 += 1;
        continuanMap[k].valor2026 += Number(c.valor_del_contrato) || 0;
      });
      const continuanList = Object.values(continuanMap)
        .map(x => ({ ...x, entidades: [...x.entidades] }))
        .sort((a, b) => b.valor2026 - a.valor2026);

      setData({ periodos: porPeriodo, duqueAll, p2026, cross, continuanList });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [nits.join(',')]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // ── Estadísticas de un set de contratos ─────────────────────────────────────
  const stats = (contratos, soloPS = false) => {
    const arr = soloPS ? contratos.filter(c => esPS(c.tipo_de_contrato, c.objeto_del_contrato)) : contratos;
    const valor = arr.reduce((s, c) => s + (Number(c.valor_del_contrato) || 0), 0);
    const contratistas = new Set(arr.map(c => (c.nit_del_contratista || c.nombre_del_contratista || '').trim())).size;
    return { count: arr.length, valor, contratistas };
  };

  // ── Tabla de contratistas ────────────────────────────────────────────────────
  const buildTablaPS = (periodosKeys, soloPS = true) => {
    if (!data) return [];
    const map = {};
    periodosKeys.forEach(pk => {
      const contratos = (data.periodos[pk] || []).filter(c => soloPS ? esPS(c.tipo_de_contrato, c.objeto_del_contrato) : !esPS(c.tipo_de_contrato, c.objeto_del_contrato));
      contratos.forEach(c => {
        const key = (c.nit_del_contratista || c.nombre_del_contratista || '').trim();
        if (!key) return;
        if (!map[key]) map[key] = { nombre: c.nombre_del_contratista, nit: c.nit_del_contratista, periodos: {}, total: 0, totalValor: 0 };
        if (!map[key].periodos[pk]) map[key].periodos[pk] = { count: 0, valor: 0 };
        map[key].periodos[pk].count += 1;
        map[key].periodos[pk].valor += Number(c.valor_del_contrato) || 0;
        map[key].total += 1;
        map[key].totalValor += Number(c.valor_del_contrato) || 0;
      });
    });
    return Object.values(map).sort((a, b) => b.totalValor - a.totalValor);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '16px' }}>
      <div style={{ width: 48, height: 48, border: `3px solid ${cfg.color}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <p style={{ color: 'var(--text-secondary)' }}>Consultando SECOP II — puede tardar 20–60 segundos…</p>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(255,94,98,0.08)', border: '1px solid rgba(255,94,98,0.3)', borderRadius: 10, padding: 20 }}>
      <AlertCircle size={20} color="var(--color-error)" />
      <div>
        <strong style={{ color: 'var(--color-error)' }}>Error al consultar SECOP II</strong>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 12px 0', fontSize: '0.85rem' }}>{error}</p>
        <button className="btn btn-secondary" onClick={cargarDatos} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Reintentar
        </button>
      </div>
    </div>
  );

  if (!data) return null;

  const allPeriodKeys = PERIODOS.map(p => p.key);

  // Tarjetas resumen por período (PS)
  const statsCards = PERIODOS.map(p => ({ ...p, s: stats(data.periodos[p.key] || [], true) }));
  const duqueRef = statsCards.find(s => s.key === 'petro_1')?.s.valor || 1;

  // Tabla PS
  const tablaPS = buildTablaPS(allPeriodKeys, true);
  const tablaOtros = buildTablaPS(allPeriodKeys, false);

  const filteredPS = tablaPS.filter(r =>
    (!searchContratista || r.nombre?.toLowerCase().includes(searchContratista.toLowerCase()))
  );
  const filteredOtros = tablaOtros.filter(r =>
    (!searchContratista || r.nombre?.toLowerCase().includes(searchContratista.toLowerCase()))
  );
  const filteredCross = data.cross.filter(r =>
    (!searchContratista || r.nombre?.toLowerCase().includes(searchContratista.toLowerCase()))
  );
  const filteredContinuan = data.continuanList.filter(r =>
    (!searchContratista || r.nombre?.toLowerCase().includes(searchContratista.toLowerCase()))
  );

  const maxValorBar = Math.max(...statsCards.map(s => s.s.valor), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Header del sector ── */}
      <div className="glass-panel" style={{ background: cfg.colorBg, border: `1px solid ${cfg.colorBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Building2 size={22} color={cfg.color} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: cfg.color }}>Contratación Directa — {cfg.nombre}</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0 32px', fontSize: '0.82rem' }}>
            Entidades: {cfg.entidades.map(e => `${e.sigla} (NIT ${e.nit})`).join(' · ')}
          </p>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0 32px', fontSize: '0.78rem' }}>
            Fuente: SECOP II · datos.gov.co · Solo contratos directos
          </p>
        </div>
        <button className="btn btn-secondary" onClick={cargarDatos} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
          <RefreshCw size={14} /> Actualizar datos
        </button>
      </div>

      {/* ── Tarjetas resumen PS por período ── */}
      <div>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
          📊 Prestación de Servicios Directos — Resumen por Gobierno
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {statsCards.map((s, i) => {
            const prev = i > 0 ? statsCards[i - 1].s.valor : null;
            const cambio = pct(s.s.valor, prev);
            const subiendo = cambio && Number(cambio) > 0;
            return (
              <div key={s.key} className="glass-panel" style={{
                borderLeft: `3px solid ${s.gov === 'duque' ? '#60a5fa' : cfg.color}`,
                padding: '14px 16px'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{s.emoji} {s.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: s.gov === 'duque' ? '#60a5fa' : cfg.color }}>{fmtCOP(s.s.valor)}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {fmtNum(s.s.count)} contratos · {fmtNum(s.s.contratistas)} contratistas
                </div>
                {cambio && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.78rem', color: subiendo ? '#f87171' : '#43e97b' }}>
                    {subiendo ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {subiendo ? '+' : ''}{cambio}% vs período anterior
                  </div>
                )}
                {/* Mini barra */}
                <div style={{ marginTop: 8, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(100, (s.s.valor / maxValorBar) * 100)}%`, height: '100%', background: s.gov === 'duque' ? '#60a5fa' : cfg.color, borderRadius: 2, transition: 'width 0.8s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tabs de análisis ── */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)' }}>
          {[
            { key: 'ps',    icon: <FileText size={15} />,       label: 'PS Directos' },
            { key: 'otros', icon: <BarChart3 size={15} />,      label: 'Otros Directos' },
            { key: 'cruce', icon: <ArrowRightLeft size={15} />, label: `Cruce entre Entidades (${data.cross.length})` },
            { key: '2026',  icon: <UserCheck size={15} />,      label: `Duque→2026 (${data.continuanList.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTabAnalisis(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', border: 'none',
              background: tabAnalisis === t.key ? cfg.colorBg : 'transparent',
              color: tabAnalisis === t.key ? cfg.color : 'var(--text-secondary)',
              borderBottom: tabAnalisis === t.key ? `2px solid ${cfg.color}` : '2px solid transparent',
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: tabAnalisis === t.key ? 700 : 400,
              transition: 'all 0.2s'
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Buscador */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 32, fontSize: '0.83rem' }}
              placeholder="Buscar contratista..."
              value={searchContratista}
              onChange={e => setSearchContratista(e.target.value)}
            />
          </div>
        </div>

        {/* ── TAB PS DIRECTOS ── */}
        {tabAnalisis === 'ps' && (
          <div style={{ padding: 16 }}>
            <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Mostrando {filteredPS.length} contratistas con contratos de Prestación de Servicios directos. Valores en COP.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', minWidth: 200 }}>Contratista</th>
                    {PERIODOS.map(p => (
                      <th key={p.key} style={{ padding: '8px 10px', textAlign: 'center', color: p.gov === 'duque' ? '#60a5fa' : cfg.color, borderBottom: '1px solid var(--border-color)', minWidth: 100, fontSize: '0.72rem' }}>
                        {p.emoji} {p.label}
                      </th>
                    ))}
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPS.slice(0, 200).map((r, idx) => (
                    <React.Fragment key={idx}>
                      <tr
                        style={{ cursor: 'pointer', background: expandedRow === idx ? cfg.colorBg : idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                        onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                      >
                        <td style={{ padding: '7px 12px', color: 'var(--text-main)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {expandedRow === idx ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            <div>
                              <div style={{ fontWeight: 500 }}>{r.nombre || '—'}</div>
                              {r.nit && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NIT: {r.nit}</div>}
                            </div>
                          </div>
                        </td>
                        {PERIODOS.map(p => {
                          const pp = r.periodos[p.key];
                          return (
                            <td key={p.key} style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              {pp ? (
                                <div>
                                  <div style={{ color: p.gov === 'duque' ? '#60a5fa' : cfg.color, fontWeight: 600 }}>{fmtCOP(pp.valor)}</div>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{pp.count} cto{pp.count !== 1 ? 's' : ''}</div>
                                </div>
                              ) : <span style={{ color: 'rgba(255,255,255,0.12)' }}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{ padding: '7px 12px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)', fontWeight: 700, color: cfg.color }}>
                          {fmtCOP(r.totalValor)}
                        </td>
                      </tr>
                      {expandedRow === idx && (
                        <tr>
                          <td colSpan={PERIODOS.length + 2} style={{ padding: '8px 24px 12px', background: cfg.colorBg, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            📌 <strong style={{ color: 'var(--text-main)' }}>Total contratos PS:</strong> {r.total} · <strong style={{ color: 'var(--text-main)' }}>Valor acumulado:</strong> ${Number(r.totalValor).toLocaleString('es-CO')}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {filteredPS.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No se encontraron contratos PS directos para los filtros aplicados.</div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB OTROS DIRECTOS ── */}
        {tabAnalisis === 'otros' && (
          <div style={{ padding: 16 }}>
            <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Contratos directos diferentes a Prestación de Servicios — suministros, consultoría, obras, compras, etc.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', minWidth: 200 }}>Contratista</th>
                    {PERIODOS.map(p => (
                      <th key={p.key} style={{ padding: '8px 10px', textAlign: 'center', color: p.gov === 'duque' ? '#60a5fa' : cfg.color, borderBottom: '1px solid var(--border-color)', minWidth: 100, fontSize: '0.72rem' }}>
                        {p.emoji} {p.label}
                      </th>
                    ))}
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOtros.slice(0, 200).map((r, idx) => (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '7px 12px', color: 'var(--text-main)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ fontWeight: 500 }}>{r.nombre || '—'}</div>
                        {r.nit && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NIT: {r.nit}</div>}
                      </td>
                      {PERIODOS.map(p => {
                        const pp = r.periodos[p.key];
                        return (
                          <td key={p.key} style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            {pp ? (
                              <div>
                                <div style={{ color: p.gov === 'duque' ? '#60a5fa' : cfg.color, fontWeight: 600 }}>{fmtCOP(pp.valor)}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{pp.count} cto{pp.count !== 1 ? 's' : ''}</div>
                              </div>
                            ) : <span style={{ color: 'rgba(255,255,255,0.12)' }}>—</span>}
                          </td>
                        );
                      })}
                      <td style={{ padding: '7px 12px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)', fontWeight: 700, color: cfg.color }}>
                        {fmtCOP(r.totalValor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredOtros.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No se encontraron otros contratos directos.</div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB CRUCE ENTRE ENTIDADES ── */}
        {tabAnalisis === 'cruce' && (
          <div style={{ padding: 16 }}>
            <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Contratistas que aparecen en <strong style={{ color: cfg.color }}>más de una entidad</strong> del sector — posibles vínculos cruzados.
            </div>
            {filteredCross.length === 0
              ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No se encontraron contratistas repetidos entre entidades.</div>
              : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredCross.slice(0, 150).map((r, i) => (
                  <div key={i} className="glass-panel" style={{ padding: '12px 16px', borderLeft: `3px solid ${cfg.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>{r.nombre || '—'}</div>
                        {r.nit && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>NIT: {r.nit}</div>}
                        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {r.entidades.map((e, j) => (
                            <span key={j} style={{ fontSize: '0.7rem', background: cfg.colorBg, border: `1px solid ${cfg.colorBorder}`, color: cfg.color, borderRadius: 4, padding: '2px 7px' }}>
                              {cfg.entidades.find(x => e.includes(x.sigla) || e.includes(x.nombre))?.sigla || e.slice(0, 25)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: cfg.color, fontSize: '1.1rem' }}>{fmtCOP(r.valor)}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.contratos} contratos · {r.entidades.length} entidades</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB DUQUE → 2026 ── */}
        {tabAnalisis === '2026' && (
          <div style={{ padding: 16 }}>
            <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              🔵 Contratistas del gobierno <strong style={{ color: '#60a5fa' }}>Duque (2018–2022)</strong> que tienen contratos directos en <strong style={{ color: cfg.color }}>2026</strong>. Total: <strong style={{ color: cfg.color }}>{filteredContinuan.length}</strong> personas/empresas.
            </div>
            {filteredContinuan.length === 0
              ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No se encontraron continuaciones del gobierno Duque en 2026.</div>
              : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredContinuan.slice(0, 200).map((r, i) => (
                  <div key={i} className="glass-panel" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>{r.nombre || '—'}</div>
                      {r.nit && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>NIT: {r.nit}</div>}
                      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.entidades.map((e, j) => (
                          <span key={j} style={{ fontSize: '0.68rem', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', color: '#60a5fa', borderRadius: 4, padding: '2px 6px' }}>
                            {e.slice(0, 30)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: cfg.color, fontSize: '1rem' }}>{fmtCOP(r.valor2026)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.contratos2026} contratos en 2026</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.72rem', flexWrap: 'wrap', gap: 8 }}>
        <span>Datos obtenidos en tiempo real de SECOP II · datos.gov.co</span>
        <a href="https://www.datos.gov.co/Gastos-Gubernamentales/SECOP-II-Contratos-Electr-nicos/jbjy-vk9h" target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-primary)', textDecoration: 'none', fontSize: '0.72rem' }}>
          Ver fuente completa <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
