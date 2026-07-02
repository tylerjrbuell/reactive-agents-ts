/**
 * MCP Client — powered by the official @modelcontextprotocol/sdk.
 *
 * Supports all standard MCP transports:
 *   • stdio           — subprocess (node, python, npx, uvx, bun, uv, …)
 *   • streamable-http — modern HTTP MCP (2025-03-26 spec)
 *   • sse             — legacy Server-Sent Events transport
 *
 * **Smart auto-detection for Docker/subprocess HTTP MCP servers**
 * Some containers (e.g. mcp/context7) start an HTTP server instead of
 * speaking MCP over stdio. When a subprocess prints an HTTP startup URL to
 * stderr and the SDK stdio handshake hasn't completed yet, the client
 * automatically:
 *   1. Force-stops the probe container via `docker rm -f`
 *   2. Re-spawns the command with `-p PORT:PORT` and a unique `--name`
 *   3. Polls the endpoint until the HTTP server is healthy (up to 60s)
 *   4. Connects via streamable-http, falling back to SSE
 *   5. On dispose/cleanup, calls `docker rm -f <name>` so the container is
 *      actually stopped (killing the docker run process alone is not enough —
 *      Docker keeps the container alive even when the client process exits)
 * — all transparent to callers; no port config required.
 *
 * For pure stdio servers (GitHub MCP, filesystem, etc.) the HTTP startup
 * message never appears, so the race resolves on the stdio path immediately.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:net";
import { Effect, Ref } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServer } from "../types.js";
import { MCPConnectionError, ToolExecutionError } from "../errors.js";

const mcpDebug = (...args: unknown[]): void => {
  if (process.env["RAX_DEBUG"]) console.log(...args);
};

// ─── Types ───────────────────────────────────────────────────────────────────

type ConnectConfig = Omit<
  Pick<MCPServer, "name" | "transport" | "endpoint" | "command" | "args" | "cwd" | "env" | "headers">,
  "transport"
> & { transport?: MCPServer["transport"] };

interface ActiveConnection {
  client: Client;
  transport: Transport;
  server: MCPServer;
  /**
   * Name of the docker container to stop on cleanup.
   * Set when the server was auto-detected as HTTP-only and re-spawned with a
   * port mapping. `docker rm -f` is used instead of process.kill() because
   * killing the `docker run` process does NOT stop the container — the Docker
   * daemon keeps it alive until explicitly told to stop it.
   */
  dockerContainerName?: string;
}

// ─── Module-level State ───────────────────────────────────────────────────────

const activeConnections = new Map<string, ActiveConnection>();

const notificationCallbacks = new Map<
  string,
  (method: string, params: Record<string, unknown>) => void
>();

// ─── Exit Cleanup ─────────────────────────────────────────────────────────────

function cleanupAll(): void {
  for (const [name] of activeConnections) {
    cleanupMcpTransport(name);
  }
}

let exitHandlerRegistered = false;
function ensureExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.on("exit", cleanupAll);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    // HS-12 (2026-05-20 sweep): library code must not unilaterally call
    // `process.exit`. Previously this handler killed the host process on
    // SIGINT/SIGTERM, breaking any embedding consumer that wanted to
    // handle signals itself. Now we clean up our docker containers and
    // re-raise the signal so the caller's own handlers (or Node's
    // defaults) decide the exit path.
    const handler = (): void => {
      cleanupAll();
      process.off(sig, handler);
      process.kill(process.pid, sig);
    };
    process.on(sig, handler);
  }
}

// ─── Docker Container Helpers ─────────────────────────────────────────────────

/**
 * Stop and remove a named docker container. Fire-and-forget — errors are silenced
 * because the container may already be gone. The spawned rm process is unref'd so
 * it doesn't block the Node.js event loop on exit.
 */
function dockerRmForce(containerName: string): void {
  try {
    const rm = nodeSpawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    rm.unref();
  } catch { /* ignore */ }
}

/**
 * Stop and remove a named docker container, resolving once the `docker rm -f`
 * process has actually exited. Use this (not the fire-and-forget `dockerRmForce`)
 * when a stale container with a deterministic name must be gone *before* the next
 * `docker run` reuses that name — otherwise the run races the removal and hits
 * "container name already in use". Never rejects: a missing container is success.
 */
function dockerRmForceAwait(containerName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const rm = nodeSpawn("docker", ["rm", "-f", containerName], { stdio: "ignore" });
      rm.on("exit", () => resolve());
      rm.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Allocate a free TCP port on the host by binding to port 0 and reading back the
 * OS-assigned port. Used to map a unique host port to a docker container's
 * internal HTTP port — reusing the container's own port as the host port collides
 * with any foreign service already bound to it (e.g. a stray uvicorn on :8080),
 * which silently routes MCP traffic to the wrong server.
 */
function getFreeHostPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free host port")));
      }
    });
  });
}

// ─── Public Cleanup ───────────────────────────────────────────────────────────

/**
 * Forcibly close a named MCP transport and stop any managed docker container.
 * Called on DELETE, agent dispose, and refresh-tools timeout.
 */
export function cleanupMcpTransport(serverName: string): void {
  const conn = activeConnections.get(serverName);
  if (!conn) return;

  if (conn.dockerContainerName) {
    // Must use `docker rm -f` — killing the docker run process is not enough
    // because the Docker daemon keeps the container alive independently.
    mcpDebug(`[MCP cleanup] stopping container "${conn.dockerContainerName}"`);
    dockerRmForce(conn.dockerContainerName);
  }
  try { void conn.transport.close(); } catch { /* already gone */ }
  activeConnections.delete(serverName);
  mcpDebug(`[MCP cleanup] "${serverName}" transport closed`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function inferHttpTransportType(url: string): "streamable-http" | "sse" {
  try {
    const p = new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
    if (p === "/mcp" || p.endsWith("/mcp")) return "streamable-http";
  } catch { /* fall through */ }
  return "sse";
}

/**
 * Scan a line of stderr for an HTTP server startup URL.
 * Matches explicit http(s):// URLs with a port, and bare ":PORT" startup lines.
 */
function detectHttpStartupUrl(line: string): string | undefined {
  const urlMatch = line.match(/\b(https?:\/\/[\w.-]+:\d{2,5}[/\w.%-]*)/i);
  if (urlMatch) return urlMatch[1]!.replace(/\/\/0\.0\.0\.0:/, "//localhost:");
  const portMatch = line.match(
    /(?:running on|listening (?:on|at)|started (?:on|at)|server (?:on|at)|http server)\b.*?:(\d{2,5})\b/i,
  );
  if (portMatch) return `http://localhost:${portMatch[1]}/mcp`;
  return undefined;
}

/**
 * Insert `-p hostPort:containerPort` into `docker run` args immediately before the
 * image name. Host and container ports are kept distinct so a unique, free host
 * port can front a container whose internal port might already be taken on the host.
 */
export function addDockerPortMapping(args: readonly string[], hostPort: number, containerPort: number): string[] {
  if (args[0] !== "run") return [...args];

  const consumesNext = new Set([
    "-e","--env","-v","--volume","-p","--publish","--name",
    "--network","-u","--user","-w","--workdir","-l","--label",
    "--mount","--hostname","-h","--memory","--cpus","--restart",
    "--entrypoint","--env-file","--add-host","--log-driver","--log-opt",
    "--platform","--pull","--device","--dns","--gpus","--group-add",
    "--health-cmd","--health-interval","--health-retries","--health-timeout",
    "--ip","--isolation","--runtime","--shm-size","--sysctl","--tmpfs",
    "--security-opt","--ulimit","--volumes-from","--stop-signal",
    "-a","--attach","--cgroupns","--cidfile","--cpu-period","--cpu-quota",
    "--cpu-shares","--cpuset-cpus","--cpuset-mems","--dns-option","--dns-search",
    "--domainname",
  ]);

  const result = [...args];
  let i = 1;
  while (i < result.length) {
    const arg = result[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      result.splice(i, 0, "-p", `${hostPort}:${containerPort}`);
      return result;
    }
    if (arg.startsWith("--") && arg.includes("=")) { i++; continue; }
    if (consumesNext.has(arg)) { i += 2; } else { i++; }
  }
  return result;
}

/**
 * Insert a flag+value pair right after "run" in docker args.
 */
function insertDockerFlag(args: readonly string[], flag: string, value: string): string[] {
  if (args[0] !== "run") return [...args];
  return ["run", flag, value, ...args.slice(1)];
}

/**
 * Shape the args for a docker-backed stdio probe container: ensure `--rm` (clean
 * self-removal on exit) and a deterministic `--name` (so cleanup can `docker rm -f`
 * it reliably — closing the stdio transport kills the docker run process but the
 * daemon keeps the container alive). Returns the original args unchanged when this
 * isn't a `docker run` invocation.
 */
export function buildDockerProbeArgs(args: readonly string[], containerName: string): string[] {
  if (args[0] !== "run") return [...args];
  const withRm = args.includes("--rm") ? [...args] : ["run", "--rm", ...args.slice(1)];
  return insertDockerFlag(withRm, "--name", containerName);
}

/**
 * Poll an HTTP endpoint until it responds with a non-5xx status.
 * POST with a JSON-RPC ping is the most reliable probe; 405 on POST still means the server is up.
 */
async function waitForHttpEndpoint(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
        signal: AbortSignal.timeout(2_000),
      });
      if (res.status < 500) { await res.body?.cancel(); return; }
    } catch (e) { lastErr = e; }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  throw new Error(`Endpoint ${url} not healthy within ${timeoutMs}ms${lastErr ? `: ${String(lastErr)}` : ""}`);
}

// ─── Subprocess Environment (F12) ──────────────────────────────────────────────

/**
 * Non-secret environment variables forwarded to MCP subprocesses by default.
 *
 * MCP servers are commonly `npx <untrusted-pkg>` or `docker run <untrusted-image>`.
 * Inheriting the parent's full `process.env` hands every provider API key and
 * token to that subprocess — one malicious package exfiltrates the whole secret
 * set. Instead we forward only this allowlist of vars a subprocess legitimately
 * needs (PATH, HOME, locale, proxy, runtime/docker config); secrets are opt-in
 * via the server's explicit `env` map.
 */
const MCP_ENV_ALLOWLIST: ReadonlyArray<string> = [
  // Core process
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD", "TMPDIR", "TZ", "TERM",
  // Locale
  "LANG", "LC_ALL", "LC_CTYPE",
  // Proxy (needed for MCP servers that make outbound calls)
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy",
  // Node / Python runtime discovery
  "NODE_PATH", "NODE_OPTIONS", "PYTHONPATH", "VIRTUAL_ENV",
  // Docker CLI (needed for `docker run` MCP servers to reach the daemon)
  "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH",
];

/**
 * Build the environment for an MCP subprocess: a non-secret base allowlist
 * pulled from `process.env` plus the server's explicit `env` map (opt-in
 * secrets). Explicit vars override base vars. Provider keys and other secrets
 * in the parent environment are never forwarded implicitly (F12).
 */
export function buildMcpSubprocessEnv(
  configEnv?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (configEnv) Object.assign(env, configEnv);
  return env;
}

// ─── Transport Creation ────────────────────────────────────────────────────────

function resolveTransport(config: ConnectConfig): MCPServer["transport"] {
  if (config.transport) return config.transport;
  if (config.command) return "stdio";
  if (config.endpoint) return inferHttpTransportType(config.endpoint);
  throw new Error(
    `MCP server "${config.name}": cannot infer transport — provide either a command or an endpoint`,
  );
}

function createTransport(config: ConnectConfig, overrideArgs?: string[]): Transport {
  const headers = config.headers ?? {};
  const transport = resolveTransport(config);

  switch (transport) {
    case "stdio": {
      if (!config.command) throw new Error(
        `MCP server "${config.name}" has transport "stdio" but no command specified`,
      );
      return new StdioClientTransport({
        command: config.command,
        args: overrideArgs ?? [...(config.args ?? [])],
        env: buildMcpSubprocessEnv(config.env),
        cwd: config.cwd,
        stderr: "pipe",
      });
    }
    case "streamable-http": {
      if (!config.endpoint) throw new Error(
        `MCP server "${config.name}" has transport "streamable-http" but no endpoint specified`,
      );
      return new StreamableHTTPClientTransport(new URL(config.endpoint), { requestInit: { headers } });
    }
    case "sse": {
      if (!config.endpoint) throw new Error(
        `MCP server "${config.name}" has transport "sse" but no endpoint specified`,
      );
      return new SSEClientTransport(new URL(config.endpoint), { requestInit: { headers } });
    }
    case "websocket":
      throw new Error(
        `MCP server "${config.name}": websocket transport is not supported. Use streamable-http or sse.`,
      );
    default:
      throw new Error(`MCP server "${config.name}": unknown transport "${String(config.transport)}"`);
  }
}

// ─── HTTP Reconnect ────────────────────────────────────────────────────────────

async function reconnectViaHttp(
  config: ConnectConfig,
  detectedUrl: string,
  probeContainerName?: string,
): Promise<ActiveConnection> {
  const resolvedUrl = detectedUrl.replace(/\/\/0\.0\.0\.0:/, "//localhost:");
  let containerPort: number;
  try {
    containerPort = parseInt(new URL(resolvedUrl).port, 10) || 80;
  } catch {
    throw new Error(`MCP server "${config.name}": cannot parse URL "${resolvedUrl}"`);
  }

  // Stop the probe container before spawning the port-mapped one.
  // This is the only reliable way — killing the docker run process does not stop the container.
  if (probeContainerName) {
    mcpDebug(`[MCP http-mode] "${config.name}" — stopping probe container "${probeContainerName}"`);
    await dockerRmForceAwait(probeContainerName);
  }

  const isDocker = config.command === "docker" && (config.args ?? []).includes("run");

  // The URL we actually connect the SDK to. For docker we remap to a free host
  // port; for non-docker HTTP subprocesses the process binds the host port itself.
  let connectUrl = resolvedUrl;
  let dockerContainerName: string | undefined;

  if (isDocker) {
    // Map a *free host port* → the container's internal port. The container
    // reports its own port (e.g. :8080); blindly reusing that as the host port
    // collides with any foreign service already bound to it and routes MCP
    // traffic to the wrong server (observed: a stray uvicorn on :8080 answering
    // 405 / wrong content-type). A unique host port eliminates the collision.
    const hostPort = await getFreeHostPort();
    const u = new URL(resolvedUrl);
    u.port = String(hostPort);
    connectUrl = u.toString();

    // Unique name: rax-mcp-<server>-<pid>. Pre-remove any stale container with
    // this deterministic name so the run doesn't hit "name already in use".
    dockerContainerName = `rax-mcp-${config.name.replace(/[^a-zA-Z0-9]/g, "-")}-${process.pid}`;
    await dockerRmForceAwait(dockerContainerName);

    // Ensure --rm is present so the container auto-removes when docker rm -f is called
    const baseArgs = config.args ?? [];
    const argsWithRm = baseArgs.includes("run") && !baseArgs.includes("--rm")
      ? ["run", "--rm", ...baseArgs.slice(1)]
      : baseArgs;

    const namedArgs = insertDockerFlag(argsWithRm, "--name", dockerContainerName);
    const portMappedArgs = addDockerPortMapping(namedArgs, hostPort, containerPort);

    mcpDebug(`[MCP http-mode] "${config.name}" — spawning "${dockerContainerName}" with -p ${hostPort}:${containerPort}`);

    const spawnEnv = config.env ? { ...process.env, ...config.env } : { ...process.env };
    const subprocess = nodeSpawn(config.command!, portMappedArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      cwd: config.cwd,
      env: spawnEnv as NodeJS.ProcessEnv,
      detached: false,
    });
    subprocess.unref(); // don't block Node.js event loop
    subprocess.stderr?.on("data", (chunk: Buffer) => {
      const trimmed = chunk.toString().trimEnd();
      if (trimmed) process.stderr.write(`[MCP ${config.name}] ${trimmed}\n`);
    });

    mcpDebug(`[MCP http-mode] "${config.name}" — waiting for ${connectUrl} to be healthy…`);
    await waitForHttpEndpoint(connectUrl, 60_000).catch((e) => {
      dockerRmForce(dockerContainerName!);
      throw e;
    });
    mcpDebug(`[MCP http-mode] "${config.name}" — endpoint healthy`);
  } else {
    // Non-docker HTTP subprocess (e.g. `npx some-http-mcp`). It binds the host
    // port itself, so connect to the reported URL. Reuse if already up; otherwise
    // re-spawn the command (the stdio probe transport that started it was closed).
    const alreadyUp = await waitForHttpEndpoint(resolvedUrl, 1_500).then(() => true).catch(() => false);
    if (alreadyUp) {
      mcpDebug(`[MCP http-mode] "${config.name}" — endpoint already up at ${resolvedUrl}; reusing`);
    } else {
      mcpDebug(`[MCP http-mode] "${config.name}" — re-spawning "${config.command}" for HTTP mode`);
      const spawnEnv = buildMcpSubprocessEnv(config.env);
      const subprocess = nodeSpawn(config.command!, [...(config.args ?? [])], {
        stdio: ["ignore", "ignore", "pipe"],
        cwd: config.cwd,
        env: spawnEnv as NodeJS.ProcessEnv,
        detached: false,
      });
      subprocess.unref();
      subprocess.stderr?.on("data", (chunk: Buffer) => {
        const trimmed = chunk.toString().trimEnd();
        if (trimmed) process.stderr.write(`[MCP ${config.name}] ${trimmed}\n`);
      });
      await waitForHttpEndpoint(resolvedUrl, 60_000);
      mcpDebug(`[MCP http-mode] "${config.name}" — endpoint healthy`);
    }
  }

  // Try streamable-http first, fall back to SSE
  const baseUrl = new URL(connectUrl);
  const sseUrl = new URL("/sse", baseUrl).toString();
  const candidates: Array<{ type: "streamable-http" | "sse"; url: string }> = [
    { type: "streamable-http", url: connectUrl },
    { type: "sse", url: sseUrl },
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    const httpTransport: Transport =
      candidate.type === "streamable-http"
        ? new StreamableHTTPClientTransport(new URL(candidate.url), { requestInit: { headers: config.headers ?? {} } })
        : new SSEClientTransport(new URL(candidate.url), { requestInit: { headers: config.headers ?? {} } });

    const sdkClient = new Client({ name: "reactive-agents", version: "1.0.0" }, { capabilities: {} });
    try {
      mcpDebug(`[MCP http-mode] "${config.name}" — trying ${candidate.type} at ${candidate.url}`);
      await sdkClient.connect(httpTransport);
      mcpDebug(`[MCP init] "${config.name}" — connected via ${candidate.type}`);
      return {
        client: sdkClient,
        transport: httpTransport,
        server: await buildMCPServer(config.name, candidate.type, candidate.url, config, sdkClient),
        dockerContainerName,  // undefined when reusing an existing server
      };
    } catch (e) {
      lastError = e;
      console.warn(`[MCP http-mode] "${config.name}" — ${candidate.type} failed: ${e instanceof Error ? e.message : e}`);
      try { await httpTransport.close(); } catch { /* ignore */ }
    }
  }

  if (dockerContainerName) dockerRmForce(dockerContainerName);
  throw new Error(
    `MCP server "${config.name}": all HTTP transports failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// ─── Handshake Helper ─────────────────────────────────────────────────────────

async function buildMCPServer(
  name: string,
  transport: MCPServer["transport"],
  endpoint: string | undefined,
  config: ConnectConfig,
  sdkClient: Client,
): Promise<MCPServer> {
  const serverVersion = sdkClient.getServerVersion();
  const toolsResult = await sdkClient.listTools();
  const tools = toolsResult.tools ?? [];
  const toolNames = tools.map((t) => t.name);

  mcpDebug(
    `[MCP tools] "${name}" — ${toolNames.length} tool(s)` +
    (toolNames.length > 0
      ? `: ${toolNames.slice(0, 5).join(", ")}${toolNames.length > 5 ? ` … +${toolNames.length - 5} more` : ""}`
      : " (none)"),
  );

  return {
    name,
    version: serverVersion?.version ?? "unknown",
    transport,
    endpoint,
    command: config.command,
    args: config.args,
    tools: toolNames,
    toolSchemas: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    })),
    status: "connected",
  };
}

// ─── Core Connect ─────────────────────────────────────────────────────────────

async function connectInternal(config: ConnectConfig): Promise<ActiveConnection> {
  const effectiveTransport = resolveTransport(config);

  // ── stdio path ──
  if (effectiveTransport === "stdio") {
    // For docker commands, assign a unique probe container name so we can stop it
    // reliably via `docker rm -f` when switching to HTTP mode.
    const isDocker = config.command === "docker" && (config.args ?? []).includes("run");
    const probeContainerName = isDocker
      ? `rax-probe-${config.name.replace(/[^a-zA-Z0-9]/g, "-")}-${process.pid}`
      : undefined;

    // Ensure --rm + a stable --name on the probe container. --name lets us stop
    // it reliably via `docker rm -f` on cleanup (killing the docker run process
    // leaves the container alive); --rm is belt-and-suspenders so a clean exit
    // self-removes. The name is pid-deterministic, so pre-remove any stale
    // container left by a prior connect that didn't clean up — otherwise the new
    // `docker run` hits "container name already in use".
    const probeArgs = (isDocker && probeContainerName && config.args)
      ? buildDockerProbeArgs(config.args, probeContainerName)
      : undefined;

    if (isDocker && probeContainerName) {
      await dockerRmForceAwait(probeContainerName);
    }

    const transport = createTransport(config, probeArgs) as StdioClientTransport;
    const sdkClient = new Client({ name: "reactive-agents", version: "1.0.0" }, { capabilities: {} });

    const stderrLines: string[] = [];
    let httpDetectedResolve: ((url: string) => void) | undefined;
    const httpDetectedPromise = new Promise<string>((r) => { httpDetectedResolve = r; });

    const stderrStream = transport.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const raw of text.split("\n")) {
          const trimmed = raw.trimEnd();
          if (!trimmed) continue;
          process.stderr.write(`[MCP ${config.name}] ${trimmed}\n`);
          stderrLines.push(trimmed);
          if (stderrLines.length > 50) stderrLines.shift();
          const found = detectHttpStartupUrl(trimmed);
          if (found) httpDetectedResolve?.(found);
        }
      });
    }

    mcpDebug(
      `[MCP spawn] "${config.name}" — ${config.command} ${(probeArgs ?? config.args ?? []).join(" ")}` +
      (config.cwd ? ` (cwd: ${config.cwd})` : ""),
    );

    type RaceResult =
      | { type: "connected" }
      | { type: "http"; url: string }
      | { type: "error"; error: unknown };

    const connectRace: Promise<RaceResult> = sdkClient
      .connect(transport, { timeout: 600_000 })
      .then(() => ({ type: "connected" as const }))
      .catch((e: unknown) => ({ type: "error" as const, error: e }));

    const httpRace: Promise<RaceResult> = httpDetectedPromise.then((url) => ({
      type: "http" as const, url,
    }));

    const winner = await Promise.race([connectRace, httpRace]);

    if (winner.type === "http") {
      mcpDebug(`[MCP auto-detect] "${config.name}" — HTTP server detected; switching to HTTP mode`);
      void transport.close().catch(() => {});
      return reconnectViaHttp(config, winner.url, probeContainerName);
    }

    if (winner.type === "error") {
      const httpUrl = await Promise.race([
        httpDetectedPromise,
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 200)),
      ]);
      if (httpUrl) {
        mcpDebug(`[MCP auto-detect] "${config.name}" — stdio error + HTTP URL seen; switching to HTTP`);
        void transport.close().catch(() => {});
        return reconnectViaHttp(config, httpUrl, probeContainerName);
      }
      const stderrContext = stderrLines.slice(-5).join(" | ").trim();
      const base = winner.error instanceof Error ? winner.error.message : String(winner.error);
      const detail = stderrContext ? `\nServer stderr: ${stderrContext}` : "";
      throw new Error(`MCP server "${config.name}" connection failed: ${base}${detail}`);
    }

    // stdio MCP server — connected normally
    mcpDebug(`[MCP init] "${config.name}" — connected via stdio`);
    const server = await buildMCPServer(config.name, "stdio", undefined, config, sdkClient);
    // Track the probe container so disconnect()/cleanup `docker rm -f`s it — for a
    // pure stdio docker server the probe container IS the running server, and
    // closing the stdio transport kills the docker run process but NOT the
    // container (the daemon keeps it alive), leaking it across runs.
    return probeContainerName
      ? { client: sdkClient, transport, server, dockerContainerName: probeContainerName }
      : { client: sdkClient, transport, server };
  }

  // ── HTTP / SSE ──
  const transport = createTransport(config);
  const sdkClient = new Client({ name: "reactive-agents", version: "1.0.0" }, { capabilities: {} });
  await sdkClient.connect(transport);
  mcpDebug(`[MCP init] "${config.name}" — connected via ${effectiveTransport}`);
  const server = await buildMCPServer(config.name, effectiveTransport, config.endpoint, config, sdkClient);
  return { client: sdkClient, transport, server };
}

// ─── MCP Client (Effect-TS facade) ───────────────────────────────────────────

export const makeMCPClient = Effect.gen(function* () {
  const serversRef = yield* Ref.make<Map<string, MCPServer>>(new Map());

  const connect = (config: ConnectConfig): Effect.Effect<MCPServer, MCPConnectionError> =>
    Effect.tryPromise({
      try: async () => {
        const conn = await connectInternal(config);
        const cb = notificationCallbacks.get(config.name);
        if (cb) {
          conn.client.fallbackNotificationHandler = async (notification) => {
            cb(notification.method, (notification.params ?? {}) as Record<string, unknown>);
          };
        }
        ensureExitHandler();
        activeConnections.set(config.name, conn);
        return conn.server;
      },
      catch: (e) =>
        new MCPConnectionError({
          message: e instanceof Error ? e.message : String(e),
          serverName: config.name,
          transport: config.transport ?? "stdio",
          cause: e,
        }),
    }).pipe(
      Effect.tap((server) =>
        Ref.update(serversRef, (m) => { const n = new Map(m); n.set(server.name, server); return n; }),
      ),
    );

  const callTool = (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, MCPConnectionError | ToolExecutionError> => {
    const conn = activeConnections.get(serverName);
    if (!conn) {
      return Effect.fail(new MCPConnectionError({
        message: `MCP server "${serverName}" is not connected`,
        serverName,
        transport: "unknown",
      }));
    }
    return Effect.tryPromise({
      try: async () => {
        const result = await conn.client.callTool({ name: toolName, arguments: args });
        if (result.content && Array.isArray(result.content)) {
          const textParts = (result.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "");
          if (result.isError) throw new Error(textParts.join("\n") || `MCP tool "${toolName}" returned an error`);
          return textParts.length > 0 ? textParts.join("\n") : result;
        }
        return result;
      },
      catch: (e) =>
        e instanceof MCPConnectionError
          ? e
          : new ToolExecutionError({ message: e instanceof Error ? e.message : String(e), toolName, input: args }),
    });
  };

  const disconnect = (serverName: string): Effect.Effect<void, MCPConnectionError> =>
    Effect.tryPromise({
      try: async () => {
        const conn = activeConnections.get(serverName);
        if (conn) {
          if (conn.dockerContainerName) {
            mcpDebug(`[MCP disconnect] stopping container "${conn.dockerContainerName}"`);
            dockerRmForce(conn.dockerContainerName);
          }
          try { await conn.transport.close(); } catch { /* already gone */ }
          activeConnections.delete(serverName);
        }
      },
      catch: (e) =>
        new MCPConnectionError({ message: e instanceof Error ? e.message : String(e), serverName, transport: "unknown" }),
    }).pipe(
      Effect.tap(() =>
        Ref.update(serversRef, (m) => {
          const n = new Map(m);
          const s = n.get(serverName);
          if (s) n.set(serverName, { ...s, status: "disconnected" });
          return n;
        }),
      ),
    );

  const listServers = (): Effect.Effect<readonly MCPServer[], never> =>
    Ref.get(serversRef).pipe(Effect.map((m) => [...m.values()]));

  const onNotification = (
    serverName: string,
    callback: (method: string, params: Record<string, unknown>) => void,
  ): void => {
    notificationCallbacks.set(serverName, callback);
    const conn = activeConnections.get(serverName);
    if (conn) {
      conn.client.fallbackNotificationHandler = async (notification) => {
        callback(notification.method, (notification.params ?? {}) as Record<string, unknown>);
      };
    }
  };

  return { connect, callTool, disconnect, listServers, onNotification };
});
