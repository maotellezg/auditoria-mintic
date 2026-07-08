# Anla-Entrega | Buscador Ambiental Inteligente

Este proyecto es una plataforma inteligente para la gestión, clasificación y búsqueda semántica de documentos ambientales de la **ANLA** (Autoridad Nacional de Licencias Ambientales). Permite la carga masiva de archivos pesados (PDFs, imágenes y Word), los cuales son leídos y analizados de forma automática por **Gemini (Vertex AI)** para extraer metadatos, clasificar el tipo de trámite, identificar empresas y proyectos, y generar resúmenes ejecutivos detallados.

---

## Estructura del Proyecto

* **`/frontend`**: Interfaz de usuario Premium construida con **React + Vite** y **CSS puro**.
  * Autenticación sencilla con Firebase Auth (Login, Registro y Recuperación de contraseña).
  * Panel de carga interactiva (Drag & Drop) con subida directa a Google Cloud Storage y barra de progreso.
  * Buscador y filtros inteligentes de documentos (por proyecto, territorio, trámite, empresa).
  * Sección de "Wiki de Relaciones" interconectando documentos.
  * Visor de PDF integrado con ficha técnica del análisis de Gemini.
* **`/backend`**: API segura en **Node.js + Express** desplegable en **Google Cloud Run**.
  * Endpoint seguro para invocar a **Vertex AI (Gemini 1.5/2.0 Flash)** con salida estructurada en JSON.
  * Extractor de texto para documentos Word (`.docx`) y soporte nativo para PDFs e imágenes.
  * Integración con **Firebase Admin SDK** para actualizar Firestore en tiempo real.

---

## Requisitos Previos

1. Tener instalado [Node.js](https://nodejs.org/) (v18 o superior).
2. Un proyecto en Google Cloud Platform (GCP) con el ID: `auditoria-mintc`.
3. Firebase habilitado en el proyecto de GCP (Firestore, Authentication con proveedor Email/Password, y Cloud Storage).

---

## Configuración Local

### 1. Clonar el repositorio
```bash
git clone https://github.com/maotellezg/Anla-Entrega.git
cd Anla-Entrega
```

### 2. Configurar el Backend
1. Navega a la carpeta `/backend`:
   ```bash
   cd backend
   ```
2. Crea tu archivo `.env` basado en `.env.example` y configura tus variables.
3. Instala las dependencias:
   ```bash
   npm install
   ```
4. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

### 3. Configurar el Frontend
1. Abre una nueva terminal y navega a la carpeta `/frontend`:
   ```bash
   cd frontend
   ```
2. Crea tu archivo `.env` basado en `.env.example` con las credenciales de tu proyecto de Firebase.
3. Instala las dependencias:
   ```bash
   npm install
   ```
4. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
5. Abre en tu navegador la dirección indicada (por defecto `http://localhost:3000`).

---

## Despliegue en GCP (Cloud Run)

Para desplegar el backend y frontend unificados en Cloud Run, puedes compilar la app y subirla con Google Cloud Build. El Dockerfile del backend compila el frontend y lo sirve de forma unificada para ahorrar costos.

Próximamente agregaremos la guía detallada y scripts para el despliegue automático con un solo comando.
