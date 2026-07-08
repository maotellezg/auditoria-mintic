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

const FUENTES = [
  { id: 'secop_ii_contratos', label: 'SECOP II — Contratos',  shortLabel: 'Contratos',     icono: '📄', color: '#214E92', desc: 'Contratos electrónicos firmados · jbjy-vk9h' },
  { id: 'secop_ii_procesos',  label: 'SECOP II — Procesos',   shortLabel: 'Procesos',       icono: '📋', color: '#0D7C3D', desc: 'Procesos de contratación publicados · p6dx-8zbt' },
  { id: 'tienda_virtual',     label: 'Tienda Virtual',        shortLabel: 'Tienda Virtual', icono: '🏪', color: '#7B2D8B', desc: 'Órdenes de la Tienda Virtual del Estado · rgxm-mmea' },
];

const COP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const FMT = (d) => d ? String(d).slice(0, 10) : '—';

// ─── Etiquetas legibles para campos BQ ──────────────────────────────────────
const FIELD_LABELS = {
  id_contrato:'ID Contrato', referencia_del_contrato:'Referencia', proceso_de_compra:'Proceso de Compra',
  nombre_entidad:'Entidad', nit_entidad:'NIT Entidad', objeto_del_contrato:'Objeto del Contrato',
  tipo_de_contrato:'Tipo de Contrato', modalidad_de_contratacion:'Modalidad', estado_contrato:'Estado',
  fecha_de_firma:'Fecha de Firma', fecha_inicio:'Fecha Inicio', fecha_fin:'Fecha Fin',
  valor_del_contrato:'Valor Contrato', valor_pagado:'Valor Pagado', valor_pendiente:'Valor Pendiente',
  proveedor_adjudicado:'Proveedor/Contratista', documento_proveedor:'Doc. Proveedor',
  tipo_doc_proveedor:'Tipo Doc.', nombre_supervisor:'Supervisor', nombre_ordenador:'Ordenador del Gasto',
  representante_legal:'Representante Legal', departamento:'Departamento', ciudad:'Ciudad',
  duracion:'Duración', es_pyme:'Es PyME', dias_adicionados:'Días Adicionados', url_secop:'Enlace SECOP',
  id_del_proceso:'ID Proceso', referencia_del_proceso:'Referencia', ppi:'PPI',
  entidad:'Entidad', descripcion_del_procedimiento:'Descripción', estado_del_procedimiento:'Estado',
  fecha_de_publicacion:'Fecha Publicación', fecha_ultima_publicacion:'Última Publicación',
  precio_base:'Precio Base', valor_total_adjudicacion:'Valor Adjudicación',
  nombre_del_proveedor:'Proveedor Adjudicado', nit_del_proveedor_adjudicado:'NIT Proveedor',
  nombre_del_adjudicador:'Adjudicador', departamento_entidad:'Departamento', ciudad_entidad:'Ciudad',
  adjudicado:'Adjudicado', proveedores_invitados:'Proveedores Invitados',
  identificador_de_la_orden:'ID Orden', solicitud:'Solicitud', a_o:'Año',
  solicitante:'Solicitante', proveedor:'Proveedor', nit_proveedor:'NIT Proveedor',
  items:'Ítems', agregacion:'Tipo Agregación', estado:'Estado', fecha:'Fecha',
  fecha_vence:'Fecha Vence', total:'Total', actividad_economica_proveedor:'Actividad Económica',
  entidades_mintic_str:'Entidades MinTic', roles_mintic_str:'Roles',
};

// ─── Panel único con toggle Contratante / Proveedor ─────────────────────────
function ContratoPanel({ entidad, fuente, currentUser }) {
  const [modo, setModo]                   = useState('contratante');
  const [contratos, setContratos]         = useState([]);
  const [estadisticas, setEstadisticas]   = useState(null);
  const [total, setTotal]                 = useState(0);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [page, setPage]                   = useState(1);
  const [detalleIdx, setDetalleIdx]       = useState(null);
  const [localSearch, setLocalSearch]     = useState('');
  const [search, setSearch]               = useState('');
  // Filtros genéricos
  const [filterTipo, setFilterTipo]       = useState('');
  const [filterModalidad, setFilterModalidad] = useState('');
  const [filterEstado, setFilterEstado]   = useState('');
  // Filtros específicos Contratos/Procesos
  const [filterProveedor, setFilterProveedor]   = useState('');
  const [filterDocProv, setFilterDocProv]       = useState('');
  const [showFilters, setShowFilters]     = useState(false);
  const pageSize = 100;

  // Reset filtros al cambiar fuente
  const resetFilters = () => {
    setFilterTipo(''); setFilterModalidad(''); setFilterEstado('');
    setFilterProveedor(''); setFilterDocProv(''); setLocalSearch('');
  };


  const fetchData = useCallback(async (pg = 1) => {
    if (!entidad || !currentUser) return;
    setLoading(true); setError(null);
    try {
      const token  = await currentUser.getIdToken();
      const offset = (pg - 1) * pageSize;
      const params = new URLSearchParams({ modo, limit: String(pageSize), offset: String(offset) });
      if (search)           params.append('search',           search);
      if (filterTipo)       params.append('tipo',             filterTipo);
      if (filterModalidad)  params.append('modalidad',        filterModalidad);
      if (filterEstado)     params.append('estado',           filterEstado);
      if (filterProveedor)  params.append('proveedor_nombre', filterProveedor);
      if (filterDocProv)    params.append('doc_proveedor',    filterDocProv);

      const resp = await fetch(`/api/secop/bq/${fuente.id}/${entidad.id}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Error ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();

      const normalizados = (data.data || []).map(r => ({
        ...r,
        _objeto:   r.objeto_del_contrato || r.descripcion_del_procedimiento || r.items || '—',
        _contratista: r.proveedor_adjudicado || r.nombre_del_proveedor || r.proveedor || '—',
        _nit_contratista: r.documento_proveedor || r.nit_del_proveedor_adjudicado || r.nit_proveedor || '—',
        _tipo:     r.tipo_de_contrato || r.agregacion || '—',
        _estado:   r.estado_contrato || r.estado_del_procedimiento || r.estado || '—',
        _fecha:    r.fecha_de_firma || r.fecha_de_publicacion || r.fecha || null,
        _valor:    parseFloat(r.valor_del_contrato || r.precio_base || r.total || 0),
        _entidad:  r.nombre_entidad || r.entidad || '—',
        _ref:      r.referencia_del_contrato || r.referencia_del_proceso || r.identificador_de_la_orden || r.id_contrato || r.id_del_proceso || '—',
        _url:      r.url_secop || null,
      }));

      setContratos(normalizados);
      setTotal(data.total || 0);
      setEstadisticas({ total: data.total||0, valorTotal: data.valor_total||0, enEjecucion: data.en_ejecucion||0, conAdicion: data.con_adicion||0 });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [entidad, currentUser, fuente.id, modo, filterTipo, filterModalidad, filterEstado, filterProveedor, filterDocProv, search]);

  useEffect(() => { setPage(1); setContratos([]); setEstadisticas(null); setDetalleIdx(null); fetchData(1); },
    [entidad, fuente.id, modo, filterTipo, filterModalidad, filterEstado, filterProveedor, filterDocProv, search]);
  useEffect(() => { const t = setTimeout(() => setSearch(localSearch), 600); return () => clearTimeout(t); }, [localSearch]);


  const totalPages = Math.ceil(total / pageSize);
  const esProveedor = modo === 'proveedor';
  const hColor = esProveedor ? '#16A085' : fuente.color;

  const exportCSV = () => {
    if (!contratos.length) return;
    const keys = Object.keys(contratos[0]).filter(k => !k.startsWith('_'));
    const csv = [keys.join(','), ...contratos.map(c =>
      keys.map(k => { const v = String(c[k] ?? ''); return v.includes(',') ? `"${v}"` : v; }).join(',')
    )].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff'+csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `SECOP_BQ_${entidad.nombre}_${fuente.shortLabel}_${modo}_${new Date().toISOString().slice(0,10)}.csv`;
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

      {/* Cabecera con toggle */}
      <div style={{ background:`${fuente.color}10`, borderBottom:`3px solid ${hColor}`, padding:'12px 18px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          {/* Toggle */}
          <div style={{ display:'flex', background:'#F1F5F9', borderRadius:'10px', padding:'3px', gap:'2px' }}>
            {[
              { v:'contratante', label:'🏛️ Como Contratante', color:'#214E92' },
              { v:'proveedor',   label:'🤝 Como Proveedor',   color:'#16A085' },
            ].map(m => (
              <button key={m.v} onClick={() => { setModo(m.v); setPage(1); setDetalleIdx(null); }}
                style={{ padding:'7px 18px', borderRadius:'8px', border:'none', fontWeight:700, fontSize:'0.82rem', cursor:'pointer', transition:'all 0.2s',
                  background: modo===m.v ? m.color : 'transparent',
                  color: modo===m.v ? '#FFF' : '#64748B',
                  boxShadow: modo===m.v ? `0 2px 8px ${m.color}50` : 'none',
                }}>
                {m.label}
              </button>
            ))}
          </div>

          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
            <span style={{ color:'#64748B', fontSize:'0.75rem', fontWeight:600 }}>
              {loading ? '⏳ Consultando BQ...' : `${(total||0).toLocaleString('es-CO')} registros`}
            </span>
            <button onClick={exportCSV} style={{ display:'flex', alignItems:'center', gap:'4px', padding:'5px 10px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', color:'#0D7C3D', cursor:'pointer', fontSize:'0.75rem', fontWeight:600 }}>
              <Download size={11}/> CSV
            </button>
            <button onClick={() => fetchData(page)} style={{ padding:'5px 8px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', cursor:'pointer' }}>
              <RefreshCw size={12} color="#64748B"/>
            </button>
          </div>
        </div>
        <div style={{ fontSize:'0.7rem', color:'#64748B', marginTop:'6px' }}>
          {fuente.desc} · NIT {entidad.nit} · desde 2018-08-07 · 🗄️ BigQuery
        </div>
      </div>

      {/* KPIs */}
      {estadisticas && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px,1fr))', background:'#F8FAFC', borderBottom:'1px solid #E8EDF3' }}>
          {[
            { label:'Total registros', value:(estadisticas.total||0).toLocaleString('es-CO'), color:hColor },
            { label:'Valor total $',   value:COP(estadisticas.valorTotal),                   color:'#0D7C3D' },
            { label:'En ejecución',    value:(estadisticas.enEjecucion||0).toLocaleString('es-CO'), color:'#214E92' },
            { label:'Con adición ⚠️',  value:(estadisticas.conAdicion||0).toLocaleString('es-CO'),  color:'#C0392B' },
          ].map((k,i) => (
            <div key={i} style={{ background:'#FFF', padding:'10px 14px', borderRight:'1px solid #F1F5F9' }}>
              <div style={{ fontWeight:800, color:k.color, fontSize:'0.95rem' }}>{k.value}</div>
              <div style={{ fontSize:'0.65rem', color:'#94A3B8', fontWeight:600, textTransform:'uppercase', marginTop:'1px' }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Búsqueda + Filtros */}
      <div style={{ padding:'8px 14px', borderBottom:'1px solid #E8EDF3', display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', background:'#FAFBFC' }}>
        <div style={{ position:'relative', flex:1, minWidth:'160px' }}>
          <Search size={12} color="#94A3B8" style={{ position:'absolute', left:'9px', top:'50%', transform:'translateY(-50%)' }}/>
          <input type="text" placeholder="Buscar en todos los campos..." value={localSearch} onChange={e => setLocalSearch(e.target.value)}
            style={{ width:'100%', paddingLeft:'28px', padding:'6px 8px 6px 28px', border:'1.5px solid #E0E6ED', borderRadius:'6px', fontSize:'0.8rem', background:'#FFF', boxSizing:'border-box' }}/>
        </div>
        <button onClick={() => setShowFilters(f=>!f)} style={{ padding:'6px 10px', borderRadius:'6px', border:`1.5px solid ${showFilters?hColor:'#E0E6ED'}`, background:showFilters?`${hColor}15`:'#FFF', color:hColor, fontWeight:600, cursor:'pointer', fontSize:'0.75rem', display:'flex', alignItems:'center', gap:'4px' }}>
          <Filter size={11}/> Filtros {(filterTipo||filterModalidad||filterEstado||filterProveedor||filterDocProv) && <span style={{ background:hColor, color:'#FFF', borderRadius:'50%', width:'14px', height:'14px', fontSize:'0.6rem', display:'inline-flex', alignItems:'center', justifyContent:'center', marginLeft:'2px' }}>✓</span>}
        </button>
        {(filterTipo||filterModalidad||filterEstado||filterProveedor||filterDocProv||localSearch) && (
          <button onClick={()=>{ resetFilters(); }} style={{ padding:'6px 8px', borderRadius:'6px', border:'1px solid #E0E6ED', background:'#FFF', cursor:'pointer', color:'#C0392B', fontSize:'0.72rem', fontWeight:600, display:'flex', alignItems:'center', gap:'3px' }}>
            <X size={10}/> Limpiar todo
          </button>
        )}
      </div>

      {showFilters && (
        <div style={{ padding:'10px 14px', borderBottom:'1px solid #E8EDF3', background:'#F8FAFC' }}>
          {fuente.id === 'tienda_virtual' ? (
            // Tienda Virtual: solo Tipo y Estado
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'7px' }}>
              {[{ label:'Tipo / Agregación', v:filterTipo, set:setFilterTipo, opts:['Acuerdo Marco de Precio','Subasta Inversa','Mínima Cuantía'] },
                { label:'Estado', v:filterEstado, set:setFilterEstado, opts:['Aprobada','Cancelada','En trámite','Recibida','Vigente'] }
              ].map(f => (
                <div key={f.label}>
                  <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>{f.label}</label>
                  <select value={f.v} onChange={e=>f.set(e.target.value)} style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem' }}>
                    <option value="">— Todos —</option>
                    {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            // Contratos y Procesos: 5 filtros
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(185px,1fr))', gap:'8px' }}>

              {/* Tipo de Contrato */}
              <div>
                <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>Tipo de Contrato</label>
                <select value={filterTipo} onChange={e=>setFilterTipo(e.target.value)} style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem' }}>
                  <option value="">— Todos —</option>
                  {['Prestación de servicios','Suministros','Compraventa','Obra','Consultoría','Interadministrativo','Acuerdo Marco','Arrendamiento','Concesión','Asociación','Apoyo a la gestión'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Modalidad */}
              <div>
                <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>Modalidad</label>
                <select value={filterModalidad} onChange={e=>setFilterModalidad(e.target.value)} style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem' }}>
                  <option value="">— Todas —</option>
                  {['Contratación directa','Mínima cuantía','Licitación pública','Selección abreviada','Concurso de méritos','Asociación público privada','Régimen especial','Contratación de mínima cuantía'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Estado */}
              <div>
                <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>Estado</label>
                <select value={filterEstado} onChange={e=>setFilterEstado(e.target.value)} style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem' }}>
                  <option value="">— Todos —</option>
                  {['En ejecución','Cerrado','Aprobado','Liquidado','Terminado','Seleccionado','Issued','Presentation of offer','Cancelled','Suspendido'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              {/* Proveedor / Contratista — texto libre */}
              <div>
                <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>Proveedor / Contratista</label>
                <input type="text" placeholder="Nombre del proveedor..." value={filterProveedor} onChange={e=>setFilterProveedor(e.target.value)}
                  style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem', boxSizing:'border-box' }}/>
              </div>

              {/* Doc. Proveedor — texto libre */}
              <div>
                <label style={{ fontSize:'0.63rem', fontWeight:700, color:'#64748B', textTransform:'uppercase', display:'block', marginBottom:'3px' }}>Doc. Proveedor (NIT/Cédula)</label>
                <input type="text" placeholder="NIT o cédula..." value={filterDocProv} onChange={e=>setFilterDocProv(e.target.value)}
                  style={{ width:'100%', padding:'6px 8px', borderRadius:'6px', border:'1.5px solid #E0E6ED', background:'#FFF', fontSize:'0.8rem', boxSizing:'border-box' }}/>
              </div>

            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ margin:'10px 14px', background:'#FDECEA', border:'1px solid #F5C6C0', borderRadius:'7px', padding:'9px 12px', display:'flex', gap:'7px', alignItems:'center' }}>
          <AlertTriangle size={13} color="#C0392B"/>
          <span style={{ color:'#C0392B', fontSize:'0.8rem' }}>{error}</span>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div style={{ padding:'36px', textAlign:'center', color:'#64748B', fontSize:'0.88rem' }}>⏳ Consultando BigQuery...</div>
      ) : contratos.length === 0 ? (
        <div style={{ padding:'36px', textAlign:'center' }}>
          <div style={{ fontSize:'1.8rem', marginBottom:'6px' }}>📭</div>
          <p style={{ color:'#64748B', fontSize:'0.85rem' }}>
            Sin registros en BigQuery para <strong>{entidad.nombre}</strong> como <strong>{modo}</strong> en {fuente.shortLabel}.
            <br/><span style={{ fontSize:'0.78rem', color:'#94A3B8' }}>Ejecuta la carga completa en 🗄️ BigQuery SECOP primero.</span>
          </p>
        </div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.79rem' }}>
            <thead>
              <tr style={{ background:'#F8FAFC', borderBottom:'1px solid #E8EDF3' }}>
                {['Referencia / ID', esProveedor?'Entidad Contratante':'Proveedor / Contratista', 'Objeto', 'Tipo', 'Estado', 'Fecha', 'Valor COP', 'Detalle'].map(h =>
                  <th key={h} style={{ padding:'8px 11px', textAlign:'left', fontWeight:700, color:'#475569', textTransform:'uppercase', fontSize:'0.63rem', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {contratos.map((c, idx) => {
                const abierto = detalleIdx === idx;
                return (
                  <React.Fragment key={idx}>
                    <tr
                      onClick={() => setDetalleIdx(abierto ? null : idx)}
                      style={{ borderBottom:'1px solid #F1F5F9', background: abierto?`${hColor}12`:(idx%2===0?'#FFF':'#FAFBFC'), cursor:'pointer', transition:'background 0.1s' }}
                      onMouseEnter={e=>{ if(!abierto) e.currentTarget.style.background='#F0F7FF'; }}
                      onMouseLeave={e=>{ if(!abierto) e.currentTarget.style.background=idx%2===0?'#FFF':'#FAFBFC'; }}>
                      <td style={{ padding:'8px 11px', fontWeight:700, color:hColor, whiteSpace:'nowrap' }}>
                        {String(c._ref||'—').slice(0,22)}
                      </td>
                      <td style={{ padding:'8px 11px', maxWidth:'180px' }}>
                        <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:esProveedor?'#214E92':'#475569', fontWeight:esProveedor?600:400, fontSize:'0.75rem' }}
                          title={esProveedor?c._entidad:c._contratista}>
                          {esProveedor ? c._entidad : c._contratista}
                        </div>
                        <div style={{ fontSize:'0.65rem', color:'#94A3B8' }}>
                          {esProveedor ? (c.nit_entidad||'') : c._nit_contratista}
                        </div>
                      </td>
                      <td style={{ padding:'8px 11px', maxWidth:'260px' }}>
                        <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c._objeto}>{c._objeto}</div>
                      </td>
                      <td style={{ padding:'8px 11px', whiteSpace:'nowrap', color:'#475569', fontSize:'0.73rem' }}>{c._tipo}</td>
                      <td style={{ padding:'8px 11px' }}>{estadoBadge(c._estado)}</td>
                      <td style={{ padding:'8px 11px', whiteSpace:'nowrap', color:'#64748B' }}>{FMT(c._fecha)}</td>
                      <td style={{ padding:'8px 11px', whiteSpace:'nowrap', fontWeight:700, color:c._valor>1000000000?'#C0392B':'#0D7C3D' }}>{COP(c._valor)}</td>
                      <td style={{ padding:'8px 11px', whiteSpace:'nowrap' }}>
                        <div style={{ display:'flex', gap:'5px', alignItems:'center' }}>
                          <button onClick={e=>{e.stopPropagation(); setDetalleIdx(abierto?null:idx);}}
                            style={{ padding:'3px 9px', borderRadius:'5px', border:`1px solid ${hColor}`, background:abierto?hColor:'#FFF', color:abierto?'#FFF':hColor, fontWeight:700, fontSize:'0.7rem', cursor:'pointer' }}>
                            {abierto ? '▲ Cerrar' : '▼ Ver'}
                          </button>
                          {c._url && (
                            <a href={c._url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
                              style={{ padding:'3px 9px', borderRadius:'5px', background:'#214E92', color:'#FFF', fontWeight:700, fontSize:'0.7rem', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:'3px' }}>
                              <ExternalLink size={9}/> SECOP
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Detalle expandido — TODOS los campos */}
                    {abierto && (
                      <tr>
                        <td colSpan={8} style={{ padding:0, background:`${hColor}08`, borderBottom:`2px solid ${hColor}` }}>
                          <div style={{ padding:'16px 20px' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                              <div style={{ fontWeight:800, color:hColor, fontSize:'0.85rem' }}>
                                📋 Información completa — {c._ref}
                              </div>
                              <div style={{ display:'flex', gap:'7px' }}>
                                {c._url && (
                                  <a href={c._url} target="_blank" rel="noreferrer"
                                    style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'7px 16px', borderRadius:'7px', background:'#214E92', color:'#FFF', fontWeight:700, fontSize:'0.8rem', textDecoration:'none', boxShadow:'0 2px 8px rgba(33,78,146,0.35)' }}>
                                    <ExternalLink size={13}/> Ver en SECOP
                                  </a>
                                )}
                                <button onClick={()=>setDetalleIdx(null)}
                                  style={{ padding:'7px 12px', borderRadius:'7px', border:'1px solid #E0E6ED', background:'#FFF', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px', fontWeight:600, fontSize:'0.78rem', color:'#64748B' }}>
                                  <X size={12}/> Cerrar
                                </button>
                              </div>
                            </div>
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:'8px' }}>
                              {Object.entries(c)
                                .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== '' && v !== undefined)
                                .map(([k, v]) => {
                                  const esMonto = k.includes('valor')||k.includes('total')||k.includes('precio');
                                  return (
                                    <div key={k} style={{ background:'#FFF', borderRadius:'6px', padding:'8px 12px', border:'1px solid #E8EDF3' }}>
                                      <div style={{ fontSize:'0.62rem', fontWeight:700, color:'#94A3B8', textTransform:'uppercase', marginBottom:'3px', letterSpacing:'0.04em' }}>
                                        {FIELD_LABELS[k] || k.replace(/_/g,' ')}
                                      </div>
                                      <div style={{ fontSize:'0.81rem', lineHeight:1.5, wordBreak:'break-word', fontWeight:esMonto?700:400, color:esMonto?'#0D7C3D':'#1E293B' }}>
                                        {esMonto ? COP(v) : String(v)}
                                      </div>
                                    </div>
                                  );
                                })
                              }
                            </div>
                          </div>
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

      {/* Paginación */}
      {!loading && total > pageSize && (
        <div style={{ padding:'8px 14px', borderTop:'1px solid #E8EDF3', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'5px', background:'#FAFBFC' }}>
          <span style={{ fontSize:'0.75rem', color:'#64748B' }}>Pág <strong>{page}</strong>/{Math.ceil(total/pageSize)} · {total.toLocaleString('es-CO')} total · 🗄️ BigQuery</span>
          <div style={{ display:'flex', gap:'5px' }}>
            {[{l:'← Ant', d:page===1, fn:()=>{setPage(p=>p-1);fetchData(page-1);}},
              {l:'Sig →', d:page>=totalPages, fn:()=>{setPage(p=>p+1);fetchData(page+1);}}
            ].map(b => (
              <button key={b.l} disabled={b.d} onClick={b.fn} style={{ padding:'5px 12px', borderRadius:'6px', border:'1px solid #E0E6ED', background:b.d?'#F8FAFC':'#FFF', color:b.d?'#CBD5E1':hColor, cursor:b.d?'not-allowed':'pointer', fontWeight:600, fontSize:'0.75rem' }}>{b.l}</button>
            ))}
          </div>
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

      <div>
        <h2 style={{ fontSize:'1.35rem', fontWeight:800, color:'var(--text-main)', margin:0 }}>
          📋 Contratación Pública MinTic — SECOP
        </h2>
        <p style={{ color:'var(--text-secondary)', fontSize:'0.82rem', margin:'4px 0 0' }}>
          3 fuentes de datos · desde <strong>2018-08-07</strong> · <span style={{ background:'#EBF1FB', color:'#214E92', borderRadius:'5px', padding:'1px 7px', fontWeight:700, fontSize:'0.75rem' }}>🗄️ Datos desde BigQuery</span>
        </p>
      </div>

      {/* Selector de entidades */}
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
            Usa el toggle <strong>🏛️ Contratante / 🤝 Proveedor</strong> para cambiar rol. Haz clic en cualquier fila para ver <strong>todos los campos</strong> del registro.
          </p>
        </div>
      ) : (
        <>
          {/* Selector de fuente con conteos BQ */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'10px' }}>
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
                        🏛️ <strong style={{ color:f.color }}>{cnt.contratante?.total?.toLocaleString('es-CO') ?? '—'}</strong> como contratante
                      </span>
                      <span style={{ fontSize:'0.7rem', color:'#64748B' }}>
                        🤝 <strong style={{ color:'#16A085' }}>{cnt.proveedor?.total?.toLocaleString('es-CO') ?? '—'}</strong> como proveedor
                      </span>
                    </div>
                  )}
                  <div style={{ fontSize:'0.65rem', color:'#94A3B8' }}>{f.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Panel único con toggle integrado */}
          <ContratoPanel
            key={`${entidadActiva.id}-${fuenteActiva.id}`}
            entidad={entidadActiva}
            fuente={fuenteActiva}
            currentUser={currentUser}
          />
        </>
      )}
    </div>
  );
}
