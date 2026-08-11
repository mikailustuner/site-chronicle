FROM oven/bun:1.3.12 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json tsconfig.typecheck.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=43180 \
    ARTIFACTS_PATH=/data/artifacts \
    WEB_DIST_PATH=../../web/dist
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/package.json /app/bun.lock ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/apps ./apps
COPY --from=build --chown=pwuser:pwuser /app/packages ./packages
RUN mkdir -p /data/artifacts && chown -R pwuser:pwuser /data
USER pwuser
EXPOSE 43180
CMD ["node", "apps/api/dist/server.js"]
