# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install

COPY frontend/ ./
# Compilar la aplicación React + Vite (genera la carpeta /app/frontend/dist)
RUN npm run build

# Stage 2: Build Backend & Serve
FROM node:18-alpine
WORKDIR /app

# Instalar dependencias del backend
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev

# Copiar el código del backend
COPY backend/ ./backend/

# Copiar la compilación del frontend a la carpeta 'public' del backend para que Express la sirva
COPY --from=frontend-builder /app/frontend/dist ./backend/public

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "backend/src/index.js"]
