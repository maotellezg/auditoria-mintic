import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { storage } from './firebase.js';
import { VertexAI } from '@google-cloud/vertexai';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location = process.env.GCP_LOCATION || 'us-central1';

const vertexAI = new VertexAI({
  project: projectId,
  location: location
});

/**
 * Divide una cadena de texto en fragmentos (chunks) solapados alineados a límites de palabras.
 * @param {string} text - El texto completo a fragmentar
 * @param {number} chunkSize - Tamaño máximo del fragmento en caracteres (por defecto 1200)
 * @param {number} overlap - Tamaño de la superposición en caracteres (por defecto 200)
 * @returns {Array<string>} Arreglo de fragmentos de texto
 */
export function splitTextIntoChunks(text, chunkSize = 1200, overlap = 200) {
  const chunks = [];
  if (!text || typeof text !== 'string') return chunks;

  // Reemplazar saltos de línea múltiples por simples y normalizar espacios
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\n\s*\n/g, '\n\n');
  
  let index = 0;
  while (index < normalizedText.length) {
    let end = index + chunkSize;
    
    if (end > normalizedText.length) {
      end = normalizedText.length;
    } else {
      // Intentar alinearse a un límite de palabra buscando el último espacio
      const lastSpace = normalizedText.lastIndexOf(' ', end);
      // Solo retroceder si el espacio está dentro de un rango razonable para no achicar demasiado el chunk
      if (lastSpace > index + (chunkSize - 200)) {
        end = lastSpace;
      }
    }

    const chunkText = normalizedText.slice(index, end).trim();
    
    // Solo guardar chunks que contengan texto real y significativo (evitar ruido de espacios)
    if (chunkText.length > 40) {
      chunks.push(chunkText);
    }

    index = end - overlap;
    
    // Evitar bucles infinitos o chunks redundantes al final
    if (index >= normalizedText.length - overlap) {
      break;
    }
  }

  return chunks;
}

/**
 * Transcribe el contenido textual de una imagen utilizando Gemini 2.5 Flash
 * @param {Buffer} fileBuffer - Buffer del archivo de imagen
 * @param {string} mimeType - El tipo MIME de la imagen
 * @returns {Promise<string>} El texto extraído
 */
async function extractTextFromImageWithAI(fileBuffer, mimeType) {
  try {
    console.log(`[Chunker] Extrayendo texto de imagen de forma visual usando Gemini 2.5 Flash...`);
    const modelInstance = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash'
    });

    const result = await modelInstance.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              data: fileBuffer.toString('base64'),
              mimeType: mimeType
            }
          },
          { text: "Por favor transcribe de manera fiel, completa e íntegra todo el texto visible que identifiques en esta imagen o documento escaneado. Transcribe el texto de forma corrida en español, sin añadir resúmenes, explicaciones ni notas adicionales." }
        ]
      }]
    });

    const response = await result.response;
    
    // Extraer texto robustamente
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || '';
    return text.trim();
  } catch (err) {
    console.error('[Chunker] Error extrayendo texto de imagen con Gemini:', err);
    return '';
  }
}

/**
 * Descarga y extrae el texto plano de un documento en Cloud Storage o Buffer según su tipo MIME.
 * @param {string} filePath - La ruta del archivo en Storage (ej: documents/...)
 * @param {string} mimeType - El tipo MIME del archivo
 * @param {Buffer} [localBuffer] - Buffer opcional si ya se cuenta con él en memoria
 * @returns {Promise<string>} El texto extraído completo del archivo
 */
export async function extractTextFromDocument(filePath, mimeType, localBuffer = null) {
  let buffer = localBuffer;

  // Si no hay buffer local, descargarlo de GCS
  if (!buffer) {
    console.log(`[Chunker] Descargando archivo de Cloud Storage para extracción: ${filePath}`);
    const bucket = storage.bucket();
    const file = bucket.file(filePath);
    const [downloadedBuffer] = await file.download();
    buffer = downloadedBuffer;
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('El buffer del archivo está vacío o no se pudo descargar.');
  }

  console.log(`[Chunker] Iniciando extracción de texto para MIME: ${mimeType}`);

  // Extracción según tipo MIME
  if (mimeType === 'application/pdf') {
    try {
      const data = await pdf(buffer);
      console.log(`[Chunker] Éxito al parsear PDF localmente. Caracteres extraídos: ${data.text?.length || 0}`);
      return data.text || '';
    } catch (err) {
      console.error('[Chunker] Error parseando PDF localmente con pdf-parse. Usando fallback de Gemini para lectura de PDF...', err);
      // Fallback usando Gemini para leer el PDF completo de GCS si es posible
      return await extractTextFromPDFWithAI(filePath);
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      console.log(`[Chunker] Éxito al parsear Word. Caracteres extraídos: ${result.value?.length || 0}`);
      return result.value || '';
    } catch (err) {
      console.error('[Chunker] Error parseando Word con mammoth:', err);
      throw err;
    }
  } else if (mimeType.startsWith('image/')) {
    return await extractTextFromImageWithAI(buffer, mimeType);
  } else if (mimeType.startsWith('text/')) {
    const textDecoder = new TextDecoder('utf-8');
    return textDecoder.decode(buffer);
  } else {
    // Para otros tipos de archivos de texto
    const textDecoder = new TextDecoder('utf-8');
    try {
      return textDecoder.decode(buffer);
    } catch (e) {
      console.warn(`[Chunker] No se soporta extracción nativa para el tipo: ${mimeType}. Intentando forzar conversión a texto.`);
      return buffer.toString('utf8');
    }
  }
}

/**
 * Fallback usando Gemini 2.5 Flash para extraer el texto de un PDF en Cloud Storage
 * @param {string} filePath - La ruta de GCS
 */
async function extractTextFromPDFWithAI(filePath) {
  try {
    const bucketName = process.env.GCP_STORAGE_BUCKET || 'auditoria-mintc';
    const gcsUri = `gs://${bucketName}/${filePath}`;
    console.log(`[Chunker Fallback] Extrayendo texto de PDF vía Vertex AI desde GCS: ${gcsUri}`);
    
    const modelInstance = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash'
    });

    const result = await modelInstance.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: gcsUri,
              mimeType: 'application/pdf'
            }
          },
          { text: "Extrae de manera completa e íntegra el texto de este documento PDF. Retorna solo el texto plano extraído del documento, sin agregar explicaciones, resúmenes, comentarios ni encabezados." }
        ]
      }]
    });

    const response = await result.response;
    return response.candidates?.[0]?.content?.parts?.[0]?.text || response.text || '';
  } catch (err) {
    console.error('[Chunker Fallback] Error crítico al extraer texto del PDF con Gemini:', err);
    return '';
  }
}
