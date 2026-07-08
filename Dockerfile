# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --legacy-peer-deps

COPY frontend/src ./src
COPY frontend/index.html ./
COPY frontend/vite.config.js ./

RUN npm run build

# Stage 2: Backend + Frontend compilado
FROM node:20-alpine
WORKDIR /app

COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev --legacy-peer-deps

COPY backend/src ./backend/src
COPY --from=frontend-builder /app/frontend/dist ./backend/public

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "backend/src/index.js"]
