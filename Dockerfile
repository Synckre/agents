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

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
