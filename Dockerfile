# Tokenmaxx — production container for n9c-server deployment (P8).
# Multi-stage; final image is ~200 MB.
#
# Build:    docker build -t tokenmaxx:latest .
# Run:      docker run --env-file /root/.config/tokenmaxx/web.env -p 3000:3000 tokenmaxx:latest

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Bring back dev deps for the build step (next, typescript, etc.)
RUN npm ci --no-audit --no-fund
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time identity. Passed in via docker compose build args from CI;
# defaults to 'dev' so a plain `docker build .` still works.
ARG TOKENMAXX_BUILD_NUMBER=dev
ARG NEXT_PUBLIC_GIT_SHA=dev
ENV TOKENMAXX_BUILD_NUMBER=${TOKENMAXX_BUILD_NUMBER}
ENV NEXT_PUBLIC_GIT_SHA=${NEXT_PUBLIC_GIT_SHA}
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Persist build identity into the running container so /api/health can
# read them at request time even though next.config.mjs's `env` baked
# them into the bundle at build time.
ARG TOKENMAXX_BUILD_NUMBER=dev
ARG NEXT_PUBLIC_GIT_SHA=dev
ENV TOKENMAXX_BUILD_NUMBER=${TOKENMAXX_BUILD_NUMBER}
ENV NEXT_PUBLIC_GIT_SHA=${NEXT_PUBLIC_GIT_SHA}
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ may not exist in this project; create empty so the copy below
# is unconditional and the runtime stays happy.
RUN mkdir -p ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
