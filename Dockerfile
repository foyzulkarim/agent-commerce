# One image for every Node container. compose.yaml sets the command per service.
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY services ./services
COPY agents ./agents
RUN npm ci --omit=dev

USER node
