# One image for every Node container. compose.yaml sets the command per service.
FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY services ./services
COPY agents ./agents
# Optional: a network that intercepts TLS (a company proxy) needs its CA certificate for npm.
# Copy the certificate to ./npm-ca.pem and set NPM_CA_FILE=./npm-ca.pem in .env; compose passes it as a build secret.
# Without it the secret is empty and npm uses the normal certificate store. TLS checks stay on.
RUN --mount=type=secret,id=npm_ca \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev

USER node
