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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Inicializar Vertex AI para el RAG Chat
const projectId = process.env.GCP_PROJECT_ID || 'entrega-anla';
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
  res.json({ status: 'ok', message: 'Servidor de Anla-Entrega operativo.' });
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

    // 3. Generar enlace de activación de contraseña de Firebase si es Passwordless
    let setupLink = null;
    if (isPasswordless) {
      try {
        setupLink = await authAdmin.generatePasswordResetLink(email, {
          url: 'https://entrega-anla-33385687524.us-central1.run.app' // URL de redirección tras completar
        });
      } catch (linkError) {
        console.warn('No se pudo generar el enlace de configuración de Firebase:', linkError.message);
      }
    }

    // 4. Registrar el perfil y su rol en la colección de Firestore con los flags correspondientes
    const userData = {
      id: uid,
      email: email,
      role: role,
      status: isPasswordless ? 'PENDING_SETUP' : 'ACTIVE_TEMPORARY',
      requirePasswordChange: true, // Forzar cambio en primer inicio
      createdAt: new Date().toISOString()
    };

    if (isPasswordless && setupLink) {
      userData.setupLink = setupLink;
    }

    await db.collection('users').doc(uid).set(userData);
    console.log(`[ADMIN] ✅ Usuario creado con éxito en Firebase y Firestore: ${email}`);

    return res.json({
      success: true,
      message: isPasswordless 
        ? `El usuario ${email} fue creado con éxito. Copia el enlace de activación para compartirlo.`
        : `El usuario ${email} fue creado con éxito con contraseña temporal.`,
      setupLink: setupLink,
      isPasswordless: isPasswordless,
      user: {
        uid: uid,
        email: email,
        role: role
      }
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
 * Chatbot inteligente (RAG) con filtros y citación estructurada.
 */
app.post('/api/chat', checkUser, async (req, res) => {
  const { message, filters } = req.body;
  const userId = req.user.uid;
  const userEmail = req.user.email;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'La pregunta o mensaje del chat es obligatoria.' });
  }

  console.log(`[RAG Chat] Nueva pregunta de ${userEmail}: "${message}" con filtros:`, filters);

  const startTime = Date.now();

  try {
    // 1. Generar embedding de la consulta del usuario
    const queryVector = await getEmbedding(message);

    // 2. Realizar búsqueda vectorial en Firestore
    let query = db.collection('document_chunks');
    
    // Aplicar filtros de pre-filtrado si existen y están seleccionados
    if (filters) {
      if (filters.sector && filters.sector !== 'TODOS') {
        query = query.where('sector', '==', filters.sector);
      }
      if (filters.company && filters.company !== 'TODAS') {
        query = query.where('company', '==', filters.company);
      }
      if (filters.region && filters.region !== 'TODAS') {
        query = query.where('region', '==', filters.region);
      }
    }

    let querySnapshot;
    let fallbackUsed = false;

    try {
      const vectorQuery = query.findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(queryVector),
        limit: 15,
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance'
      });
      querySnapshot = await vectorQuery.get();
    } catch (err) {
      console.warn('[RAG Chat] Búsqueda vectorial filtrada falló (falta de índice). Activando fallback en memoria:', err.message);
      fallbackUsed = true;
      
      // Fallback: buscar los 100 fragmentos más relevantes globalmente y filtrar en memoria
      const vectorQuery = db.collection('document_chunks').findNearest({
        vectorField: 'embedding',
        queryVector: FieldValue.vector(queryVector),
        limit: 100,
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance'
      });
      const fullSnapshot = await vectorQuery.get();

      const filteredDocs = [];
      fullSnapshot.forEach(doc => {
        const data = doc.data();
        let matches = true;
        
        if (filters) {
          if (filters.sector && filters.sector !== 'TODOS' && data.sector !== filters.sector) {
            matches = false;
          }
          if (filters.company && filters.company !== 'TODAS' && data.company !== filters.company) {
            matches = false;
          }
          if (filters.region && filters.region !== 'TODAS' && data.region !== filters.region) {
            matches = false;
          }
        }

        if (matches) {
          filteredDocs.push({ id: doc.id, ...data });
        }
      });

      querySnapshot = filteredDocs.slice(0, 15);
    }

    // 3. Extraer texto y estructurar chunks
    const chunks = [];
    if (Array.isArray(querySnapshot)) {
      chunks.push(...querySnapshot);
    } else {
      querySnapshot.forEach(doc => {
        chunks.push({ id: doc.id, ...doc.data() });
      });
    }

    console.log(`[RAG Chat] Encontrados ${chunks.length} fragmentos de contexto para responder.`);

    if (chunks.length === 0) {
      return res.json({
        response: 'No se encontraron documentos o fragmentos relevantes para responder a tu pregunta con los filtros seleccionados. Por favor intenta cambiar los filtros o cargar nuevos documentos.',
        citations: [],
        iaMetadata: {
          modelUsed: 'gemini-2.5-flash',
          durationMs: Date.now() - startTime,
          tokens: null
        }
      });
    }

    // 4. Formatear contexto para Gemini
    const contextText = chunks.map((chunk, idx) => {
      return `[Fragmento ${idx + 1}] (Documento ID: ${chunk.docId}, Nombre del archivo: "${chunk.fileName}"):\n${chunk.text}`;
    }).join('\n\n');

    // 5. Enviar a Gemini para generar respuesta
    const systemPrompt = `
Eres "Anla-Chat", un chatbot inteligente experto de la ANLA (Autoridad Nacional de Licencias Ambientales) de Colombia.
Tu tarea es responder la pregunta del usuario utilizando de manera única, estricta e íntegra la información provista en los fragmentos de contexto adjuntos.

Instrucciones Críticas:
1. Responde de manera profesional, clara y estructurada en español formal.
2. CITAS OBLIGATORIAS: Cada vez que afirmes algo basado en un fragmento de contexto, debes citar inmediatamente al final de la oración usando la nomenclatura exacta \`[Doc:docId|fileName]\` de donde proviene. Por ejemplo: "La ANLA impuso una sanción a Ecopetrol por vertimientos en el Río Sogamoso [Doc:abc123DocId|resolucion_sancion.pdf]".
3. Nunca inventes los IDs de documento ni nombres de archivo. Usa exactamente el 'Documento ID' y 'Nombre del archivo' provistos en cada fragmento.
4. Si la información necesaria para responder no se encuentra en el contexto, indícalo de manera amable diciendo que no cuentas con la información específica en los expedientes indexados. No respondas con conocimientos externos que no estén respaldados por el contexto provisto.
5. Haz uso de formato markdown básico (listas, negritas) para estructurar tu respuesta de forma atractiva y premium.
`;

    const modelInstance = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt
    });

    const promptText = `
PREGUNTA DEL USUARIO:
"${message}"

CONTEXTO DE DOCUMENTOS INDEXADOS:
${contextText}

Genera tu respuesta estructurada y citada según las instrucciones.
`;

    const result = await modelInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: promptText }] }]
    });

    const response = await result.response;
    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || '';

    const durationMs = Date.now() - startTime;
    const tokens = response.usageMetadata || null;

    // 6. Extraer las citas únicas presentes en el texto
    const citationsRegex = /\[Doc:([^|\]]+)\|([^\]]+)\]/g;
    const citationsMap = new Map();
    let match;
    while ((match = citationsRegex.exec(responseText)) !== null) {
      citationsMap.set(match[1], match[2]);
    }

    const uniqueCitations = Array.from(citationsMap.entries()).map(([id, fileName]) => ({
      id,
      fileName
    }));

    // 7. Guardar en auditoría general y auditoría de IA
    await logAuditEvent(userId, userEmail, 'IA_CHAT', {
      query: message,
      filters: filters || null,
      fallbackUsed: fallbackUsed,
      durationMs: durationMs,
      tokensUsed: tokens ? tokens.totalTokenCount : null,
      modelUsed: 'gemini-2.5-flash',
      citationsCount: uniqueCitations.length
    });

    return res.json({
      response: responseText,
      citations: uniqueCitations,
      iaMetadata: {
        modelUsed: 'gemini-2.5-flash',
        durationMs: durationMs,
        tokens: tokens || null
      }
    });

  } catch (error) {
    console.error('[RAG Chat] Error en /api/chat:', error);
    return res.status(500).json({
      error: 'Error al procesar la consulta del chat.',
      details: error.message
    });
  }
});

// Servir la aplicación en producción (unificación de frontend y backend en un solo contenedor)
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

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
