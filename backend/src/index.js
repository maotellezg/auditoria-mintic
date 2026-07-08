import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, storage } from './services/firebase.js';
import { analyzeDocument } from './services/gemini.js';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { getEmbedding } from './services/embeddings.js';
import { extractTextFromDocument, splitTextIntoChunks } from './services/chunker.js';
import { VertexAI } from '@google-cloud/vertexai';
import nodemailer from 'nodemailer';
import { fetchContratante, countContratante, fetchProveedor, countProveedor, normalizarContrato, ENTIDADES_MINTIC, SECOP_SOURCES } from './services/secop.js';
import { sincronizarTodo } from './services/secopSync.js';
import { initBigQuery, queryBQ, querySecopBQ, resumenEntidadBQ, DATASET_ID } from './services/bigquery.js';
import { indexarContratosEnRAG } from './services/bqRagIndexer.js';
import { kpisComparativos, serieMensual, tiposContrato, modalidades, topContratistas, prestacionServicios, heatmapMensual, alertasRiesgo, topContratosValor } from './services/analytics.js';




// Inicializar BigQuery al arrancar (crea dataset y tablas si no existen)
initBigQuery().catch(err => console.warn('[BQ] Error al inicializar:', err.message));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Inicializar Vertex AI para el RAG Chat
const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location = process.env.GCP_LOCATION || 'us-central1';
const vertexAI = new VertexAI({
  project: projectId,
  location: location
});


// Configurar CORS para permitir peticiones desde el frontend en desarrollo
app.use(cors({
  origin: '*', // En producción se puede restringir al dominio específico
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Endpoint de estado / prueba
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor de Auditoria MinTic operativo.' });
});

/**
 * Determina el tipo MIME basado en la extensión si no es provisto
 * @param {string} filename 
 */
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'txt': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

/**
 * Intenta calcular el número de páginas de un PDF leyendo su Buffer binario
 * @param {Buffer} buffer 
 */
function getPdfPageCount(buffer) {
  try {
    const str = buffer.toString('ascii');
    // 1. Intentar encontrar "/Type /Pages" con su "/Count"
    const pagesMatches = str.match(/\/Type\s*\/Pages\s*\/Count\s*(\d+)/g);
    if (pagesMatches) {
      let maxPages = 0;
      for (const m of pagesMatches) {
        const num = m.match(/\d+/);
        if (num) {
          const val = parseInt(num[0], 10);
          if (val > maxPages) maxPages = val;
        }
      }
      if (maxPages > 0) return maxPages;
    }

    // 2. Intentar buscar simplemente /Count seguido de número
    const countMatches = str.match(/\/Count\s+(\d+)/g);
    if (countMatches) {
      let maxPages = 0;
      for (const m of countMatches) {
        const num = m.match(/\d+/);
        if (num) {
          const val = parseInt(num[0], 10);
          if (val > maxPages) maxPages = val;
        }
      }
      if (maxPages > 0) return maxPages;
    }

    // 3. Contar ocurrencias individuales de "/Type /Page"
    const pageMatches = str.match(/\/Type\s*\/Page\b/g);
    if (pageMatches) {
      return pageMatches.length;
    }

    return 1;
  } catch (error) {
    console.error('Error al calcular páginas del PDF:', error);
    return 1;
  }
}

/**
 * Función asíncrona auxiliar para procesar y analizar el documento con Gemini en segundo plano
 */
async function processAndAnalyzeDocument(docId, filePath, fileName, fileBuffer, userId = null) {
  try {
    const docRef = db.collection('documents').doc(docId);
    
    // Checkpoint 1: Inicial
    const snap1 = await docRef.get();
    if (snap1.exists && snap1.data().status === 'Cancelado') {
      console.log(`[ABORT-1] Análisis cancelado por el usuario para docId: ${docId} en checkpoint inicial.`);
      return;
    }

    await docRef.update({
      status: 'Procesando con Gemini...',
      updatedAt: new Date().toISOString()
    });

    console.log(`Iniciando análisis asíncrono para docId: ${docId}, archivo: ${fileName}`);

    // Determinar el tipo de contenido (mimeType)
    const mimeType = getMimeType(fileName);

    // Checkpoint 2: Antes de invocar Gemini
    const snap2 = await docRef.get();
    if (snap2.exists && snap2.data().status === 'Cancelado') {
      console.log(`[ABORT-2] Análisis cancelado por el usuario para docId: ${docId} antes de llamar a Gemini.`);
      return;
    }

    // Invocar a Gemini para procesar el buffer
    console.log('Invocando a Vertex AI (Gemini) para análisis...');
    const geminiAnalysis = await analyzeDocument(fileBuffer, fileName, mimeType, filePath);

    // Checkpoint 3: Antes de guardar los resultados en Firestore
    const snap3 = await docRef.get();
    if (snap3.exists && snap3.data().status === 'Cancelado') {
      console.log(`[ABORT-3] Análisis cancelado por el usuario para docId: ${docId} después de Gemini, evitando persistencia.`);
      return;
    }

    // Extraer los metadatos de auditoría de IA
    const { _audit, ...geminiResults } = geminiAnalysis;

    const fileExt = fileName.split('.').pop().toUpperCase();
    let pageCount = null;
    if (fileExt === 'PDF') {
      pageCount = getPdfPageCount(fileBuffer);
    }

    // Enriquecer los resultados con metadatos de control y guardar en Firestore
    const updatedData = {
      ...geminiResults,
      fileName: fileName,
      filePath: filePath,
      fileSize: fileBuffer.length,
      fileType: fileExt,
      pageCount: pageCount,
      mimeType: mimeType,
      updatedAt: new Date().toISOString(),
      iaMetadata: _audit || null
    };

    console.log('Guardando resultados en Firestore...');
    await docRef.set(updatedData, { merge: true });
    console.log(`Documento ${docId} analizado y guardado con éxito!`);

    // Indexar texto completo para búsqueda vectorial (RAG) en background de forma resiliente
    try {
      await indexDocumentText(docId, filePath, mimeType, updatedData);
    } catch (idxErr) {
      console.error(`[Indexing-Auto] Error al indexar automáticamente el documento ${docId}:`, idxErr.message);
    }

    // Log del análisis de IA completado en la auditoría general
    if (_audit) {
      let userEmail = 'sistema';
      if (userId) {
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists) {
            userEmail = userDoc.data().email || 'sistema';
          }
        } catch (err) {
          console.warn('No se pudo recuperar el correo electrónico para la auditoría de IA:', err.message);
        }
      }
      await logAuditEvent(userId, userEmail, 'IA_ANALYSIS', {
        docId: docId,
        fileName: fileName,
        fileSize: fileBuffer.length,
        fileType: fileExt,
        pageCount: pageCount,
        modelUsed: _audit.modelUsed,
        durationMs: _audit.durationMs,
        tokens: _audit.tokens
      });
    }

  } catch (error) {
    console.error(`Error procesando documento ${docId} de forma asíncrona:`, error);

    // Actualizar el estado en Firestore a "Error" si no fue cancelado por el usuario
    try {
      const docRef = db.collection('documents').doc(docId);
      const errSnap = await docRef.get();
      if (errSnap.exists && errSnap.data().status === 'Cancelado') {
        console.log(`[ABORT-ERROR-CATCH] No se cambia a estado Error ya que el documento fue cancelado.`);
        return;
      }
      await docRef.update({
        status: 'Error en Análisis',
        errorMessage: error.message,
        updatedAt: new Date().toISOString()
      });
    } catch (dbError) {
      console.error('Error al actualizar estado fallido en Firestore:', dbError);
    }
  }
}

/**
 * Indexa el texto completo de un documento dividiéndolo en fragmentos y generando embeddings de Vertex AI.
 */
async function indexDocumentText(docId, filePath, mimeType, docData) {
  try {
    console.log(`[Indexing] Iniciando indexación automática de texto para el documento ID: ${docId}`);
    
    // 1. Extraer texto del documento
    const text = await extractTextFromDocument(filePath, mimeType);
    if (!text || text.trim().length === 0) {
      console.warn(`[Indexing] El documento ${docId} no contiene texto extraíble o legible. Marcando como indexed: true con 0 chunks.`);
      await db.collection('documents').doc(docId).update({
        indexed: true,
        indexedAt: new Date().toISOString(),
        chunksCount: 0
      });
      return;
    }

    // 2. Fragmentar en chunks de 1200 chars con solapamiento
    const chunks = splitTextIntoChunks(text);
    console.log(`[Indexing] Documento ${docId} dividido en ${chunks.length} fragmentos.`);

    if (chunks.length === 0) {
      await db.collection('documents').doc(docId).update({
        indexed: true,
        indexedAt: new Date().toISOString(),
        chunksCount: 0
      });
      return;
    }

    // 3. Generar embeddings y guardar cada chunk en Firestore
    let chunkRefBatch = db.batch();
    let batchCount = 0;
    const maxBatchSize = 400;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await getEmbedding(chunkText);

      const chunkDocId = `${docId}_chunk_${i}`;
      const chunkRef = db.collection('document_chunks').doc(chunkDocId);

      const chunkData = {
        docId: docId,
        fileName: docData.fileName || '',
        chunkIndex: i,
        text: chunkText,
        embedding: FieldValue.vector(embedding),
        sector: docData.sector || 'OTRO',
        company: docData.company || 'No especificado',
        region: docData.region || 'No especificada',
        departamento: docData.departamento || 'No especificado',
        municipio: docData.municipio || 'No especificado',
        institution: docData.institution || 'ANLA',
        createdAt: new Date().toISOString()
      };

      chunkRefBatch.set(chunkRef, chunkData);
      batchCount++;

      if (batchCount >= maxBatchSize) {
        await chunkRefBatch.commit();
        console.log(`[Indexing] Guardado lote de ${batchCount} fragmentos de RAG.`);
        chunkRefBatch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await chunkRefBatch.commit();
      console.log(`[Indexing] Guardado último lote de ${batchCount} fragmentos de RAG.`);
    }

    // 4. Marcar documento como indexado con éxito
    await db.collection('documents').doc(docId).update({
      indexed: true,
      indexedAt: new Date().toISOString(),
      chunksCount: chunks.length
    });
    console.log(`[Indexing] Documento ${docId} indexado con éxito con ${chunks.length} chunks!`);

  } catch (error) {
    console.error(`[Indexing] Error crítico al indexar texto del documento ${docId}:`, error);
    await db.collection('documents').doc(docId).update({
      indexed: 'error',
      indexingError: error.message,
      updatedAt: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * GET /api/documents
 * Obtiene todos los documentos registrados en Firestore de forma segura sin pasar por reglas del cliente
 */
app.get('/api/documents', async (req, res) => {
  try {
    console.log('Obteniendo documentos desde Firestore...');
    const snapshot = await db.collection('documents').orderBy('uploadedAt', 'desc').get();
    const docs = [];
    snapshot.forEach(doc => {
      docs.push({ id: doc.id, ...doc.data() });
    });
    return res.json(docs);
  } catch (error) {
    console.error('Error en GET /api/documents:', error);
    return res.status(500).json({
      error: 'Error al recuperar documentos de la base de datos',
      details: error.message
    });
  }
});

/**
 * POST /api/upload-document
 * Recibe archivo serializado en Base64, realiza validación de duplicados,
 * registra en Firestore, sube a Storage y lanza análisis en background.
 */
app.post('/api/upload-document', async (req, res) => {
  const { fileName, fileSize, fileData, userId, uploadReason } = req.body;

  if (!fileName || !fileSize || !fileData || !userId || !uploadReason || !uploadReason.trim()) {
    return res.status(400).json({ error: 'Faltan campos obligatorios o justificación: fileName, fileSize, fileData, userId, uploadReason' });
  }

  console.log(`Recibiendo subida de documento: ${fileName} (${fileSize} bytes)`);

  try {
    // 1. Validar duplicado en Firestore para evitar documentos repetidos
    const querySnapshot = await db.collection('documents')
      .where('fileName', '==', fileName)
      .where('fileSize', '==', fileSize)
      .get();

    if (!querySnapshot.empty) {
      console.warn(`Intento de subir documento duplicado bloqueado: ${fileName}`);
      return res.status(400).json({ error: 'Documento repetido: ya existe en el sistema.' });
    }

    // 3. Decodificar buffer Base64
    const fileBuffer = Buffer.from(fileData, 'base64');

    const fileExt = fileName.split('.').pop().toUpperCase();
    let pageCount = null;
    if (fileExt === 'PDF') {
      pageCount = getPdfPageCount(fileBuffer);
    }

    // 2. Crear documento inicial en Firestore en estado "Subiendo archivo..."
    const docData = {
      fileName: fileName,
      fileSize: fileSize,
      fileType: fileExt,
      pageCount: pageCount,
      status: 'Subiendo archivo...',
      userId: userId,
      uploadReason: uploadReason.trim(),
      uploadedAt: new Date().toISOString(),
      institution: 'Detectando...',
      documentType: 'Detectando...',
      sector: 'Detectando...',
      company: 'Detectando...',
      region: 'Detectando...',
      departamento: 'Detectando...',
      municipio: 'Detectando...',
      summary: 'Procesando documento con inteligencia artificial...',
      importantDates: [],
      signatories: [],
      relevantData: [],
      keyThemes: [],
      wikiKeywords: []
    };

    const docRef = await db.collection('documents').add(docData);
    const docId = docRef.id;

    // Obtener el correo del usuario que sube para la auditoría
    let userEmail = 'desconocido';
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        userEmail = userDoc.data().email || 'desconocido';
      }
    } catch (eEmail) {
      console.warn('No se pudo recuperar el correo para el log de subida:', eEmail.message);
    }

    // Registrar en auditoría la carga
    await logAuditEvent(userId, userEmail, 'UPLOAD_DOCUMENT', {
      docId: docId,
      fileName: fileName,
      fileSize: fileSize,
      fileType: fileExt,
      pageCount: pageCount,
      uploadReason: uploadReason.trim()
    });

    // 4. Subir archivo a Cloud Storage
    const storagePath = `documents/${userId}_${Date.now()}_${fileName}`;
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    console.log(`Subiendo archivo a Cloud Storage: ${storagePath}...`);
    const mimeType = getMimeType(fileName);
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType
      }
    });

    // Actualizar ruta del archivo en el documento inicial
    await docRef.update({
      filePath: storagePath
    });

    // 5. Lanzar análisis con Gemini de manera asíncrona en segundo plano sin bloquear el HTTP response
    processAndAnalyzeDocument(docId, storagePath, fileName, fileBuffer, userId);

    return res.json({
      success: true,
      message: 'Archivo recibido y subido con éxito, análisis iniciado.',
      docId: docId,
      filePath: storagePath
    });

  } catch (error) {
    console.error('Error en POST /api/upload-document:', error);
    return res.status(500).json({
      error: 'Error interno al subir el documento',
      details: error.message
    });
  }
});

/**
 * GET /api/download-file
 * Descarga y transmite (stream) un archivo de Cloud Storage directamente al navegador
 * saltándose las reglas de cliente de Cloud Storage y enviando el tipo MIME adecuado.
 */
app.get('/api/download-file', async (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: 'Falta parámetro de consulta obligatorio: filePath' });
  }

  try {
    const bucket = storage.bucket();
    const file = bucket.file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: `El archivo ${filePath} no existe en Cloud Storage.` });
    }

    const mimeType = getMimeType(filePath);
    res.setHeader('Content-Type', mimeType);
    
    // Configurar Content-Disposition para ver inline si es soportado (PDF, imágenes)
    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);

    console.log(`Streaming de archivo a cliente: ${filePath}`);
    file.createReadStream()
      .on('error', (streamErr) => {
        console.error('Error en streaming de archivo:', streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error al descargar el archivo' });
        }
      })
      .pipe(res);

  } catch (error) {
    console.error('Error en GET /api/download-file:', error);
    return res.status(500).json({
      error: 'Error al procesar la descarga',
      details: error.message
    });
  }
});

/**
 * POST /api/process-document
 * Recibe la información del documento subido, descarga de Cloud Storage, invoca a Gemini y guarda en Firestore.
 * (Mantenemos por compatibilidad con cualquier flujo previo)
 */
app.post('/api/process-document', checkAdmin, async (req, res) => {
  const { docId, filePath, fileName } = req.body;

  if (!docId || !filePath || !fileName) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: docId, filePath, fileName' });
  }

  console.log(`Petición recibida para procesar docId: ${docId}, ruta: ${filePath}`);

  try {
    const docRef = db.collection('documents').doc(docId);
    await docRef.update({
      status: 'Procesando con Gemini...',
      updatedAt: new Date().toISOString()
    });

    // Registrar en auditoría la solicitud de re-análisis
    await logAuditEvent(req.adminUser.uid, req.adminUser.email, 'REANALYZE_DOCUMENT', {
      docId: docId,
      fileName: fileName
    });

    const bucket = storage.bucket();
    const file = bucket.file(filePath);

    console.log(`Descargando archivo desde Storage: ${filePath}...`);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`El archivo ${filePath} no existe en Cloud Storage.`);
    }

    const [fileBuffer] = await file.download();
    console.log(`Archivo descargado con éxito. Tamaño: ${fileBuffer.length} bytes.`);

    // Ejecutar el análisis pesado con Gemini de manera asíncrona en segundo plano sin bloquear el HTTP response
    processAndAnalyzeDocument(docId, filePath, fileName, fileBuffer, req.adminUser.uid);

    return res.json({
      success: true,
      message: 'Análisis iniciado en segundo plano con éxito.'
    });

  } catch (error) {
    console.error(`Error al iniciar procesamiento de documento ${docId}:`, error);

    try {
      const docRef = db.collection('documents').doc(docId);
      await docRef.update({
        status: 'Error en Análisis',
        errorMessage: error.message,
        updatedAt: new Date().toISOString()
      });
    } catch (dbError) {
      console.error('Error al actualizar estado fallido en Firestore:', dbError);
    }

    return res.status(500).json({
      error: 'Error al iniciar el procesamiento del documento',
      details: error.message
    });
  }
});

/**
 * Función asíncrona para re-análisis masivo secuencial en segundo plano
 */
async function bulkReanalyzeBackground(docs, adminUserId = null) {
  console.log(`Iniciando re-análisis masivo en segundo plano para ${docs.length} documentos...`);
  const bucket = storage.bucket();

  for (const doc of docs) {
    const docId = doc.id;
    const filePath = doc.filePath;
    const fileName = doc.fileName;

    try {
      const docRef = db.collection('documents').doc(docId);
      
      // Checkpoint antes de iniciar descarga
      const checkSnap = await docRef.get();
      if (checkSnap.exists && checkSnap.data().status === 'Cancelado') {
        console.log(`[BULK] Documento ${docId} está Cancelado. Saltando.`);
        continue;
      }

      console.log(`[BULK] Descargando de Storage para docId: ${docId}, ruta: ${filePath}`);
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (!exists) {
        console.error(`[BULK] Archivo ${filePath} no existe en Cloud Storage.`);
        await docRef.update({
          status: 'Error en Análisis',
          errorMessage: `El archivo no existe en Cloud Storage: ${filePath}`,
          updatedAt: new Date().toISOString()
        });
        continue;
      }

      const [fileBuffer] = await file.download();
      console.log(`[BULK] Archivo descargado con éxito (${fileBuffer.length} bytes). Procesando...`);

      // Ejecutar análisis secuencialmente de forma síncrona dentro del loop de fondo
      await processAndAnalyzeDocument(docId, filePath, fileName, fileBuffer, adminUserId);

      // Pequeña pausa entre solicitudes para respetar cuotas de Gemini (Vertex AI rate limits)
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`[BULK] Error en el re-análisis de ${docId}:`, error);
      try {
        const docRef = db.collection('documents').doc(docId);
        const postErrSnap = await docRef.get();
        if (postErrSnap.exists && postErrSnap.data().status === 'Cancelado') {
          console.log(`[BULK-ERROR] Documento fue cancelado. No se altera el estado.`);
          continue;
        }
        await docRef.update({
          status: 'Error en Análisis',
          errorMessage: error.message,
          updatedAt: new Date().toISOString()
        });
      } catch (dbErr) {
        console.error('Error actualizando estado en Firestore:', dbErr);
      }
    }
  }
  console.log('[BULK] Proceso de re-análisis masivo finalizado.');
}

/**
 * POST /api/admin/cancel-document
 * Detiene y cancela un análisis en proceso.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/cancel-document', checkAdmin, async (req, res) => {
  const { docId } = req.body;

  if (!docId) {
    return res.status(400).json({ error: 'Falta campo obligatorio: docId' });
  }

  try {
    console.log(`[ADMIN] Solicitando cancelación de análisis para docId: ${docId}`);
    const docRef = db.collection('documents').doc(docId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'El documento no existe.' });
    }

    const currentStatus = docSnap.data().status || '';
    if (!currentStatus.includes('Procesando') && !currentStatus.includes('Subiendo') && !currentStatus.includes('archivo')) {
      return res.status(400).json({ error: 'El documento no se encuentra en proceso de análisis o subida.' });
    }

    const fileName = docSnap.data().fileName || 'documento';

    await docRef.update({
      status: 'Cancelado',
      summary: 'El análisis fue detenido por el administrador.',
      updatedAt: new Date().toISOString()
    });

    // Registrar en auditoría la cancelación individual
    await logAuditEvent(req.adminUser.uid, req.adminUser.email, 'CANCEL_ANALYSIS', {
      docId: docId,
      fileName: fileName
    });

    console.log(`[ADMIN] ✅ Análisis para docId: ${docId} marcado como Cancelado.`);
    return res.json({
      success: true,
      message: 'El análisis del documento fue detenido con éxito.'
    });
  } catch (error) {
    console.error('Error al cancelar análisis de documento:', error);
    return res.status(500).json({ error: 'No se pudo detener el análisis.', details: error.message });
  }
});

/**
 * POST /api/admin/cancel-all
 * Detiene y cancela todos los análisis que estén actualmente en proceso.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/cancel-all', checkAdmin, async (req, res) => {
  try {
    console.log('[ADMIN] Solicitando cancelación masiva de todos los análisis activos.');

    const snapshot = await db.collection('documents').get();
    const docsToCancel = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const currentStatus = data.status || '';
      if (currentStatus.includes('Procesando') || currentStatus.includes('Subiendo') || currentStatus.includes('archivo')) {
        docsToCancel.push({
          id: doc.id,
          fileName: data.fileName || 'documento'
        });
      }
    });

    if (docsToCancel.length === 0) {
      return res.json({
        success: true,
        message: 'No hay análisis activos para detener.'
      });
    }

    // Actualizar todos los estados en un batch
    const batch = db.batch();
    for (const d of docsToCancel) {
      const ref = db.collection('documents').doc(d.id);
      batch.update(ref, {
        status: 'Cancelado',
        summary: 'El análisis fue detenido por el administrador mediante cancelación masiva.',
        updatedAt: new Date().toISOString()
      });
    }
    await batch.commit();

    // Registrar en auditoría la cancelación masiva
    await logAuditEvent(req.adminUser.uid, req.adminUser.email, 'CANCEL_ALL', {
      count: docsToCancel.length
    });

    console.log(`[ADMIN] ✅ Se cancelaron ${docsToCancel.length} análisis activos.`);
    return res.json({
      success: true,
      message: `Se han detenido con éxito los ${docsToCancel.length} análisis activos.`
    });

  } catch (error) {
    console.error('Error al realizar la cancelación masiva:', error);
    return res.status(500).json({
      error: 'Error al realizar la cancelación masiva',
      details: error.message
    });
  }
});

/**
 * POST /api/admin/reanalyze-all
 * Re-analiza todos los documentos elegibles del sistema secuencialmente en segundo plano.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/reanalyze-all', checkAdmin, async (req, res) => {
  try {
    console.log('[ADMIN] Solicitando re-análisis masivo de todos los documentos.');
    
    // Obtener todos los documentos de Firestore
    const snapshot = await db.collection('documents').get();
    const docsToProcess = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const currentStatus = data.status || '';
      // Solo elegibles si tienen filePath y no están ya procesándose o subiéndose
      if (data.filePath && !currentStatus.includes('Procesando') && !currentStatus.includes('Subiendo') && !currentStatus.includes('archivo')) {
        docsToProcess.push({
          id: doc.id,
          filePath: data.filePath,
          fileName: data.fileName || 'documento'
        });
      }
    });

    if (docsToProcess.length === 0) {
      return res.json({
        success: true,
        message: 'No hay documentos elegibles para re-analizar en este momento (todos están en proceso o no tienen archivo subido).'
      });
    }

    // Actualizar todos los estados elegibles a "Procesando con Gemini..." inmediatamente en lote (batch) para feedback visual rápido
    const batch = db.batch();
    for (const d of docsToProcess) {
      const ref = db.collection('documents').doc(d.id);
      batch.update(ref, {
        status: 'Procesando con Gemini...',
        updatedAt: new Date().toISOString()
      });
    }
    await batch.commit();

    // Registrar en auditoría la solicitud de re-análisis masivo
    await logAuditEvent(req.adminUser.uid, req.adminUser.email, 'REANALYZE_ALL', {
      count: docsToProcess.length
    });

    // Lanzar el procesamiento masivo en segundo plano de forma secuencial
    bulkReanalyzeBackground(docsToProcess, req.adminUser.uid);

    return res.json({
      success: true,
      message: `Se ha iniciado el re-análisis de ${docsToProcess.length} documentos en segundo plano.`
    });

  } catch (error) {
    console.error('Error al iniciar re-análisis masivo:', error);
    return res.status(500).json({
      error: 'Error al iniciar el re-análisis masivo',
      details: error.message
    });
  }
});

const authAdmin = getAuth();

/**
 * Función asíncrona auxiliar para guardar logs de auditoría en Firestore
 */
async function logAuditEvent(userId, userEmail, action, details = {}) {
  try {
    const auditRef = db.collection('audit');
    await auditRef.add({
      timestamp: new Date().toISOString(),
      userId: userId || 'sistema',
      userEmail: userEmail || 'sistema',
      action: action,
      details: details
    });
    console.log(`[AUDIT-LOG] Action: ${action} registrado con éxito para ${userEmail || userId}`);
  } catch (error) {
    console.error('Error crítico al escribir log de auditoría en Firestore:', error);
  }
}

/**
 * Middleware para validar que el usuario sea un usuario registrado (administrador o visualizador).
 */
async function checkUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token de sesión.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await authAdmin.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error al verificar token de usuario:', error);
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

/**
 * GET /api/audit
 * Recupera todos los registros de auditoría ordenados por fecha descendente.
 * Visible para cualquier usuario autenticado (público).
 */
app.get('/api/audit', checkUser, async (req, res) => {
  try {
    console.log('Recuperando registros de auditoría desde Firestore...');
    const snapshot = await db.collection('audit').orderBy('timestamp', 'desc').get();
    const logs = [];
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return res.json(logs);
  } catch (error) {
    console.error('Error en GET /api/audit:', error);
    return res.status(500).json({
      error: 'Error al recuperar los registros de auditoría de la base de datos',
      details: error.message
    });
  }
});

/**
 * POST /api/documents/view
 * Registra en la auditoría que un usuario entró a ver un documento.
 */
app.post('/api/documents/view', checkUser, async (req, res) => {
  const { docId } = req.body;
  if (!docId) {
    return res.status(400).json({ error: 'Falta campo obligatorio: docId' });
  }

  try {
    const user = req.user;
    const docSnap = await db.collection('documents').doc(docId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'El documento no existe.' });
    }

    const docData = docSnap.data();
    await logAuditEvent(user.uid, user.email, 'VIEW_DOCUMENT', {
      docId: docId,
      fileName: docData.fileName || 'documento'
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error al registrar auditoría de visualización:', error);
    return res.status(500).json({ error: 'Error interno al registrar visualización.' });
  }
});

/**
 * Middleware para validar que el usuario que realiza la petición sea un Administrador registrado.
 */
async function checkAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token de sesión.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await authAdmin.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    
    // Buscar el rol asignado en Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'administrador') {
      return res.status(403).json({ error: 'Acceso denegado: se requieren permisos de administrador.' });
    }
    
    req.adminUser = decodedToken;
    next();
  } catch (error) {
    console.error('Error al verificar privilegios de administrador:', error);
    return res.status(401).json({ error: 'Sesión inválida o expirada. Por favor, vuelve a iniciar sesión.' });
  }
}

/**
 * GET /api/user-role
 * Obtiene el rol asignado al usuario logueado usando el Admin SDK.
 * Accesible por cualquier usuario autenticado (administrador o visualizador).
 */
app.get('/api/user-role', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token de sesión.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await authAdmin.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      return res.json({ 
        role: userData.role || 'visualizador',
        requirePasswordChange: userData.requirePasswordChange || false,
        status: userData.status || 'ACTIVE'
      });
    }
    // Si existe la cuenta en Firebase Auth pero no hay perfil en Firestore,
    // retornamos 'visualizador' por defecto de forma segura.
    return res.json({ role: 'visualizador', requirePasswordChange: false, status: 'ACTIVE' });
  } catch (error) {
    console.error('Error al obtener rol de usuario:', error);
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
});

/**
 * POST /api/user/complete-setup
 * Marca a un usuario como completamente activo una vez que ha configurado su contraseña inicial o temporal.
 * Accesible por cualquier usuario autenticado.
 */
app.post('/api/user/complete-setup', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token de sesión.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await authAdmin.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    
    // Actualizar el perfil en Firestore
    await db.collection('users').doc(uid).update({
      status: 'ACTIVE',
      requirePasswordChange: false,
      setupLink: null // Limpiar el setupLink si existía
    });
    
    console.log(`[USER] Cuenta de usuario ${uid} activada (onboarding completado).`);
    return res.json({ success: true, message: 'Perfil activado con éxito.' });
  } catch (error) {
    console.error('Error al completar configuración del usuario:', error);
    return res.status(500).json({ error: 'Error al actualizar el estado del perfil.', details: error.message });
  }
});


/**
 * GET /api/users
 * Lista todos los usuarios y sus roles guardados en Firestore.
 * Protegido: Solo Administradores.
 */
app.get('/api/users', checkAdmin, async (req, res) => {
  try {
    console.log('Listando todos los usuarios de la base de datos...');
    const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
    const usersList = [];
    snapshot.forEach(doc => {
      usersList.push(doc.data());
    });
    return res.json(usersList);
  } catch (error) {
    console.error('Error al obtener lista de usuarios:', error);
    return res.status(500).json({ error: 'Error al recuperar los usuarios del sistema.', details: error.message });
  }
});

/**
 * POST /api/admin/create-user
 * Crea una cuenta de acceso en Firebase Auth y su perfil correspondiente en Firestore.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/create-user', checkAdmin, async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: email, role' });
  }

  if (role !== 'administrador' && role !== 'visualizador') {
    return res.status(400).json({ error: 'Rol no válido. Debe ser "administrador" o "visualizador".' });
  }

  const isPasswordless = !password || password.trim() === '';

  try {
    console.log(`[ADMIN] Creando cuenta de usuario: ${email} con rol: ${role} (Sin contraseña: ${isPasswordless})`);
    
    // 1. Determinar la contraseña a usar para la creación inicial
    let initialPassword = password;
    if (isPasswordless) {
      // Generar una contraseña aleatoria compleja para cumplir requisitos de Firebase Auth
      const randomPart = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
      initialPassword = randomPart + 'Aa1!';
    }

    // 2. Crear el usuario de forma directa en Firebase Auth usando el Admin SDK (evita desloguear al admin en el cliente)
    const userRecord = await authAdmin.createUser({
      email: email,
      password: initialPassword,
      emailVerified: true
    });

    const uid = userRecord.uid;

    // 3. Generar enlace de activación SIEMPRE (para todos los usuarios nuevos)
    let setupLink = null;
    try {
      // Sin URL de redirección personalizada para evitar error de dominio no autorizado
      setupLink = await authAdmin.generatePasswordResetLink(email);
    } catch (linkError) {
      const isDomainError = linkError.message && (
        linkError.message.includes('Domain not allowlisted') ||
        linkError.message.includes('unauthorized-domain') ||
        linkError.code === 'auth/unauthorized-continue-uri'
      );
      if (isDomainError) {
        try { await authAdmin.deleteUser(uid); } catch (_) {}
        console.error(`[ADMIN] ❌ URL de redirección no autorizada en Firebase — usuario borrado.`);
        return res.status(400).json({
          error: `La URL de la app no está autorizada en Firebase para enviar correos.`,
          hint: `Ve a Firebase Console → Authentication → Configuración → Dominios autorizados y agrega "auditoria-mintc-33385687524.us-central1.run.app".`,
          domainError: true
        });
      }
      console.warn('No se pudo generar el enlace:', linkError.message);
    }


    // 4. Registrar el perfil y su rol en Firestore
    // El usuario establece su contraseña desde el link de email → no se fuerza cambio al entrar
    const userData = {
      id: uid,
      email: email,
      role: role,
      status: isPasswordless ? 'PENDING_SETUP' : 'ACTIVE',
      requirePasswordChange: false, // No se requiere — el link de email ya lo maneja
      createdAt: new Date().toISOString()
    };

    if (isPasswordless && setupLink) {
      userData.setupLink = setupLink;
    }

    await db.collection('users').doc(uid).set(userData);
    console.log(`[ADMIN] ✅ Usuario creado con éxito en Firebase y Firestore: ${email}`);

    // 5. Intentar enviar correo de bienvenida automáticamente si hay config SMTP
    let emailSent = false;
    let emailError = null;
    if (setupLink) {
      try {
        const settingsDoc = await db.collection('settings').doc('email').get();
        if (settingsDoc.exists) {
          const cfg = settingsDoc.data();
          if (cfg.host && cfg.user && cfg.pass) {
            const transporter = nodemailer.createTransport({
              host: cfg.host,
              port: parseInt(cfg.port) || 587,
              secure: cfg.secure === true || cfg.port === '465',
              auth: { user: cfg.user, pass: cfg.pass }
            });
            const platformName = cfg.platformName || 'Auditoria MinTic';
            const fromName = cfg.fromName || platformName;
            await transporter.sendMail({
              from: `"${fromName}" <${cfg.user}>`,
              to: email,
              subject: `Bienvenido a ${platformName} — Activa tu cuenta`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
                  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; text-align: center;">
                    <h1 style="color: #00f2fe; margin: 0; font-size: 24px;">${platformName}</h1>
                    <p style="color: #94a3b8; margin: 8px 0 0 0;">Sistema de Análisis Documental Inteligente</p>
                  </div>
                  <div style="padding: 32px;">
                    <h2 style="color: #1e293b;">¡Bienvenido!</h2>
                    <p style="color: #475569; line-height: 1.6;">El administrador de la plataforma ha creado una cuenta para ti con el correo:</p>
                    <p style="background: #e2e8f0; padding: 12px; border-radius: 6px; font-weight: bold; color: #0f172a;">${email}</p>
                    <p style="color: #475569; line-height: 1.6;">Para activar tu cuenta y crear tu contraseña personal, haz clic en el siguiente botón:</p>
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${setupLink}" style="background: linear-gradient(135deg, #00f2fe, #4facfe); color: #000; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">ACTIVAR MI CUENTA</a>
                    </div>
                    <p style="color: #94a3b8; font-size: 13px;">⚠️ Este enlace es válido por 24 horas. Si no solicitaste este acceso, ignora este correo.</p>
                  </div>
                  <div style="background: #f1f5f9; padding: 16px; text-align: center;">
                    <p style="color: #94a3b8; font-size: 12px; margin: 0;">— Equipo ${platformName}</p>
                  </div>
                </div>
              `
            });
            emailSent = true;
            console.log(`[ADMIN] ✅ Correo de bienvenida enviado a: ${email}`);
          }
        }
      } catch (mailErr) {
        console.warn('[ADMIN] No se pudo enviar el correo de bienvenida:', mailErr.message);
        emailError = mailErr.message;
      }
    }

    return res.json({
      success: true,
      message: emailSent
        ? `El usuario ${email} fue creado y el correo de bienvenida fue enviado automáticamente.`
        : `El usuario ${email} fue creado. Configura el SMTP en Configuración para enviar correos automáticamente.`,
      setupLink: setupLink,
      emailSent: emailSent,
      emailError: emailError,
      isPasswordless: isPasswordless,
      user: { uid, email, role }
    });


  } catch (error) {
    console.error('Error al crear usuario administrativo:', error);
    let errorMsg = 'Error al registrar la cuenta.';
    if (error.code === 'auth/email-already-exists') {
      errorMsg = 'El correo electrónico ya se encuentra registrado.';
    } else if (error.code === 'auth/invalid-password') {
      errorMsg = 'La contraseña debe tener al menos 6 caracteres de longitud.';
    }
    return res.status(500).json({ error: errorMsg, details: error.message });
  }
});

/**
 * POST /api/admin/reset-password
 * Restablece o sobreescribe de manera inmediata la contraseña de cualquier usuario.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/reset-password', checkAdmin, async (req, res) => {
  const { uid, newPassword } = req.body;

  if (!uid || !newPassword) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: uid, newPassword' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres.' });
  }

  try {
    console.log(`[ADMIN] Restableciendo contraseña para usuario UID: ${uid}`);
    await authAdmin.updateUser(uid, {
      password: newPassword
    });

    console.log(`[ADMIN] ✅ Contraseña restablecida con éxito para UID: ${uid}`);
    return res.json({
      success: true,
      message: 'La contraseña del usuario fue actualizada con éxito.'
    });
  } catch (error) {
    console.error('Error al restablecer contraseña de usuario:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña.', details: error.message });
  }
});

/**
 * POST /api/admin/resend-welcome-email
 * Genera un nuevo link de activación y lo envía por correo al usuario.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/resend-welcome-email', checkAdmin, async (req, res) => {
  const { uid, email } = req.body;
  if (!uid || !email) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: uid, email' });
  }
  try {
    // 1. Generar nuevo link de activación (sin URL personalizada para evitar error de dominio)
    const setupLink = await authAdmin.generatePasswordResetLink(email);


    // 2. Verificar que hay config SMTP
    const settingsDoc = await db.collection('settings').doc('email').get();
    if (!settingsDoc.exists) {
      return res.status(400).json({
        error: 'No hay configuración SMTP guardada. Ve a Configuración para habilitarlo.',
        setupLink: setupLink
      });
    }
    const cfg = settingsDoc.data();
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(400).json({
        error: 'La configuración SMTP está incompleta.',
        setupLink: setupLink
      });
    }

    // 3. Enviar correo
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port) || 587,
      secure: cfg.secure === true || cfg.port === '465',
      auth: { user: cfg.user, pass: cfg.pass }
    });
    const platformName = cfg.platformName || 'Auditoria MinTic';
    await transporter.sendMail({
      from: `"${cfg.fromName || platformName}" <${cfg.user}>`,
      to: email,
      subject: `Activa tu cuenta en ${platformName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; text-align: center;">
            <h1 style="color: #00f2fe; margin: 0; font-size: 24px;">${platformName}</h1>
            <p style="color: #94a3b8; margin: 8px 0 0 0;">Sistema de Análisis Documental Inteligente</p>
          </div>
          <div style="padding: 32px;">
            <h2 style="color: #1e293b;">Activación de cuenta</h2>
            <p style="color: #475569; line-height: 1.6;">El administrador ha generado un nuevo enlace de activación para tu cuenta:</p>
            <p style="background: #e2e8f0; padding: 12px; border-radius: 6px; font-weight: bold; color: #0f172a;">${email}</p>
            <p style="color: #475569; line-height: 1.6;">Haz clic en el siguiente botón para crear o restablecer tu contraseña:</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${setupLink}" style="background: linear-gradient(135deg, #00f2fe, #4facfe); color: #000; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">ACTIVAR MI CUENTA</a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">⚠️ Este enlace es válido por 24 horas.</p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">— Equipo ${platformName}</p>
          </div>
        </div>
      `
    });

    // 4. Actualizar estado en Firestore
    await db.collection('users').doc(uid).update({
      lastEmailSentAt: new Date().toISOString(),
      status: 'PENDING_SETUP'
    });

    console.log(`[ADMIN] ✅ Correo de activación reenviado a: ${email}`);
    return res.json({ success: true, message: `Correo de activación enviado exitosamente a ${email}.` });

  } catch (error) {
    console.error('Error al reenviar correo de bienvenida:', error);
    return res.status(500).json({ error: `Error al reenviar correo: ${error.message}` });
  }
});


/**
 * POST /api/admin/delete-user
 * Borra permanentemente una cuenta de Firebase Auth y su perfil en Firestore.
 * Protegido: Solo Administradores.
 */
app.post('/api/admin/delete-user', checkAdmin, async (req, res) => {
  const { uid } = req.body;

  if (!uid) {
    return res.status(400).json({ error: 'Falta campo obligatorio: uid' });
  }

  // Protección anti-autoeliminación
  if (uid === req.adminUser.uid) {
    return res.status(400).json({ error: 'Acción inválida: no puedes eliminar tu propia cuenta de administrador.' });
  }

  try {
    console.log(`[ADMIN] Eliminando cuenta de Firebase Auth para UID: ${uid}`);
    await authAdmin.deleteUser(uid);

    console.log(`[ADMIN] Eliminando registro de Firestore para UID: ${uid}`);
    await db.collection('users').doc(uid).delete();

    console.log(`[ADMIN] ✅ Cuenta eliminada por completo del sistema: ${uid}`);
    return res.json({
      success: true,
      message: 'El usuario fue eliminado permanentemente del sistema.'
    });
  } catch (error) {
    console.error('Error al eliminar cuenta de usuario:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el usuario seleccionado.', details: error.message });
  }
});


/**
 * GET /api/documents/:id
 * Obtiene los detalles de un documento específico por su ID.
 */
app.get('/api/documents/:id', checkUser, async (req, res) => {
  try {
    const docId = req.params.id;
    console.log(`[GET] Recuperando documento por ID: ${docId}`);
    const docSnap = await db.collection('documents').doc(docId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'El documento no existe.' });
    }
    return res.json({ id: docSnap.id, ...docSnap.data() });
  } catch (error) {
    console.error('Error en GET /api/documents/:id:', error);
    return res.status(500).json({
      error: 'Error al recuperar el documento de la base de datos',
      details: error.message
    });
  }
});

/**
 * GET /api/admin/index-status
 * Devuelve el estado de la indexación de todo el corpus.
 */
app.get('/api/admin/index-status', checkAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('documents').get();
    let total = 0;
    let indexed = 0;
    let failed = 0;
    let pending = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'Analizado') {
        total++;
        if (data.indexed === true) {
          indexed++;
        } else if (data.indexed === 'error') {
          failed++;
        } else {
          pending++;
        }
      }
    });

    const percentage = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return res.json({
      total,
      indexed,
      failed,
      pending,
      percentage
    });
  } catch (error) {
    console.error('Error en GET /api/admin/index-status:', error);
    return res.status(500).json({ error: 'Error al obtener estado de indexación.' });
  }
});

/**
 * POST /api/admin/index-batch
 * Procesa un lote de documentos no indexados de forma controlada en background.
 */
app.post('/api/admin/index-batch', checkAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 10;
    console.log(`[Batch Indexing] Iniciando procesamiento de un lote de hasta ${limit} documentos...`);

    // Consultar documentos analizados
    const snapshot = await db.collection('documents')
      .where('status', '==', 'Analizado')
      .get();

    const pendingDocs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Si no está indexado con éxito
      if (data.indexed !== true) {
        pendingDocs.push({ id: doc.id, ...data });
      }
    });

    console.log(`[Batch Indexing] Encontrados ${pendingDocs.length} documentos pendientes de indexar en total.`);

    if (pendingDocs.length === 0) {
      return res.json({
        message: 'Todos los documentos ya están indexados.',
        indexedCount: 0,
        results: []
      });
    }

    // Tomar los primeros N documentos
    const batchDocs = pendingDocs.slice(0, limit);
    const results = [];

    // Procesar secuencialmente para respetar estrictamente las cuotas de Vertex AI y base de datos
    for (const doc of batchDocs) {
      try {
        console.log(`[Batch Indexing] Procesando documento: ${doc.fileName} (${doc.id})`);
        
        // 1. Extraer texto
        const text = await extractTextFromDocument(doc.filePath, doc.mimeType);
        if (!text || text.trim().length === 0) {
          console.warn(`[Batch Indexing] Documento ${doc.id} sin texto legible.`);
          await db.collection('documents').doc(doc.id).update({
            indexed: true,
            indexedAt: new Date().toISOString(),
            chunksCount: 0
          });
          results.push({ id: doc.id, fileName: doc.fileName, status: 'empty' });
          continue;
        }

        // 2. Chunks
        const chunks = splitTextIntoChunks(text);
        console.log(`[Batch Indexing] Documento ${doc.id} dividido en ${chunks.length} fragmentos.`);

        if (chunks.length === 0) {
          await db.collection('documents').doc(doc.id).update({
            indexed: true,
            indexedAt: new Date().toISOString(),
            chunksCount: 0
          });
          results.push({ id: doc.id, fileName: doc.fileName, status: 'empty_chunks' });
          continue;
        }

        // 3. Crear chunks en Firestore con embeddings
        let chunkBatch = db.batch();
        let chunkBatchCount = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          const embedding = await getEmbedding(chunkText);

          const chunkDocId = `${doc.id}_chunk_${i}`;
          const chunkRef = db.collection('document_chunks').doc(chunkDocId);

          const chunkData = {
            docId: doc.id,
            fileName: doc.fileName || '',
            chunkIndex: i,
            text: chunkText,
            embedding: FieldValue.vector(embedding),
            sector: doc.sector || 'OTRO',
            company: doc.company || 'No especificado',
            region: doc.region || 'No especificada',
            departamento: doc.departamento || 'No especificado',
            municipio: doc.municipio || 'No especificado',
            institution: doc.institution || 'ANLA',
            createdAt: new Date().toISOString()
          };

          chunkBatch.set(chunkRef, chunkData);
          chunkBatchCount++;

          if (chunkBatchCount >= 400) {
            await chunkBatch.commit();
            chunkBatch = db.batch();
            chunkBatchCount = 0;
          }
        }

        if (chunkBatchCount > 0) {
          await chunkBatch.commit();
        }

        // 4. Marcar como indexado
        await db.collection('documents').doc(doc.id).update({
          indexed: true,
          indexedAt: new Date().toISOString(),
          chunksCount: chunks.length
        });

        results.push({ id: doc.id, fileName: doc.fileName, status: 'success', chunksCount: chunks.length });
      } catch (err) {
        console.error(`[Batch Indexing] Error procesando documento ${doc.id}:`, err);
        await db.collection('documents').doc(doc.id).update({
          indexed: 'error',
          indexingError: err.message,
          updatedAt: new Date().toISOString()
        });
        results.push({ id: doc.id, fileName: doc.fileName, status: 'error', error: err.message });
      }
    }

    // Log en auditoría
    await logAuditEvent(
      req.adminUser.uid,
      req.adminUser.email,
      'BATCH_INDEXING',
      {
        batchSize: batchDocs.length,
        results: results
      }
    );

    return res.json({
      message: `Procesado lote de indexación con éxito.`,
      processedCount: batchDocs.length,
      results: results
    });

  } catch (error) {
    console.error('Error en POST /api/admin/index-batch:', error);
    return res.status(500).json({ error: 'Error al ejecutar lote de indexación.' });
  }
});

/**
 * GET /api/chat/filters
 * Recupera todas las opciones de filtro de sector, empresa y territorio disponibles dinámicamente.
 */
app.get('/api/chat/filters', checkUser, async (req, res) => {
  try {
    console.log('[RAG Chat] Obteniendo valores únicos de filtros de documentos...');
    const snapshot = await db.collection('documents').where('status', '==', 'Analizado').get();
    
    const sectors = new Set();
    const companies = new Set();
    const territories = new Set();

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.sector) sectors.add(data.sector.toUpperCase());
      if (data.company && data.company !== 'No especificado' && data.company !== 'No especificada') {
        companies.add(data.company.trim());
      }
      if (data.region && data.region !== 'No especificado' && data.region !== 'No especificada') {
        territories.add(data.region.trim());
      }
    });

    return res.json({
      sectors: Array.from(sectors).sort(),
      companies: Array.from(companies).sort(),
      territories: Array.from(territories).sort()
    });
  } catch (error) {
    console.error('Error en GET /api/chat/filters:', error);
    return res.status(500).json({ error: 'Error al recuperar filtros de búsqueda.' });
  }
});

/**
 * POST /api/chat
 * Asistente forense de auditoría MinTic — RAG con capa semántica completa, análisis de corrupción
 * y conocimiento general del sector TIC colombiano.
 */
app.post('/api/chat', checkUser, async (req, res) => {
  const { message, history } = req.body;
  const userId  = req.user.uid;
  const userEmail = req.user.email;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'La pregunta es obligatoria.' });
  }

  console.log(`[AUDIT-CHAT] Consulta de ${userEmail}: "${message.slice(0, 120)}"`);
  const startTime = Date.now();

  try {
    // ── 1. Embedding de la consulta ──────────────────────────────────────────
    const queryVector = await getEmbedding(message);

    // ── 2. Búsqueda vectorial ampliada (25 fragmentos para mayor cobertura) ──
    const vectorQuery = db.collection('document_chunks').findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(queryVector),
      limit: 25,
      distanceMeasure: 'COSINE',
      distanceResultField: 'distance'
    });
    const querySnapshot = await vectorQuery.get();

    const chunks = [];
    querySnapshot.forEach(doc => chunks.push({ id: doc.id, ...doc.data() }));
    console.log(`[AUDIT-CHAT] ${chunks.length} fragmentos vectoriales encontrados.`);

    // ── 3. Enriquecer con metadatos semánticos de Firestore ─────────────────
    // Obtener los docIds únicos de los chunks más relevantes
    const uniqueDocIds = [...new Set(chunks.map(c => c.docId).filter(Boolean))].slice(0, 10);
    let metadataContext = '';

    if (uniqueDocIds.length > 0) {
      try {
        const metaDocs = await Promise.all(
          uniqueDocIds.map(id => db.collection('documents').doc(id).get())
        );
        const metaEntries = metaDocs
          .filter(d => d.exists)
          .map(d => {
            const m = d.data();
            const personas = (m.personas || [])
              .map(p => `${p.nombre || ''}${p.cedula && p.cedula !== 'No especificado' ? ` (CC/NIT: ${p.cedula})` : ''} — ${p.cargo || ''} — ${p.rol || ''}`)
              .filter(Boolean).join('; ');
            const alertas = (m.alertas || []).join('; ');
            return [
              `[META Doc:${d.id}|${m.fileName || ''}]`,
              `  Entidad: ${m.entidad || m.institution || 'N/A'}`,
              `  Tipo: ${m.tipoDocumento || m.documentType || 'N/A'}`,
              `  No. Documento: ${m.numeroDocumento || m.expediente || 'N/A'}`,
              `  Fecha: ${m.fechaDocumento || m.date || 'N/A'}`,
              `  Valor: ${m.valorContrato || 'N/A'}`,
              `  Objeto: ${m.objetoContrato || 'N/A'}`,
              `  Contratista: ${m.contratista || m.company || 'N/A'}`,
              `  Supervisor: ${m.supervisor || 'N/A'}`,
              personas ? `  Personas identificadas: ${personas}` : '',
              alertas ? `  ⚠️ Alertas: ${alertas}` : '',
              `  Resumen: ${(m.resumen || m.summary || '').slice(0, 400)}`
            ].filter(Boolean).join('\n');
          });
        metadataContext = metaEntries.join('\n\n');
        console.log(`[AUDIT-CHAT] Metadatos enriquecidos para ${metaEntries.length} documentos únicos.`);
      } catch (metaErr) {
        console.warn('[AUDIT-CHAT] No se pudo enriquecer metadatos:', metaErr.message);
      }
    }

    // ── 4. Formatear fragmentos textuales ────────────────────────────────────
    const contextText = chunks.map((chunk, idx) =>
      `[Frag ${idx + 1}] Doc:${chunk.docId}|"${chunk.fileName}" (similitud coseno: ${chunk.distance ? (1 - chunk.distance).toFixed(3) : 'N/A'}):\n${chunk.text}`
    ).join('\n\n');

    // ── 5. Historial de conversación (memoria) ───────────────────────────────
    let historyText = '';
    if (Array.isArray(history) && history.length > 0) {
      historyText = history.slice(-12).map(h => {
        const label = h.role === 'user' ? '👤 Usuario' : '🤖 Asistente';
        return `${label}: ${h.content}`;
      }).join('\n');
    }

    // ── 6. System Prompt — AuditBot MinTic (docs + conocimiento propio) ─────
    const systemPrompt = `
Eres "AuditBot MinTic", un asistente forense especializado en auditoría gubernamental,
detección de corrupción y análisis de documentos del sector TIC colombiano
(MinTIC, ANE, CRC, AND, FUTIC, RTVC, Servicios Postales Nacionales 4-72).

════════════════════════════════════════════════════
PRIORIDAD DE RESPUESTA
════════════════════════════════════════════════════
PRIMERO — Si la respuesta está en los documentos indexados del contexto:
  → Responde con base en esos documentos y cita SIEMPRE con [Doc:docId|archivo].
  → Los documentos son la fuente de verdad prioritaria.

SEGUNDO — Si la respuesta NO está o está incompleta en los documentos:
  → Responde con tu conocimiento propio de auditoría, normativa colombiana,
    sector TIC, contratación pública, DIAN, SECOP, etc.
  → Indica claramente cuando estás usando conocimiento general, por ejemplo:
    "Según la normativa general de contratación colombiana (no en los documentos cargados)..."

NUNCA digas "no puedo responder" ni te niegues a dar información útil.
Siempre aportas valor al auditor, ya sea desde los docs o desde tu conocimiento.

════════════════════════════════════════════════════
TUS CAPACIDADES
════════════════════════════════════════════════════
1. 🔍 AUDITOR FORENSE: Detectas en los documentos cargados patrones de corrupción,
   irregularidades contractuales, inconsistencias en declaraciones de renta,
   conflictos de interés y alertas de riesgo.

2. 📊 ANALISTA SEMÁNTICO: Cruzas información ENTRE los documentos indexados para
   identificar personas, empresas y contratos relacionados.

3. ⚖️ EXPERTO JURÍDICO TIC: Conoces el marco normativo colombiano: Ley 1341/2009,
   Estatuto de Contratación (Ley 80/93, Ley 1150/07), SECOP, DIAN, y regulaciones MinTic.

4. 💼 ANALISTA FINANCIERO: Evalúas valores de contratos, adiciones injustificadas,
   fraccionamiento de contratos para evadir licitación, lavado de activos.

5. 👤 IDENTIFICADOR DE PERSONAS: Extraes y cruzas personas entre documentos —
   firmantes, contratistas, beneficiarios, declarantes, redes de relaciones.

5. 🗄️ ANALISTA SECOP/BIGQUERY: Tienes acceso directo a los datos de contratación pública
   del sector TIC colombiano cargados en BigQuery (SECOP II Contratos, Procesos, Tienda Virtual).
   Estos datos están indexados en la capa semántica y disponibles como fragmentos [BQ-SECOP|...].
   Puedes responder preguntas sobre: contratos específicos, contratistas, valores, fechas,
   tipos de contrato, comparaciones entre gobiernos Duque y Petro, prestación de servicios,
   entidades MinTIC, ANE, CRC, AND, FUTIC, RTVC, 4-72. Cuando veas fragmentos [BQ-SECOP|...]
   en el contexto, úsalos como datos reales de contratos SECOP para responder con precisión.

6. 🌐 ASISTENTE GENERAL: Respondes cualquier pregunta relacionada con auditoría,
   gobierno, sector TIC, contratación pública o cualquier tema que el auditor necesite.

════════════════════════════════════════════════════
ANÁLISIS FORENSE (cuando aplique)
════════════════════════════════════════════════════
- 🔴 Personas repetidas en múltiples contratos → posible conflicto de interés
- 🔴 Contratos divididos para evadir licitación → fraccionamiento
- 🔴 Diferencias entre declaración de renta y contratos recibidos
- 🟡 Supervisores que también son contratistas en otros documentos
- 🟡 Fechas inconsistentes o plazos vencidos
- 🟡 Empresas creadas poco antes de recibir contratos
- 🟡 Alta concentración de prestación de servicios → posible nómina paralela
- 🔴 Contratistas que concentran > 20% del presupuesto de una entidad

════════════════════════════════════════════════════
FORMATO DE RESPUESTA
════════════════════════════════════════════════════
- Cita documentos: [Doc:docId|nombreArchivo] después de cada afirmación documental
- Cita datos BQ: [BQ-SECOP|entidad|referencia] cuando uses datos de contratos BigQuery
- 🔴 alertas críticas  |  🟡 alertas moderadas  |  🟢 hallazgos normales
- 📋 resumen de doc   |  👤 persona   |  💰 dato financiero  |  ⚖️ normativa
- Termina SIEMPRE con "💡 Recomendaciones para el auditor"
`;


    // ── 7. Construir prompt completo ─────────────────────────────────────────
    const promptText = `
${historyText ? `HISTORIAL DE CONVERSACIÓN (MEMORIA — últimos mensajes):\n${historyText}\n\n` : ''}
══════════════════════════════════════════════════════
CONSULTA DEL AUDITOR:
"${message}"
══════════════════════════════════════════════════════

CAPA SEMÁNTICA — METADATOS ESTRUCTURADOS (documentos más relevantes):
${metadataContext || 'No hay metadatos adicionales disponibles.'}

══════════════════════════════════════════════════════
CAPA DE CONTENIDO — FRAGMENTOS TEXTUALES (extraídos por similitud semántica):
${contextText || 'No se encontraron fragmentos de contenido relevantes.'}
══════════════════════════════════════════════════════

Instrucciones finales:
- Responde la consulta del auditor de forma exhaustiva y estructurada.
- Si detectas señales de corrupción o irregularidades, resáltalas claramente con 🔴.
- Cita con [Doc:id|archivo] cada afirmación basada en documentos.
- Si no hay suficiente contexto documental, aporta desde tu conocimiento del sector TIC colombiano.
- Termina siempre con una sección "💡 Recomendaciones para el auditor" con los próximos pasos sugeridos.
`;

    // ── 8. Llamar a Gemini 2.5 Flash ─────────────────────────────────────────
    const modelInstance = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.2,   // Baja temperatura para análisis forense preciso
        topP: 0.8
      }
    });

    const result = await modelInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: promptText }] }]
    });

    const response    = await result.response;
    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text
                      || response.text || '';

    const durationMs = Date.now() - startTime;
    const tokens     = response.usageMetadata || null;

    // ── 9. Extraer citas únicas ───────────────────────────────────────────────
    const citationsRegex = /\[Doc:([^|\]]+)\|([^\]]+)\]/g;
    const citationsMap   = new Map();
    let match;
    while ((match = citationsRegex.exec(responseText)) !== null) {
      citationsMap.set(match[1], match[2]);
    }
    const uniqueCitations = Array.from(citationsMap.entries()).map(([id, fileName]) => ({ id, fileName }));

    // ── 10. Registrar en auditoría ────────────────────────────────────────────
    await logAuditEvent(userId, userEmail, 'IA_CHAT_FORENSIC', {
      query: message,
      durationMs,
      tokensUsed: tokens?.totalTokenCount || null,
      modelUsed: 'gemini-2.5-flash',
      citationsCount: uniqueCitations.length,
      docsEnriched: uniqueDocIds.length,
      chunksUsed: chunks.length
    });

    return res.json({
      response: responseText,
      citations: uniqueCitations,
      iaMetadata: {
        modelUsed: 'gemini-2.5-flash',
        durationMs,
        tokens: tokens || null,
        chunksUsed: chunks.length,
        docsEnriched: uniqueDocIds.length
      }
    });

  } catch (error) {
    console.error('[AUDIT-CHAT] Error:', error);
    return res.status(500).json({
      error: 'Error al procesar la consulta del chat forense.',
      details: error.message
    });
  }
});

/**
 * GET /api/admin/settings
 * Obtiene la configuración del sistema (SMTP, nombre plataforma).
 */
app.get('/api/admin/settings', checkAdmin, async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('email').get();
    if (!doc.exists) return res.json({});
    const data = doc.data();
    // Ocultar la contraseña en la respuesta por seguridad
    return res.json({ ...data, pass: data.pass ? '••••••••' : '' });
  } catch (error) {
    console.error('Error al obtener configuración:', error);
    return res.status(500).json({ error: 'No se pudo obtener la configuración.' });
  }
});

/**
 * POST /api/admin/settings
 * Guarda la configuración SMTP y general del sistema en Firestore.
 */
app.post('/api/admin/settings', checkAdmin, async (req, res) => {
  const { host, port, secure, user, pass, fromName, platformName } = req.body;
  if (!host || !user) {
    return res.status(400).json({ error: 'Host y usuario SMTP son obligatorios.' });
  }
  try {
    const existing = await db.collection('settings').doc('email').get();
    const existingPass = existing.exists ? existing.data().pass : '';
    // Si la contraseña llega como bullets, conservar la existente
    const finalPass = (!pass || pass === '••••••••') ? existingPass : pass;
    await db.collection('settings').doc('email').set({
      host, port: port || '587',
      secure: secure === true || secure === 'true',
      user, pass: finalPass,
      fromName: fromName || 'Auditoria MinTic',
      platformName: platformName || 'Auditoria MinTic',
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`[ADMIN] ✅ Configuración SMTP guardada por: ${req.user.email}`);
    return res.json({ success: true, message: 'Configuración guardada correctamente.' });
  } catch (error) {
    console.error('Error al guardar configuración:', error);
    return res.status(500).json({ error: 'No se pudo guardar la configuración.' });
  }
});

/**
 * POST /api/admin/test-email
 * Envía un correo de prueba para verificar la configuración SMTP.
 */
app.post('/api/admin/test-email', checkAdmin, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Dirección de destino obligatoria.' });
  try {
    const settingsDoc = await db.collection('settings').doc('email').get();
    if (!settingsDoc.exists) return res.status(400).json({ error: 'No hay configuración SMTP guardada.' });
    const cfg = settingsDoc.data();
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return res.status(400).json({ error: 'La configuración SMTP está incompleta.' });
    }
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port) || 587,
      secure: cfg.secure === true || cfg.port === '465',
      auth: { user: cfg.user, pass: cfg.pass }
    });
    await transporter.sendMail({
      from: `"${cfg.fromName || 'Auditoria MinTic'}" <${cfg.user}>`,
      to,
      subject: `Correo de prueba — ${cfg.platformName || 'Auditoria MinTic'}`,
      html: `<div style="font-family:Arial,sans-serif;padding:24px;"><h2 style="color:#00f2fe;">✅ Conexión SMTP Exitosa</h2><p>Este es un correo de prueba enviado desde <strong>${cfg.platformName || 'Auditoria MinTic'}</strong>.</p><p>Tu configuración de correo está funcionando correctamente.</p></div>`
    });
    console.log(`[ADMIN] ✅ Correo de prueba enviado a: ${to}`);
    return res.json({ success: true, message: `Correo de prueba enviado exitosamente a ${to}.` });
  } catch (error) {
    console.error('Error al enviar correo de prueba:', error);
    return res.status(500).json({ error: `Error al enviar: ${error.message}` });
  }
});

// Servir la aplicación en producción (unificación de frontend y backend en un solo contenedor)
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// ═══════════════════════════════════════════════════════════════════════════
//  SECOP — Módulo de Contratación Pública MinTic  (3 fuentes | desde 2018-08-07)
// ═══════════════════════════════════════════════════════════════════════════

// Fuentes disponibles (IDs para el param ?fuente=)
const FUENTES_VALIDAS = {
  secop_ii_contratos: 'SECOP_II_CONTRATOS',
  secop_ii_procesos:  'SECOP_II_PROCESOS',
  tienda_virtual:     'TIENDA_VIRTUAL'
};

const resolverFuente = (fuenteParam) => {
  const key = FUENTES_VALIDAS[fuenteParam?.toLowerCase()] || 'SECOP_II_CONTRATOS';
  return key;
};

const calcularEstadisticasContratante = (contratos, total) => {
  const vals = contratos.map(c => c.valor).filter(v => v > 0);
  const porTipo = {};
  contratos.forEach(c => {
    const k = c.tipo || 'Sin tipo';
    if (!porTipo[k]) porTipo[k] = { count: 0, valor: 0 };
    porTipo[k].count++; porTipo[k].valor += c.valor;
  });
  return {
    totalContratos: total,
    contratosEnMuestra: contratos.length,
    valorTotal: vals.reduce((a, b) => a + b, 0),
    valorPromedio: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
    valorMaximo: vals.length ? Math.max(...vals) : 0,
    contratosEnEjecucion: contratos.filter(c => /ejecuci/i.test(c.estado)).length,
    contratosConAdicion: contratos.filter(c => (c.diasAdicionados || 0) > 0).length,
    topTipos: Object.entries(porTipo).sort((a,b) => b[1].valor - a[1].valor).slice(0,5)
      .map(([tipo, d]) => ({ tipo, count: d.count, valor: d.valor }))
  };
};

const calcularEstadisticasProveedor = (contratos, total) => {
  const vals = contratos.map(c => c.valor).filter(v => v > 0);
  const porContratante = {};
  contratos.forEach(c => {
    const k = c._contratante || 'Desconocida';
    if (!porContratante[k]) porContratante[k] = { count: 0, valor: 0 };
    porContratante[k].count++; porContratante[k].valor += c.valor;
  });
  return {
    totalContratos: total,
    contratosEnMuestra: contratos.length,
    valorTotalRecibido: vals.reduce((a, b) => a + b, 0),
    valorPromedio: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
    valorMaximo: vals.length ? Math.max(...vals) : 0,
    topContratantes: Object.entries(porContratante).sort((a,b) => b[1].valor - a[1].valor).slice(0,5)
      .map(([nombre, d]) => ({ nombre, count: d.count, valor: d.valor }))
  };
};

/**
 * GET /api/secop/entidades
 * Lista de entidades MinTic con sus NITs y metadatos.
 */
app.get('/api/secop/entidades', checkUser, (req, res) => {
  res.json(ENTIDADES_MINTIC.map(e => ({
    id: e.id, nombre: e.nombre, nombreCompleto: e.nombreCompleto,
    nit: e.nit, color: e.color, icono: e.icono
  })));
});

/**
 * GET /api/secop/fuentes
 * Lista las 3 fuentes disponibles con sus metadatos.
 */
app.get('/api/secop/fuentes', checkUser, (req, res) => {
  res.json(Object.values(SECOP_SOURCES).map(s => ({
    id: s.id, label: s.label, shortLabel: s.shortLabel
  })));
});

/**
 * GET /api/secop/contratos/:entidadId
 * Contratos donde la entidad aparece como CONTRATANTE.
 * ?fuente=secop_ii_contratos | secop_ii_procesos | tienda_virtual
 * ?page, pageSize, tipoContrato, estado, search
 */
app.get('/api/secop/contratos/:entidadId', checkUser, async (req, res) => {
  const { entidadId } = req.params;
  const { page = '1', pageSize = '100', fuente = 'secop_ii_contratos',
          tipoContrato, estado, search } = req.query;

  const entidad = ENTIDADES_MINTIC.find(e => e.id === entidadId);
  if (!entidad) return res.status(404).json({ error: `Entidad '${entidadId}' no encontrada.` });

  const sourceKey = resolverFuente(fuente);
  const source    = SECOP_SOURCES[sourceKey];
  const limit     = Math.min(parseInt(pageSize, 10) || 100, 1000);
  const offset    = (parseInt(page, 10) - 1) * limit;
  const filters   = { tipoContrato, estado, search };

  try {
    console.log(`[SECOP:contratante] ${entidad.nombre} | ${source.shortLabel} | pág ${page}`);
    const [rawData, total] = await Promise.all([
      fetchContratante(entidad, sourceKey, limit, offset, filters),
      offset === 0 ? countContratante(entidad, sourceKey) : Promise.resolve(-1)
    ]);

    const contratos = rawData.map(r => normalizarContrato(r, source.id, 'contratante'));
    const estadisticas = offset === 0 && contratos.length > 0
      ? calcularEstadisticasContratante(contratos, total) : null;

    return res.json({
      entidad: { id: entidad.id, nombre: entidad.nombre, nit: entidad.nit, color: entidad.color, icono: entidad.icono },
      modo: 'contratante', fuente: source.label, fuenteId: source.id,
      fechaDesde: '2018-08-07',
      page: parseInt(page, 10), pageSize: limit,
      total: total >= 0 ? total : undefined,
      count: contratos.length,
      estadisticas, contratos
    });
  } catch (err) {
    console.error(`[SECOP:contratante] Error:`, err.message);
    return res.status(500).json({ error: 'Error al consultar SECOP.', details: err.message });
  }
});

/**
 * GET /api/secop/como-proveedor/:entidadId
 * Contratos donde la entidad aparece como PROVEEDOR/ADJUDICADO.
 * SECOP II Contratos: campo documento_proveedor = NIT
 * SECOP II Procesos:  campo nit_del_proveedor_adjudicado = NIT
 * Tienda Virtual:     campo proveedor (nombre LIKE)
 */
app.get('/api/secop/como-proveedor/:entidadId', checkUser, async (req, res) => {
  const { entidadId } = req.params;
  const { page = '1', pageSize = '100', fuente = 'secop_ii_contratos',
          tipoContrato, estado, search } = req.query;

  const entidad = ENTIDADES_MINTIC.find(e => e.id === entidadId);
  if (!entidad) return res.status(404).json({ error: `Entidad '${entidadId}' no encontrada.` });

  const sourceKey = resolverFuente(fuente);
  const source    = SECOP_SOURCES[sourceKey];
  const limit     = Math.min(parseInt(pageSize, 10) || 100, 1000);
  const offset    = (parseInt(page, 10) - 1) * limit;
  const filters   = { tipoContrato, estado, search };

  try {
    console.log(`[SECOP:proveedor] ${entidad.nombre} | ${source.shortLabel} | pág ${page}`);
    const [rawData, total] = await Promise.all([
      fetchProveedor(entidad, sourceKey, limit, offset, filters),
      offset === 0 ? countProveedor(entidad, sourceKey) : Promise.resolve(-1)
    ]);

    const contratos = rawData.map(r => normalizarContrato(r, source.id, 'proveedor'));
    const estadisticas = offset === 0 && contratos.length > 0
      ? calcularEstadisticasProveedor(contratos, total) : null;

    return res.json({
      entidad: { id: entidad.id, nombre: entidad.nombre, nit: entidad.nit, color: entidad.color, icono: entidad.icono },
      modo: 'proveedor', fuente: source.label, fuenteId: source.id,
      fechaDesde: '2018-08-07',
      page: parseInt(page, 10), pageSize: limit,
      total: total >= 0 ? total : undefined,
      count: contratos.length,
      estadisticas, contratos
    });
  } catch (err) {
    console.error(`[SECOP:proveedor] Error:`, err.message);
    return res.status(500).json({ error: 'Error al consultar SECOP como proveedor.', details: err.message });
  }
});


/**
 * GET /api/secop/resumen/:entidadId
 * Conteos de contratos en las 3 fuentes (contratante + proveedor) en paralelo.
 */
app.get('/api/secop/resumen/:entidadId', checkUser, async (req, res) => {
  const entidad = ENTIDADES_MINTIC.find(e => e.id === req.params.entidadId);
  if (!entidad) return res.status(404).json({ error: 'Entidad no encontrada.' });

  try {
    const fuentes = Object.keys(SECOP_SOURCES);
    const resultados = await Promise.allSettled(
      fuentes.flatMap(sk => [
        countContratante(entidad, sk).then(n => ({ sk, modo: 'contratante', total: n })),
        countProveedor(entidad, sk).then(n => ({ sk, modo: 'proveedor', total: n }))
      ])
    );

    const resumen = {};
    fuentes.forEach(sk => {
      resumen[sk] = { contratante: 0, proveedor: 0, label: SECOP_SOURCES[sk].label, shortLabel: SECOP_SOURCES[sk].shortLabel };
    });
    resultados.forEach(r => {
      if (r.status === 'fulfilled') {
        const { sk, modo, total } = r.value;
        resumen[sk][modo] = total;
      }
    });

    return res.json({
      entidad: { id: entidad.id, nombre: entidad.nombre, nit: entidad.nit },
      fechaDesde: '2018-08-07',
      resumen
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error en resumen SECOP.', details: err.message });
  }
});



// ═══════════════════════════════════════════════════════════════════════════
//  SECOP — Sincronización BigQuery (carga completa + incremental diaria)
// ═══════════════════════════════════════════════════════════════════════════

// Estado global del job de sync (solo 1 a la vez)
let syncJobActivo = false;
let syncJobResumen = null;

/**
 * GET /api/secop/sync-bigquery/status
 * Estado actual del job de sincronización.
 */
app.get('/api/secop/sync-bigquery/status', checkUser, (req, res) => {
  res.json({
    activo: syncJobActivo,
    ultimaSync: syncJobResumen
  });
});

/**
 * GET /api/secop/sync-bigquery/stream
 * Server-Sent Events: inicia sincronización y envía progreso en tiempo real.
 * El cliente recibe una línea por evento (data: mensaje\n\n).
 */
app.get('/api/secop/sync-bigquery/stream', checkUser, async (req, res) => {
  // Configurar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (msg, tipo = 'progreso') => {
    const payload = JSON.stringify({ tipo, msg, ts: new Date().toISOString() });
    res.write(`data: ${payload}\n\n`);
    if (res.flush) res.flush();
  };

  if (syncJobActivo) {
    send('⚠️ Ya hay una sincronización en curso. Espera a que termine.', 'aviso');
    res.write('data: {"tipo":"fin","msg":""} \n\n');
    return res.end();
  }

  syncJobActivo = true;
  send('🚀 Iniciando carga completa a BigQuery...', 'inicio');

  try {
    const resumen = await sincronizarTodo((msg) => send(msg));
    syncJobResumen = resumen;
    send(`✅ Listo | ${resumen.filasUnicas} filas únicas en BQ | ${resumen.duracionSeg}s`, 'fin');
    res.write(`data: ${JSON.stringify({ tipo: 'resumen', resumen })}\n\n`);
  } catch (err) {
    send(`❌ Error fatal: ${err.message}`, 'error');
  } finally {
    syncJobActivo = false;
    res.write('data: {"tipo":"fin","msg":"Proceso terminado"}\n\n');
    res.end();
  }
});

/**
 * POST /api/secop/sync-bigquery
 * Sincronización sin SSE (para Cloud Scheduler / llamadas programadas).
 * Retorna JSON con resumen al finalizar.
 */
app.post('/api/secop/sync-bigquery', async (req, res) => {
  // Verificar token de Cloud Scheduler (header X-Sync-Secret)
  const secret = req.headers['x-sync-secret'];
  const SYNC_SECRET = process.env.SYNC_SECRET || 'sync-mintic-2024';
  if (secret !== SYNC_SECRET) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  if (syncJobActivo) {
    return res.status(409).json({ error: 'Sync ya en curso.' });
  }
  syncJobActivo = true;
  try {
    const resumen = await sincronizarTodo();
    syncJobResumen = resumen;
    // ── Después del sync: re-indexar contratos en la capa semántica RAG ──
    console.log('[SYNC] Iniciando re-indexación BQ→RAG en background...');
    indexarContratosEnRAG({ db, getEmbedding })
      .then(r => console.log('[BQ-RAG] Indexación completada:', r))
      .catch(e => console.error('[BQ-RAG] Error indexando:', e.message));
    return res.json({ ok: true, resumen });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    syncJobActivo = false;
  }
});

/**
 * POST /api/secop/index-bq-rag
 * Disparo manual: convierte contratos BQ → chunks RAG en Firestore.
 * Acepta X-Sync-Secret header (sin Firebase) o token de usuario.
 */
app.post('/api/secop/index-bq-rag', async (req, res) => {
  const secret = req.headers['x-sync-secret'];
  const SYNC_SECRET = process.env.SYNC_SECRET || 'sync-mintic-2024';
  if (secret !== SYNC_SECRET) {
    try {
      const authHeader = req.headers.authorization || '';
      const tkn = authHeader.replace('Bearer ', '');
      if (!tkn) return res.status(403).json({ error: 'Acceso denegado.' });
      await getAuth().verifyIdToken(tkn);
    } catch { return res.status(403).json({ error: 'Acceso denegado.' }); }
  }
  const { entidadId, limite } = req.body || {};
  res.json({ ok: true, mensaje: 'Indexación BQ→RAG iniciada. El chat usará los contratos en ~5 minutos.' });
  indexarContratosEnRAG({ db, getEmbedding, entidadId, limite: limite || 300 })
    .then(r => console.log('[BQ-RAG] Manual index completo:', r))
    .catch(e => console.error('[BQ-RAG] Manual index error:', e.message));
});



/**
 * GET /api/secop/bigquery/stats
 * Estadísticas de las tablas en BigQuery: total filas, última carga, top entidades.
 */
app.get('/api/secop/bigquery/stats', checkUser, async (req, res) => {
  try {
    const [contratos, procesos, tienda] = await Promise.all([
      queryBQ(`SELECT COUNT(*) AS total, MAX(_fecha_carga) AS ultima_carga,
                      COUNTIF('mintic' IN UNNEST(entidades_mintic)) AS filas_mintic
               FROM \`${process.env.GCP_PROJECT_ID || 'auditoria-mintc'}.${DATASET_ID}.secop_ii_contratos\``),
      queryBQ(`SELECT COUNT(*) AS total, MAX(_fecha_carga) AS ultima_carga,
                      COUNTIF('mintic' IN UNNEST(entidades_mintic)) AS filas_mintic
               FROM \`${process.env.GCP_PROJECT_ID || 'auditoria-mintc'}.${DATASET_ID}.secop_ii_procesos\``),
      queryBQ(`SELECT COUNT(*) AS total, MAX(_fecha_carga) AS ultima_carga,
                      COUNTIF('mintic' IN UNNEST(entidades_mintic)) AS filas_mintic
               FROM \`${process.env.GCP_PROJECT_ID || 'auditoria-mintc'}.${DATASET_ID}.tienda_virtual\``),
    ]);

    return res.json({
      tablas: [
        { id: 'secop_ii_contratos', label: 'SECOP II Contratos', ...contratos[0] },
        { id: 'secop_ii_procesos',  label: 'SECOP II Procesos',  ...procesos[0]  },
        { id: 'tienda_virtual',     label: 'Tienda Virtual',     ...tienda[0]    },
      ],
      syncActivo: syncJobActivo,
      ultimaSync: syncJobResumen
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ANALYTICS — Dashboard comparativo Duque vs Petro (detección de corrupción)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/analytics/kpis/:entidadId */
app.get('/api/analytics/kpis/:entidadId', checkUser, async (req, res) => {
  try { res.json(await kpisComparativos(req.params.entidadId)); }
  catch (e) { console.error('[analytics/kpis]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/serie-mensual/:entidadId */
app.get('/api/analytics/serie-mensual/:entidadId', checkUser, async (req, res) => {
  try { res.json(await serieMensual(req.params.entidadId)); }
  catch (e) { console.error('[analytics/serie-mensual]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/tipos/:entidadId */
app.get('/api/analytics/tipos/:entidadId', checkUser, async (req, res) => {
  try { res.json(await tiposContrato(req.params.entidadId)); }
  catch (e) { console.error('[analytics/tipos]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/modalidades/:entidadId */
app.get('/api/analytics/modalidades/:entidadId', checkUser, async (req, res) => {
  try { res.json(await modalidades(req.params.entidadId)); }
  catch (e) { console.error('[analytics/modalidades]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/top-contratistas/:entidadId */
app.get('/api/analytics/top-contratistas/:entidadId', checkUser, async (req, res) => {
  try { res.json(await topContratistas(req.params.entidadId)); }
  catch (e) { console.error('[analytics/top-contratistas]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/prestacion-servicios/:entidadId */
app.get('/api/analytics/prestacion-servicios/:entidadId', checkUser, async (req, res) => {
  try { res.json(await prestacionServicios(req.params.entidadId)); }
  catch (e) { console.error('[analytics/prestacion-servicios]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/heatmap/:entidadId */
app.get('/api/analytics/heatmap/:entidadId', checkUser, async (req, res) => {
  try { res.json(await heatmapMensual(req.params.entidadId)); }
  catch (e) { console.error('[analytics/heatmap]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/alertas/:entidadId */
app.get('/api/analytics/alertas/:entidadId', checkUser, async (req, res) => {
  try { res.json(await alertasRiesgo(req.params.entidadId)); }
  catch (e) { console.error('[analytics/alertas]', e.message); res.status(500).json({ error: e.message }); }
});

/** GET /api/analytics/top-contratos/:entidadId */
app.get('/api/analytics/top-contratos/:entidadId', checkUser, async (req, res) => {
  try { res.json(await topContratosValor(req.params.entidadId)); }
  catch (e) { console.error('[analytics/top-contratos]', e.message); res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SECOP — Consulta desde BigQuery (rápido, sin límites de paginación)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/secop/bq/:tabla/:entidadId
 * Consulta datos SECOP desde BigQuery.
 * ?modo=contratante|proveedor  (default: contratante)
 * ?limit=50  ?offset=0
 * ?search=texto
 * ?tipo=Prestacion+de+servicios
 * ?estado=Liquidado
 * ?fechaDesde=2022-01-01  ?fechaHasta=2024-12-31
 */
app.get('/api/secop/bq/:tabla/:entidadId', checkUser, async (req, res) => {
  const { tabla, entidadId } = req.params;
  const tablas = ['secop_ii_contratos', 'secop_ii_procesos', 'tienda_virtual'];
  if (!tablas.includes(tabla)) return res.status(400).json({ error: `Tabla inválida: ${tabla}` });

  const modo = req.query.modo || 'contratante';
  if (!['contratante', 'proveedor'].includes(modo)) return res.status(400).json({ error: 'modo debe ser contratante o proveedor' });

  try {
    const result = await querySecopBQ(tabla, entidadId, modo, {
      limit:            req.query.limit            || 50,
      offset:           req.query.offset           || 0,
      search:           req.query.search           || '',
      tipo:             req.query.tipo             || '',
      modalidad:        req.query.modalidad        || '',
      estado:           req.query.estado           || '',
      proveedor_nombre: req.query.proveedor_nombre || '',
      doc_proveedor:    req.query.doc_proveedor    || '',
      fechaDesde:       req.query.fechaDesde       || '',
      fechaHasta:       req.query.fechaHasta       || '',
      sortField:        req.query.sortField        || '',
      sortDir:          req.query.sortDir          || 'DESC',
    });
    return res.json(result);
  } catch (err) {
    console.error(`[BQ query] ${tabla}/${entidadId}/${modo}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/secop/bq/resumen/:entidadId
 * Resumen consolidado de las 3 tablas para una entidad (conteos + valores).
 */
app.get('/api/secop/bq/resumen/:entidadId', checkUser, async (req, res) => {
  try {
    const resumen = await resumenEntidadBQ(req.params.entidadId);
    return res.json(resumen);
  } catch (err) {
    console.error(`[BQ resumen] ${req.params.entidadId}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Cualquier otra ruta no-API debe retornar el index.html del frontend

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const server = app.listen(port, () => {
  console.log(`Servidor backend corriendo en el puerto ${port}`);
});
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.timeout = 1800000; // 30 minutos para soportar cargas muy grandes sin timeouts de conexión
