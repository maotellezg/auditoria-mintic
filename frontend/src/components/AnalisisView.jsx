/**
 * AnalisisView.jsx
 * Dashboard analítico comparativo Duque vs Petro.
 * Incluye: KPIs, gráficas Recharts, heatmap, alertas de riesgo, top contratistas,
 * prestación de servicios, y exportación PDF (jsPDF + html2canvas).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ─── Constantes ───────────────────────────────────────────────────────────────
const ENTIDADES = [
  { id: 'mintic', nombre: 'MinTIC', color: '#FF6900', nit: '899999053', icono: '🏛️' },
  { id: 'ane',    nombre: 'ANE',    color: '#214E92', nit: '900334265', icono: '📡' },
  { id: 'crc',    nombre: 'CRC',    color: '#0D7C3D', nit: '830002593', icono: '⚖️' },
  { id: 'and',    nombre: 'AND',    color: '#7B2D8B', nit: '901144049', icono: '💻' },
  { id: 'futic',  nombre: 'FUTIC',  color: '#C0392B', nit: '8001316486', icono: '💰' },
  { id: 'rtvc',   nombre: 'RTVC',   color: '#E67E22', nit: '900002583', icono: '📺' },
  { id: '472',    nombre: '4-72',   color: '#16A085', nit: '900062917', icono: '📮' },
];

const DUQUE_COLOR = '#214E92';
const PETRO_COLOR = '#0D7C3D';
const DUQUE_LIGHT = '#4A90D9';
const PETRO_LIGHT = '#27AE60';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const PIE_COLORS = ['#214E92','#0D7C3D','#E67E22','#7B2D8B','#C0392B','#16A085','#F39C12','#8E44AD','#2C3E50','#E74C3C'];

const COP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const COP_M = (v) => {
  if (!v) return '$0';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}B`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(1)}MM`;
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return COP(v);
};
const FMT = (d) => d ? String(d).slice(0, 10) : '—';
const PCT = (v) => `${(v || 0).toFixed(1)}%`;

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function Skeleton({ w = '100%', h = 80, br = 12 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: br,
      background: 'linear-gradient(90deg, #e8eaf0 25%, #f5f7fa 50%, #e8eaf0 75%)',
      backgroundSize: '400% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, valueD, valueP, fmt = COP_M, isRisk = false, lower = false }) {
  const diff = valueP && valueD ? ((valueP - valueD) / Math.abs(valueD)) * 100 : null;
  const diffSign = diff > 0 ? '+' : '';
  // For risk indicators: higher = worse (red). For money: higher = more spend.
  const diffColor = diff === null ? '#666' :
    (isRisk ? (diff > 0 ? '#C0392B' : '#27AE60') : (diff > 0 ? '#C0392B' : '#27AE60'));

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      border: '1px solid #E8ECF4',
      padding: '18px 20px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: DUQUE_COLOR, fontWeight: 700, marginBottom: 2 }}>🔵 DUQUE</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>{fmt(valueD)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: PETRO_COLOR, fontWeight: 700, marginBottom: 2 }}>🟢 PETRO</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>{fmt(valueP)}</div>
        </div>
      </div>
      {diff !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4, borderTop: '1px solid #F0F2F8' }}>
          <span style={{ fontSize: 11, color: diffColor, fontWeight: 700 }}>
            {diffSign}{diff.toFixed(1)}% vs Duque
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>{diff > 0 ? '▲' : '▼'}</span>
        </div>
      )}
    </div>
  );
}

// ─── Alert Card ───────────────────────────────────────────────────────────────
function AlertaCard({ alerta }) {
  const colors = { ROJO: '#C0392B', AMARILLO: '#E67E22', VERDE: '#27AE60' };
  const bgs = { ROJO: '#FEF2F2', AMARILLO: '#FFFBEB', VERDE: '#F0FDF4' };
  const icons = { ROJO: '🔴', AMARILLO: '🟡', VERDE: '🟢' };
  const c = colors[alerta.nivel] || '#666';
  const bg = bgs[alerta.nivel] || '#f9f9f9';
  const pct = Math.min(100, ((alerta.valor / alerta.umbral) * 100));

  return (
    <div style={{
      background: bg, borderRadius: 14, padding: '20px 24px',
      borderLeft: `5px solid ${c}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>{icons[alerta.nivel]}</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#1a1a2e' }}>{alerta.titulo}</span>
            <span style={{
              background: c, color: '#fff', fontSize: 10, fontWeight: 700,
              padding: '2px 8px', borderRadius: 20, letterSpacing: '0.05em'
            }}>{alerta.nivel}</span>
          </div>
          <p style={{ color: '#4B5563', fontSize: 13, lineHeight: 1.6, margin: 0 }}>{alerta.descripcion}</p>
        </div>
        <div style={{ textAlign: 'center', minWidth: 72 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{PCT(alerta.valor)}</div>
          <div style={{ fontSize: 10, color: '#9CA3AF' }}>umbral: {PCT(alerta.umbral)}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#6B7280' }}>Nivel de riesgo</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{PCT(alerta.valor)}</span>
        </div>
        <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(pct, 100)}%`, height: '100%',
            background: `linear-gradient(90deg, ${c}88, ${c})`,
            borderRadius: 4, transition: 'width 0.6s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>Umbral: {PCT(alerta.umbral)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Gauge circular CSS-only ──────────────────────────────────────────────────
function RiskGauge({ score }) {
  const angle = (score / 100) * 180;
  const color = score >= 70 ? '#C0392B' : score >= 40 ? '#E67E22' : '#27AE60';
  const label = score >= 70 ? 'ALTO' : score >= 40 ? 'MEDIO' : 'BAJO';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: 180, height: 100, overflow: 'hidden' }}>
        {/* Background arc */}
        <svg width={180} height={100} viewBox="0 0 180 100" style={{ position: 'absolute', top: 0, left: 0 }}>
          <path d="M 10 90 A 80 80 0 0 1 170 90" fill="none" stroke="#E5E7EB" strokeWidth={20} strokeLinecap="round" />
          <path
            d="M 10 90 A 80 80 0 0 1 170 90"
            fill="none"
            stroke={color}
            strokeWidth={20}
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 251.3} 251.3`}
            style={{ transition: 'stroke-dasharray 1s ease, stroke 0.5s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 30, fontWeight: 900, color, lineHeight: 1 }}>{Math.round(score)}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.1em' }}>{label}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>Score de Riesgo (0–100)</div>
    </div>
  );
}

// ─── Custom tooltip Recharts ──────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1E293B', borderRadius: 10, padding: '10px 14px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{ color: '#94A3B8', fontSize: 11, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color }} />
          <span style={{ color: '#CBD5E1', fontSize: 12, fontWeight: 600 }}>{p.name}:</span>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
            {typeof p.value === 'number' && p.value > 1e5 ? COP_M(p.value) : (p.value?.toLocaleString('es-CO') || 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
function Heatmap({ data }) {
  if (!data?.length) return <div style={{ color: '#9CA3AF', padding: 20, textAlign: 'center' }}>Sin datos</div>;

  // Build map: year+month → {valor, gobierno}
  const map = {};
  let maxVal = 0;
  data.forEach(r => {
    const key = `${r.anio}-${r.mes}`;
    if (!map[key]) map[key] = { valor: 0, gobierno: r.gobierno };
    map[key].valor += r.valor_total || 0;
    if (map[key].valor > maxVal) maxVal = map[key].valor;
  });

  const years = [...new Set(data.map(r => r.anio))].sort();

  const cellColor = (val, gobierno) => {
    if (!val) return '#F9FAFB';
    const intensity = val / maxVal;
    if (gobierno === 'Duque') {
      const r = Math.round(33 + (intensity * (33 - 33)));
      const g = Math.round(78 + (intensity * (78 - 146)));
      const b = Math.round(146 + (intensity * (146 - 33)));
      return `rgba(33, 78, 146, ${0.1 + intensity * 0.9})`;
    } else {
      return `rgba(13, 124, 61, ${0.1 + intensity * 0.9})`;
    }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 680 }}>
        {/* Header months */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(12, 1fr)', gap: 3, marginBottom: 3 }}>
          <div />
          {MESES.map(m => (
            <div key={m} style={{ textAlign: 'center', fontSize: 11, color: '#6B7280', fontWeight: 600 }}>{m}</div>
          ))}
        </div>
        {years.map(y => (
          <div key={y} style={{ display: 'grid', gridTemplateColumns: '60px repeat(12, 1fr)', gap: 3, marginBottom: 3 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center' }}>{y}</div>
            {[...Array(12)].map((_, mi) => {
              const key = `${y}-${mi + 1}`;
              const cell = map[key];
              const bg = cell ? cellColor(cell.valor, cell.gobierno) : '#F9FAFB';
              return (
                <div key={mi} title={cell ? `${COP_M(cell.valor)} (${cell.gobierno})` : 'Sin datos'}
                  style={{
                    height: 36, borderRadius: 6, background: bg,
                    border: '1px solid rgba(0,0,0,0.06)',
                    cursor: cell ? 'pointer' : 'default',
                    transition: 'transform 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              );
            })}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: 'rgba(33,78,146,0.7)' }} />
            <span style={{ fontSize: 11, color: '#6B7280' }}>Duque</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: 'rgba(13,124,61,0.7)' }} />
            <span style={{ fontSize: 11, color: '#6B7280' }}>Petro</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: '#F9FAFB', border: '1px solid #E5E7EB' }} />
            <span style={{ fontSize: 11, color: '#6B7280' }}>Sin contratos</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ data, color, title }) {
  const TOP_N = 6;
  const sorted = [...(data || [])].sort((a, b) => b.n_contratos - a.n_contratos);
  const top = sorted.slice(0, TOP_N);
  const otros = sorted.slice(TOP_N).reduce((s, r) => s + r.n_contratos, 0);
  const chartData = [...top.map(r => ({ name: r.tipo || r.modalidad, value: r.n_contratos }))];
  if (otros > 0) chartData.push({ name: 'Otros', value: otros });

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: color, marginBottom: 8, textAlign: 'center' }}>{title}</div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
            {chartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [v.toLocaleString('es-CO'), n]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 4 }}>
        {chartData.slice(0, 5).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: PIE_COLORS[i], flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#4B5563', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>{d.value.toLocaleString('es-CO')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PDF Generation ───────────────────────────────────────────────────────────
async function captureSection(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return null;
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  return canvas.toDataURL('image/png');
}

function buildPDFHeader(pdf, entidad, reportType, pageNum) {
  const pageW = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(21, 35, 78);
  pdf.rect(0, 0, pageW, 14, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.text(`${entidad.nombre} — ${reportType}`, 10, 9);
  pdf.text(`Página ${pageNum}`, pageW - 10, 9, { align: 'right' });
  pdf.setTextColor(0, 0, 0);
}

function buildPDFFooter(pdf) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(240, 242, 248);
  pdf.rect(0, pageH - 10, pageW, 10, 'F');
  pdf.setFontSize(7);
  pdf.setTextColor(100, 100, 130);
  pdf.text(
    `Sistema de Auditoría MinTIC  |  Datos: SECOP II via BigQuery  |  Generado: ${new Date().toLocaleDateString('es-CO')}`,
    pageW / 2, pageH - 3, { align: 'center' }
  );
  pdf.setTextColor(0, 0, 0);
}

function addTableToPDF(pdf, headers, rows, startY, colWidths) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginL = 12;
  let y = startY;
  const rowH = 7;

  // Header row
  pdf.setFillColor(21, 35, 78);
  pdf.rect(marginL, y, pageW - marginL * 2, rowH, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8);
  pdf.setFont(undefined, 'bold');
  let x = marginL + 2;
  headers.forEach((h, i) => {
    pdf.text(String(h), x, y + 5, { maxWidth: colWidths[i] - 2 });
    x += colWidths[i];
  });
  y += rowH;

  rows.forEach((row, ri) => {
    if (y + rowH > pageH - 16) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFillColor(ri % 2 === 0 ? 249 : 255, ri % 2 === 0 ? 250 : 255, ri % 2 === 0 ? 252 : 255);
    pdf.rect(marginL, y, pageW - marginL * 2, rowH, 'F');
    pdf.setTextColor(50, 50, 70);
    pdf.setFont(undefined, 'normal');
    pdf.setFontSize(7.5);
    let cx = marginL + 2;
    row.forEach((cell, i) => {
      pdf.text(String(cell ?? '—'), cx, y + 5, { maxWidth: colWidths[i] - 2 });
      cx += colWidths[i];
    });
    y += rowH;
  });
  return y + 4;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AnalisisView() {
  const { currentUser } = useAuth();
  const [entidadId, setEntidadId] = useState('mintic');
  const [activeTab, setActiveTab] = useState('resumen');
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState('');

  // Data states
  const [kpis, setKpis] = useState(null);
  const [serie, setSerie] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [mods, setMods] = useState([]);
  const [contratistas, setContratistas] = useState([]);
  const [prestacion, setPrestacion] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [topContratos, setTopContratos] = useState([]);
  const [psDetalle, setPsDetalle] = useState(null);
  const [directosNPS, setDirectosNPS] = useState(null);
  const [loadingPS, setLoadingPS] = useState(false);
  const [loadingNPS, setLoadingNPS] = useState(false);
  const [error, setError] = useState(null);

  // Sort state for contratistas table
  const [sortField, setSortField] = useState('valor_total');
  const [sortDir, setSortDir] = useState('desc');

  const entidadActiva = ENTIDADES.find(e => e.id === entidadId) || ENTIDADES[0];

  // ─── Fetch data ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (eid) => {
    if (!currentUser) return;
    setLoading(true);
    setKpis(null);
    setSerie([]); setTipos([]); setMods([]); setContratistas([]);
    setPrestacion([]); setHeatmap([]); setAlertas([]); setTopContratos([]);

    try {
      const token = await currentUser.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };

      // Wrap each fetch so a single failure doesn't kill all data
      const safeJson = async (url, hdrs) => {
        try {
          const r = await fetch(url, { headers: hdrs });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
          return await r.json();
        } catch (e) {
          console.warn('[AnalisisView] fetch failed:', url, e.message);
          return null;
        }
      };

      const [kpisR, serieR, tiposR, modsR, contratistasR, prestacionR, heatmapR, alertasR, topR] =
        await Promise.all([
          safeJson(`/api/analytics/kpis/${eid}`, headers),
          safeJson(`/api/analytics/serie-mensual/${eid}`, headers),
          safeJson(`/api/analytics/tipos/${eid}`, headers),
          safeJson(`/api/analytics/modalidades/${eid}`, headers),
          safeJson(`/api/analytics/top-contratistas/${eid}`, headers),
          safeJson(`/api/analytics/prestacion-servicios/${eid}`, headers),
          safeJson(`/api/analytics/heatmap/${eid}`, headers),
          safeJson(`/api/analytics/alertas/${eid}`, headers),
          safeJson(`/api/analytics/top-contratos/${eid}`, headers),
        ]);

      setKpis(kpisR ? (Array.isArray(kpisR) ? kpisR[0] : kpisR) : null);
      setSerie(Array.isArray(serieR) ? serieR : []);
      setTipos(Array.isArray(tiposR) ? tiposR : []);
      setMods(Array.isArray(modsR) ? modsR : []);
      setContratistas(Array.isArray(contratistasR) ? contratistasR : []);
      setPrestacion(Array.isArray(prestacionR) ? prestacionR : []);
      setHeatmap(Array.isArray(heatmapR) ? heatmapR : []);
      setAlertas(Array.isArray(alertasR) ? alertasR : []);
      setTopContratos(Array.isArray(topR) ? topR : []);

      // Surface a top-level error only if kpis is null (core data failed)
      if (!kpisR) setError('No se pudieron cargar los KPIs desde el backend. Revisa la consola para detalles.');
      else setError(null);
    } catch (err) {
      console.error('[AnalisisView] fetch error:', err);
      setError(err.message || 'Error cargando datos del dashboard');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { fetchAll(entidadId); }, [entidadId, fetchAll]);

  // ─── Derived data for charts ─────────────────────────────────────────────
  const serieFormatted = (() => {
    const map = {};
    serie.forEach(r => {
      if (!map[r.mes]) map[r.mes] = { mes: r.mes };
      map[r.mes][r.gobierno] = r.valor_total || 0;
    });
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes));
  })();

  const anualData = (() => {
    const map = {};
    serie.forEach(r => {
      const y = r.mes?.slice(0, 4);
      if (!y) return;
      if (!map[y]) map[y] = { anio: y, Duque: 0, Petro: 0 };
      map[y][r.gobierno] = (map[y][r.gobierno] || 0) + (r.valor_total || 0);
    });
    return Object.values(map).sort((a, b) => a.anio.localeCompare(b.anio));
  })();

  const tiposDuque = tipos.filter(t => t.gobierno === 'Duque');
  const tiposPetro = tipos.filter(t => t.gobierno === 'Petro');
  const modsDuque  = mods.filter(m => m.gobierno === 'Duque');
  const modsPetro  = mods.filter(m => m.gobierno === 'Petro');

  // Risk score
  const riskScore = (() => {
    if (!alertas.length) return 0;
    const nivelVal = (nivel) => nivel === 'ROJO' ? 100 : nivel === 'AMARILLO' ? 50 : 0;
    const concentracion = alertas.find(a => a.tipo === 'CONCENTRACION');
    const directa = alertas.find(a => a.tipo === 'CONTRATACION_DIRECTA');
    const adiciones = alertas.find(a => a.tipo === 'ADICIONES');
    const prestacionA = alertas.find(a => a.tipo === 'NOMINA_PARALELA');
    return Math.min(100,
      (nivelVal(concentracion?.nivel) * 0.30) +
      (nivelVal(directa?.nivel) * 0.25) +
      (nivelVal(adiciones?.nivel) * 0.20) +
      (nivelVal(prestacionA?.nivel) * 0.15) +
      (alertas.filter(a => a.nivel === 'ROJO').length > 2 ? 10 : 0)
    );
  })();

  // Sort contratistas
  const sortedContratistas = [...contratistas].sort((a, b) => {
    const av = a[sortField] || 0, bv = b[sortField] || 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const toggleSort = (f) => {
    if (sortField === f) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(f); setSortDir('desc'); }
  };
  const sortIcon = (f) => sortField === f ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅';

  // Comparison banner
  const comparisonBanner = (() => {
    if (!kpis) return null;
    const vD = kpis.duque_valor_total || 0;
    const vP = kpis.petro_valor_total || 0;
    if (!vD || !vP) return null;
    const diff = ((vP - vD) / vD * 100).toFixed(1);
    const more = vP > vD ? 'Petro' : 'Duque';
    const color = more === 'Petro' ? PETRO_COLOR : DUQUE_COLOR;
    return { diff: Math.abs(diff), more, color };
  })();

  // ─── PDF generators ──────────────────────────────────────────────────────
  const generatePDF = async (tipo) => {
    setPdfLoading(tipo);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const fechaHoy = new Date().toLocaleDateString('es-CO');

      // ── Cover page ──
      pdf.setFillColor(21, 35, 78);
      pdf.rect(0, 0, pageW, 65, 'F');
      pdf.setFillColor(33, 78, 146);
      pdf.rect(0, 65, pageW, 8, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(9);
      pdf.setFont(undefined, 'normal');
      pdf.text('SISTEMA DE AUDITORÍA CONTRACTUAL MINTIC', pageW / 2, 22, { align: 'center' });

      pdf.setFontSize(20);
      pdf.setFont(undefined, 'bold');
      const titleMap = {
        ejecutivo: 'INFORME EJECUTIVO',
        riesgo: 'INFORME DE RIESGO',
        completo: 'INFORME COMPLETO',
      };
      pdf.text(titleMap[tipo] || 'INFORME', pageW / 2, 36, { align: 'center' });

      pdf.setFontSize(13);
      pdf.setFont(undefined, 'normal');
      pdf.text(`${entidadActiva.icono}  ${entidadActiva.nombre} — Gobierno Duque vs Petro`, pageW / 2, 48, { align: 'center' });

      pdf.setFontSize(9);
      pdf.text(`Generado: ${fechaHoy}  |  NIT: ${entidadActiva.nit}`, pageW / 2, 58, { align: 'center' });

      pdf.setTextColor(0, 0, 0);
      let y = 80;

      // ── KPI Table ──
      if (tipo === 'ejecutivo' || tipo === 'completo') {
        pdf.setFontSize(13);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(21, 35, 78);
        pdf.text('Indicadores Clave de Desempeño (KPIs)', 12, y);
        y += 8;

        if (kpis) {
          const kpiRows = [
            ['Valor Total Contratado', COP(kpis.duque_valor_total), COP(kpis.petro_valor_total)],
            ['N° de Contratos', (kpis.duque_n_contratos || 0).toLocaleString('es-CO'), (kpis.petro_n_contratos || 0).toLocaleString('es-CO')],
            ['Contratistas Únicos', (kpis.duque_contratistas || 0).toLocaleString('es-CO'), (kpis.petro_contratistas || 0).toLocaleString('es-CO')],
            ['Ticket Promedio', COP(kpis.duque_ticket_promedio), COP(kpis.petro_ticket_promedio)],
            ['% Contratación Directa', PCT(kpis.duque_pct_directa), PCT(kpis.petro_pct_directa)],
            ['% Prestación de Servicios', PCT(kpis.duque_pct_prestacion), PCT(kpis.petro_pct_prestacion)],
            ['% Contratos Adicionados', PCT(kpis.duque_pct_adicionados), PCT(kpis.petro_pct_adicionados)],
          ];
          y = addTableToPDF(pdf, ['Indicador', 'Duque 2018–2022', 'Petro 2022–present'], kpiRows, y, [86, 52, 52]);
        }
        y += 6;
      }

      // ── Key Findings ──
      if (tipo === 'ejecutivo' || tipo === 'completo') {
        if (y > pageH - 50) { pdf.addPage(); y = 20; }
        pdf.setFontSize(13);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(21, 35, 78);
        pdf.text('Hallazgos Clave', 12, y);
        y += 8;
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(50, 50, 70);

        const findings = [];
        if (kpis) {
          const vD = kpis.duque_valor_total || 0, vP = kpis.petro_valor_total || 0;
          if (vD && vP) {
            const diff = ((vP - vD) / vD * 100).toFixed(1);
            findings.push(`• El gobierno ${vP > vD ? 'Petro' : 'Duque'} contrató ${Math.abs(diff)}% ${vP > vD ? 'más' : 'menos'} en valor vs ${vP > vD ? 'Duque' : 'Petro'}: Duque ${COP_M(vD)} vs Petro ${COP_M(vP)}.`);
          }
          if (kpis.petro_pct_directa > 60) findings.push(`• ⚠️ ALERTA: Contratación directa Petro (${PCT(kpis.petro_pct_directa)}) supera umbral crítico del 60%.`);
          if (kpis.petro_pct_prestacion > 40) findings.push(`• 🔴 Riesgo de nómina paralela Petro: ${PCT(kpis.petro_pct_prestacion)} de contratos son Prestación de Servicios.`);
          if (kpis.duque_pct_prestacion > 40) findings.push(`• 🔴 Riesgo de nómina paralela Duque: ${PCT(kpis.duque_pct_prestacion)} de contratos son Prestación de Servicios.`);
          if (kpis.petro_n_contratos > kpis.duque_n_contratos * 1.5) findings.push(`• El volumen de contratos Petro (${kpis.petro_n_contratos?.toLocaleString()}) supera ampliamente a Duque (${kpis.duque_n_contratos?.toLocaleString()}).`);
          if (!findings.length) findings.push('• Los indicadores se encuentran dentro de rangos normales para entidades del sector TIC.');
        }

        findings.forEach(f => {
          const lines = pdf.splitTextToSize(f, pageW - 24);
          pdf.text(lines, 12, y);
          y += lines.length * 5 + 3;
        });
        y += 4;
      }

      // ── Riesgo ──
      if (tipo === 'riesgo' || tipo === 'completo') {
        if (y > pageH - 50) { pdf.addPage(); y = 20; }
        pdf.setFontSize(13);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(21, 35, 78);
        pdf.text('Score de Riesgo Computado', 12, y);
        y += 8;
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(11);
        const riskLabel = riskScore >= 70 ? 'ALTO' : riskScore >= 40 ? 'MEDIO' : 'BAJO';
        const riskCol = riskScore >= 70 ? [192, 57, 43] : riskScore >= 40 ? [230, 126, 34] : [39, 174, 96];
        pdf.setTextColor(...riskCol);
        pdf.text(`Score: ${Math.round(riskScore)}/100 — Riesgo ${riskLabel}`, 12, y);
        y += 10;

        // Alert sections
        pdf.setFontSize(13);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(21, 35, 78);
        pdf.text('Alertas de Riesgo Detectadas', 12, y);
        y += 8;

        alertas.forEach(a => {
          if (y > pageH - 40) { pdf.addPage(); y = 20; }
          const ac = a.nivel === 'ROJO' ? [192, 57, 43] : a.nivel === 'AMARILLO' ? [230, 126, 34] : [39, 174, 96];
          pdf.setFillColor(...ac);
          pdf.rect(12, y, 3, 20, 'F');
          pdf.setFillColor(ac[0], ac[1], ac[2], 0.07);
          pdf.rect(16, y, pageW - 28, 20, 'F');
          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(10);
          pdf.setTextColor(21, 35, 78);
          pdf.text(`[${a.nivel}] ${a.titulo}`, 19, y + 6);
          pdf.setFont(undefined, 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(60, 60, 80);
          const lines = pdf.splitTextToSize(a.descripcion, pageW - 34);
          pdf.text(lines.slice(0, 2), 19, y + 13);
          y += 24;
        });
        y += 4;

        // Top 10 contractors
        if (contratistas.length && (tipo === 'riesgo' || tipo === 'completo')) {
          if (y > pageH - 50) { pdf.addPage(); y = 20; }
          pdf.setFontSize(12);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(21, 35, 78);
          pdf.text('Top 10 Contratistas por Riesgo de Concentración', 12, y);
          y += 7;
          const top10Rows = contratistas.slice(0, 10).map((c, i) => [
            `#${i + 1}`,
            (c.nombre || '').slice(0, 28),
            c.nit || '—',
            COP_M(c.valor_total),
            PCT(c.pct_del_total),
            c.pct_del_total > 20 ? '🔴 ALTO' : c.pct_del_total > 10 ? '🟡 MEDIO' : '🟢 OK',
          ]);
          y = addTableToPDF(pdf, ['#', 'Contratista', 'NIT', 'Valor Total', '% Presupuesto', 'Riesgo'], top10Rows, y, [10, 60, 25, 30, 26, 20]);
          y += 4;
        }

        // Prestación de servicios table
        if (prestacion.length) {
          if (y > pageH - 50) { pdf.addPage(); y = 20; }
          pdf.setFontSize(12);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(21, 35, 78);
          pdf.text('Análisis Prestación de Servicios por Año', 12, y);
          y += 7;
          const psRows = prestacion.map(p => [
            p.anio,
            (p.n_total || 0).toLocaleString('es-CO'),
            (p.n_prestacion || 0).toLocaleString('es-CO'),
            PCT(p.pct_prestacion),
            COP_M(p.valor_prestacion),
            p.pct_prestacion > 40 ? '🔴 ALTO' : p.pct_prestacion > 25 ? '🟡' : '🟢',
          ]);
          y = addTableToPDF(pdf, ['Año', 'Total Contratos', 'Prestación Serv.', '% P.S.', 'Valor P.S.', 'Riesgo'], psRows, y, [16, 36, 36, 20, 32, 18]);
          y += 4;
        }
      }

      // ── Full data (completo only) ──
      if (tipo === 'completo') {
        // Top 30 contratistas
        if (y > pageH - 50) { pdf.addPage(); y = 20; }
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(21, 35, 78);
        pdf.text('Top 30 Contratistas Histórico', 12, y);
        y += 7;
        const c30Rows = contratistas.slice(0, 30).map((c, i) => [
          `#${i + 1}`,
          (c.nombre || '').slice(0, 32),
          COP_M(c.valor_duque),
          COP_M(c.valor_petro),
          PCT(c.pct_del_total),
        ]);
        y = addTableToPDF(pdf, ['#', 'Contratista', 'Valor Duque', 'Valor Petro', '% Total'], c30Rows, y, [10, 75, 30, 30, 20]);
        y += 4;

        // Top 50 contratos por valor
        if (topContratos.length) {
          if (y > pageH - 50) { pdf.addPage(); y = 20; }
          pdf.setFontSize(12);
          pdf.setFont(undefined, 'bold');
          pdf.setTextColor(21, 35, 78);
          pdf.text('Top 50 Contratos por Valor', 12, y);
          y += 7;
          const tc50 = topContratos.slice(0, 50).map(c => [
            c.gobierno === 'Petro' ? '🟢' : '🔵',
            (c.referencia_del_contrato || '').slice(0, 20),
            (c.proveedor_adjudicado || '').slice(0, 30),
            FMT(c.fecha_de_firma),
            COP_M(c.valor_del_contrato),
          ]);
          y = addTableToPDF(pdf, ['Gov', 'Referencia', 'Contratista', 'Fecha', 'Valor'], tc50, y, [10, 42, 60, 24, 30]);
        }
      }

      // ── Footer on all pages ──
      const totalPages = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        buildPDFFooter(pdf);
        if (p > 1) buildPDFHeader(pdf, entidadActiva, titleMap[tipo] || tipo, p);
      }

      pdf.save(`Informe_${tipo}_${entidadActiva.nombre}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('[PDF]', err);
      alert('Error generando PDF: ' + err.message);
    } finally {
      setPdfLoading('');
    }
  };

  const titleMap = { ejecutivo: 'INFORME EJECUTIVO', riesgo: 'INFORME DE RIESGO', completo: 'INFORME COMPLETO' };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#F4F6FB', minHeight: '100%', padding: '0 0 40px 0' }}>
      {/* ── Shimmer keyframes (required by Skeleton component) ── */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -400% 0; }
          100% { background-position:  400% 0; }
        }
        @keyframes spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      {/* ── Error banner ── */}
      {error && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#C0392B', marginBottom: 8 }}>Error cargando el dashboard</div>
          <div style={{ fontSize: 14, color: '#6B7280', marginBottom: 24 }}>{error}</div>
          <button onClick={() => { setError(null); fetchAll(entidadId); }} style={{ padding: '10px 24px', background: '#15234E', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Reintentar</button>
        </div>
      )}
      {/* ── Top bar ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #E8ECF4',
        padding: '16px 28px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#15234E' }}>
            📊 Dashboard Analítico — Comparativo Duque vs Petro
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: '#6B7280', marginTop: 2 }}>
            Detección de corrupción por análisis estadístico de contratación pública
          </p>
        </div>
        {/* PDF Buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { tipo: 'ejecutivo', label: '📄 Informe Ejecutivo', bg: '#15234E' },
            { tipo: 'riesgo',    label: '🔴 Informe de Riesgo',  bg: '#C0392B' },
            { tipo: 'completo',  label: '📊 Informe Completo',   bg: '#374151' },
          ].map(({ tipo, label, bg }) => (
            <button key={tipo} onClick={() => generatePDF(tipo)}
              disabled={loading || !!pdfLoading}
              style={{
                background: bg, color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 14px', fontSize: 12,
                fontWeight: 600, cursor: loading || pdfLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: loading || pdfLoading ? 0.6 : 1,
                transition: 'opacity 0.2s, transform 0.15s',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
              onMouseEnter={e => !pdfLoading && (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              {pdfLoading === tipo ? (
                <span style={{ display:'inline-block', width:14, height:14, border:'2px solid #fff', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
              ) : label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px 28px 0' }}>
        {/* ── Entity selector ── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {ENTIDADES.map(e => (
            <button key={e.id} onClick={() => setEntidadId(e.id)}
              style={{
                padding: '8px 18px', borderRadius: 30, border: 'none',
                background: entidadId === e.id ? e.color : '#fff',
                color: entidadId === e.id ? '#fff' : '#374151',
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
                boxShadow: entidadId === e.id
                  ? `0 3px 10px ${e.color}55`
                  : '0 1px 4px rgba(0,0,0,0.08)',
                transition: 'all 0.2s ease',
                transform: entidadId === e.id ? 'scale(1.04)' : 'scale(1)',
              }}>
              {e.icono} {e.nombre}
            </button>
          ))}
          <button onClick={() => fetchAll(entidadId)}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 30, border: '1px solid #D1D5DB',
              background: '#fff', color: '#6B7280', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', marginLeft: 'auto',
            }}>
            {loading ? '⟳' : '🔄 Actualizar'}
          </button>
        </div>

        {/* ── Comparison banner ── */}
        {comparisonBanner && (
          <div style={{
            background: `linear-gradient(135deg, ${comparisonBanner.color}18, ${comparisonBanner.color}08)`,
            border: `1px solid ${comparisonBanner.color}40`,
            borderRadius: 14, padding: '14px 24px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <span style={{ fontSize: 28 }}>{comparisonBanner.more === 'Petro' ? '🟢' : '🔵'}</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: comparisonBanner.color }}>
                El gobierno {comparisonBanner.more} contrató {comparisonBanner.diff}% más que su contraparte
              </div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                Duque (2018–2022): {COP(kpis?.duque_valor_total)} &nbsp;|&nbsp;
                Petro (2022–presente): {COP(kpis?.petro_valor_total)}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab nav ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#fff', borderRadius: 12, padding: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', width: 'fit-content' }}>
          {[
            { id: 'resumen',  label: '📋 Resumen Ejecutivo' },
            { id: 'profundo', label: '🔬 Análisis Profundo' },
            { id: 'alertas',  label: '🚨 Alertas de Riesgo' },
            { id: 'prestacion_detalle', label: '🧑‍💼 Prestación de Servicios' },
            { id: 'directos_nops', label: '📑 Directos No-PS' },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: '8px 20px', borderRadius: 9, border: 'none',
                background: activeTab === t.id ? '#15234E' : 'transparent',
                color: activeTab === t.id ? '#fff' : '#6B7280',
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
                transition: 'all 0.2s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════ TAB: RESUMEN ══════════════════════════ */}
        {activeTab === 'resumen' && (
          <div id="section-resumen">
            {/* KPI Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16, marginBottom: 24,
            }}>
              {loading ? (
                [...Array(7)].map((_, i) => <Skeleton key={i} h={130} />)
              ) : kpis ? (
                <>
                  <KpiCard icon="💰" label="Valor Total Contratado"   valueD={kpis.duque_valor_total}     valueP={kpis.petro_valor_total} />
                  <KpiCard icon="📄" label="N° de Contratos"          valueD={kpis.duque_n_contratos}     valueP={kpis.petro_n_contratos} fmt={(v) => (v||0).toLocaleString('es-CO')} />
                  <KpiCard icon="🤝" label="Contratistas Únicos"      valueD={kpis.duque_contratistas}    valueP={kpis.petro_contratistas} fmt={(v) => (v||0).toLocaleString('es-CO')} />
                  <KpiCard icon="📊" label="Ticket Promedio"           valueD={kpis.duque_ticket_promedio} valueP={kpis.petro_ticket_promedio} />
                  <KpiCard icon="🔴" label="% Contratación Directa"   valueD={kpis.duque_pct_directa}     valueP={kpis.petro_pct_directa} fmt={PCT} isRisk />
                  <KpiCard icon="📋" label="% Prestación de Servicios" valueD={kpis.duque_pct_prestacion}  valueP={kpis.petro_pct_prestacion} fmt={PCT} isRisk />
                  <KpiCard icon="➕" label="% Contratos Adicionados"   valueD={kpis.duque_pct_adicionados} valueP={kpis.petro_pct_adicionados} fmt={PCT} isRisk />
                </>
              ) : (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Sin datos disponibles</div>
                  <div style={{ fontSize: 13, color: '#9CA3AF' }}>
                    No hay contratos registrados para <strong>{entidadActiva.nombre}</strong> o el backend no devolvió datos.
                  </div>
                  <button onClick={() => fetchAll(entidadId)} style={{ marginTop: 20, padding: '8px 22px', background: '#15234E', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    🔄 Reintentar
                  </button>
                </div>
              )}
            </div>

            {/* Monthly Area Chart */}
            <div id="section-area-chart" style={{ background: '#fff', borderRadius: 14, padding: '20px 20px 12px', marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#15234E' }}>
                📈 Gasto Mensual por Gobierno
              </h2>
              {loading ? <Skeleton h={280} /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={serieFormatted} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <defs>
                      <linearGradient id="gradDuque" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={DUQUE_COLOR} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={DUQUE_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradPetro" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={PETRO_COLOR} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={PETRO_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F8" />
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} />
                    <YAxis tickFormatter={COP_M} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="Duque" stroke={DUQUE_COLOR} strokeWidth={2.5} fill="url(#gradDuque)" dot={false} />
                    <Area type="monotone" dataKey="Petro" stroke={PETRO_COLOR} strokeWidth={2.5} fill="url(#gradPetro)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Annual Bar Chart */}
            <div id="section-bar-chart" style={{ background: '#fff', borderRadius: 14, padding: '20px 20px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#15234E' }}>
                📊 Gasto Anual Comparativo
              </h2>
              {loading ? <Skeleton h={260} /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={anualData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F8" />
                    <XAxis dataKey="anio" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                    <YAxis tickFormatter={COP_M} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="Duque" fill={DUQUE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    <Bar dataKey="Petro" fill={PETRO_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════ TAB: PROFUNDO ══════════════════════════ */}
        {activeTab === 'profundo' && (
          <div>
            {/* Tipos contrato donuts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
              {['Tipos de Contrato', 'Modalidades de Contratación'].map((title, sIdx) => (
                <div key={sIdx} style={{ background: '#fff', borderRadius: 14, padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
                  <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#15234E' }}>{title}</h2>
                  {loading ? <Skeleton h={280} /> : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <DonutChart
                        data={sIdx === 0 ? tiposDuque : modsDuque}
                        color={DUQUE_COLOR}
                        title="🔵 Duque"
                      />
                      <DonutChart
                        data={sIdx === 0 ? tiposPetro : modsPetro}
                        color={PETRO_COLOR}
                        title="🟢 Petro"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Prestación de Servicios por año */}
            <div id="section-prestacion" style={{ background: '#fff', borderRadius: 14, padding: '20px', marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#15234E' }}>
                    📋 Prestación de Servicios por Año — Detección de Nómina Paralela
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6B7280' }}>
                    Alta concentración de contratos de Prestación de Servicios es indicador de nómina paralela
                  </p>
                </div>
                <div style={{ background: '#FEF3F2', border: '1px solid #FECACA', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#B91C1C', fontWeight: 600 }}>
                  ⚠️ Umbral crítico: &gt;40%
                </div>
              </div>
              {loading ? <Skeleton h={300} /> : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={prestacion} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F8" />
                      <XAxis dataKey="anio" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#C0392B' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="n_total" name="Total Contratos" fill="#CBD5E1" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="left" dataKey="n_prestacion" name="Prestación Serv." fill="#C0392B" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="pct_prestacion" name="% Prestación" stroke="#E67E22" strokeWidth={2.5} dot={{ r: 4, fill: '#E67E22' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          {['Año', 'Total', 'Prestación', '% P.S.', 'Gobierno'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '2px solid #E5E7EB', fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {prestacion.map((p, i) => {
                          const gov = p.anio >= 2022 ? 'Petro' : 'Duque';
                          const color = p.pct_prestacion > 40 ? '#C0392B' : p.pct_prestacion > 25 ? '#E67E22' : '#27AE60';
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#F9FAFB' : '#fff' }}>
                              <td style={{ padding: '7px 10px', fontWeight: 700 }}>{p.anio}</td>
                              <td style={{ padding: '7px 10px' }}>{(p.n_total || 0).toLocaleString('es-CO')}</td>
                              <td style={{ padding: '7px 10px' }}>{(p.n_prestacion || 0).toLocaleString('es-CO')}</td>
                              <td style={{ padding: '7px 10px', fontWeight: 700, color }}>{PCT(p.pct_prestacion)}</td>
                              <td style={{ padding: '7px 10px' }}>
                                <span style={{ color: gov === 'Petro' ? PETRO_COLOR : DUQUE_COLOR, fontWeight: 700 }}>{gov === 'Petro' ? '🟢' : '🔵'} {gov}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Heatmap */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '20px', marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#15234E' }}>
                🗓️ Heatmap de Contratación Mensual
              </h2>
              {loading ? <Skeleton h={220} /> : <Heatmap data={heatmap} />}
            </div>

            {/* Top Contratistas */}
            <div id="section-contratistas" style={{ background: '#fff', borderRadius: 14, padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#15234E' }}>
                🏆 Top 30 Contratistas — Análisis de Concentración
              </h2>
              {loading ? <Skeleton h={300} /> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 860 }}>
                    <thead>
                      <tr style={{ background: '#15234E', color: '#fff' }}>
                        {[
                          { f: null, l: '#' },
                          { f: 'nombre', l: 'Contratista' },
                          { f: 'nit', l: 'NIT' },
                          { f: 'valor_duque', l: '💙 Valor Duque' },
                          { f: 'valor_petro', l: '💚 Valor Petro' },
                          { f: 'variacion_pct', l: 'Variación %' },
                          { f: 'n_contratos', l: '# Contratos' },
                          { f: 'pct_del_total', l: '% Presupuesto' },
                          { f: null, l: 'Alerta' },
                        ].map(({ f, l }) => (
                          <th key={l}
                            onClick={() => f && toggleSort(f)}
                            style={{
                              padding: '10px 12px', textAlign: 'left', fontWeight: 700,
                              fontSize: 11, cursor: f ? 'pointer' : 'default',
                              userSelect: 'none', whiteSpace: 'nowrap',
                            }}>
                            {l}{f ? sortIcon(f) : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedContratistas.map((c, i) => {
                        const riesgo = c.pct_del_total > 20 ? { color: '#C0392B', bg: '#FEF2F2', label: '🔴 ALTO' }
                          : c.pct_del_total > 10 ? { color: '#E67E22', bg: '#FFFBEB', label: '🟡 MEDIO' }
                          : { color: '#27AE60', bg: 'transparent', label: '🟢 OK' };
                        const varC = (c.variacion_pct || 0) > 0 ? '#C0392B' : '#27AE60';
                        return (
                          <tr key={i} style={{ background: riesgo.bg || (i % 2 === 0 ? '#F9FAFB' : '#fff'), transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#EEF2FF'}
                            onMouseLeave={e => e.currentTarget.style.background = riesgo.bg || (i % 2 === 0 ? '#F9FAFB' : '#fff')}
                          >
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: '#9CA3AF' }}>#{i + 1}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1E293B', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>{c.nombre || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#6B7280', fontFamily: 'monospace', fontSize: 11 }}>{c.nit}</td>
                            <td style={{ padding: '8px 12px', color: DUQUE_COLOR, fontWeight: 600 }}>{COP_M(c.valor_duque)}</td>
                            <td style={{ padding: '8px 12px', color: PETRO_COLOR, fontWeight: 600 }}>{COP_M(c.valor_petro)}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: varC }}>{c.variacion_pct ? `${c.variacion_pct > 0 ? '+' : ''}${(c.variacion_pct).toFixed(1)}%` : '—'}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>{(c.n_contratos || 0).toLocaleString('es-CO')}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: riesgo.color }}>
                              <div style={{ background: riesgo.color + '22', borderRadius: 6, padding: '2px 8px', display: 'inline-block' }}>
                                {PCT(c.pct_del_total)}
                              </div>
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: riesgo.color }}>{riesgo.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════ TAB: ALERTAS ══════════════════════════ */}
        {activeTab === 'alertas' && (
          <div>
            {/* Risk Score Panel */}
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, marginBottom: 24, alignItems: 'start' }}>
              <div style={{ background: '#fff', borderRadius: 14, padding: '24px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4', textAlign: 'center' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#15234E' }}>
                  🎯 Score de Riesgo Global
                </h3>
                {loading ? <Skeleton h={140} w={200} /> : <RiskGauge score={riskScore} />}
                <div style={{ marginTop: 16, fontSize: 11, color: '#6B7280', lineHeight: 1.6 }}>
                  <div>Calculado sobre: concentración (30%) + contratación directa (25%) + adiciones (20%) + prestación (15%) + otros (10%)</div>
                  <div style={{ marginTop: 8, fontWeight: 600, color: '#374151' }}>Entidad: {entidadActiva.nombre}</div>
                </div>
              </div>

              <div style={{ background: '#fff', borderRadius: 14, padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E8ECF4' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#15234E' }}>📊 Resumen de Alertas</h3>
                {loading ? <Skeleton h={100} /> : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      { nivel: 'ROJO', color: '#C0392B', bg: '#FEF2F2', icon: '🔴', label: 'Críticas' },
                      { nivel: 'AMARILLO', color: '#E67E22', bg: '#FFFBEB', icon: '🟡', label: 'Advertencias' },
                      { nivel: 'VERDE', color: '#27AE60', bg: '#F0FDF4', icon: '🟢', label: 'OK' },
                    ].map(({ nivel, color, bg, icon, label }) => {
                      const count = alertas.filter(a => a.nivel === nivel).length;
                      return (
                        <div key={nivel} style={{ background: bg, borderRadius: 10, padding: '16px', border: `1px solid ${color}30`, textAlign: 'center' }}>
                          <div style={{ fontSize: 28 }}>{icon}</div>
                          <div style={{ fontSize: 28, fontWeight: 900, color, margin: '4px 0' }}>{count}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color }}>{label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Alert cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loading ? (
                [...Array(5)].map((_, i) => <Skeleton key={i} h={120} />)
              ) : alertas.length ? (
                alertas.map((a, i) => <AlertaCard key={i} alerta={a} />)
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
                  No hay alertas generadas. Selecciona una entidad y actualiza los datos.
                </div>
              )}
            </div>

            {/* Anti-corruption recommendations */}
            {!loading && alertas.length > 0 && (
              <div style={{ background: '#F8FAFC', borderRadius: 14, padding: '20px 24px', marginTop: 24, border: '1px solid #E5E7EB' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#15234E' }}>
                  🛡️ Recomendaciones Anticorrupción
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {[
                    { icon: '📌', title: 'Diversificar Contratistas', desc: 'Si el top 3 concentra >50%, promover competencia y pluralidad de oferentes.' },
                    { icon: '🔍', title: 'Auditar Contratación Directa', desc: 'Modalidades directas >40% deben justificarse con causal legal específica.' },
                    { icon: '👥', title: 'Revisar Nómina Paralela', desc: 'Contratos de prestación de servicios >40% sugieren evasión de planta de personal.' },
                    { icon: '📊', title: 'Control de Adiciones', desc: 'Contratos modificados >15% deben auditarse individualmente para verificar necesidad.' },
                    { icon: '🔗', title: 'Verificar Vínculos', desc: 'Cruzar proveedores frecuentes con bases de datos de funcionarios e inhabilidades.' },
                    { icon: '📅', title: 'Análisis Temporal', desc: 'Picos de contratación en ciertos meses (diciembre, agosto) son señales de alerta.' },
                  ].map((r, i) => (
                    <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #E8ECF4' }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 18 }}>{r.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#15234E' }}>{r.title}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>{r.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB: PRESTACIÓN DE SERVICIOS DETALLADA ══════════════ */}
        {activeTab === 'prestacion_detalle' && (
          <div id="section-ps-detalle">
            {/* Botón cargar */}
            {!psDetalle && !loadingPS && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🧑‍💼</div>
                <h3 style={{ color: '#15234E', marginBottom: 8 }}>Análisis Prestación de Servicios Directa</h3>
                <p style={{ color: '#6B7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
                  Comparativo Duque vs Petro por año, personas repetidas entre entidades, contratistas activos en 2026 y top ganadores.
                </p>
                <button onClick={async () => {
                  setLoadingPS(true);
                  try {
                    const token = await currentUser.getIdToken();
                    const r = await fetch(`/api/analytics/prestacion-detalle/${entidadId}`, { headers: { Authorization: `Bearer ${token}` } });
                    const d = await r.json();
                    setPsDetalle(d);
                  } catch(e) { console.error(e); }
                  setLoadingPS(false);
                }} style={{ background: '#214E92', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  📊 Cargar Análisis
                </button>
              </div>
            )}
            {loadingPS && <div style={{ textAlign:'center', padding: 80 }}><Skeleton h={60} /><Skeleton h={60} /><Skeleton h={60} /></div>}
            {psDetalle && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* 1. Comparativo anual Duque vs Petro */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#15234E', marginBottom: 4 }}>📅 Contratos por Año — Duque vs Petro</h3>
                  <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>Último año Duque (2021-2022) y cada año de Petro. Cantidad de contratos, valores y personas únicas.</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          {['Año','Gobierno','Contratos','Valor Total','Personas Únicas','Valor Promedio'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #E8ECF4', fontWeight: 700, color: '#374151' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {psDetalle.porAnio.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: i%2===0?'#fff':'#FAFBFC' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.anio}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: r.gobierno==='Duque'?'#214E92':'#0D7C3D', color:'#fff', borderRadius:6, padding:'2px 10px', fontSize:12, fontWeight:700 }}>{r.gobierno}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>{Number(r.n_contratos).toLocaleString('es-CO')}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, color:'#15234E' }}>{COP(r.valor_total)}</td>
                            <td style={{ padding: '10px 12px' }}>{Number(r.personas_unicas).toLocaleString('es-CO')}</td>
                            <td style={{ padding: '10px 12px' }}>{COP(r.valor_promedio)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. Personas que se repiten entre entidades */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#C0392B', marginBottom: 4 }}>🔄 Personas Repetidas Entre Entidades (Petro)</h3>
                  <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>Contratistas que tienen contratos de prestación de servicios en más de una entidad del sector MinTIC durante el gobierno Petro. Alta concentración puede indicar nómina paralela coordinada.</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#FEF2F2' }}>
                          {['#','Nombre','NIT/Doc','Entidades','Contratos','Valor Total','Entidades Detalle'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #FECACA', fontWeight: 700, color: '#991B1B' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {psDetalle.repetidos.slice(0,50).map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #FEF2F2', background: i%2===0?'#fff':'#FFFBFB' }}>
                            <td style={{ padding: '10px 12px', color:'#9CA3AF' }}>{i+1}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, maxWidth:180 }}>{r.nombre}</td>
                            <td style={{ padding: '10px 12px', fontFamily:'monospace', fontSize:12, color:'#6B7280' }}>{r.documento_proveedor}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: r.n_entidades>=3?'#C0392B':'#E67E22', color:'#fff', borderRadius:6, padding:'2px 8px', fontWeight:700, fontSize:12 }}>{r.n_entidades}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>{r.n_contratos}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, color:'#C0392B' }}>{COP(r.valor_total)}</td>
                            <td style={{ padding: '10px 12px', fontSize:11, color:'#6B7280', maxWidth:200 }}>{r.entidades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>Mostrando {Math.min(50, psDetalle.repetidos.length)} de {psDetalle.repetidos.length} personas repetidas</p>
                  </div>
                </div>

                {/* 3. Contratistas Duque que continúan en 2026 */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#214E92', marginBottom: 4 }}>🔁 Contratistas Duque que Continúan en 2026</h3>
                  <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>Personas que tuvieron contratos de PS en el gobierno Duque y siguen con contratos activos en 2026. Total: <strong style={{color:'#214E92'}}>{psDetalle.continuanDuque.length} personas</strong>.</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#EBF1FB' }}>
                          {['#','Nombre','Doc','Contratos Duque','Valor en Duque','Última Firma Duque','Estado'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #BFDBFE', fontWeight: 700, color: '#1E40AF' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {psDetalle.continuanDuque.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #EFF6FF', background: i%2===0?'#fff':'#F8FAFF' }}>
                            <td style={{ padding: '10px 12px', color:'#9CA3AF' }}>{i+1}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700 }}>{r.nombre}</td>
                            <td style={{ padding: '10px 12px', fontFamily:'monospace', fontSize:12, color:'#6B7280' }}>{r.documento_proveedor}</td>
                            <td style={{ padding: '10px 12px' }}>{r.n_contratos_duque}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, color:'#214E92' }}>{COP(r.valor_duque)}</td>
                            <td style={{ padding: '10px 12px' }}>{r.ultima_firma_duque}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: '#DCFCE7', color:'#15803D', borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{r.estado_contrato || 'Activo'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Top ganadores Petro + totales */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#0D7C3D', marginBottom: 4 }}>💰 Top 50 Mayores Ganadores — Gobierno Petro</h3>
                  <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 8 }}>Personas con mayor valor acumulado en contratos de PS durante el gobierno Petro.</p>
                  {/* Totales por año */}
                  <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
                    {psDetalle.totalPetro.map((t,i) => (
                      <div key={i} style={{ background:'#E8F7EE', borderRadius:10, padding:'10px 18px', border:'1px solid #BBF7D0' }}>
                        <div style={{ fontSize:12, color:'#6B7280' }}>Año {t.anio}</div>
                        <div style={{ fontWeight:800, fontSize:15, color:'#0D7C3D' }}>{COP(t.valor_total)}</div>
                        <div style={{ fontSize:11, color:'#9CA3AF' }}>{Number(t.n_contratos).toLocaleString('es-CO')} contratos · {Number(t.personas).toLocaleString('es-CO')} personas</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F0FDF4' }}>
                          {['#','Nombre','Doc','Contratos','Valor Total','Promedio/Contrato','Años','Entidades'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #BBF7D0', fontWeight: 700, color: '#14532D' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {psDetalle.topGanadores.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #F0FDF4', background: i<3?'#FFFBEB':i%2===0?'#fff':'#F8FFF9' }}>
                            <td style={{ padding: '10px 12px', fontWeight:800, color: i<3?'#D97706':'#9CA3AF' }}>{i+1}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700 }}>{r.nombre}</td>
                            <td style={{ padding: '10px 12px', fontFamily:'monospace', fontSize:12, color:'#6B7280' }}>{r.documento_proveedor}</td>
                            <td style={{ padding: '10px 12px' }}>{r.n_contratos}</td>
                            <td style={{ padding: '10px 12px', fontWeight:800, color:'#0D7C3D' }}>{COP(r.valor_total)}</td>
                            <td style={{ padding: '10px 12px' }}>{COP(r.valor_promedio)}</td>
                            <td style={{ padding: '10px 12px', fontSize:12 }}>{r.primer_anio}–{r.ultimo_anio}</td>
                            <td style={{ padding: '10px 12px' }}>{r.n_entidades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB: DIRECTOS NO PRESTACIÓN DE SERVICIOS ══════════════ */}
        {activeTab === 'directos_nops' && (
          <div id="section-directos-nops">
            {!directosNPS && !loadingNPS && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📑</div>
                <h3 style={{ color: '#15234E', marginBottom: 8 }}>Contratos Directos — Excluye Prestación de Servicios</h3>
                <p style={{ color: '#6B7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
                  Análisis completo de contratos adjudicados por contratación directa que NO son prestación de servicios: suministros, obras, consultorías, arrendamientos, etc.
                </p>
                <button onClick={async () => {
                  setLoadingNPS(true);
                  try {
                    const token = await currentUser.getIdToken();
                    const r = await fetch(`/api/analytics/directos-no-ps/${entidadId}`, { headers: { Authorization: `Bearer ${token}` } });
                    const d = await r.json();
                    setDirectosNPS(d);
                  } catch(e) { console.error(e); }
                  setLoadingNPS(false);
                }} style={{ background: '#7B2D8B', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  📊 Cargar Análisis
                </button>
              </div>
            )}
            {loadingNPS && <div style={{ textAlign:'center', padding: 80 }}><Skeleton h={60} /><Skeleton h={60} /><Skeleton h={60} /></div>}
            {directosNPS && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* KPI Duque vs Petro */}
                {directosNPS.kpis && (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:16 }}>
                    {[
                      { label:'Contratos Duque', val: Number(directosNPS.kpis.duque_n||0).toLocaleString('es-CO'), color:'#214E92', icon:'📄' },
                      { label:'Valor Duque', val: COP(directosNPS.kpis.duque_valor), color:'#214E92', icon:'💰' },
                      { label:'Proveedores Duque', val: Number(directosNPS.kpis.duque_proveedores||0).toLocaleString('es-CO'), color:'#214E92', icon:'🏢' },
                      { label:'Contratos Petro', val: Number(directosNPS.kpis.petro_n||0).toLocaleString('es-CO'), color:'#0D7C3D', icon:'📄' },
                      { label:'Valor Petro', val: COP(directosNPS.kpis.petro_valor), color:'#0D7C3D', icon:'💰' },
                      { label:'Proveedores Petro', val: Number(directosNPS.kpis.petro_proveedores||0).toLocaleString('es-CO'), color:'#0D7C3D', icon:'🏢' },
                    ].map((k,i) => (
                      <div key={i} style={{ background:'#fff', borderRadius:12, padding:18, borderLeft:`4px solid ${k.color}`, boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
                        <div style={{ fontSize:22, marginBottom:6 }}>{k.icon}</div>
                        <div style={{ fontSize:11, color:'#9CA3AF', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{k.label}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:k.color, marginTop:4 }}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Top tipos de contrato */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#15234E', marginBottom: 16 }}>📋 Tipos de Contrato Más Usados (Directa No-PS)</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#F8FAFC' }}>
                          {['Tipo de Contrato','Gobierno','Contratos','Valor Total','Valor Promedio'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #E8ECF4', fontWeight: 700, color: '#374151' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {directosNPS.porTipo.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: i%2===0?'#fff':'#FAFBFC' }}>
                            <td style={{ padding: '10px 12px', fontWeight:600, maxWidth:250 }}>{r.tipo_de_contrato || '(Sin tipo)'}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: r.gobierno==='Duque'?'#214E92':'#0D7C3D', color:'#fff', borderRadius:6, padding:'2px 10px', fontSize:12, fontWeight:700 }}>{r.gobierno}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>{Number(r.n_contratos).toLocaleString('es-CO')}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, color:'#15234E' }}>{COP(r.valor_total)}</td>
                            <td style={{ padding: '10px 12px' }}>{COP(r.valor_promedio)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top proveedores Petro */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#7B2D8B', marginBottom: 16 }}>🏆 Top 50 Proveedores Directos No-PS — Gobierno Petro</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#FAF0FF' }}>
                          {['#','Proveedor','NIT','Tipo Principal','Contratos','Valor Total','Tipos','Entidades'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #E9D5FF', fontWeight: 700, color: '#581C87' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {directosNPS.topProveedores.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #FAF0FF', background: i<3?'#FFF7FF':i%2===0?'#fff':'#FDFAFF' }}>
                            <td style={{ padding: '10px 12px', fontWeight:800, color: i<3?'#D97706':'#9CA3AF' }}>{i+1}</td>
                            <td style={{ padding: '10px 12px', fontWeight:700, maxWidth:180 }}>{r.nombre}</td>
                            <td style={{ padding: '10px 12px', fontFamily:'monospace', fontSize:12, color:'#6B7280' }}>{r.documento_proveedor}</td>
                            <td style={{ padding: '10px 12px', fontSize:12 }}>{r.tipo_principal}</td>
                            <td style={{ padding: '10px 12px' }}>{r.n_contratos}</td>
                            <td style={{ padding: '10px 12px', fontWeight:800, color:'#7B2D8B' }}>{COP(r.valor_total)}</td>
                            <td style={{ padding: '10px 12px' }}>{r.tipos_distintos}</td>
                            <td style={{ padding: '10px 12px' }}>{r.n_entidades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top 30 contratos de mayor valor */}
                <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ color: '#C0392B', marginBottom: 16 }}>🔍 Top 30 Contratos de Mayor Valor — Directa No-PS</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#FEF2F2' }}>
                          {['Gobierno','Proveedor','Tipo','Objeto','Valor','Fecha','Estado','SECOP'].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #FECACA', fontWeight: 700, color: '#991B1B' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {directosNPS.topContratos.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #FEF2F2', background: i%2===0?'#fff':'#FFFBFB' }}>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: r.gobierno==='Duque'?'#214E92':'#0D7C3D', color:'#fff', borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:700 }}>{r.gobierno}</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight:600, maxWidth:150 }}>{r.proveedor_adjudicado}</td>
                            <td style={{ padding: '10px 12px', fontSize:12 }}>{r.tipo_de_contrato}</td>
                            <td style={{ padding: '10px 12px', fontSize:12, maxWidth:200, color:'#6B7280' }}>{(r.objeto_del_contrato||'').slice(0,80)}{(r.objeto_del_contrato||'').length>80?'…':''}</td>
                            <td style={{ padding: '10px 12px', fontWeight:800, color:'#C0392B' }}>{COP(r.valor_del_contrato)}</td>
                            <td style={{ padding: '10px 12px', fontSize:12 }}>{r.fecha_de_firma}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background:'#F0FDF4', color:'#15803D', borderRadius:6, padding:'2px 8px', fontSize:11 }}>{r.estado_contrato}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {r.url_secop && <a href={r.url_secop} target="_blank" rel="noopener noreferrer" style={{ color:'#3B82F6', fontSize:12 }}>🔗 Ver</a>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes shimmer { 0% { background-position: -400% 0; } 100% { background-position: 400% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
