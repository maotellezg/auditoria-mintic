import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Download, FileText, Calendar, Tag, 
  MapPin, Building, Briefcase, Hash, ExternalLink,
  Users, AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function DocViewer({ doc, onBack }) {
  const { currentUser } = useAuth();
  const [downloadUrl, setDownloadUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(true);

  useEffect(() => {
    async function logView() {
      if (!doc || !doc.id || !currentUser) return;
      try {
        const idToken = await currentUser.getIdToken();
        await fetch('/api/documents/view', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ docId: doc.id })
        });
        console.log(`[AUDIT-VIEW] Visualización de ${doc.id} registrada.`);
      } catch (err) {
        console.error('Error al registrar visualización de documento:', err);
      }
    }
    logView();
  }, [doc?.id, currentUser]);


  useEffect(() => {
    function fetchUrl() {
      if (!doc.filePath) {
        setLoadingUrl(false);
        return;
      }
      try {
        // Generar la URL que apunta directamente a nuestro backend proxy seguro
        const url = `/api/download-file?filePath=${encodeURIComponent(doc.filePath)}`;
        setDownloadUrl(url);
      } catch (err) {
        console.error("Error al obtener URL del archivo:", err);
      } finally {
        setLoadingUrl(false);
      }
    }
    fetchUrl();
  }, [doc]);

  const isImage = doc.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(doc.fileName || '');
  const isPdf = doc.mimeType === 'application/pdf' || doc.fileName?.toLowerCase().endsWith('.pdf');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      {/* Botón superior de navegación */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          Volver al Listado
        </button>

        {downloadUrl && (
          <a 
            href={downloadUrl} 
            download={doc.fileName} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn btn-primary"
          >
            <Download size={16} />
            Descargar Documento
          </a>
        )}
      </div>

      {/* Visor Dividido */}
      <div className="split-viewer">
        
        {/* Panel Izquierdo: El archivo */}
        <div className="pdf-pane">
          {loadingUrl ? (
            <div className="loading-spin" style={{ width: '32px', height: '32px', border: '3px solid var(--color-accent)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
          ) : isPdf && downloadUrl ? (
            <iframe 
              src={`${downloadUrl}#toolbar=1`} 
              title={doc.fileName} 
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          ) : isImage && downloadUrl ? (
            <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
              <img 
                src={downloadUrl} 
                alt={doc.fileName} 
                style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }} 
              />
            </div>
          ) : (
            // Fallback para Word u otros archivos sin visor en navegador
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
              <FileText size={64} color="var(--color-primary)" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ color: 'var(--text-main)', fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>
                Vista previa no disponible para este formato
              </h3>
              <p style={{ fontSize: '0.9rem', marginBottom: '16px' }}>
                Este archivo es un documento Word (.docx) o no tiene soporte de visor web.
              </p>
              {downloadUrl && (
                <a 
                  href={downloadUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', gap: '8px' }}
                >
                  <ExternalLink size={16} />
                  Abrir / Descargar directamente
                </a>
              )}
            </div>
          )}
        </div>

        {/* Panel Derecho: Ficha técnica / Gemini */}
        <div className="detail-pane glass-panel">
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '4px', wordBreak: 'break-word' }}>
              {doc.fileName}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
              Tipo de archivo: {doc.fileType || (doc.fileName ? doc.fileName.split('.').pop().toUpperCase() : 'PDF')}
              {doc.fileSize && ` • Peso: ${(doc.fileSize / (1024 * 1024)).toFixed(2)} MB`}
              {doc.pageCount && ` • Cantidad de hojas: ${doc.pageCount}`}
              {doc.mimeType && ` • Tipo MIME: ${doc.mimeType}`}
            </p>
          </div>

          {/* Grilla de campos extraídos */}
          <div>
            <div className="detail-section-title">Análisis de Entidades (Gemini)</div>
            <div className="field-grid">
              
              <div className="field-item">
                <span className="field-label">
                  <Building size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Entidad Emisora
                </span>
                <span className="field-value">
                  <span className="badge" style={{ 
                    textTransform: 'none', 
                    borderColor: doc.institution === 'ANLA' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)', 
                    background: doc.institution === 'ANLA' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                    color: doc.institution === 'ANLA' ? '#3b82f6' : '#10b981'
                  }}>
                    {doc.institution || 'ANLA'}
                  </span>
                </span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <Hash size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Tipo de Documento
                </span>
                <span className="field-value">
                  <span className="badge badge-pending" style={{ textTransform: 'none', background: 'rgba(0, 242, 254, 0.08)', color: 'var(--color-primary)' }}>
                    {doc.documentType || 'No detectado'}
                  </span>
                </span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <Briefcase size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Sector
                </span>
                <span className="field-value">
                  <span className="badge badge-success" style={{ textTransform: 'none', background: 'rgba(67, 233, 123, 0.08)', color: '#43e97b', borderColor: 'rgba(67, 233, 123, 0.2)' }}>
                    {doc.sector || 'No especificado'}
                  </span>
                </span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <Calendar size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Fecha Principal
                </span>
                <span className="field-value">{doc.date || 'No identificada'}</span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <Building size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Empresa / Interesado
                </span>
                <span className="field-value">{doc.company || 'No identificada'}</span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <MapPin size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Región / CAR
                </span>
                <span className="field-value">{doc.region || 'No identificada'}</span>
              </div>

              <div className="field-item">
                <span className="field-label">
                  <MapPin size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                  Ubicación (Dpto/Mpio)
                </span>
                <span className="field-value">
                  {doc.municipio && doc.municipio !== 'No especificado' && doc.municipio !== 'Detectando...' ? `${doc.municipio}, ` : ''}
                  {doc.departamento || 'No identificado'}
                </span>
              </div>

              {doc.expediente && doc.expediente !== 'No especificado' && (
                <div className="field-item" style={{ gridColumn: 'span 2' }}>
                  <span className="field-label">Expediente / Radicado</span>
                  <span className="field-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
                    {doc.expediente}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Firmantes */}
          {doc.signatories && doc.signatories.length > 0 && (
            <div>
              <div className="detail-section-title">Firmantes y Cargos</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {doc.signatories.map((sig, idx) => (
                  <div key={idx} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                    <Users size={16} color="var(--color-primary)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-main)' }}>{sig.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sig.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Otras Fechas Relevantes */}
          {doc.importantDates && doc.importantDates.length > 0 && (
            <div>
              <div className="detail-section-title">Otras Fechas Relevantes</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                {doc.importantDates.map((d, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                    <Calendar size={12} color="var(--color-accent)" />
                    <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{d.date}:</span>
                    <span style={{ color: 'var(--text-muted)' }}>{d.context}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Datos Relevantes y Cifras */}
          {doc.relevantData && doc.relevantData.length > 0 && (
            <div>
              <div className="detail-section-title">Cifras y Datos de Interés</div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '18px', margin: 0 }}>
                {doc.relevantData.map((data, idx) => (
                  <li key={idx} style={{ fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                    {data}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Resumen Ejecutivo */}
          <div>
            <div className="detail-section-title">Resumen Ejecutivo Inteligente</div>
            <p style={{ fontSize: '0.92rem', lineHeight: '1.6', color: 'var(--text-main)', whiteSpace: 'pre-wrap' }}>
              {doc.summary}
            </p>
          </div>

          {/* Temas Clave */}
          {doc.keyThemes && doc.keyThemes.length > 0 && (
            <div>
              <div className="detail-section-title">Temas Clave</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {doc.keyThemes.map((tag, idx) => (
                  <span key={idx} className="badge badge-success" style={{ textTransform: 'none', background: 'rgba(67, 233, 123, 0.08)' }}>
                    <Tag size={10} style={{ marginRight: '4px' }} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Wiki Keywords / Conexiones */}
          {doc.wikiKeywords && doc.wikiKeywords.length > 0 && (
            <div>
              <div className="detail-section-title">Conexiones Wiki</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {doc.wikiKeywords.map((tag, idx) => (
                  <span 
                    key={idx} 
                    className="meta-tag" 
                    style={{ background: 'rgba(0, 242, 254, 0.03)', borderColor: 'rgba(0, 242, 254, 0.15)', color: 'var(--color-primary)', borderRadius: '50px', padding: '4px 12px', fontSize: '0.8rem' }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
