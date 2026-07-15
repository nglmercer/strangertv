# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY server ./server
COPY shared ./shared
COPY tsconfig.json tsconfig.node.json ./
# Alpine images may lack wget; use node for healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 8787
ENV APP_VERSION=1.0.0
CMD ["npx", "tsx", "server/index.ts"]
