import { VertexAI } from '@google-cloud/vertexai';
import mammoth from 'mammoth';
import dotenv from 'dotenv';

dotenv.config();

// Inicializar Vertex AI
const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location = process.env.GCP_LOCATION || 'us-central1';

const vertexAI = new VertexAI({
  project: projectId,
  location: location
});

// Los modelos se instancian dinámicamente con un sistema de fallback asíncrono para garantizar alta disponibilidad.

/**
 * Convierte un buffer de archivo en el formato inlineData que requiere Gemini
 * @param {Buffer} buffer - El buffer del archivo
 * @param {string} mimeType - El tipo MIME del archivo
 */
function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString('base64'),
      mimeType: mimeType
    }
  };
}

/**
 * Extrae texto de un archivo Word (.docx)
 * @param {Buffer} buffer - Buffer del archivo .docx
 * @returns {Promise<string>} Texto extraído
 */
async function extractTextFromWord(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: buffer });
    return result.value || '';
  } catch (error) {
    console.error('Error al extraer texto del archivo Word:', error);
    throw new Error('No se pudo leer el archivo de Word.');
  }
}

/**
 * Función auxiliar para extraer el texto de la respuesta de Gemini de forma 100% robusta,
 * soportando tanto propiedades directas, funciones, como la estructura anidada de candidates de Vertex AI legacy.
 * @param {Object} response - Objeto de respuesta de Vertex AI
 * @returns {string} Texto extraído de la respuesta
 */
function extractTextFromResponse(response) {
  if (!response) return '';
  
  // 1. Intentar la estructura anidada legacy de @google-cloud/vertexai (candidates)
  try {
    const candidateText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText && typeof candidateText === 'string') {
      return candidateText;
    }
  } catch (e) {
    console.warn('Fallo al intentar extraer texto de candidates:', e.message);
  }

  // 2. Intentar llamar a .text() como función (común en algunas versiones del SDK)
  try {
    if (typeof response.text === 'function') {
      return response.text();
    }
  } catch (e) {
    console.warn('Fallo al intentar llamar a response.text():', e.message);
  }

  // 3. Intentar acceder a .text como propiedad (SDK unificado)
  try {
    if (response.text && typeof response.text === 'string') {
      return response.text;
    }
  } catch (e) {
    console.warn('Fallo al intentar acceder a response.text:', e.message);
  }

  // 4. Fallback si es un string directo o si viene stringificado
  try {
    if (typeof response === 'string') {
      const parsed = JSON.parse(response);
      const txt = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) return txt;
    }
  } catch (e) {}

  return '';
}

/**
 * Analiza un documento (PDF, Imagen o Word) usando Gemini y Vertex AI.
 * @param {Buffer} fileBuffer - Buffer del archivo
 * @param {string} filename - Nombre original del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<Object>} Metadatos y resumen estructurados en JSON
 */
export async function analyzeDocument(fileBuffer, filename, mimeType, gcsPath = null) {
  console.log(`Iniciando análisis inteligente de: ${filename} (MIME: ${mimeType})`);

  let parts = [];
  let fileTypeDescription = '';

  // Determinar cómo procesar según el tipo MIME
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Si es Word, extraemos texto primero y lo pasamos como prompt
    console.log('Detectado archivo Word (.docx). Extrayendo texto...');
    const extractedText = await extractTextFromWord(fileBuffer);
    parts.push({ text: `CONTENIDO DEL DOCUMENTO WORD EXTRAÍDO:\n\n${extractedText}` });
    fileTypeDescription = 'Word (.docx)';
  } else if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
    // PDFs e Imágenes son soportados de forma nativa por Gemini
    if (gcsPath) {
      const bucketName = process.env.GCP_STORAGE_BUCKET || 'auditoria-mintc';
      const gcsUri = `gs://${bucketName}/${gcsPath}`;
      console.log(`Detectado archivo nativo multimedia (${mimeType}). Usando URI directa de GCS: ${gcsUri}`);
      parts.push({
        fileData: {
          fileUri: gcsUri,
          mimeType: mimeType
        }
      });
    } else {
      console.log(`Detectado archivo nativo multimedia (${mimeType}) sin gcsPath. Preparando inlineData...`);
      const filePart = fileToGenerativePart(fileBuffer, mimeType);
      parts.push(filePart);
    }
    fileTypeDescription = mimeType === 'application/pdf' ? 'PDF' : 'Imagen';
  } else {
    // Por si acaso, intentamos extraer texto simple o asumimos texto si no es soportado nativamente
    const textDecoder = new TextDecoder('utf-8');
    const textContent = textDecoder.decode(fileBuffer).slice(0, 100000); // Límite razonable
    parts.push({ text: `CONTENIDO DEL DOCUMENTO EXTRAÍDO:\n\n${textContent}` });
    fileTypeDescription = 'Texto/Desconocido';
  }

  // El Prompt del Sistema para Gemini adaptado a la ANLA colombiana
  const promptText = `
Eres un analista experto de la MinTic (Ministerio de Tecnologias de la Informacion y las Comunicaciones).
Tu tarea es analizar el documento adjunto (que es de tipo ${fileTypeDescription} y se llama "${filename}") y extraer información estructurada en formato JSON estricto.

Debes clasificar e identificar todas las entidades posibles y generar un resumen ejecutivo.

El JSON retornado debe tener EXACTAMENTE las siguientes propiedades de tipo String, Array o Número, según corresponda:

{
  "institution": "La entidad de origen o institución del documento. DEBE SER EXACTAMENTE UNO DE LOS SIGUIENTES: 'ANLA', 'Ministerio de Ambiente'. Si el documento es emitido por el Ministerio, pon 'Ministerio de Ambiente'; si es por la Autoridad Nacional de Licencias Ambientales o autos, resoluciones de trámites de licencias, pon 'ANLA'",
  "documentType": "El tipo de trámite o documento. Debe ser uno de los siguientes: 'Licencia', 'Sanción', 'Resolución', 'Auto de Inicio', 'Concepto Técnico', 'PQRS', 'Documento Público', 'Otro'",
  "sector": "El sector industrial del documento. DEBE SER EXACTAMENTE UNO DE LOS SIGUIENTES: 'HIDROCARBUROS', 'MINERIA', 'INFRAESTRUCTURA', 'ENERGIA', 'AGROQUIMICOS', 'OTRO'",
  "company": "Nombre de la empresa o solicitante (ej: EPM, Ecopetrol, Cerrejón, etc.). Si no aplica o no se menciona, pon 'No especificado'",
  "region": "La región o territorio general de Colombia donde aplica (ej: Región Andina, Región Caribe, etc.) o Corporación Autónoma Regional (ej: Corantioquia, Cornare, etc.)",
  "departamento": "Departamento de Colombia (ej: Antioquia, Bolívar, etc.). Si hay varios, sepáralos por comas o pon 'Nacional'",
  "municipio": "Municipio(s) involucrado(s). Si no hay, pon 'No especificado'",
  "expediente": "Número de expediente, código de radicado o número de resolución si se encuentra (ej: LAV0123-00-19, Radicado 202612345). Si no hay, pon 'No especificado'",
  "date": "Fecha principal del documento en formato YYYY-MM-DD. Si no se encuentra, estima la fecha aproximada o pon 'No especificada'",
  "importantDates": [
    { "date": "YYYY-MM-DD", "context": "Contexto de la fecha (ej: Fecha de notificación, fecha del hecho sancionable, fecha de recurso, etc.)" }
  ],
  "signatories": [
    { "name": "Nombre completo de la persona que firma", "role": "Cargo o rol (ej: Director, Subdirector, Coordinador, etc.)" }
  ],
  "summary": "Resumen ejecutivo detallado del documento. Debe ser claro, profesional y estructurado en 2 o 3 párrafos cortos explicando el objetivo, las decisiones y las conclusiones principales del documento.",
  "relevantData": [
    "Cualquier otro dato cuantitativo o cualitativo de alta relevancia o cifras clave (ej: 'Multa de $150.000.000 COP', 'Afectación a la cuenca del Río Sogamoso', 'Volumen de vertimiento autorizado', etc.)"
  ],
  "keyThemes": ["Arreglo de palabras clave o temas del documento (ej: 'Licencia', 'Monitoreo de Aguas', 'Sanción por Vertimientos', 'Energía Solar')", "máximo 5 tags"],
  "wikiKeywords": ["Palabras clave específicas para crear interconexiones en una Wiki. Deben ser conceptos técnicos, nombres de cuencas, veredas, o términos legales recurrentes que sirvan para vincular este documento con otros en una red de conocimiento (ej: 'Río Cauca', 'PMA', 'Vertimientos', 'Deforestación')", "máximo 6 palabras"],
  "status": "Siempre retorna 'Analizado'"
}

Instrucciones Críticas:
1. No inventes datos. Si no encuentras alguna propiedad, pon 'No especificado' o un arreglo vacío [] según corresponda.
2. El resumen debe estar en español formal y ser muy útil para un tomador de decisiones.
3. Asegúrate de retornar ÚNICAMENTE el código JSON válido. Sin markdown adicional (no agregues \`\`\`json ni nada de eso). Si la respuesta no es un JSON perfecto, el sistema fallará.
4. IMPORTANTE: Escapa correctamente cualquier comilla doble interna (usa \\\" en tus textos de resumen o campos) y cualquier carácter de control especial en tus textos (como saltos de línea internos, usa \\n) para que el JSON sea 100% válido y nunca rompa el parser JSON. No retornes saltos de línea literales (crudos) dentro de los strings del JSON.
`;

  parts.push({ text: promptText });

  const candidateModels = [
    'gemini-1.5-flash-001',
    'gemini-1.5-flash-002',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro-001',
    'gemini-1.5-pro-002',
    'gemini-1.5-pro'
  ];

  const startTime = Date.now();
  let text = '';
  let lastError = null;
  let chosenModel = '';
  let responseMetadata = null;

  for (const candidate of candidateModels) {
    try {
      console.log(`Intentando analizar documento con modelo Vertex AI: ${candidate}...`);
      const modelInstance = vertexAI.getGenerativeModel({
        model: candidate,
        generationConfig: {
          responseMimeType: 'application/json',
        }
      });

      const result = await modelInstance.generateContent({
        contents: [{ role: 'user', parts: parts }]
      });

      const response = await result.response;
      text = extractTextFromResponse(response);
      console.log(`✅ Análisis exitoso usando modelo: ${candidate}`);
      lastError = null;
      chosenModel = candidate;
      responseMetadata = response.usageMetadata || null;
      break;
    } catch (err) {
      console.warn(`⚠️ Error usando modelo ${candidate}: ${err.message}`);
      lastError = err;
      
      const errMsg = err.message || '';
      if (errMsg.includes('400') || errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('page limit') || errMsg.includes('limit of 1000')) {
        console.warn(`🛑 Detectado error de validación o límite de páginas de Vertex AI. Abortando búsqueda secuencial de modelos para conservar el mensaje de error de validación exacto.`);
        break;
      }
    }
  }

  if (lastError) {
    console.error('❌ Todos los modelos de Gemini fallaron en Vertex AI.');
    throw lastError;
  }

  try {
    console.log('Respuesta recibida de Gemini. Iniciando parseo resiliente...');
    
    // Función auxiliar para intentar parsear con diferentes estrategias de limpieza
    const parseResilient = (rawText) => {
      let cleanText = rawText.trim();
      
      // Stage 1: Intento directo
      try {
        return JSON.parse(cleanText);
      } catch (e) {
        console.warn('Estrategia 1 (JSON.parse directo) falló.');
      }
      
      // Stage 2: Limpieza de bloques de código markdown
      let stripped = cleanText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      try {
        return JSON.parse(stripped);
      } catch (e) {
        console.warn('Estrategia 2 (Limpieza de markdown) falló.');
      }
      
      // Stage 3: Extraer lo que está estrictamente entre la primera llave { y la última llave }
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = cleanText.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          console.warn('Estrategia 3 (Extracción de llave a llave) falló. Intentando sanitización fina de caracteres de control...');
          
          // Stage 4: Sanitizar saltos de línea y caracteres de control dentro de strings
          try {
            let sanitized = '';
            let insideQuote = false;
            let escaped = false;
            
            for (let i = 0; i < candidate.length; i++) {
              const char = candidate[i];
              
              if (char === '"' && !escaped) {
                insideQuote = !insideQuote;
                sanitized += char;
              } else if (char === '\\' && insideQuote) {
                escaped = !escaped;
                sanitized += char;
              } else {
                escaped = false;
                if (insideQuote) {
                  if (char === '\n') {
                    sanitized += '\\n';
                  } else if (char === '\r') {
                    sanitized += '\\r';
                  } else if (char === '\t') {
                    sanitized += '\\t';
                  } else {
                    sanitized += char;
                  }
                } else {
                  sanitized += char;
                }
              }
            }
            return JSON.parse(sanitized);
          } catch (sanitizeErr) {
            console.warn('Estrategia 4 (Sanitización de caracteres de control) falló:', sanitizeErr.message);
          }
        }
      }
      
      throw new Error('Todas las estrategias de parseo JSON fallaron.');
    };

    try {
      const parsedJSON = parseResilient(text);
      
      // Validamos que por lo menos sea un objeto y tenga campos esperados
      if (parsedJSON && typeof parsedJSON === 'object') {
        const durationMs = Date.now() - startTime;
        const promptTokens = responseMetadata?.promptTokenCount || responseMetadata?.promptTokens || 0;
        const candidatesTokens = responseMetadata?.candidatesTokenCount || responseMetadata?.candidatesTokens || responseMetadata?.outputTokenCount || responseMetadata?.outputTokens || 0;
        const totalTokens = responseMetadata?.totalTokenCount || responseMetadata?.totalTokens || (promptTokens + candidatesTokens);

        // Normalizar los campos principales si vienen indefinidos para mantener uniformidad
        return {
          institution: parsedJSON.institution || 'ANLA',
          documentType: parsedJSON.documentType || 'Otro',
          sector: parsedJSON.sector || 'OTRO',
          company: parsedJSON.company || 'No especificado',
          region: parsedJSON.region || 'No especificado',
          departamento: parsedJSON.departamento || 'No especificado',
          municipio: parsedJSON.municipio || 'No especificado',
          expediente: parsedJSON.expediente || 'No especificado',
          date: parsedJSON.date || new Date().toISOString().split('T')[0],
          importantDates: parsedJSON.importantDates || [],
          signatories: parsedJSON.signatories || [],
          summary: parsedJSON.summary || 'Sin resumen estructurado disponible.',
          relevantData: parsedJSON.relevantData || [],
          keyThemes: parsedJSON.keyThemes || [],
          wikiKeywords: parsedJSON.wikiKeywords || [],
          status: 'Analizado',
          _audit: {
            modelUsed: chosenModel,
            durationMs: durationMs,
            tokens: {
              prompt: promptTokens,
              candidates: candidatesTokens,
              total: totalTokens
            }
          }
        };
      } else {
        throw new Error('El JSON parseado no es un objeto válido.');
      }
      
    } catch (parseError) {
      console.error('Error crítico al parsear el JSON de Gemini. Retornando fallback estructurado. Respuesta cruda:', text);
      const durationMs = Date.now() - startTime;
      const promptTokens = responseMetadata?.promptTokenCount || responseMetadata?.promptTokens || 0;
      const candidatesTokens = responseMetadata?.candidatesTokenCount || responseMetadata?.candidatesTokens || responseMetadata?.outputTokenCount || responseMetadata?.outputTokens || 0;
      const totalTokens = responseMetadata?.totalTokenCount || responseMetadata?.totalTokens || (promptTokens + candidatesTokens);

      return {
        institution: 'ANLA',
        documentType: 'Otro',
        sector: 'OTRO',
        company: 'Error de análisis',
        region: 'No especificado',
        departamento: 'No especificado',
        municipio: 'No especificado',
        expediente: 'No especificado',
        date: new Date().toISOString().split('T')[0],
        importantDates: [],
        signatories: [],
        summary: `No se pudo parsear el análisis automático. El archivo fue subido con éxito pero falló el formateador de IA. Respuesta cruda: ${text.slice(0, 500)}...`,
        relevantData: [],
        keyThemes: ['Error'],
        wikiKeywords: [],
        status: 'Error en Análisis',
        _audit: {
          modelUsed: chosenModel,
          durationMs: durationMs,
          tokens: {
            prompt: promptTokens,
            candidates: candidatesTokens,
            total: totalTokens
          }
        }
      };
    }
  } catch (error) {
    console.error('Error en la llamada a Vertex AI (Gemini):', error);
    throw error;
  }
}
