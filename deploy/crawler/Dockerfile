# The crawler worker (src/pro/crawler, docs/design/crawler.md). Build from the repository root:
#   docker build -f deploy/crawler/Dockerfile -t crawlpilot-crawler .
# Run with the configuration in CRAWLER_CONFIG (JSON), or mounted and given with --config, and the secrets
# it names (${NAME}) in the environment.
# Behind a proxy that re-signs TLS, pass its CA as a secret (proxy settings pass as the usual build args):
#   docker build --secret id=ca,src=ca.crt --build-arg HTTPS_PROXY … -f deploy/crawler/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export npm_config_cafile=/run/secrets/ca NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run crawler:build

# Playwright's image: Chromium and its system libraries, for the same Playwright version as the worker's.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
ENV NODE_ENV=production
COPY deploy/crawler/package.json ./package.json
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export npm_config_cafile=/run/secrets/ca; fi; \
    npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/src/pro/crawler/dist ./dist
USER pwuser
ENTRYPOINT ["node", "/app/dist/worker.mjs"]
