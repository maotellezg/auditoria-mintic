import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import dotenv from 'dotenv';

dotenv.config();

let app;

const projectId = process.env.GCP_PROJECT_ID || 'auditoria-mintc';
const storageBucket = process.env.GCP_STORAGE_BUCKET || `${projectId}.appspot.com`;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    app = initializeApp({
      credential: cert(serviceAccount),
      storageBucket: storageBucket
    });
    console.log('Firebase Admin inicializado usando cuenta de servicio provista en .env');
  } else {
    // Inicialización automática en GCP Cloud Run o localmente si ya tiene credenciales cargadas
    app = initializeApp({
      projectId: projectId,
      storageBucket: storageBucket
    });
    console.log(`Firebase Admin inicializado automáticamente para el proyecto: ${projectId}`);
  }
} catch (error) {
  console.error('Error al inicializar Firebase Admin:', error.message);
  // Reintentar de manera simplificada en caso de error
  app = initializeApp({
    projectId: projectId,
    storageBucket: storageBucket
  });
}

export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
