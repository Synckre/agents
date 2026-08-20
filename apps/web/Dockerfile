# Synckre Web — build de PRODUCCIÓN (para Coolify / despliegue real).
# Las NEXT_PUBLIC_* se resuelven en BUILD (se hornean en el bundle):
#   - NEXT_PUBLIC_API_URL (URL pública de la API, ej. https://api.dominio.com)
#   - NEXT_PUBLIC_INTERNAL_API_KEY (la key interna del backend)
# En runtime se necesita API_URL (URL interna del backend para el route handler de login).

FROM node:20-alpine AS deps
RUN npm install -g pnpm
WORKDIR /app
COPY apps/web/package.json ./
RUN pnpm install

FROM node:20-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web ./
ENV NEXT_TELEMETRY_DISABLED 1
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_INTERNAL_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_INTERNAL_API_KEY=$NEXT_PUBLIC_INTERNAL_API_KEY
RUN pnpm build

FROM node:20-alpine AS runner
RUN npm install -g pnpm
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["pnpm", "start"]
