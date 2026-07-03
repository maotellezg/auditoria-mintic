import React, { useState, useEffect } from 'react';
import { BookOpen, Briefcase, MapPin, Building, ChevronRight, FileText, Calendar, Search, Map } from 'lucide-react';

export default function WikiView({ onSelectDoc }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wikiSearch, setWikiSearch] = useState('');
  
  // Vista activa: 'home', 'sector', 'region', 'dept', 'company'
  const [viewState, setViewState] = useState({ type: 'home', value: null });

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const response = await fetch('/api/documents');
        if (response.ok) {
          const docs = await response.json();
          setDocuments(docs);
        }
      } catch (err) {
        console.error('Error al cargar documentos en la Wiki:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchDocs();
  }, []);

  // Extraer agrupaciones únicas de documentos "Analizados"
  const analyzedDocs = documents.filter(d => d.status === 'Analizado');

  const getGroupedData = () => {
    const sectors = {};
    const regions = {};
    const depts = {};
    const companies = {};

    analyzedDocs.forEach(doc => {
      // Agrupar por Sector
      if (doc.sector && doc.sector !== 'No especificado' && doc.sector !== 'Detectando...') {
        if (!sectors[doc.sector]) sectors[doc.sector] = [];
        sectors[doc.sector].push(doc);
      }
      // Agrupar por Región / CAR
      if (doc.region && doc.region !== 'No especificado' && doc.region !== 'Detectando...') {
        const reg = doc.region;
        if (!regions[reg]) regions[reg] = [];
        regions[reg].push(doc);
      }
      // Agrupar por Departamento
      if (doc.departamento && doc.departamento !== 'No especificado' && doc.departamento !== 'Detectando...') {
        // Puede haber departamentos separados por comas
        if (doc.departamento.includes(',')) {
          doc.departamento.split(',').forEach(d => {
            const trimmed = d.trim();
            if (trimmed) {
              if (!depts[trimmed]) depts[trimmed] = [];
              depts[trimmed].push(doc);
            }
          });
        } else {
          const dept = doc.departamento;
          if (!depts[dept]) depts[dept] = [];
          depts[dept].push(doc);
        }
      }
      // Agrupar por Empresa
      if (doc.company && doc.company !== 'No especificado' && doc.company !== 'Detectando...') {
        if (!companies[doc.company]) companies[doc.company] = [];
        companies[doc.company].push(doc);
      }
    });

    return { sectors, regions, depts, companies };
  };

  const { sectors, regions, depts, companies } = getGroupedData();

  // Filtrar grupos basados en búsqueda
  const filteredSectors = Object.keys(sectors).filter(s => 
    s.toLowerCase().includes(wikiSearch.toLowerCase())
  );
  const filteredRegions = Object.keys(regions).filter(r => 
    r.toLowerCase().includes(wikiSearch.toLowerCase())
  );
  const filteredDepts = Object.keys(depts).filter(d => 
    d.toLowerCase().includes(wikiSearch.toLowerCase())
  );
  const filteredCompanies = Object.keys(companies).filter(c => 
    c.toLowerCase().includes(wikiSearch.toLowerCase())
  );

  const handleSelectGroup = (type, value) => {
    setViewState({ type, value });
  };

  const handleBackToHome = () => {
    setViewState({ type: 'home', value: null });
    setWikiSearch('');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
        <div className="loading-spin" style={{ width: '40px', height: '40px', border: '3px solid var(--color-accent)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
      </div>
    );
  }

  // --- VISTA DETALLADA DE UN TEMA/GRUPO ---
  if (viewState.type !== 'home') {
    const groupTitle = viewState.value;
    let groupDocs = [];
    if (viewState.type === 'sector') groupDocs = sectors[groupTitle] || [];
    if (viewState.type === 'region') groupDocs = regions[groupTitle] || [];
    if (viewState.type === 'dept') groupDocs = depts[groupTitle] || [];
    if (viewState.type === 'company') groupDocs = companies[groupTitle] || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={handleBackToHome}>
            Volver a la Wiki
          </button>
        </div>

        <div className="glass-panel" style={{ borderLeft: '4px solid var(--color-accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            {viewState.type === 'sector' && <Briefcase size={24} color="var(--color-primary)" />}
            {viewState.type === 'region' && <MapPin size={24} color="#ba55d3" />}
            {viewState.type === 'dept' && <Map size={24} color="var(--color-accent)" />}
            {viewState.type === 'company' && <Building size={24} />}
            <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              {viewState.type === 'sector' && 'Sector Industrial'}
              {viewState.type === 'region' && 'Región / CAR'}
              {viewState.type === 'dept' && 'Departamento'}
              {viewState.type === 'company' && 'Empresa / Solicitante'}
            </span>
          </div>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>{groupTitle}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            Contiene {groupDocs.length} documento{groupDocs.length !== 1 ? 's' : ''} relacionado{groupDocs.length !== 1 ? 's' : ''} en la base de conocimiento.
          </p>
        </div>

        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Documentos Vinculados</h3>
        
        <div className="wiki-list">
          {groupDocs.map(doc => (
            <div 
              key={doc.id} 
              className="wiki-list-item"
              onClick={() => onSelectDoc(doc)}
            >
              <div className="wiki-item-info">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={16} color="var(--color-primary)" />
                  {doc.fileName}
                </h4>
                <p style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: '80%' }}>
                  {doc.summary}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span className="badge badge-success" style={{ background: 'rgba(0, 242, 254, 0.08)', color: 'var(--color-primary)', textTransform: 'none' }}>
                  {doc.documentType}
                </span>
                <ChevronRight size={16} color="var(--text-muted)" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- VISTA HOME DE LA WIKI (Agrupaciones generales) ---
  return (
    <div className="wiki-container">
      
      {/* Buscador de la Wiki */}
      <div className="wiki-search-box">
        <Search size={24} color="var(--color-accent)" />
        <input 
          type="text" 
          placeholder="Filtrar temas de la Wiki (Ej: Hidrocarburos, Corantioquia, EPM, Antioquia...)" 
          className="form-input"
          style={{ width: '100%', background: 'transparent', border: 'none', fontSize: '1.1rem', height: '100%' }}
          value={wikiSearch}
          onChange={(e) => setWikiSearch(e.target.value)}
        />
      </div>

      <div className="wiki-groups" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Agrupación por Sectores */}
        <div className="glass-panel wiki-group-card">
          <h3 className="wiki-group-title">
            <Briefcase size={20} color="var(--color-primary)" />
            Sectores Ambientales ({filteredSectors.length})
          </h3>
          <div className="wiki-list">
            {filteredSectors.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No se encontraron sectores.</p>
            ) : (
              filteredSectors.map((s, idx) => (
                <div key={idx} className="wiki-list-item" onClick={() => handleSelectGroup('sector', s)}>
                  <div className="wiki-item-info">
                    <h4>{s}</h4>
                    <p>{sectors[s].length} documento{sectors[s].length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agrupación por Regiones / CAR */}
        <div className="glass-panel wiki-group-card">
          <h3 className="wiki-group-title">
            <MapPin size={20} color="#ba55d3" />
            Regiones / CAR ({filteredRegions.length})
          </h3>
          <div className="wiki-list">
            {filteredRegions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No se encontraron regiones.</p>
            ) : (
              filteredRegions.map((r, idx) => (
                <div key={idx} className="wiki-list-item" onClick={() => handleSelectGroup('region', r)}>
                  <div className="wiki-item-info">
                    <h4>{r}</h4>
                    <p>{regions[r].length} documento{regions[r].length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agrupación por Departamentos */}
        <div className="glass-panel wiki-group-card">
          <h3 className="wiki-group-title">
            <Map size={20} color="var(--color-accent)" />
            Departamentos ({filteredDepts.length})
          </h3>
          <div className="wiki-list">
            {filteredDepts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No se encontraron departamentos.</p>
            ) : (
              filteredDepts.map((d, idx) => (
                <div key={idx} className="wiki-list-item" onClick={() => handleSelectGroup('dept', d)}>
                  <div className="wiki-item-info">
                    <h4>{d}</h4>
                    <p>{depts[d].length} documento{depts[d].length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agrupación por Empresas */}
        <div className="glass-panel wiki-group-card">
          <h3 className="wiki-group-title">
            <Building size={20} />
            Empresas e Interesados ({filteredCompanies.length})
          </h3>
          <div className="wiki-list">
            {filteredCompanies.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No se encontraron empresas.</p>
            ) : (
              filteredCompanies.map((c, idx) => (
                <div key={idx} className="wiki-list-item" onClick={() => handleSelectGroup('company', c)}>
                  <div className="wiki-item-info">
                    <h4>{c}</h4>
                    <p>{companies[c].length} documento{companies[c].length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
