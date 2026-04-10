# Docker Code Execution

The `docker-execute` tool runs code in isolated Docker containers with strict resource limits. It provides stronger isolation than the process-based `code-execute` tool.

## Supported Languages

| Language | Image | Command |
|----------|-------|---------|
| `bun` (default) | `oven/bun:1-alpine` | `bun --eval <code>` |
| `node` | `node:22-alpine3.22` | `node --eval <code>` |
| `python` | `python:3.12-alpine3.22` | `python3 -c <code>` |

## Security Constraints

All containers run with:
- **`--network none`** — No network access by default
- **`--cap-drop ALL`** — No Linux capabilities
- **`--security-opt no-new-privileges`** — Cannot escalate privileges
- **`--read-only`** — Read-only root filesystem
- **`--tmpfs /tmp:rw,noexec,nosuid,size=64m`** — Writable temp dir, no exec
- **`--memory 256m`** — 256 MB memory limit (configurable)
- **`--cpus 0.5`** — Half a CPU core (configurable)
- **`--pids-limit 50`** — Max 50 processes
- **`--rm`** — Auto-remove container after execution

## Prerequisites

- Docker daemon must be running on the host
- Pull images before first use for faster startup:

```bash
docker pull oven/bun:1-alpine
docker pull node:22-alpine3.22
docker pull python:3.12-alpine3.22
```

## Usage

```typescript
import { makeDockerExecuteHandler, dockerExecuteTool } from "@reactive-agents/tools";

// Create handler with default config
const handler = makeDockerExecuteHandler();

// Or with custom config
const handler = makeDockerExecuteHandler({
  memoryMb: 512,
  cpuQuota: 1.0,
  timeoutMs: 60_000,
  network: "bridge", // Enable network if needed
});

// Register with tool service
toolService.register(dockerExecuteTool, handler);
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `image` | `oven/bun:1-alpine` | Base Docker image |
| `memoryMb` | `256` | Memory limit in MB |
| `cpuQuota` | `0.5` | CPU quota (1.0 = 1 core) |
| `timeoutMs` | `30000` | Execution timeout |
| `autoRemove` | `true` | Remove container after run |
| `network` | `"none"` | Network mode: `none`, `host`, `bridge` |
| `readOnlyFs` | `true` | Read-only root filesystem |
