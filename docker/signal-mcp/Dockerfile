# Signal MCP Server — wraps signal-cli with MCP JSON-RPC interface
# Requires one-time registration: see scripts/signal-register.sh
#
# Base: Python 3.13 (signal-mcp requires >=3.13) + Eclipse Temurin JRE 21 (signal-cli)
# Alpine does NOT work — signal-cli's libsignal_jni requires glibc.
FROM python:3.13-slim

ARG SIGNAL_CLI_VERSION=0.13.12

# Install JRE for signal-cli + curl for download
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      curl \
      ca-certificates \
      default-jre-headless && \
    curl -fsSL -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    mkdir -p /opt/signal-cli && \
    tar xzf /tmp/signal-cli.tar.gz -C /opt/signal-cli --strip-components=1 && \
    rm /tmp/signal-cli.tar.gz && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli && \
    apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Install signal-mcp from GitHub (not on PyPI)
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends git && \
    pip install --no-cache-dir git+https://github.com/rymurr/signal-mcp.git && \
    apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 agent
USER agent

# signal-cli auth data persists via volume mount (bind-mount at runtime, no VOLUME declaration)
ENV SIGNAL_CLI_CONFIG=/data

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
# Entry point is the "server" console script installed by signal-mcp
ENTRYPOINT ["server"]
