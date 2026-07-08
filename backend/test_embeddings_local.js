import { getEmbedding } from './src/services/embeddings.js';

async function test() {
  try {
    console.log('Generando embedding de prueba para el texto "Hola mundo" usando Vertex AI REST API...');
    const embedding = await getEmbedding('Hola mundo');
    console.log('¡Embedding generado con éxito!');
    console.log('Dimensiones del vector:', embedding.length);
    console.log('Primeros 5 valores:', embedding.slice(0, 5));
  } catch (err) {
    console.error('Error al generar embedding:', err);
  }
}

test();
