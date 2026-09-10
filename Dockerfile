# Coolify / repo-root image. Sources live in ./agent
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN npm install -g npm@latest
COPY agent/package.json agent/package-lock.json* ./
RUN npm ci --include=dev

FROM deps AS build
ENV NODE_ENV=production
COPY agent/ ./
RUN npm run build
RUN npm prune --production

FROM base AS prod
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

USER node

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "echo \"[boot] node $(node -v) PORT=${PORT:-3000}\" && exec node dist/index.js"]
