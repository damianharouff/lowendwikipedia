# lowendwikipedia, self-hosted: bundle the Worker with wrangler, then run the
# bundle in workerd via Miniflare (see deploy/server.mjs).
# workerd and sharp need glibc — do not switch this to an Alpine base.

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV WRANGLER_SEND_METRICS=false
# Only wrangler is needed to bundle; the repo's dev deps (vitest pool) trip
# npm 10's resolver here and are not needed in the image.
RUN npm install --no-audit --no-fund wrangler@4.129.0
COPY wrangler.jsonc tsconfig.json ./
COPY src ./src
RUN npx wrangler deploy --dry-run --outdir dist

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# workerd validates upstream TLS against the system CA store, which the slim
# image does not ship (Node has its own bundled roots, workerd does not).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Miniflare pulls in workerd and sharp (for the Images binding simulator).
RUN npm install --no-audit --no-fund --omit=dev miniflare@4.20260730.0 \
  && npm cache clean --force
COPY --from=build /src/dist/index.js ./dist/index.js
COPY wrangler.jsonc deploy/server.mjs ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
