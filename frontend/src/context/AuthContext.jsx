import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  function signup(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
  }

  const [userRole, setUserRole] = useState(null);
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const idToken = await user.getIdToken(true);
          const response = await fetch('/api/user-role', {
            headers: {
              'Authorization': `Bearer ${idToken}`
            }
          });
          if (response.ok) {
            const data = await response.json();
            setUserRole(data.role);
            setRequirePasswordChange(data.requirePasswordChange || false);
          } else {
            console.warn('Error al recuperar rol del backend. Asignando "visualizador" por defecto.');
            setUserRole('visualizador');
            setRequirePasswordChange(false);
          }
        } catch (error) {
          console.error('Error al obtener el rol del usuario desde backend:', error);
          setUserRole('visualizador');
          setRequirePasswordChange(false);
        }
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
        setUserRole(null);
        setRequirePasswordChange(false);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userRole,
    requirePasswordChange,
    setRequirePasswordChange,
    login,
    signup,
    logout,
    resetPassword
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
