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
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY rust/src ./src
COPY rust/.cargo ./.cargo
# Touch so cargo does not reuse the stub's fingerprint.
RUN touch src/main.rs && cargo build --release

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

COPY --from=api /build/target/release/stranger-server /usr/local/bin/stranger-server
COPY --from=web /app/dist ./dist
COPY --from=web /app/public ./public

# The binary probes itself, so the image needs no curl or node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/stranger-server", "--healthcheck"]

RUN useradd --system --uid 10001 stranger
USER stranger

EXPOSE 8787
CMD ["/usr/local/bin/stranger-server"]
