# Reglas de Seguridad de Firebase

Para que la aplicación funcione correctamente, debes configurar las reglas de seguridad en la consola de Firebase. Esto protege tus datos y evita el acceso no autorizado.

---

## 1. Cloud Firestore Rules

Copia y pega estas reglas en la pestaña **Rules** (Reglas) de tu base de datos de Firestore:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir leer y escribir a cualquier usuario autenticado
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

*Nota: Estas reglas exigen que el usuario esté registrado e iniciado sesión para leer o escribir cualquier documento, lo cual es ideal para este proyecto.*

---

## 2. Firebase Storage Rules

Copia y pega estas reglas en la pestaña **Rules** (Reglas) de tu sección de Storage (Almacenamiento):

```javascript
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // Permitir a usuarios autenticados subir y descargar archivos
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

*Nota: Con esto, solo los usuarios registrados mediante Firebase Auth en tu aplicación podrán subir y descargar los PDFs, imágenes o archivos de Word.*
