import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyByLEKR-tZpWaV3JL_-0lJgbF1LK7ebSg8',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'entrega-anla.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'entrega-anla',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'entrega-anla',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '33385687524',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:33385687524:web:81fc1ce1dd09a71ed67ff1'
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
