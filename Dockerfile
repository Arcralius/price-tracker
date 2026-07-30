# syntax=docker/dockerfile:1

# ---- deps: everything, so the app can be built -----------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci || npm install

# ---- builder: next build ---------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs a DATABASE_URL present to build. ARG, not ENV, so the placeholder
# exists only in this stage and can never be baked into the shipped image.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate && npx next build

# ---- runtime-deps: production tree only ------------------------------------
# `prisma` (migrations) and `tsx` (the worker) are runtime dependencies here,
# so they survive --omit=dev; typescript and @types do not.
FROM node:22-alpine AS runtime-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev || npm install --omit=dev
RUN npx prisma generate && npm cache clean --force

# The standalone bundle already ships a traced copy of next/@next and the
# generated Prisma client, and it is copied into the runner *before* this tree.
# Dropping the duplicates here is what keeps the image from tripling in size.
RUN rm -rf node_modules/next node_modules/@next node_modules/typescript node_modules/@types \
    && find node_modules -name "*.md" -delete \
    && find node_modules -name "*.map" -delete \
    && find node_modules -type d -name test -prune -exec rm -rf {} + 2>/dev/null || true

# ---- runner ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

# COPY --chown, never `RUN chown -R`: the latter rewrites every file into a new
# layer, which silently doubled this image's size.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The standalone bundle covers `web`. `worker` and `migrate` run from source via
# tsx and need the production tree plus the Prisma CLI.
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/worker ./worker
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
