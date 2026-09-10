# ==========================================
# 1. Base Stage: Node.js 22 LTS Alpine
# ==========================================
FROM node:22-alpine AS base
WORKDIR /app

# ==========================================
# 2. Dependencies Stage: Install all dependencies
# ==========================================
FROM base AS deps
RUN npm install -g npm@latest
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ==========================================
# 3. Development Stage: Hot-reload with tsx
# ==========================================
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
CMD ["npm", "run", "dev"]

# ==========================================
# 4. Build Stage: Compile TypeScript to JavaScript
# ==========================================
FROM deps AS build
ENV NODE_ENV=production
COPY . .
RUN npm run build
RUN npm prune --production

# ==========================================
# 5. Production Stage: Minimal runtime image
# ==========================================
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
