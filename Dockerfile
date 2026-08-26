# ---------------------------------------------------------------------------
# Web assets: the SPA is still TypeScript, so Node builds dist/.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# API server. libsql links against glibc, so this is a bookworm build, not musl.
# ---------------------------------------------------------------------------
FROM rust:1-bookworm AS api
WORKDIR /build
# Cache the dependency compile: it dominates the build and only changes when
# the manifests do.
COPY rust/Cargo.toml rust/Cargo.lock ./
COPY rust/vendor ./vendor
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release --bins && rm -rf src
COPY rust/src ./src
COPY rust/.cargo ./.cargo
# Touch so cargo does not reuse the stub's fingerprint.
RUN touch src/main.rs && cargo build --release --bins

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_DIR=/app/dist
ENV APP_VERSION=1.0.0

# ca-certificates for outbound TLS (email webhooks, alerts, remote Turso).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY --from=api /build/target/release/stranger-server /usr/local/bin/stranger-server
COPY --from=api /build/target/release/migrate-auth /usr/local/bin/migrate-auth
COPY --from=api /build/target/release/migrate-auth-users /usr/local/bin/migrate-auth-users
COPY --from=web /app/dist ./dist
COPY --from=web /app/public ./public

# The binary probes itself, so the image needs no curl or node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/stranger-server", "--healthcheck"]

# The default local deployment keeps the database under /data (see
# docker-compose.yml). A fresh named volume is root-owned, so create the
# mountpoint and hand it to the runtime user BEFORE dropping privileges --
# otherwise the container can't create file:/data/local.db on first start.
RUN useradd --system --uid 10001 stranger \
 && mkdir -p /data \
 && chown -R stranger:stranger /data
USER stranger

EXPOSE 8787
# The entrypoint applies the Better Auth schema first; passing a command
# (`docker compose run stranger migrate-auth-users`) runs that instead.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD []
