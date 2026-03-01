# Signal MCP Server — wraps signal-cli with MCP JSON-RPC interface
# Requires one-time registration: see scripts/signal-register.sh
FROM eclipse-temurin:21-jre-alpine

ARG SIGNAL_CLI_VERSION=0.13.12

# Install signal-cli + Python for MCP server
RUN apk add --no-cache curl bash python3 py3-pip && \
    curl -fsSL -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    mkdir -p /opt/signal-cli && \
    tar xzf /tmp/signal-cli.tar.gz -C /opt/signal-cli --strip-components=1 && \
    rm /tmp/signal-cli.tar.gz && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Install signal-mcp (rymurr/signal-mcp)
RUN pip3 install --no-cache-dir --break-system-packages signal-mcp

# Non-root user
RUN adduser -D -u 1000 agent
USER agent

# signal-cli auth data persists via volume mount (bind-mount at runtime, no VOLUME declaration)
ENV SIGNAL_CLI_CONFIG=/data

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
ENTRYPOINT ["python3", "-m", "signal_mcp"]
