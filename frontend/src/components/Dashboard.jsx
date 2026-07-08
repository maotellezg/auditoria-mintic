import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { Search, Calendar, Tag, MapPin, Building, Briefcase, FileText, CheckCircle2, Clock, AlertTriangle, Download, RefreshCw, StopCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Dashboard({ onSelectDoc }) {
  const { currentUser, userRole } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(60);
  const [dbError, setDbError] = useState(null);
  
  const formatDocDate = (uploadedAt) => {
    if (!uploadedAt) return 'No especificada';
    if (typeof uploadedAt === 'string') return uploadedAt.slice(0, 10);
    if (uploadedAt && typeof uploadedAt === 'object') {
      const secs = uploadedAt._seconds || uploadedAt.seconds;
      if (secs) {
        try {
          return new Date(secs * 1000).toISOString().slice(0, 10);
        } catch (e) {
          console.warn('Error al formatear Timestamp:', e);
        }
      }
    }
    return 'No especificada';
  };
  
  // Filtros
  const [filterType, setFilterType] = useState('Todos');
  const [filterInstitution, setFilterInstitution] = useState('Todos');
  const [statusFilter, setStatusFilter] = useState('Todos');

  const toggleStatusFilter = (targetStatus) => {
    if (statusFilter === targetStatus) {
      setStatusFilter('Todos');
    } else {
      setStatusFilter(targetStatus);
    }
  };


  // Estados para descarga masiva
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  const handleDownloadAll = async () => {
    if (filteredDocuments.length === 0) return;
    setDownloadingAll(true);
    setDownloadProgress(`Iniciando consolidación de ${filteredDocuments.length} archivos en un ZIP...`);

    try {
      const zip = new JSZip();
      let addedFilesCount = 0;

      // 1. Descargar secuencialmente cada uno de los archivos y agregarlos al ZIP
      for (let i = 0; i < filteredDocuments.length; i++) {
        const doc = filteredDocuments[i];
        if (!doc.filePath) continue;

        setDownloadProgress(`Obteniendo archivo ${i + 1}/${filteredDocuments.length}: ${doc.fileName || 'documento'}`);

        try {
          const url = `/api/download-file?filePath=${encodeURIComponent(doc.filePath)}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
          }
          const blob = await response.blob();
          
          // Evitar colisiones de nombres añadiendo un contador si el nombre del archivo se repite en el ZIP
          let name = doc.fileName || `documento_${i + 1}`;
          let nameUsed = name;
          let counter = 1;
          while (zip.file(nameUsed)) {
            const extIndex = name.lastIndexOf('.');
            if (extIndex !== -1) {
              const base = name.slice(0, extIndex);
              const ext = name.slice(extIndex);
              nameUsed = `${base} (${counter})${ext}`;
            } else {
              nameUsed = `${name} (${counter})`;
            }
            counter++;
          }

          zip.file(nameUsed, blob);
          addedFilesCount++;
        } catch (fileErr) {
          console.error(`Error al descargar ${doc.fileName || 'documento'} para incluir en el ZIP:`, fileErr);
        }
      }

      // 2. Generar el archivo CSV (Excel-compatible) con todos los metadatos analizados por Gemini
      setDownloadProgress('Generando hoja de cálculo Excel (CSV) con metadatos de Gemini...');

      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '""';
        const stringVal = String(value);
        // Escapar comillas dobles duplicándolas según estándar RFC 4180
        const escaped = stringVal.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const headers = [
        'Nombre del Archivo',
        'Entidad Origen',
        'Tipo de Trámite/Documento',
        'Sector Industrial',
        'Empresa / Solicitante',
        'Expediente / Radicado',
        'Fecha Principal (Documento)',
        'Región / CAR',
        'Departamento',
        'Municipio(s)',
        'Resumen Ejecutivo (Gemini)',
        'Fecha de Carga'
      ];

      // "sep=;" le indica a Excel qué separador usar por defecto sin importar la configuración regional de Windows
      let csvContent = "sep=;\n" + headers.join(';') + "\n";

      filteredDocuments.forEach((doc) => {
        const row = [
          escapeCSV(doc.fileName),
          escapeCSV(doc.institution),
          escapeCSV(doc.documentType),
          escapeCSV(doc.sector),
          escapeCSV(doc.company),
          escapeCSV(doc.expediente),
          escapeCSV(doc.date),
          escapeCSV(doc.region),
          escapeCSV(doc.departamento),
          escapeCSV(doc.municipio),
          escapeCSV(doc.summary),
          escapeCSV(doc.uploadedAt)
        ];
        csvContent += row.join(';') + "\n";
      });

      // Agregar la hoja de cálculo al raíz del ZIP
      zip.file("Metadatos_Documentos_IA.csv", csvContent);

      // 3. Compilar el archivo ZIP en el navegador
      setDownloadProgress('Comprimiendo y generando archivo ZIP final...');
      const zipContentBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setDownloadProgress(`Comprimiendo ZIP: ${Math.round(metadata.percent)}%`);
      });

      // 4. Disparar la descarga del archivo ZIP consolidado
      const timestamp = new Date().toISOString().slice(0, 10);
      const zipFileName = `Auditoria_MinTic_${timestamp}.zip`;

      const blobUrl = window.URL.createObjectURL(zipContentBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = zipFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error("Error en la descarga masiva con ZIP:", err);
      alert("Error al generar la descarga masiva en ZIP con metadatos.");
    } finally {
      setDownloadingAll(false);
      setDownloadProgress('');
    }
  };

  const handleReanalyze = async (docId, filePath, fileName) => {
    if (!docId || !filePath || !fileName) return;

    // Cambiar localmente el estado del documento en la UI a "Procesando con Gemini..." para dar feedback instantáneo
    setDocuments(prev => prev.map(d => 
      d.id === docId ? { ...d, status: 'Procesando con Gemini...' } : d
    ));

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch('/api/process-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ docId, filePath, fileName })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al iniciar el análisis');
      }

      // Refrescar los documentos para obtener el estado del polling
      fetchDocs(false);
    } catch (err) {
      console.error('Error re-analizando documento:', err);
      // Actualizar la UI con el error
      setDocuments(prev => prev.map(d => 
        d.id === docId ? { ...d, status: 'Error en Análisis', errorMessage: err.message } : d
      ));
    }
  };

  const handleCancelAnalysis = async (docId) => {
    if (!docId) return;

    if (!window.confirm('¿Está seguro de que desea detener el análisis de este documento?')) {
      return;
    }

    // Feedback visual inmediato en la UI
    setDocuments(prev => prev.map(d => 
      d.id === docId ? { ...d, status: 'Cancelado', summary: 'Deteniendo análisis...' } : d
    ));

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch('/api/admin/cancel-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ docId })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al cancelar el análisis');
      }

      // Refrescar los documentos para sincronizar
      fetchDocs(false);
    } catch (err) {
      console.error('Error al cancelar análisis:', err);
      alert(`Error al detener análisis: ${err.message}`);
      fetchDocs(false);
    }
  };

  const [reanalyzingAll, setReanalyzingAll] = useState(false);
  const [cancelingAll, setCancelingAll] = useState(false);

  const handleCancelAll = async () => {
    // Buscar documentos que se están procesando actualmente para confirmar
    const activeDocsCount = documents.filter(d => 
      d.status && (d.status.includes('Procesando') || d.status.includes('Subiendo') || d.status.includes('archivo'))
    ).length;

    if (activeDocsCount === 0) {
      alert('No hay análisis activos en proceso para detener.');
      return;
    }

    if (!window.confirm(`¿Está seguro de que desea detener TODOS los ${activeDocsCount} análisis activos? Esto abortará los procesos de Gemini de inmediato.`)) {
      return;
    }

    setCancelingAll(true);

    // Feedback visual inmediato en la UI para todos los activos
    setDocuments(prev => prev.map(d => {
      const isActive = d.status && (d.status.includes('Procesando') || d.status.includes('Subiendo') || d.status.includes('archivo'));
      return isActive ? { ...d, status: 'Cancelado', summary: 'Deteniendo análisis...' } : d;
    }));

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch('/api/admin/cancel-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al detener todos los análisis');
      }

      const data = await response.json();
      alert(data.message || 'Se han detenido todos los análisis con éxito.');

      // Refrescar para sincronizar
      fetchDocs(false);
    } catch (err) {
      console.error('Error al detener todos los análisis:', err);
      alert(`Error al detener todo: ${err.message}`);
      fetchDocs(false);
    } finally {
      setCancelingAll(false);
    }
  };

  const handleReanalyzeAll = async () => {
    // Buscar documentos elegibles para re-análisis masivo
    const eligibleDocs = documents.filter(doc => 
      doc.filePath && 
      !doc.status?.includes('Procesando') && 
      !doc.status?.includes('Subiendo') && 
      !doc.status?.includes('archivo')
    );

    if (eligibleDocs.length === 0) {
      alert('No hay documentos elegibles para re-analizar en este momento. Todos los documentos están en proceso o no tienen archivo.');
      return;
    }

    if (!window.confirm(`¿Está seguro de que desea re-analizar los ${eligibleDocs.length} documentos elegibles? Esto procesará cada uno secuencialmente en segundo plano para respetar límites.`)) {
      return;
    }

    setReanalyzingAll(true);

    // Feedback visual inmediato para todos los elegibles en la UI
    setDocuments(prev => prev.map(d => {
      const isEligible = d.filePath && !d.status?.includes('Procesando') && !d.status?.includes('Subiendo') && !d.status?.includes('archivo');
      return isEligible ? { ...d, status: 'Procesando con Gemini...' } : d;
    }));

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch('/api/admin/reanalyze-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al iniciar el re-análisis masivo');
      }

      const data = await response.json();
      alert(data.message || 'Se ha iniciado el re-análisis masivo con éxito.');
      
      // Refrescar para activar el polling inteligente
      fetchDocs(false);
    } catch (err) {
      console.error('Error al iniciar re-análisis masivo:', err);
      alert(`Error al re-analizar todo: ${err.message}`);
      fetchDocs(false);
    } finally {
      setReanalyzingAll(false);
    }
  };

  // Entidades MinTic
  const entidadesMinTic = [
    'MinTIC', 'ANE', 'CRC', 'AND', 'FUTIC',
    'RTVC', 'Servicios Postales Nacionales (4-72)',
    'Persona Natural', 'Empresa Privada', 'Otro'
  ];

  // Tipos de documento MinTic
  const tiposDocumento = [
    'Contrato', 'Declaracion de Renta', 'Resolucion',
    'Convenio', 'Acta', 'Licitacion', 'Certificacion',
    'Informe', 'PQRS', 'Otro'
  ];

  const fetchDocs = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/documents');
      if (!response.ok) {
        throw new Error('El servidor de base de datos retornó un error.');
      }
      const docs = await response.json();
      
      setDocuments(docs);
      setDbError(null);
    } catch (error) {
      console.error("Error al cargar documentos del backend:", error);
      setDbError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Carga inicial
  useEffect(() => {
    fetchDocs(true);
  }, []);

  // Polling inteligente: solo se activa si hay documentos procesándose actualmente
  useEffect(() => {
    const hasProcessing = documents.some(doc => 
      doc.status && (doc.status.includes('Procesando') || doc.status.includes('Subiendo') || doc.status.includes('archivo'))
    );

    if (!hasProcessing) return;

    console.log('Polling inteligente activado (documentos en procesamiento)...');
    const interval = setInterval(() => {
      fetchDocs(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [documents]);

  // Sincronizar localSearch con el estado search con un debounce de 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // Sincronización inversa si search cambia externamente (ej: al limpiar filtros)
  useEffect(() => {
    if (search !== localSearch) {
      setLocalSearch(search);
    }
  }, [search]);

  // Reiniciar la paginación visible cuando cambie cualquier filtro de búsqueda o de combos
  useEffect(() => {
    setVisibleCount(60);
  }, [search, filterType, filterInstitution, statusFilter]);

  // Filtrado de documentos del lado del cliente para búsqueda instantánea
  const filteredDocuments = documents.filter((doc) => {
    const searchLower = (search || '').toLowerCase();
    
    const matchesSearch = !searchLower ? true : (
      (typeof doc.fileName === 'string' && doc.fileName.toLowerCase().includes(searchLower)) ||
      (typeof doc.summary === 'string' && doc.summary.toLowerCase().includes(searchLower)) ||
      (typeof doc.institution === 'string' && doc.institution.toLowerCase().includes(searchLower)) ||
      (typeof doc.sector === 'string' && doc.sector.toLowerCase().includes(searchLower)) ||
      (typeof doc.company === 'string' && doc.company.toLowerCase().includes(searchLower)) ||
      (typeof doc.region === 'string' && doc.region.toLowerCase().includes(searchLower)) ||
      (typeof doc.departamento === 'string' && doc.departamento.toLowerCase().includes(searchLower)) ||
      (typeof doc.municipio === 'string' && doc.municipio.toLowerCase().includes(searchLower)) ||
      (typeof doc.expediente === 'string' && doc.expediente.toLowerCase().includes(searchLower)) ||
      (Array.isArray(doc.wikiKeywords) && doc.wikiKeywords.some(tag => typeof tag === 'string' && tag.toLowerCase().includes(searchLower))) ||
      (Array.isArray(doc.signatories) && doc.signatories.some(sig => 
        sig && (
          (typeof sig.name === 'string' && sig.name.toLowerCase().includes(searchLower)) ||
          (typeof sig.role === 'string' && sig.role.toLowerCase().includes(searchLower))
        )
      ))
    );

    const matchesType = filterType === 'Todos' || doc.tipoDocumento === filterType || doc.documentType === filterType;
    const matchesInstitution = filterInstitution === 'Todos' || doc.entidad === filterInstitution || doc.institution === filterInstitution;

    let matchesStatus = true;
    if (statusFilter === 'Analizado') {
      matchesStatus = doc.status === 'Analizado';
    } else if (statusFilter === 'Procesando') {
      matchesStatus = doc.status && (doc.status.includes('Procesando') || doc.status.includes('Subiendo') || doc.status.includes('archivo'));
    } else if (statusFilter === 'Error') {
      matchesStatus = doc.status?.includes('Error') || doc.status === 'Error en Análisis';
    } else if (statusFilter === 'Cancelado') {
      matchesStatus = doc.status === 'Cancelado';
    }

    return matchesSearch && matchesType && matchesInstitution && matchesStatus;
  });

  const getStatusBadge = (status) => {
    if (!status) return <span className="badge badge-pending">Desconocido</span>;
    if (status.includes('Procesando') || status.includes('Subiendo')) {
      return (
        <span className="badge badge-processing" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span className="loading-spin" style={{ display: 'inline-block', width: '10px', height: '10px', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
          {status}
        </span>
      );
    }
    if (status === 'Analizado') {
      return (
        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle2 size={12} />
          Analizado
        </span>
      );
    }
    if (status === 'Cancelado') {
      return (
        <span className="badge badge-canceled" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <StopCircle size={12} />
          Cancelado
        </span>
      );
    }
    return (
      <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <AlertTriangle size={12} />
        {status}
      </span>
    );
  };

  // Calcular estadísticas para los indicadores superiores
  const totalCount = documents.length;
  const analyzedCount = documents.filter(d => d.status === 'Analizado').length;
  const processingCount = documents.filter(d => d.status && (d.status.includes('Procesando') || d.status.includes('Subiendo') || d.status.includes('archivo'))).length;
  const errorCount = documents.filter(d => d.status?.includes('Error')).length;
  const canceledCount = documents.filter(d => d.status === 'Cancelado').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Panel de Indicadores Estadísticos Premium */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '20px' 
      }}>
        {/* Tarjeta Total */}
        <div 
          className="glass-panel" 
          onClick={() => setStatusFilter('Todos')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '20px', 
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid var(--color-accent)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: statusFilter === 'Todos' ? 'translateY(-4px)' : 'none',
            boxShadow: statusFilter === 'Todos' ? '0 10px 25px -10px rgba(0, 242, 254, 0.4)' : 'none',
            background: statusFilter === 'Todos' ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            borderColor: statusFilter === 'Todos' ? 'rgba(0, 242, 254, 0.3)' : 'rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ 
            background: 'rgba(0, 242, 254, 0.05)', 
            border: '1px solid rgba(0, 242, 254, 0.25)', 
            borderRadius: '12px', 
            padding: '12px', 
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FileText size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Total Archivos</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', lineHeight: 1 }}>{totalCount}</div>
          </div>
        </div>

        {/* Tarjeta Analizados */}
        <div 
          className="glass-panel" 
          onClick={() => toggleStatusFilter('Analizado')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '20px', 
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid var(--color-success)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: statusFilter === 'Analizado' ? 'translateY(-4px)' : 'none',
            boxShadow: statusFilter === 'Analizado' ? '0 10px 25px -10px rgba(67, 233, 123, 0.4)' : 'none',
            background: statusFilter === 'Analizado' ? 'rgba(67, 233, 123, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            borderColor: statusFilter === 'Analizado' ? 'rgba(67, 233, 123, 0.3)' : 'rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ 
            background: 'rgba(67, 233, 123, 0.05)', 
            border: '1px solid rgba(67, 233, 123, 0.25)', 
            borderRadius: '12px', 
            padding: '12px', 
            color: 'var(--color-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Analizados con IA</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', lineHeight: 1 }}>{analyzedCount}</div>
          </div>
        </div>

        {/* Tarjeta En Proceso */}
        <div 
          className="glass-panel" 
          onClick={() => toggleStatusFilter('Procesando')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '20px', 
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid var(--color-warning)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: statusFilter === 'Procesando' ? 'translateY(-4px)' : 'none',
            boxShadow: statusFilter === 'Procesando' ? '0 10px 25px -10px rgba(241, 196, 15, 0.4)' : 'none',
            background: statusFilter === 'Procesando' ? 'rgba(241, 196, 15, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            borderColor: statusFilter === 'Procesando' ? 'rgba(241, 196, 15, 0.3)' : 'rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ 
            background: 'rgba(241, 196, 15, 0.05)', 
            border: '1px solid rgba(241, 196, 15, 0.25)', 
            borderRadius: '12px', 
            padding: '12px', 
            color: 'var(--color-warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Clock size={24} className={processingCount > 0 ? "loading-spin" : ""} style={{ animationDuration: '4s' }} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>En Proceso</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', lineHeight: 1 }}>{processingCount}</div>
          </div>
        </div>

        {/* Tarjeta Error */}
        <div 
          className="glass-panel" 
          onClick={() => toggleStatusFilter('Error')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '20px', 
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid var(--color-error)',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: statusFilter === 'Error' ? 'translateY(-4px)' : 'none',
            boxShadow: statusFilter === 'Error' ? '0 10px 25px -10px rgba(255, 94, 98, 0.4)' : 'none',
            background: statusFilter === 'Error' ? 'rgba(255, 94, 98, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            borderColor: statusFilter === 'Error' ? 'rgba(255, 94, 98, 0.3)' : 'rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ 
            background: 'rgba(255, 94, 98, 0.05)', 
            border: '1px solid rgba(255, 94, 98, 0.25)', 
            borderRadius: '12px', 
            padding: '12px', 
            color: 'var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Con Error</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', lineHeight: 1 }}>{errorCount}</div>
          </div>
        </div>

        {/* Tarjeta Cancelados */}
        <div 
          className="glass-panel" 
          onClick={() => toggleStatusFilter('Cancelado')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '20px', 
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '4px solid #64748b',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: statusFilter === 'Cancelado' ? 'translateY(-4px)' : 'none',
            boxShadow: statusFilter === 'Cancelado' ? '0 10px 25px -10px rgba(100, 116, 139, 0.4)' : 'none',
            background: statusFilter === 'Cancelado' ? 'rgba(100, 116, 139, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            borderColor: statusFilter === 'Cancelado' ? 'rgba(100, 116, 139, 0.3)' : 'rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ 
            background: 'rgba(100, 116, 139, 0.05)', 
            border: '1px solid rgba(100, 116, 139, 0.25)', 
            borderRadius: '12px', 
            padding: '12px', 
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <StopCircle size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Cancelados</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px', lineHeight: 1 }}>{canceledCount}</div>
          </div>
        </div>
      </div>

      {/* Caja de búsqueda y filtros */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={20} color="var(--text-muted)" style={{ position: 'absolute', left: '16px' }} />
          <input 
            type="text" 
            placeholder="Buscar por entidad, contrato, persona, cedula, objeto, palabras clave o resumen..." 
            className="form-input" 
            style={{ width: '100%', paddingLeft: '48px', height: '48px' }}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>

        {/* Filtros MinTic */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Entidad MinTic</label>
            <select
              style={{
                background: '#FFFFFF',
                color: '#2F3D42',
                border: '1.5px solid #E0E6ED',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontFamily: 'Roboto, sans-serif',
                fontWeight: 500,
                width: '100%',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'auto'
              }}
              value={filterInstitution}
              onChange={(e) => setFilterInstitution(e.target.value)}
            >
              <option value="Todos">— Todas las entidades —</option>
              {entidadesMinTic.map((ent, idx) => (
                <option key={idx} value={ent}>{ent}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tipo de Documento</label>
            <select
              style={{
                background: '#FFFFFF',
                color: '#2F3D42',
                border: '1.5px solid #E0E6ED',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontFamily: 'Roboto, sans-serif',
                fontWeight: 500,
                width: '100%',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'auto'
              }}
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="Todos">— Todos los tipos —</option>
              {tiposDocumento.map((tipo, idx) => (
                <option key={idx} value={tipo}>{tipo}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Resultados */}
      {dbError ? (
        <div className="glass-panel" style={{ padding: '32px', borderColor: 'var(--color-error)', background: 'rgba(239, 68, 68, 0.03)' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div className="dropzone-icon" style={{ borderColor: 'rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.05)', color: 'var(--color-error)', flexShrink: 0 }}>
              <AlertTriangle size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
                Error de Conexión / Permisos en Firebase
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                Firestore ha retornado el siguiente error: <code style={{ color: 'var(--color-error)', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>{dbError}</code>
              </p>
            </div>
          </div>
          
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-main)' }}>
              ¿Cómo solucionar este error?
            </h4>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
              Este error ocurre cuando las reglas de seguridad de Firestore no han sido configuradas o han expirado. Sigue estos sencillos pasos para publicarlas:
            </p>
            
            <ol style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '12px', lineHeight: '1.6', margin: 0 }}>
              <li>
                Ingresa a la <strong><a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>Consola de Firebase</a></strong> y selecciona tu proyecto <code>auditoria-mintc</code>.
              </li>
              <li>
                En el menú lateral izquierdo, haz clic en <strong>Firestore Database</strong> y ve a la pestaña <strong>Rules (Reglas)</strong>.
              </li>
              <li>
                Reemplaza las reglas actuales con el siguiente código y haz clic en <strong>Publish (Publicar)</strong>:
                <pre style={{ background: '#090d16', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '8px', overflowX: 'auto', fontSize: '0.8rem', color: '#a5b4fc', fontFamily: 'monospace' }}>
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`}
                </pre>
              </li>
              <li>
                Haz lo mismo para <strong>Storage</strong> en la consola (menú izquierdo) usando las reglas descritas en el archivo <code>firebase-rules.md</code>.
              </li>
            </ol>
          </div>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <div className="loading-spin" style={{ width: '40px', height: '40px', border: '3px solid var(--color-accent)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <Clock size={48} style={{ margin: '0 auto 16px', color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>No se encontraron documentos</h3>
          <p>Sube algunos archivos en la pestaña "Cargar Archivos" o ajusta tus criterios de búsqueda.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Barra de cabecera con botón de descarga masiva */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Documentos Encontrados ({filteredDocuments.length})
              {statusFilter !== 'Todos' && (
                <span 
                  onClick={() => setStatusFilter('Todos')}
                  style={{ 
                    fontSize: '0.75rem', 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    background: 'rgba(255,255,255,0.08)', 
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'var(--color-accent)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 500,
                    userSelect: 'none',
                    transition: 'all 0.2s'
                  }}
                  title="Limpiar filtro de estado"
                >
                  Filtrado: {statusFilter === 'Analizado' ? 'Analizados' : statusFilter === 'Procesando' ? 'En Proceso' : statusFilter === 'Error' ? 'Con Error' : 'Cancelados'}
                  <span style={{ fontWeight: 800 }}>×</span>
                </span>
              )}
            </h3>
            
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {userRole === 'administrador' && (
                <>
                  <button 
                    className="btn btn-secondary" 
                    style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      padding: '8px 16px', 
                      background: reanalyzingAll ? 'rgba(186, 85, 211, 0.1)' : 'rgba(255,255,255,0.02)', 
                      borderColor: reanalyzingAll ? '#ba55d3' : 'rgba(186, 85, 211, 0.25)',
                      color: '#ba55d3',
                      fontSize: '0.9rem',
                      cursor: 'pointer'
                    }}
                    onClick={handleReanalyzeAll}
                    disabled={reanalyzingAll}
                  >
                    <RefreshCw size={16} color="#ba55d3" className={reanalyzingAll ? "loading-spin" : ""} />
                    {reanalyzingAll ? 'Iniciando...' : 'Re-analizar Todo con IA'}
                  </button>

                  <button 
                    className="btn btn-secondary" 
                    style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      padding: '8px 16px', 
                      background: cancelingAll ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.02)', 
                      borderColor: cancelingAll ? '#ef4444' : 'rgba(239, 68, 68, 0.25)',
                      color: '#ef4444',
                      fontSize: '0.9rem',
                      cursor: 'pointer'
                    }}
                    onClick={handleCancelAll}
                    disabled={cancelingAll}
                  >
                    <StopCircle size={16} color="#ef4444" />
                    {cancelingAll ? 'Deteniendo...' : 'Detener Todos los Análisis'}
                  </button>
                </>
              )}

              <button 
                className="btn btn-secondary" 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '8px 16px', 
                  background: downloadingAll ? 'rgba(0, 242, 254, 0.1)' : 'rgba(255,255,255,0.02)', 
                  borderColor: downloadingAll ? 'var(--color-accent)' : 'var(--border-color)',
                  fontSize: '0.9rem'
                }}
                onClick={handleDownloadAll}
                disabled={downloadingAll}
              >
                <Download size={16} color="var(--color-accent)" />
                {downloadingAll ? downloadProgress : 'Descargar Todos con su Nombre'}
              </button>
            </div>
          </div>

          <div className="doc-grid">
            {filteredDocuments.slice(0, visibleCount).map((doc) => (
              <div 
                key={doc.id} 
                className="glass-panel doc-card"
                onClick={() => onSelectDoc(doc)}
              >
                <div>
                  <div className="doc-card-header">
                    {getStatusBadge(doc.status)}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={12} />
                        {doc.date && doc.date !== 'No especificada' ? doc.date : formatDocDate(doc.uploadedAt)}
                      </span>
                      <span>•</span>
                      <span className="badge" style={{ 
                        padding: '1px 6px', 
                        fontSize: '0.65rem', 
                        borderRadius: '4px', 
                        background: 'rgba(255, 255, 255, 0.05)', 
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        display: 'inline-block'
                      }}>
                        {doc.fileType || (doc.fileName ? doc.fileName.split('.').pop() : 'PDF')}
                      </span>
                      {doc.fileSize && (
                        <>
                          <span>•</span>
                          <span>{(doc.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
                        </>
                      )}
                      {doc.pageCount && (
                        <>
                          <span>•</span>
                          <span>{doc.pageCount} {doc.pageCount === 1 ? 'hoja' : 'hojas'}</span>
                        </>
                      )}
                    </span>
                  </div>

                  <h3 className="doc-card-title">
                    {doc.fileName}
                  </h3>
                  
                  <p className="doc-card-desc">
                    {doc.summary}
                  </p>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <div className="doc-meta-tags">
                    {doc.institution && doc.institution !== 'Detectando...' && doc.institution !== 'No especificado' && (
                      <span className="meta-tag" style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '4px',
                        borderColor: doc.institution === 'ANLA' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.25)', 
                        background: doc.institution === 'ANLA' ? 'rgba(59, 130, 246, 0.05)' : 'rgba(16, 185, 129, 0.05)',
                        color: doc.institution === 'ANLA' ? '#3b82f6' : '#10b981'
                      }}>
                        <Building size={10} color={doc.institution === 'ANLA' ? '#3b82f6' : '#10b981'} />
                        {doc.institution}
                      </span>
                    )}
                    {doc.sector && doc.sector !== 'Detectando...' && doc.sector !== 'No especificado' && (
                      <span className="meta-tag" style={{ display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(0, 242, 254, 0.25)', background: 'rgba(0, 242, 254, 0.05)' }}>
                        <Briefcase size={10} color="var(--color-primary)" />
                        {doc.sector}
                      </span>
                    )}
                    {doc.region && doc.region !== 'Detectando...' && doc.region !== 'No especificado' && (
                      <span className="meta-tag" style={{ display: 'flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(186, 85, 211, 0.25)', background: 'rgba(186, 85, 211, 0.05)' }}>
                        <MapPin size={10} color="#ba55d3" />
                        {doc.region}
                      </span>
                    )}
                    {(doc.departamento || doc.municipio) && (
                      <span className="meta-tag" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={10} color="var(--color-accent)" />
                        {doc.municipio && doc.municipio !== 'No especificado' && doc.municipio !== 'Detectando...' ? `${doc.municipio}, ` : ''}
                        {doc.departamento && doc.departamento !== 'No especificado' && doc.departamento !== 'Detectando...' ? doc.departamento : ''}
                      </span>
                    )}
                    {doc.company && doc.company !== 'Detectando...' && doc.company !== 'No especificado' && (
                      <span className="meta-tag" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Building size={10} />
                        {doc.company}
                      </span>
                    )}
                  </div>
                </div>

                {userRole === 'administrador' && doc.filePath && (
                  <>
                    {(doc.status?.includes('Procesando') || doc.status?.includes('Subiendo') || doc.status?.includes('archivo')) ? (
                      <button
                        className="btn btn-secondary"
                        style={{
                          width: '100%',
                          marginTop: '16px',
                          padding: '8px 12px',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          borderColor: 'rgba(239, 68, 68, 0.25)',
                          color: '#ef4444',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onClick={(e) => {
                          e.stopPropagation(); // Evitar abrir el visor de documentos al hacer clic en el botón
                          handleCancelAnalysis(doc.id);
                        }}
                      >
                        <StopCircle size={14} style={{ color: '#ef4444' }} />
                        Detener Análisis
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        style={{
                          width: '100%',
                          marginTop: '16px',
                          padding: '8px 12px',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          background: 'rgba(0, 242, 254, 0.05)',
                          borderColor: 'rgba(0, 242, 254, 0.2)',
                          color: 'var(--color-primary)',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onClick={(e) => {
                          e.stopPropagation(); // Evitar abrir el visor de documentos al hacer clic en el botón
                          handleReanalyze(doc.id, doc.filePath, doc.fileName);
                        }}
                      >
                        <RefreshCw size={14} style={{ color: 'var(--color-primary)' }} className="loading-spin-hover" />
                        Re-analizar con IA
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {filteredDocuments.length > visibleCount && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '32px', marginBottom: '16px' }}>
              <button 
                className="btn btn-secondary"
                style={{ 
                  padding: '12px 28px', 
                  fontSize: '0.9rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-main)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.2s'
                }}
                onClick={() => setVisibleCount(prev => prev + 60)}
              >
                Mostrar más resultados (+60)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
