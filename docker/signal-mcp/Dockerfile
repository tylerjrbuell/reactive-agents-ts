# Signal MCP Server — TypeScript MCP server wrapping signal-cli in persistent jsonRpc mode
# Requires one-time registration: see scripts/signal-register.sh
#
# Base: Eclipse Temurin JRE 21 (signal-cli requires glibc — Alpine does NOT work)
# Runtime: Bun (TypeScript MCP server)

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-noble AS build

# Install Bun
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
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
FROM eclipse-temurin:21-jre-noble

ARG SIGNAL_CLI_VERSION=0.13.12

# Install signal-cli + Bun
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      curl \
      ca-certificates \
      unzip \
      qrencode && \
    curl -fsSL -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    mkdir -p /opt/signal-cli && \
    tar xzf /tmp/signal-cli.tar.gz -C /opt/signal-cli --strip-components=1 && \
    rm /tmp/signal-cli.tar.gz && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli && \
    curl -fsSL https://bun.sh/install | bash && \
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
ENV SIGNAL_CLI_CONFIG=/data

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
ENTRYPOINT ["bun", "run", "server.js"]
