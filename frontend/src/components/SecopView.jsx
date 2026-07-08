import React, { useState, useEffect, useCallback } from 'react';
import { Search, ExternalLink, RefreshCw, Download, AlertTriangle, Filter, X, Building2, Handshake, Database } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Config de entidades ─────────────────────────────────────────────────────
const ENTIDADES = [
  { id: 'mintic', nombre: 'MinTIC',  color: '#FF6900', bg: '#FFF4EC', icono: '🏛️', nit: '899999053', desc: 'Ministerio TIC' },
  { id: 'ane',    nombre: 'ANE',     color: '#214E92', bg: '#EBF1FB', icono: '📡', nit: '900334265', desc: 'Agencia Nacional del Espectro' },
  { id: 'crc',    nombre: 'CRC',     color: '#0D7C3D', bg: '#E8F7EE', icono: '⚖️', nit: '830002593', desc: 'Comisión de Regulación de Comunicaciones' },
  { id: 'and',    nombre: 'AND',     color: '#7B2D8B', bg: '#F5EBF8', icono: '💻', nit: '901144049', desc: 'Agencia Nacional Digital' },
  { id: 'futic',  nombre: 'FUTIC',   color: '#C0392B', bg: '#FDECEA', icono: '💰', nit: '8001316486', desc: 'Fondo Único TIC' },
  { id: 'rtvc',   nombre: 'RTVC',    color: '#E67E22', bg: '#FEF5EC', icono: '📺', nit: '900002583', desc: 'Sistema de Medios Públicos' },
  { id: '472',    nombre: '4-72',    color: '#16A085', bg: '#E8F8F5', icono: '📮', nit: '900062917', desc: 'Servicios Postales Nacionales' },
];

// ─── 3 Fuentes de datos ──────────────────────────────────────────────────────
const FUENTES = [
  { id: 'secop_ii_contratos', label: 'SECOP II — Contratos',  shortLabel: 'Contratos',      icono: '📄', color: '#214E92',
    desc: 'Contratos electrónicos firmados · jbjy-vk9h',
    campoProveedor: 'documento_proveedor (NIT exacto)' },
  { id: 'secop_ii_procesos',  label: 'SECOP II — Procesos',   shortLabel: 'Procesos',        icono: '📋', color: '#0D7C3D',
    desc: 'Procesos de contratación publicados · p6dx-8zbt',
    campoProveedor: 'nit_del_proveedor_adjudicado (NIT exacto)' },
  { id: 'tienda_virtual',     label: 'Tienda Virtual',         shortLabel: 'Tienda Virtual', icono: '🏪', color: '#7B2D8B',
    desc: 'Órdenes de la Tienda Virtual del Estado · rgxm-mmea',
    campoProveedor: 'proveedor (nombre LIKE)' },
];

const COP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const FMT = (d) => d ? String(d).slice(0, 10) : '—';

// ─── Panel de tabla: 1 fuente × 1 modo ──────────────────────────────────────
function ContratoPanel({ entidad, fuente, modo, currentUser }) {
  const [contratos, setContratos]       = useState([]);
  const [estadisticas, setEstadisticas] = useState(null);
  const [total, setTotal]               = useState(0);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [page, setPage]                 = useState(1);
  const [detalle, setDetalle]           = useState(null);
  const [localSearch, setLocalSearch]   = useState('');
  const [search, setSearch]             = useState('');
  const [filterTipo, setFilterTipo]     = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [showFilters, setShowFilters]   = useState(false);
  const pageSize = 100;

  // Llama a BigQuery via /api/secop/bq/:tabla/:entidadId
  const fetchData = useCallback(async (pg = 1) => {
    if (!entidad || !currentUser) return;
    setLoading(true); setError(null);
    try {
      const token  = await currentUser.getIdToken();
      const offset = (pg - 1) * pageSize;
      const params = new URLSearchParams({
        modo,
        limit:  String(pageSize),
        offset: String(offset),
      });
      if (filterTipo)   params.append('tipo',   filterTipo);
      if (filterEstado) params.append('estado', filterEstado);
      if (search)       params.append('search', search);

      const resp = await fetch(`/api/secop/bq/${fuente.id}/${entidad.id}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();

      // Normalizar campos BQ al formato que espera la UI
      const normalizados = (data.data || []).map(r => ({
        ...r,
        // contratos
        objeto:   r.objeto_del_contrato || r.descripcion_del_procedimiento || r.items || '—',
        contratista: r.proveedor_adjudicado || r.nombre_del_proveedor || r.proveedor || '—',
        nit_contratista: r.documento_proveedor || r.nit_del_proveedor_adjudicado || r.nit_proveedor || '—',
        tipo:     r.tipo_de_contrato || r.agregacion || '—',
        estado:   r.estado_contrato || r.estado_del_procedimiento || r.estado || '—',
        fecha:    r.fecha_de_firma || r.fecha_de_publicacion || r.fecha || null,
        valor:    parseFloat(r.valor_del_contrato || r.precio_base || r.total || 0),
        entidad_nombre: r.nombre_entidad || r.entidad || '—',
        url:      r.url_secop || null,
        fuente_tag: 'BigQuery 🗄️',
      }));

      setContratos(normalizados);
      setTotal(data.total || 0);
      setEstadisticas({
        total:        data.total || 0,
        valorTotal:   data.valor_total || 0,
        enEjecucion:  data.en_ejecucion || 0,
        conAdicion:   data.con_adicion || 0,
      });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [entidad, currentUser, fuente.id, modo, filterTipo, filterEstado, search]);

  useEffect(() => { setPage(1); setContratos([]); setEstadisticas(null); fetchData(1); }, [entidad, fuente.id, modo, filterTipo, filterEstado, search]);
  useEffect(() => { const t = setTimeout(() => setSearch(localSearch), 600); return () => clearTimeout(t); }, [localSearch]);

  const totalPages = Math.ceil(total / pageSize);
  const esProveedor = modo === 'proveedor';
  const hColor = esProveedor ? '#16A085' : fuente.color;

  const exportCSV = () => {
    if (!contratos.length) return;
    const cols = ['id','referencia','entidad','objeto','tipo','estado','fechaFirma','valor','contratista','_contratante'];
    const csv = [cols.join(','), ...contratos.map(c =>
      cols.map(k => { const v = String(c[k] ?? ''); return v.includes(',') ? `"${v}"` : v; }).join(',')
    )].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `SECOP_${entidad.nombre}_${fuente.shortLabel}_${modo}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const estadoBadge = (est) => {
    if (!est) return null;
    const low = est.toLowerCase();
    let bg='#E8F7EE', col='#0D7C3D';
    if (low.includes('ejecuci')) { bg='#EBF1FB'; col='#214E92'; }
    else if (low.includes('cerrad')||low.includes('liquid')||low.includes('terminad')) { bg='#F0F0F0'; col='#666'; }
    else if (low.includes('suspendid')||low.includes('cancelad')) { bg='#FDECEA'; col='#C0392B'; }
    return <span style={{ background:bg, color:col, fontSize:'0.7rem', fontWeight:700, padding:'3px 8px', borderRadius:'20px', whiteSpace:'nowrap' }}>{est}</span>;
  };

  return (
    <div style={{ background:'#FFFFFF', borderRadius:'12px', border:`1.5px solid ${hColor}30`, overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>

      {/* Cabecera */}
      <div style={{ background: esProveedor ? '#E8F8F5' : `${fuente.color}12`, borderBottom:`3px solid ${hColor}`, padding:'12px 18px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            {esProveedor ? <Handshake size={18} color={hColor}/> : <Building2 size={18} color={hColor}/>}
            <div>
              <div style={{ fontWeight:800, color:hColor, fontSize:'0.92rem' }}>
                {esProveedor ? `${entidad.icono} ${entidad.nombre} · como PROVEEDOR` : `${entidad.icono} ${entidad.nombre} · como CONTRATANTE`}
              </div>
              <div style={{ fontSize:'0.7rem', color:'#64748B', marginTop:'1px' }}>
                {esProveedor ? `Campo: ${fuente.campoProveedor}` : fuente.desc} &nbsp;·&nbsp; desde 2018-08-07
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
            <span style={{ color:'#64748B', fontSize:'0.75rem', fontWeight:600 }}>
              {loading ? '⏳' : `${(total||0).toLocaleString('es-CO')} registros`}
            </span>
            <button onClick={exportCSV} style={{ display:'flex', alignItems:'center', gap:'4px', padding:'5px 10px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', color:'#0D7C3D', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }}>
              <Download size={11}/> CSV
            </button>
            <button onClick={() => fetchData(page)} style={{ padding:'5px 8px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', cursor:'pointer' }}>
              <RefreshCw size={12} color="#64748B"/>
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      {estadisticas && (
        <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px,1fr))', background:'#F8FAFC', borderBottom:'1px solid #E8EDF3' }}>
            {(esProveedor ? [
              { label:'Total recibidos', value:(estadisticas.totalContratos||0).toLocaleString('es-CO'), color:hColor },
              { label:'Valor total $', value:COP(estadisticas.valorTotalRecibido), color:'#0D7C3D' },
              { label:'Promedio $', value:COP(estadisticas.valorPromedio), color:'#214E92' },
              { label:'Máximo $', value:COP(estadisticas.valorMaximo), color:'#C0392B' },
            ] : [
              { label:'Total contratos', value:(estadisticas.totalContratos||0).toLocaleString('es-CO'), color:hColor },
              { label:'Valor muestra $', value:COP(estadisticas.valorTotal), color:'#0D7C3D' },
              { label:'Promedio $', value:COP(estadisticas.valorPromedio), color:'#214E92' },
              { label:'En ejecución', value:estadisticas.contratosEnEjecucion, color:'#E67E22' },
              { label:'Con adición ⚠️', value:estadisticas.contratosConAdicion, color:'#C0392B' },
            ]).map((k,i) => (
              <div key={i} style={{ background:'#FFF', padding:'10px 14px', borderRight:'1px solid #F1F5F9' }}>
                <div style={{ fontWeight:800, color:k.color, fontSize:'0.95rem' }}>{k.value}</div>
                <div style={{ fontSize:'0.65rem', color:'#94A3B8', fontWeight:600, textTransform:'uppercase', marginTop:'1px' }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Top contratantes (modo proveedor) */}
          {esProveedor && estadisticas.topContratantes?.length > 0 && (
            <div style={{ padding:'10px 16px', background:'#FAFFFE', borderBottom:'1px solid #E8EDF3' }}>
              <div style={{ fontSize:'0.7rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', marginBottom:'6px' }}>🏆 Quién más los contrató</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {estadisticas.topContratantes.map((c,i) => (
                  <div key={i} style={{ background:'#E8F8F5', borderRadius:'7px', padding:'5px 10px', display:'flex', gap:'8px', alignItems:'center' }}>
                    <span style={{ fontWeight:800, color:hColor, fontSize:'0.72rem' }}>#{i+1}</span>
                    <div>
                      <div style={{ fontSize:'0.75rem', fontWeight:600, color:'#1E293B' }}>{c.nombre}</div>
                      <div style={{ fontSize:'0.67rem', color:'#64748B' }}>{c.count} · {COP(c.valor)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top tipos (modo contratante) */}
          {!esProveedor && estadisticas.topTipos?.length > 0 && (
            <div style={{ padding:'8px 16px', background:'#FAFBFF', borderBottom:'1px solid #E8EDF3' }}>
              <div style={{ fontSize:'0.7rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', marginBottom:'6px' }}>📊 Top tipos de contrato</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                {estadisticas.topTipos.map((t,i) => (
                  <span key={i} style={{ background:`${fuente.color}15`, color:fuente.color, borderRadius:'6px', padding:'3px 9px', fontSize:'0.72rem', fontWeight:600 }}>
                    {t.tipo} ({t.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Búsqueda */}
      <div style={{ padding:'8px 14px', borderBottom:'1px solid #E8EDF3', display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', background:'#FAFBFC' }}>
        <div style={{ position:'relative', flex:1, minWidth:'160px' }}>
          <Search size={12} color="#94A3B8" style={{ position:'absolute', left:'9px', top:'50%', transform:'translateY(-50%)' }}/>
          <input type="text" placeholder="Buscar..." value={localSearch} onChange={e => setLocalSearch(e.target.value)}
            style={{ width:'100%', paddingLeft:'28px', padding:'6px 8px 6px 28px', border:'1.5px solid #E0E6ED', borderRadius:'6px', fontSize:'0.8rem', background:'#FFF', boxSizing:'border-box' }}/>
        </div>
        <button onClick={() => setShowFilters(f=>!f)} style={{ padding:'6px 10px', borderRadius:'6px', border:`1.5px solid ${showFilters?hColor:'#E0E6ED'}`, background:showFilters?`${hColor}15`:'#FFF', color:hColor, fontWeight:600, cursor:'pointer', fontSize:'0.75rem', display:'flex', alignItems:'center', gap:'4px' }}>
          <Filter size={11}/> Filtros
        </button>
        {(filterTipo||filterEstado||localSearch) && (
          <button onClick={()=>{setFilterTipo('');setFilterEstado('');setLocalSearch('');}} style={{ padding:'6px 8px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', cursor:'pointer', color:'#C0392B', fontSize:'0.72rem', fontWeight:600, display:'flex', alignItems:'center', gap:'3px' }}>
            <X size={10}/> Limpiar
          </button>
        )}
      </div>

      {showFilters && (
        <div style={{ padding:'8px 14px', borderBottom:'1px solid #E8EDF3', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'7px', background:'#F8FAFC' }}>
          {[{ label:'Tipo contrato', v:filterTipo, set:setFilterTipo, opts:['Prestación de servicios','Suministros','Compraventa','Obra','Consultoría','Interadministrativo'] },
            { label:'Estado', v:filterEstado, set:setFilterEstado, opts:['En ejecución','Cerrado','Aprobado','Liquidado','Terminado','Seleccionado','Issued'] }
          ].map(f => (
            <div key={f.label}>
              <label style={{ fontSize:'0.65rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'2px' }}>{f.label}</label>
              <select value={f.v} onChange={e=>f.set(e.target.value)} style={{ width:'100%', padding:'6px 7px', borderRadius:'5px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem' }}>
                <option value="">— Todos —</option>
                {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ margin:'10px 14px', background:'#FDECEA', border:'1px solid #F5C6C0', borderRadius:'7px', padding:'9px 12px', display:'flex', gap:'7px', alignItems:'center' }}>
          <AlertTriangle size={13} color="#C0392B"/>
          <span style={{ color:'#C0392B', fontSize:'0.8rem' }}>{error}</span>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div style={{ padding:'36px', textAlign:'center', color:'#64748B', fontSize:'0.88rem' }}>⏳ Consultando {fuente.label} en tiempo real...</div>
      ) : contratos.length === 0 ? (
        <div style={{ padding:'36px', textAlign:'center' }}>
          <div style={{ fontSize:'1.8rem', marginBottom:'6px' }}>📭</div>
          <p style={{ color:'#64748B', fontSize:'0.85rem' }}>
            {esProveedor ? `Sin registros donde ${entidad.nombre} sea proveedor en ${fuente.shortLabel}.` : `Sin contratos con los filtros aplicados.`}
          </p>
        </div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.79rem' }}>
            <thead>
              <tr style={{ background:'#F8FAFC', borderBottom:'1px solid #E8EDF3' }}>
                {(esProveedor
                  ? ['N°/ID','Entidad Contratante 🏢','Objeto','Tipo','Estado','Fecha','Valor COP','Fuente']
                  : ['N°/ID','Objeto','Contratista / Proveedor','Tipo','Estado','Fecha','Valor COP','Fuente']
                ).map(h => <th key={h} style={{ padding:'8px 11px', textAlign:'left', fontWeight:700, color:'#475569', textTransform:'uppercase', fontSize:'0.63rem', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {contratos.map((c, idx) => (
                <tr key={c.id+idx}
                  onClick={() => setDetalle(detalle?.id===c.id ? null : c)}
                  style={{ borderBottom:'1px solid #F1F5F9', background:detalle?.id===c.id?(esProveedor?'#E8F8F5':entidad.bg):(idx%2===0?'#FFF':'#FAFBFC'), cursor:'pointer', transition:'background 0.1s' }}
                  onMouseEnter={e=>{ if(detalle?.id!==c.id) e.currentTarget.style.background='#F0F7FF'; }}
                  onMouseLeave={e=>{ if(detalle?.id!==c.id) e.currentTarget.style.background=idx%2===0?'#FFF':'#FAFBFC'; }}>
                  <td style={{ padding:'8px 11px', fontWeight:700, color:hColor, whiteSpace:'nowrap' }}>
                    {(c.referencia||c.id||'—').slice(0,22)}
                    {c.diasAdicionados>0 && <span title="Adicionado" style={{ marginLeft:'3px', fontSize:'0.65rem', color:'#E67E22' }}>⚠️</span>}
                  </td>
                  {esProveedor ? (
                    <td style={{ padding:'8px 11px', maxWidth:'200px' }}>
                      <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#214E92', fontWeight:600 }} title={c._contratante}>{c._contratante||'—'}</div>
                      {c._nitContratante && <div style={{ fontSize:'0.65rem', color:'#94A3B8' }}>NIT {c._nitContratante}</div>}
                    </td>
                  ) : null}
                  <td style={{ padding:'8px 11px', maxWidth:'240px' }}>
                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c.objeto}>{c.objeto||'—'}</div>
                  </td>
                  {!esProveedor && (
                    <td style={{ padding:'8px 11px', maxWidth:'150px' }}>
                      <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#475569', fontSize:'0.75rem' }} title={c.contratista}>{c.contratista||'—'}</div>
                      {c.docContratista && <div style={{ fontSize:'0.65rem', color:'#94A3B8' }}>{c.docContratista}</div>}
                    </td>
                  )}
                  <td style={{ padding:'8px 11px', whiteSpace:'nowrap', color:'#475569', fontSize:'0.73rem' }}>{c.tipo||c.modalidad||'—'}</td>
                  <td style={{ padding:'8px 11px' }}>{estadoBadge(c.estado)}</td>
                  <td style={{ padding:'8px 11px', whiteSpace:'nowrap', color:'#64748B' }}>{FMT(c.fechaFirma)}</td>
                  <td style={{ padding:'8px 11px', whiteSpace:'nowrap', fontWeight:700, color:c.valor>1000000000?'#C0392B':'#0D7C3D' }}>{COP(c.valor)}</td>
                  <td style={{ padding:'8px 11px' }}>
                    {c.urlSecop ? (
                      <a href={c.urlSecop} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ color:'#214E92', display:'inline-flex', alignItems:'center', gap:'3px', fontWeight:600, fontSize:'0.72rem' }}>
                        Ver <ExternalLink size={9}/>
                      </a>
                    ) : <span style={{ color:'#94A3B8', fontSize:'0.7rem' }}>{fuente.icono}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {!loading && total > pageSize && (
        <div style={{ padding:'8px 14px', borderTop:'1px solid #E8EDF3', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'5px', background:'#FAFBFC' }}>
          <span style={{ fontSize:'0.75rem', color:'#64748B' }}>Pág <strong>{page}</strong>/{Math.ceil(total/pageSize)} · {total.toLocaleString('es-CO')} total</span>
          <div style={{ display:'flex', gap:'5px' }}>
            {[{l:'← Ant', d:page===1, fn:()=>{setPage(p=>p-1);fetchData(page-1);}},
              {l:'Sig →', d:page>=totalPages, fn:()=>{setPage(p=>p+1);fetchData(page+1);}}
            ].map(b => (
              <button key={b.l} disabled={b.d} onClick={b.fn} style={{ padding:'5px 12px', borderRadius:'6px', border:'1px solid #E0E6ED', background:b.d?'#F8FAFC':'#FFF', color:b.d?'#CBD5E1':hColor, cursor:b.d?'not-allowed':'pointer', fontWeight:600, fontSize:'0.75rem' }}>{b.l}</button>
            ))}
          </div>
        </div>
      )}

      {/* Detalle expandido */}
      {detalle && (
        <div style={{ padding:'18px', background: esProveedor?'#F0FDFA':entidad.bg, borderTop:`2px solid ${hColor}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'12px' }}>
            <div>
              <div style={{ fontSize:'0.65rem', fontWeight:700, color:hColor, textTransform:'uppercase' }}>Detalle · {fuente.shortLabel}</div>
              <h3 style={{ margin:'3px 0', fontSize:'0.95rem', fontWeight:800, color:'#1E293B' }}>{detalle.referencia||detalle.id}</h3>
            </div>
            <button onClick={()=>setDetalle(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}><X size={16}/></button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'10px' }}>
            {[
              { label:'📄 Objeto', value:detalle.objeto, full:true },
              esProveedor&&{ label:'🏢 Contratante', value:`${detalle._contratante} · NIT ${detalle._nitContratante}` },
              !esProveedor&&{ label:'🤝 Contratista', value:`${detalle.contratista} · ${detalle.docContratista}` },
              { label:'📋 Tipo / Modalidad', value:`${detalle.tipo||''} / ${detalle.modalidad||''}` },
              { label:'📅 Firma → Fin', value:`${FMT(detalle.fechaFirma)} → ${FMT(detalle.fechaFin)}` },
              { label:'⏱ Duración', value:detalle.duracion },
              { label:'💰 Valor', value:COP(detalle.valor) },
              { label:'✅ Pagado', value:COP(detalle.valorPagado) },
              !esProveedor&&{ label:'🔍 Supervisor', value:detalle.supervisor },
              { label:'📍 Ciudad', value:`${detalle.departamento||''} / ${detalle.ciudad||''}` },
              detalle.diasAdicionados>0&&{ label:'⚠️ Días adicionados', value:`${detalle.diasAdicionados} días` },
              detalle.adjudicado&&{ label:'✔ Adjudicado', value:detalle.adjudicado },
              detalle.año&&{ label:'📆 Año', value:detalle.año },
            ].filter(Boolean).filter(r=>r&&r.value&&r.value.trim&&r.value.trim()!==''&&r.value!=='/ ').map((row,i)=>(
              <div key={i} style={{ gridColumn:row.full?'1/-1':undefined }}>
                <div style={{ fontSize:'0.65rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', marginBottom:'2px' }}>{row.label}</div>
                <div style={{ fontSize:'0.82rem', color:'#1E293B', lineHeight:1.5 }}>{row.value}</div>
              </div>
            ))}
          </div>
          {detalle.urlSecop && (
            <div style={{ marginTop:'12px' }}>
              <a href={detalle.urlSecop} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'7px 14px', borderRadius:'6px', background:hColor, color:'#FFF', fontWeight:700, fontSize:'0.8rem', textDecoration:'none' }}>
                <ExternalLink size={12}/> Ver en SECOP
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function SecopView() {
  const { currentUser } = useAuth();
  const [entidadActiva, setEntidadActiva] = useState(null);
  const [fuenteActiva, setFuenteActiva]   = useState(FUENTES[0]);
  const [resumen, setResumen]             = useState(null);

  // Cargar resumen de conteos al seleccionar entidad
  useEffect(() => {
    if (!entidadActiva || !currentUser) return;
    currentUser.getIdToken().then(token => {
      fetch(`/api/secop/bq/resumen/${entidadActiva.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setResumen(data); })
        .catch(() => {});
    });
  }, [entidadActiva, currentUser]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'18px', minHeight:'100%' }}>

      {/* Título */}
      <div>
        <h2 style={{ fontSize:'1.35rem', fontWeight:800, color:'var(--text-main)', margin:0 }}>
          📋 Contratación Pública MinTic — SECOP
        </h2>
        <p style={{ color:'var(--text-secondary)', fontSize:'0.82rem', margin:'4px 0 0' }}>
          3 fuentes de datos · desde <strong>2018-08-07</strong> · Contratante + Proveedor simultáneamente · <span style={{ background:'#EBF1FB', color:'#214E92', borderRadius:'5px', padding:'1px 7px', fontWeight:700, fontSize:'0.75rem' }}>🗄️ Datos desde BigQuery</span>
        </p>
      </div>


      {/* Entidades */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
        {ENTIDADES.map(ent => {
          const activo = entidadActiva?.id === ent.id;
          return (
            <button key={ent.id} onClick={() => { setEntidadActiva(ent); setResumen(null); }} title={ent.desc}
              style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 18px', borderRadius:'50px',
                border:`2px solid ${activo?ent.color:'#E0E6ED'}`, background:activo?ent.color:'#FFF',
                color:activo?'#FFF':ent.color, fontWeight:700, fontSize:'0.85rem', cursor:'pointer',
                transition:'all 0.2s', boxShadow:activo?`0 4px 14px ${ent.color}40`:'none',
                transform:activo?'translateY(-2px)':'none' }}>
              <span>{ent.icono}</span> {ent.nombre}
            </button>
          );
        })}
      </div>

      {!entidadActiva ? (
        <div style={{ background:'#F8FAFC', border:'2px dashed #E0E6ED', borderRadius:'14px', padding:'56px 28px', textAlign:'center' }}>
          <div style={{ fontSize:'2.5rem', marginBottom:'12px' }}>🏛️</div>
          <h3 style={{ color:'var(--text-main)', fontWeight:700, marginBottom:'6px' }}>Selecciona una entidad</h3>
          <p style={{ color:'var(--text-secondary)', fontSize:'0.85rem', maxWidth:'420px', margin:'0 auto' }}>
            Verás simultáneamente los registros de las <strong>3 fuentes SECOP</strong> en doble rol: <strong>Contratante</strong> (lo que la entidad publica/adjudica) y <strong>Proveedor</strong> (lo que la entidad recibe de otras entidades del Estado).
          </p>
        </div>
      ) : (
        <>
          {/* Selector de fuente + conteos */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', alignItems:'stretch' }}>
            {FUENTES.map(f => {
              const activa = fuenteActiva.id === f.id;
              const cnt = resumen?.[f.id];
              return (
                <button key={f.id} onClick={() => setFuenteActiva(f)}
                  style={{ display:'flex', flexDirection:'column', gap:'4px', padding:'12px 18px', borderRadius:'12px',
                    border:`2px solid ${activa?f.color:'#E0E6ED'}`, background:activa?`${f.color}10`:'#FFF',
                    cursor:'pointer', transition:'all 0.18s', textAlign:'left',
                    boxShadow:activa?`0 3px 12px ${f.color}25`:'none', minWidth:'180px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                    <Database size={14} color={activa?f.color:'#94A3B8'}/>
                    <span style={{ fontWeight:700, fontSize:'0.82rem', color:activa?f.color:'#475569' }}>{f.icono} {f.shortLabel}</span>
                  </div>
                  {cnt && (
                    <div style={{ display:'flex', gap:'12px', marginTop:'2px' }}>
                      <span style={{ fontSize:'0.7rem', color:'#64748B' }}>
                        <Building2 size={9} style={{ marginRight:'3px', verticalAlign:'middle' }}/>
                        <strong style={{ color:f.color }}>{cnt.contratante?.toLocaleString('es-CO')}</strong> contratante
                      </span>
                      <span style={{ fontSize:'0.7rem', color:'#64748B' }}>
                        <Handshake size={9} style={{ marginRight:'3px', verticalAlign:'middle' }}/>
                        <strong style={{ color:'#16A085' }}>{cnt.proveedor?.toLocaleString('es-CO')}</strong> proveedor
                      </span>
                    </div>
                  )}
                  <div style={{ fontSize:'0.65rem', color:'#94A3B8', marginTop:'1px' }}>{f.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Leyenda doble rol */}
          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'7px', background:entidadActiva.bg, border:`1px solid ${entidadActiva.color}30`, borderRadius:'7px', padding:'7px 12px' }}>
              <Building2 size={13} color={entidadActiva.color}/>
              <span style={{ fontSize:'0.78rem', color:entidadActiva.color, fontWeight:700 }}>Como Contratante:</span>
              <span style={{ fontSize:'0.76rem', color:'#475569' }}>contratos que <strong>{entidadActiva.nombre}</strong> publica y adjudica</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'7px', background:'#E8F8F5', border:'1px solid #16A08530', borderRadius:'7px', padding:'7px 12px' }}>
              <Handshake size={13} color="#16A085"/>
              <span style={{ fontSize:'0.78rem', color:'#16A085', fontWeight:700 }}>Como Proveedor:</span>
              <span style={{ fontSize:'0.76rem', color:'#475569' }}><strong>{entidadActiva.nombre}</strong> recibe contratos · NIT {entidadActiva.nit}</span>
            </div>
          </div>

          {/* DOS PANELES — misma fuente, distinto modo */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'18px' }}>
            <ContratoPanel key={`${entidadActiva.id}-${fuenteActiva.id}-contratante`}
              entidad={entidadActiva} fuente={fuenteActiva} modo="contratante" currentUser={currentUser}/>
            <ContratoPanel key={`${entidadActiva.id}-${fuenteActiva.id}-proveedor`}
              entidad={entidadActiva} fuente={fuenteActiva} modo="proveedor" currentUser={currentUser}/>
          </div>
        </>
      )}
    </div>
  );
}
