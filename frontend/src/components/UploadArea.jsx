import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { UploadCloud, File, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

export default function UploadArea({ onUploadSuccess }) {
  const { currentUser } = useAuth();
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploads, setUploads] = useState([]); // [{ id, name, progress, status, error }]
  const [uploadReason, setUploadReason] = useState('');
  const fileInputRef = useRef(null);
  const reasonRef = useRef(null);
  const pendingQueueRef = useRef([]); // [{ id, file, uploadReason }]
  const activeUploadsCountRef = useRef(0); // number of current active network uploads

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploadReason.trim()) {
      setIsDragActive(false);
      return;
    }
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (!uploadReason.trim()) {
      if (reasonRef.current) {
        reasonRef.current.focus();
        reasonRef.current.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
        reasonRef.current.style.borderColor = 'var(--color-error)';
        setTimeout(() => {
          if (reasonRef.current) {
            reasonRef.current.style.boxShadow = 'none';
            reasonRef.current.style.borderColor = 'var(--border-color)';
          }
        }, 1500);
      }
      alert("Por favor, ingresa la explicación de los documentos antes de proceder a la carga.");
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (!uploadReason.trim()) {
      alert("Por favor, ingresa la explicación de los documentos antes de proceder a la carga.");
      return;
    }
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const triggerFileInput = () => {
    if (!uploadReason.trim()) {
      if (reasonRef.current) {
        reasonRef.current.focus();
        reasonRef.current.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
        reasonRef.current.style.borderColor = 'var(--color-error)';
        setTimeout(() => {
          if (reasonRef.current) {
            reasonRef.current.style.boxShadow = 'none';
            reasonRef.current.style.borderColor = 'var(--border-color)';
          }
        }, 1500);
      }
      alert("Por favor, ingresa la explicación de los documentos antes de proceder a la carga.");
      return;
    }
    fileInputRef.current.click();
  };

  const handleFiles = (files) => {
    const reason = uploadReason.trim();
    if (!reason) {
      if (reasonRef.current) {
        reasonRef.current.focus();
        reasonRef.current.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
        reasonRef.current.style.borderColor = 'var(--color-error)';
        setTimeout(() => {
          if (reasonRef.current) {
            reasonRef.current.style.boxShadow = 'none';
            reasonRef.current.style.borderColor = 'var(--border-color)';
          }
        }, 1500);
      }
      alert("Por favor, ingresa la explicación de los documentos antes de proceder a la carga.");
      return;
    }

    const validExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'docx'];
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    
    const newUploadRecords = [];
    const newQueueItems = [];

    Array.from(files).forEach((file) => {
      const ext = file.name.split('.').pop().toLowerCase();
      
      // 1. Validar Tipo de Archivo
      if (!validExtensions.includes(ext)) {
        const errorUpload = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          progress: 0,
          status: 'error',
          error: 'Formato no permitido. Solo se admiten PDFs, imágenes y Word (.docx).'
        };
        newUploadRecords.push(errorUpload);
        return;
      }

      // 2. Validar Tamaño del Archivo (Hasta 100MB)
      if (file.size > MAX_FILE_SIZE) {
        const errorUpload = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          progress: 0,
          status: 'error',
          error: 'El tamaño del archivo supera el límite permitido de 100MB.'
        };
        newUploadRecords.push(errorUpload);
        return;
      }

      const uploadId = Math.random().toString(36).substr(2, 9);
      const queueRecord = {
        id: uploadId,
        name: file.name,
        progress: 0,
        status: 'esperando',
        error: null
      };
      
      newUploadRecords.push(queueRecord);
      newQueueItems.push({ id: uploadId, file, uploadReason: reason });
    });

    if (newUploadRecords.length > 0) {
      setUploads(prev => [...newUploadRecords, ...prev]);
    }

    if (newQueueItems.length > 0) {
      pendingQueueRef.current = [...pendingQueueRef.current, ...newQueueItems];
      processQueue();
      // Limpiar explicación de la vista para preparar el siguiente grupo
      setUploadReason('');
    }
  };

  const processQueue = () => {
    // Limitamos la red a un máximo de 2 cargas simultáneas físicamente
    const MAX_CONCURRENT_UPLOADS = 2;

    while (activeUploadsCountRef.current < MAX_CONCURRENT_UPLOADS && pendingQueueRef.current.length > 0) {
      activeUploadsCountRef.current++;
      const nextItem = pendingQueueRef.current.shift();
      
      // Pasar el documento a estado 'subiendo' en la UI
      setUploads(prev => prev.map(u => 
        u.id === nextItem.id ? { ...u, status: 'subiendo' } : u
      ));

      executeUploadTask(nextItem.id, nextItem.file, nextItem.uploadReason);
    }
  };

  const pollDocumentStatus = (docId, uploadId) => {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutos de polling máximo
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        setUploads(prev => prev.map(u => 
          u.id === uploadId ? { ...u, status: 'error', error: 'El análisis tardó demasiado. Puedes ver el estado en el Dashboard.' } : u
        ));
        return;
      }

      try {
        const response = await fetch('/api/documents');
        if (response.ok) {
          const docs = await response.json();
          const currentDoc = docs.find(d => d.id === docId);
          if (currentDoc) {
            if (currentDoc.status === 'Analizado') {
              clearInterval(interval);
              setUploads(prev => prev.map(u => 
                u.id === uploadId ? { ...u, status: 'completado' } : u
              ));
              if (onUploadSuccess) {
                // Pequeña pausa antes de redirigir para que el usuario disfrute la animación de éxito
                setTimeout(() => {
                  onUploadSuccess();
                }, 1500);
              }
            } else if (currentDoc.status.includes('Error') || currentDoc.status === 'Error en Análisis') {
              clearInterval(interval);
              setUploads(prev => prev.map(u => 
                u.id === uploadId ? { ...u, status: 'error', error: currentDoc.errorMessage || 'Error durante el análisis inteligente.' } : u
              ));
            }
          }
        }
      } catch (err) {
        console.error('Error haciendo polling de documento:', err);
      }
    }, 5000);
  };

  const executeUploadTask = (uploadId, file, fileUploadReason) => {
    const reader = new FileReader();
    
    reader.onerror = () => {
      setUploads(prev => prev.map(u => 
        u.id === uploadId ? { ...u, status: 'error', error: 'Error al leer el archivo local.' } : u
      ));
      // Liberar slot en la cola y procesar siguiente
      activeUploadsCountRef.current = Math.max(0, activeUploadsCountRef.current - 1);
      processQueue();
    };

    reader.onload = () => {
      const base64Data = reader.result.split(',')[1];
      
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-document');
      xhr.setRequestHeader('Content-Type', 'application/json');

      // Seguir progreso de subida real
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploads(prev => prev.map(u => 
            u.id === uploadId ? { ...u, progress: Math.min(progress, 99) } : u
          ));
        }
      };

      xhr.onload = () => {
        // Liberar slot de la cola de inmediato tras el término de la petición de red
        activeUploadsCountRef.current = Math.max(0, activeUploadsCountRef.current - 1);
        processQueue();

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('Archivo subido con éxito:', response);
            
            // Subida completada, pasa a estado procesando por Gemini en el backend
            setUploads(prev => prev.map(u => 
              u.id === uploadId ? { ...u, progress: 100, status: 'procesando' } : u
            ));

            // Polling de 5 segundos para actualizar el estado
            pollDocumentStatus(response.docId, uploadId);

          } catch (e) {
            setUploads(prev => prev.map(u => 
              u.id === uploadId ? { ...u, status: 'error', error: 'Error al procesar la respuesta del servidor.' } : u
            ));
          }
        } else {
          let errorMsg = 'Error en el servidor al subir el archivo.';
          try {
            const errRes = JSON.parse(xhr.responseText);
            if (errRes && errRes.error) {
              errorMsg = errRes.error;
            }
          } catch (_) {}
          setUploads(prev => prev.map(u => 
            u.id === uploadId ? { ...u, status: 'error', error: errorMsg } : u
          ));
        }
      };

      xhr.onerror = () => {
        // Liberar slot de la cola
        activeUploadsCountRef.current = Math.max(0, activeUploadsCountRef.current - 1);
        processQueue();

        setUploads(prev => prev.map(u => 
          u.id === uploadId ? { ...u, status: 'error', error: 'No se pudo conectar con el servidor backend.' } : u
        ));
      };

      xhr.send(JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        fileData: base64Data,
        userId: currentUser.uid,
        uploadReason: fileUploadReason
      }));
    };

    reader.readAsDataURL(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Campo obligatorio de Justificación de Carga */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label htmlFor="uploadReason" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
          <span>📝</span> Explicación obligatoria de los documentos a cargar <span style={{ color: 'var(--color-error)' }}>*</span>
        </label>
        <textarea
          id="uploadReason"
          ref={reasonRef}
          value={uploadReason}
          onChange={(e) => setUploadReason(e.target.value)}
          placeholder="Ej: Subida de resoluciones de inicio de trámite ambiental correspondientes a la concesión de aguas para el proyecto hidroeléctrico de la cuenca media..."
          rows={3}
          style={{
            width: '100%',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '12px',
            color: 'var(--text-main)',
            fontSize: '0.9rem',
            lineHeight: '1.5',
            resize: 'vertical',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            outline: 'none'
          }}
        />
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          * Debes rellenar este campo explicativo para poder desbloquear el área de carga de archivos. Esto quedará registrado de forma permanente en el módulo de auditoría general.
        </p>
      </div>

      <div 
        className={`dropzone ${isDragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={triggerFileInput}
        style={{
          opacity: uploadReason.trim() ? 1 : 0.45,
          cursor: uploadReason.trim() ? 'pointer' : 'not-allowed',
          borderColor: uploadReason.trim() ? '' : 'rgba(255, 255, 255, 0.05)',
          background: uploadReason.trim() ? '' : 'rgba(255, 255, 255, 0.01)',
          transition: 'all 0.3s ease'
        }}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          multiple 
          onChange={handleChange} 
          style={{ display: 'none' }}
          accept=".pdf,.png,.jpg,.jpeg,.docx"
        />
        <div className="dropzone-icon" style={{ color: uploadReason.trim() ? 'var(--color-primary)' : 'var(--text-muted)' }}>
          {uploadReason.trim() ? <UploadCloud size={32} /> : <span>🔒</span>}
        </div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px', color: uploadReason.trim() ? 'var(--text-main)' : 'var(--text-secondary)' }}>
            {uploadReason.trim() ? 'Arrastra y suelta tus documentos aquí' : 'Área de carga bloqueada'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {uploadReason.trim() ? 'Soporta PDFs, Imágenes (PNG, JPG) y Word (.docx) de hasta 100MB' : 'Por favor escribe la explicación de los documentos arriba para desbloquear la carga'}
          </p>
        </div>
        <button 
          type="button" 
          className="btn btn-secondary"
          disabled={!uploadReason.trim()}
          style={{ opacity: uploadReason.trim() ? 1 : 0.5, cursor: uploadReason.trim() ? 'pointer' : 'not-allowed' }}
        >
          Seleccionar Archivos
        </button>
      </div>

      {/* Consejo de descarga masiva */}
      <div className="glass-panel" style={{ background: 'rgba(0, 242, 254, 0.02)', borderColor: 'rgba(0, 242, 254, 0.1)', padding: '16px 20px', borderRadius: '12px' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', lineHeight: '1.4' }}>
          <span style={{ fontSize: '1.2rem' }}>💡</span>
          <strong>Consejo Premium:</strong> ¡Recuerda que en el Dashboard puedes descargar todos los archivos filtrados de una sola vez con sus nombres originales!
        </p>
      </div>

      {uploads.length > 0 && (
        <div className="glass-panel">
          <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <File size={18} color="var(--color-accent)" />
            Cola de Procesamiento de Archivos ({uploads.filter(u => u.status !== 'completado').length} en progreso)
          </h4>
          
          <div className="upload-list">
            {uploads.map((upload) => (
              <div key={upload.id} className="upload-item">
                <div className="upload-item-header">
                  <div className="upload-item-name">
                    <File size={16} style={{ minWidth: '16px' }} />
                    <span>{upload.name}</span>
                  </div>
                  <div>
                    {upload.status === 'subiendo' && (
                      <span className="badge badge-processing">Subiendo {upload.progress}%</span>
                    )}
                    {upload.status === 'procesando' && (
                      <span className="badge badge-pending" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="loading-spin" style={{ display: 'inline-block', width: '10px', height: '10px', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }}></span>
                        Analizando con Gemini...
                      </span>
                    )}
                    {upload.status === 'completado' && (
                      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={12} />
                        Procesado
                      </span>
                    )}
                    {upload.status === 'error' && (
                      <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={12} />
                        Error
                      </span>
                    )}
                  </div>
                </div>

                {upload.status === 'subiendo' && (
                  <div className="upload-item-progress-bar">
                    <div className="upload-item-progress" style={{ width: `${upload.progress}%` }}></div>
                  </div>
                )}

                {upload.error && (
                  <p style={{ color: 'var(--color-error)', fontSize: '0.8rem', marginTop: '4px' }}>
                    {upload.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
