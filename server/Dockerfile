# Multi-stage production image for the Express API
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

COPY server ./server
RUN npm run build -w server

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci -w server --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY server/src/seed ./server/src/seed

WORKDIR /app/server
EXPOSE 5000
CMD ["node", "dist/index.js"]
