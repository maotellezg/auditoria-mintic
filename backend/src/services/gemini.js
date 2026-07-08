import { VertexAI } from '@google-cloud/vertexai';
import mammoth from 'mammoth';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location  = process.env.GCP_LOCATION  || 'us-central1';

const vertexAI = new VertexAI({ project: projectId, location });

// ─── Entidades del ecosistema MinTic ────────────────────────────────────────
const ENTIDADES_MINTIC = [
  'MinTIC',
  'ANE',
  'CRC',
  'AND',
  'FUTIC',
  'RTVC',
  'Servicios Postales Nacionales (4-72)',
  'Persona Natural',
  'Empresa Privada',
  'Otro'
];

function fileToGenerativePart(buffer, mimeType) {
  return { inlineData: { data: buffer.toString('base64'), mimeType } };
}

async function extractTextFromWord(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (error) {
    console.error('Error al extraer texto del archivo Word:', error);
    throw new Error('No se pudo leer el archivo de Word.');
  }
}

function extractTextFromResponse(response) {
  if (!response) return '';
  try {
    const t = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (t && typeof t === 'string') return t;
  } catch (e) {}
  try {
    if (typeof response.text === 'function') return response.text();
  } catch (e) {}
  try {
    if (response.text && typeof response.text === 'string') return response.text;
  } catch (e) {}
  try {
    if (typeof response === 'string') {
      const p = JSON.parse(response);
      const t2 = p.candidates?.[0]?.content?.parts?.[0]?.text;
      if (t2) return t2;
    }
  } catch (e) {}
  return '';
}

/**
 * Analiza un documento usando Gemini, especializado en auditoría MinTic colombiana.
 */
export async function analyzeDocument(fileBuffer, filename, mimeType, gcsPath = null) {
  console.log(`Iniciando análisis MinTic de: ${filename} (MIME: ${mimeType})`);

  let parts = [];
  let fileTypeDescription = '';

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const extractedText = await extractTextFromWord(fileBuffer);
    parts.push({ text: `CONTENIDO DEL DOCUMENTO WORD EXTRAIDO:\n\n${extractedText}` });
    fileTypeDescription = 'Word (.docx)';
  } else if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
    if (gcsPath) {
      const bucketName = process.env.GCP_STORAGE_BUCKET || 'auditoria-mintc-storage';
      const gcsUri = `gs://${bucketName}/${gcsPath}`;
      console.log(`Usando URI GCS: ${gcsUri}`);
      parts.push({ fileData: { fileUri: gcsUri, mimeType } });
    } else {
      parts.push(fileToGenerativePart(fileBuffer, mimeType));
    }
    fileTypeDescription = mimeType === 'application/pdf' ? 'PDF' : 'Imagen';
  } else {
    const textContent = new TextDecoder('utf-8').decode(fileBuffer).slice(0, 100000);
    parts.push({ text: `CONTENIDO DEL DOCUMENTO:\n\n${textContent}` });
    fileTypeDescription = 'Texto';
  }

  // ─── PROMPT ESPECIALIZADO EN AUDITORIA MINTIC ───────────────────────────
  const promptText = `
Eres un auditor experto del sector TIC colombiano con amplio conocimiento del ecosistema del
Ministerio de Tecnologias de la Informacion y las Comunicaciones (MinTIC) de Colombia.

Tu tarea es analizar el documento adjunto (tipo: ${fileTypeDescription}, nombre: "${filename}")
y extraer informacion estructurada para una plataforma de AUDITORIA GUBERNAMENTAL.

El documento puede ser: contratos, declaraciones de renta, resoluciones, convenios, actas,
licitaciones, certificaciones, informes, o cualquier documento del sector TIC colombiano.

Entidades del ecosistema MinTic a reconocer:
- MinTIC: Ministerio de Tecnologias de la Informacion y las Comunicaciones
- ANE: Agencia Nacional del Espectro
- CRC: Comision de Regulacion de Comunicaciones
- AND: Agencia Nacional Digital
- FUTIC: Fondo Unico de Tecnologias de la Informacion y las Comunicaciones
- RTVC: Sistema de Medios Publicos
- Servicios Postales Nacionales (4-72)
- Persona Natural: cuando el documento es de/para una persona natural (declaraciones de renta, etc.)
- Empresa Privada: empresa privada del sector TIC
- Otro: si no corresponde a ninguna de las anteriores

Retorna UNICAMENTE un JSON valido con EXACTAMENTE esta estructura. Sin markdown, sin bloques de codigo:

{
  "entidad": "Una de las 10 entidades listadas arriba. OBLIGATORIO.",
  "tipoDocumento": "Uno de: Contrato, Declaracion de Renta, Resolucion, Convenio, Acta, Licitacion, Certificacion, Informe, PQRS, Otro",
  "numeroDocumento": "Numero de contrato, radicado, expediente o referencia del documento. Si no hay, 'No especificado'",
  "fechaDocumento": "Fecha principal en formato YYYY-MM-DD. Si no hay, 'No especificada'",
  "fechasImportantes": [
    { "fecha": "YYYY-MM-DD", "contexto": "Que representa esta fecha (ej: Fecha de firma, Fecha de vencimiento, Plazo de ejecucion)" }
  ],
  "valorContrato": "Valor economico del documento en pesos colombianos. Incluir el numero completo (ej: '$1.500.000.000 COP'). Si no aplica, 'No aplica'",
  "objetoContrato": "Objeto, proposito o descripcion principal del documento. Maximo 3 lineas.",
  "contratista": "Nombre completo de la empresa o persona contratada o que presenta el documento. Si no aplica, 'No especificado'",
  "supervisor": "Nombre del supervisor o interventor del contrato si lo hay. Si no hay, 'No especificado'",
  "personas": [
    {
      "nombre": "Nombre completo de la persona",
      "cedula": "Numero de cedula o NIT si aparece. Si no hay, 'No especificado'",
      "cargo": "Cargo o titulo de la persona",
      "rol": "Rol en el documento: Firmante, Representante Legal, Contratista, Supervisor, Beneficiario, Declarante, Testigo, Otro",
      "entidadPersona": "Entidad u organizacion a la que pertenece esta persona"
    }
  ],
  "firmantes": [
    { "nombre": "Nombre completo", "cargo": "Cargo", "entidadFirmante": "Entidad que representa" }
  ],
  "alertas": [
    "Lista de posibles puntos de atencion para el auditor. Ej: 'Valor del contrato superior al umbral de licitacion', 'Plazo de ejecucion vencido', 'Falta firma del supervisor', 'Inconsistencia en fechas'"
  ],
  "resumen": "Resumen ejecutivo del documento para el auditor. Minimo 3 parrafos: 1) De que trata el documento, 2) Partes involucradas y sus roles, 3) Aspectos financieros y juridicos relevantes.",
  "datosRelevantes": [
    "Dato cuantitativo o hecho juridico importante (ej: 'Plazo de ejecucion: 12 meses', 'Garantia del 10%', 'CDP No. 2024-1234')"
  ],
  "temasClave": ["Maximo 5 temas o tags del documento (ej: 'Conectividad', 'Infraestructura TIC', 'Espectro Radioelectrico')"],
  "wikiKeywords": ["Maximo 6 palabras clave para interconectar este documento con otros en la Wiki (ej: 'MinTIC', 'Contrato', nombre de persona clave)"],
  "institution": "Mismo valor que entidad (para compatibilidad)",
  "documentType": "Mismo valor que tipoDocumento (para compatibilidad)",
  "sector": "Sector TIC especifico: CONECTIVIDAD, ESPECTRO, POSTAL, REGULACION, MEDIOS, GOBIERNO_DIGITAL, OTRO",
  "company": "Mismo valor que contratista (para compatibilidad)",
  "expediente": "Mismo valor que numeroDocumento (para compatibilidad)",
  "date": "Mismo valor que fechaDocumento (para compatibilidad)",
  "importantDates": [],
  "signatories": [],
  "summary": "Mismo valor que resumen (para compatibilidad)",
  "relevantData": [],
  "keyThemes": [],
  "region": "Region de Colombia si aplica, o 'Nacional'",
  "departamento": "Departamento de Colombia si aplica, o 'Nacional'",
  "municipio": "Municipio si aplica, o 'No especificado'",
  "status": "Analizado"
}

Instrucciones criticas:
1. NUNCA inventes datos. Si no encuentras algo, usa 'No especificado' o [].
2. El campo personas[] debe incluir A TODAS las personas mencionadas en el documento, incluyendo las que solo aparecen como referencias.
3. El campo alertas[] es MUY IMPORTANTE para el auditor. Se creativo y critico identificando posibles problemas.
4. Retorna SOLO el JSON. Sin texto adicional, sin markdown, sin bloques de codigo.
5. Escapa correctamente las comillas internas con \\\" y los saltos de linea con \\n.
6. El JSON debe ser 100% valido y parseable.
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
      console.log(`Intentando modelo: ${candidate}...`);
      const modelInstance = vertexAI.getGenerativeModel({
        model: candidate,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await modelInstance.generateContent({
        contents: [{ role: 'user', parts }]
      });
      const response = await result.response;
      text = extractTextFromResponse(response);
      console.log(`Analisis exitoso con modelo: ${candidate}`);
      lastError = null;
      chosenModel = candidate;
      responseMetadata = response.usageMetadata || null;
      break;
    } catch (err) {
      console.warn(`Error con modelo ${candidate}: ${err.message}`);
      lastError = err;
      const errMsg = err.message || '';
      if (errMsg.includes('400') || errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('page limit') || errMsg.includes('limit of 1000')) {
        break;
      }
    }
  }

  if (lastError) throw lastError;

  // ─── PARSEO RESILIENTE ──────────────────────────────────────────────────
  const parseResilient = (rawText) => {
    let cleanText = rawText.trim();
    try { return JSON.parse(cleanText); } catch (e) {}
    let stripped = cleanText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(stripped); } catch (e) {}
    const firstBrace = cleanText.indexOf('{');
    const lastBrace  = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const cand = cleanText.substring(firstBrace, lastBrace + 1);
      try { return JSON.parse(cand); } catch (e) {
        try {
          let sanitized = '';
          let insideQuote = false;
          let escaped = false;
          for (let i = 0; i < cand.length; i++) {
            const char = cand[i];
            if (char === '"' && !escaped) { insideQuote = !insideQuote; sanitized += char; }
            else if (char === '\\' && insideQuote) { escaped = !escaped; sanitized += char; }
            else {
              escaped = false;
              if (insideQuote) {
                if (char === '\n') sanitized += '\\n';
                else if (char === '\r') sanitized += '\\r';
                else if (char === '\t') sanitized += '\\t';
                else sanitized += char;
              } else { sanitized += char; }
            }
          }
          return JSON.parse(sanitized);
        } catch (se) { console.warn('Sanitizacion fallo:', se.message); }
      }
    }
    throw new Error('Todas las estrategias de parseo fallaron.');
  };

  const durationMs = Date.now() - startTime;
  const promptTokens = responseMetadata?.promptTokenCount || 0;
  const candidatesTokens = responseMetadata?.candidatesTokenCount || 0;
  const totalTokens = responseMetadata?.totalTokenCount || (promptTokens + candidatesTokens);

  try {
    const parsed = parseResilient(text);
    if (parsed && typeof parsed === 'object') {
      // Normalizar compatibilidad
      const entidad = parsed.entidad || parsed.institution || 'Otro';
      const tipoDoc = parsed.tipoDocumento || parsed.documentType || 'Otro';
      const numDoc  = parsed.numeroDocumento || parsed.expediente || 'No especificado';
      const fecha   = parsed.fechaDocumento || parsed.date || new Date().toISOString().split('T')[0];

      return {
        // ── Campos nuevos MinTic ──
        entidad,
        tipoDocumento: tipoDoc,
        numeroDocumento: numDoc,
        fechaDocumento: fecha,
        fechasImportantes: parsed.fechasImportantes || [],
        valorContrato: parsed.valorContrato || 'No aplica',
        objetoContrato: parsed.objetoContrato || 'No especificado',
        contratista: parsed.contratista || parsed.company || 'No especificado',
        supervisor: parsed.supervisor || 'No especificado',
        personas: parsed.personas || [],
        firmantes: parsed.firmantes || parsed.signatories || [],
        alertas: parsed.alertas || [],
        resumen: parsed.resumen || parsed.summary || 'Sin resumen disponible.',
        datosRelevantes: parsed.datosRelevantes || parsed.relevantData || [],
        temasClave: parsed.temasClave || parsed.keyThemes || [],
        wikiKeywords: parsed.wikiKeywords || [],
        // ── Compatibilidad con campos anteriores ──
        institution: entidad,
        documentType: tipoDoc,
        sector: parsed.sector || 'OTRO',
        company: parsed.contratista || parsed.company || 'No especificado',
        region: parsed.region || 'Nacional',
        departamento: parsed.departamento || 'Nacional',
        municipio: parsed.municipio || 'No especificado',
        expediente: numDoc,
        date: fecha,
        importantDates: parsed.fechasImportantes?.map(f => ({ date: f.fecha, context: f.contexto })) || [],
        signatories: parsed.firmantes || parsed.signatories || [],
        summary: parsed.resumen || parsed.summary || 'Sin resumen disponible.',
        relevantData: parsed.datosRelevantes || parsed.relevantData || [],
        keyThemes: parsed.temasClave || parsed.keyThemes || [],
        status: 'Analizado',
        _audit: { modelUsed: chosenModel, durationMs, tokens: { prompt: promptTokens, candidates: candidatesTokens, total: totalTokens } }
      };
    }
    throw new Error('JSON parseado no es un objeto valido.');
  } catch (parseError) {
    console.error('Error critico de parseo. Respuesta cruda:', text);
    return {
      entidad: 'Otro', tipoDocumento: 'Otro', numeroDocumento: 'No especificado',
      fechaDocumento: new Date().toISOString().split('T')[0],
      fechasImportantes: [], valorContrato: 'No aplica', objetoContrato: 'Error de analisis',
      contratista: 'Error de analisis', supervisor: 'No especificado',
      personas: [], firmantes: [], alertas: ['Error en el analisis automatico del documento'],
      resumen: `No se pudo parsear el analisis. Respuesta cruda: ${text.slice(0, 500)}`,
      datosRelevantes: [], temasClave: ['Error'], wikiKeywords: [],
      institution: 'Otro', documentType: 'Otro', sector: 'OTRO',
      company: 'Error', region: 'No especificado', departamento: 'No especificado',
      municipio: 'No especificado', expediente: 'No especificado',
      date: new Date().toISOString().split('T')[0],
      importantDates: [], signatories: [], summary: 'Error de analisis.',
      relevantData: [], keyThemes: ['Error'], status: 'Error en Analisis',
      _audit: { modelUsed: chosenModel, durationMs, tokens: { prompt: promptTokens, candidates: candidatesTokens, total: totalTokens } }
    };
  }
}