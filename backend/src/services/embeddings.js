import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const location = process.env.GCP_LOCATION || 'us-central1';

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

/**
 * Genera un vector embedding de 768 dimensiones para un fragmento de texto usando text-embedding-004 de Vertex AI a través de la API REST nativa.
 * @param {string} text - El texto del que se va a obtener el embedding
 * @returns {Promise<Array<number>>} El vector embedding de floats
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('El texto para el embedding debe ser una cadena no vacía.');
  }

  // Sanitizar texto quitando excesivos saltos de línea y caracteres extraños
  const cleanText = text.replace(/\s+/g, ' ').trim();

  try {
    // Obtener token de acceso de Google Cloud de forma dinámica
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;

    if (!token) {
      throw new Error('No se pudo obtener un token de acceso de Google Cloud.');
    }

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/text-embedding-004:predict`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [
          { content: cleanText }
        ],
        parameters: {
          autoTruncate: true,
          outputDimensionality: 768
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error en API REST de Vertex AI (Status ${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (
      data &&
      Array.isArray(data.predictions) &&
      data.predictions[0] &&
      data.predictions[0].embeddings &&
      Array.isArray(data.predictions[0].embeddings.values)
    ) {
      return data.predictions[0].embeddings.values;
    } else {
      console.error('Estructura de respuesta REST de embeddings inesperada:', JSON.stringify(data));
      throw new Error('La respuesta de Vertex AI REST no contiene un embedding válido en predictions[0].embeddings.values');
    }
  } catch (error) {
    console.error('Error al generar embedding con API REST text-embedding-004:', error);
    throw error;
  }
}
