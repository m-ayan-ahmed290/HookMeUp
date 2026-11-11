# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
# Optional build secret supports the managed development proxy without baking its CA into the image.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --omit=dev --cache /tmp/npm-cache; \
    else npm ci --omit=dev --cache /tmp/npm-cache; fi
COPY --chown=node:node src ./src
COPY --chown=node:node fixtures ./fixtures
COPY --chown=node:node assets ./assets
COPY --chown=node:node scripts/health.js ./scripts/health.js
RUN mkdir -p /app/data && chown node:node /app/data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node", "scripts/health.js"]
CMD ["node", "src/index.js"]
