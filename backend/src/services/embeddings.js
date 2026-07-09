import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location  = process.env.GCP_LOCATION   || 'us-central1';

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

// Pausa helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Genera un vector embedding con retry + exponential backoff.
 * Reintentos: 3. Delays: 1s, 3s, 9s.
 * Resuelve los errores de TLS / socket disconnect en Cloud Run.
 */
export async function getEmbedding(text, { maxRetries = 3 } = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('El texto para el embedding debe ser una cadena no vacía.');
  }

  const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 8000); // limitar tokens

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/text-embedding-004:predict`;

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Token fresco en cada intento (evita tokens expirados)
      const client        = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token         = tokenResponse.token;
      if (!token) throw new Error('No se pudo obtener token de acceso de GCP.');

      // AbortController para timeout de 30 segundos
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 30_000);

      let response;
      try {
        response = await fetch(url, {
          method:  'POST',
          signal:  controller.signal,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
            'Connection':    'keep-alive',
          },
          body: JSON.stringify({
            instances:  [{ content: cleanText }],
            parameters: { autoTruncate: true, outputDimensionality: 768 },
          }),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Vertex AI HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const values = data?.predictions?.[0]?.embeddings?.values;
      if (!Array.isArray(values)) {
        throw new Error('Respuesta de Vertex AI sin embedding válido.');
      }
      return values;

    } catch (err) {
      lastError = err;
      const isTLS    = err.message?.includes('TLS') || err.message?.includes('socket') ||
                       err.message?.includes('fetch failed') || err.name === 'AbortError';
      const isRetry  = isTLS && attempt < maxRetries;

      if (isRetry) {
        const delay = 1000 * Math.pow(3, attempt - 1); // 1s, 3s, 9s
        console.warn(`[embedding] Intento ${attempt}/${maxRetries} falló (${err.message?.slice(0,60)}). Reintentando en ${delay/1000}s...`);
        await sleep(delay);
      } else {
        console.error(`[embedding] Falló definitivamente tras ${attempt} intentos:`, err.message);
        throw err;
      }
    }
  }
  throw lastError;
}
