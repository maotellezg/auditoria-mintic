import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyCLdoKSGI4lszq2Nr__kUKZVS8i3vKaoYE",
  authDomain: "auditoria-mintc.firebaseapp.com",
  projectId: "auditoria-mintc",
  storageBucket: "auditoria-mintc.firebasestorage.app",
  messagingSenderId: "965535590033",
  appId: "1:965535590033:web:5b0b81642404e4001d4130"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;