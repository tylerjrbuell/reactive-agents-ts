# Signal MCP Server — TypeScript MCP server wrapping signal-cli in persistent jsonRpc mode
# Requires one-time registration: see docker/signal-mcp/register.sh
#
# Base: Eclipse Temurin JRE 25 (signal-cli 0.14.x bytecode is Java 25 / class 69+)
# signal-cli requires glibc — Alpine does NOT work
# Runtime: Bun (TypeScript MCP server)

# Pinned Bun (matches CI); bump deliberately, never track "latest".
ARG BUN_VERSION=1.3.10

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre-noble AS build
ARG BUN_VERSION

# Install Bun
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends curl unzip && \
    curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /build

# Install deps first (cache layer)
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source and bundle
COPY server/ ./
RUN bun build src/index.ts --target=bun --outdir=dist

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre-noble

# Bump when Signal returns DeprecatedVersionException (499) on register/send.
ARG SIGNAL_CLI_VERSION=0.14.9
# SHA-256 of signal-cli-${SIGNAL_CLI_VERSION}.tar.gz. Bump together with SIGNAL_CLI_VERSION
# (`sha256sum` the release tarball); the build fails on mismatch.
ARG SIGNAL_CLI_SHA256=c32b87f587198cbd277c9d71228716ee6047ee2b63e8e88728e8280d9407d65a
ARG BUN_VERSION

# Install signal-cli + Bun
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      curl \
      ca-certificates \
      unzip \
      qrencode && \
    curl -fsSL -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    echo "${SIGNAL_CLI_SHA256}  /tmp/signal-cli.tar.gz" | sha256sum -c - && \
    mkdir -p /opt/signal-cli && \
    tar xzf /tmp/signal-cli.tar.gz -C /opt/signal-cli --strip-components=1 && \
    rm /tmp/signal-cli.tar.gz && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli && \
    curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
    mv /root/.bun /opt/bun && \
    apt-get purge -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/bun/bin:$PATH"

# Non-root user
RUN groupadd -g 1000 agent 2>/dev/null || true && \
    useradd -m -u 1000 -g 1000 agent 2>/dev/null || true

WORKDIR /app

# Copy bundled server + node_modules (for @modelcontextprotocol/sdk runtime imports)
COPY --from=build /build/dist/index.js ./server.js
COPY --from=build /build/node_modules ./node_modules

RUN chown -R 1000:1000 /app

USER 1000

# signal-cli auth data persists via volume mount
# NOT `SIGNAL_CLI_CONFIG`: signal-cli >=0.14.9 reads that env var as a config FILE path
# and fails with "Failed to load config from /data (Is a directory)".
ENV SIGNAL_DATA_DIR=/data

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
ENTRYPOINT ["bun", "run", "server.js"]
