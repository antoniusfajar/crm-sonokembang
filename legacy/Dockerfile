# ---------- Build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/server/package.json src/server/
COPY src/web/package.json src/web/
RUN npm ci
COPY src ./src
RUN npm run build -w src/web && npm run build -w src/server

# ---------- Runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/server/package.json src/server/
COPY src/web/package.json src/web/
RUN npm ci --omit=dev --workspace src/server && npm cache clean --force
COPY --from=build /app/src/server/dist src/server/dist
COPY --from=build /app/src/server/drizzle src/server/drizzle
COPY --from=build /app/src/web/dist src/web/dist
WORKDIR /app/src/server
ENV WEB_DIST=/app/src/web/dist UPLOAD_DIR=/data/uploads PORT=3000
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
