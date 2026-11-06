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
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServer } from "../types.js";
import { MCPConnectionError, ToolExecutionError } from "../errors.js";
import { createAuthProvider } from "./auth/create-provider.js";
import { mapMcpToolResult } from "./mcp-result.js";
import { hasRedactor, redactBearerTokens, LOOPBACK_HOSTS } from "./auth/hardened-provider.js";
import { createFileTokenStore } from "./auth/token-store.js";
import type { MCPTokenStore } from "./auth/types.js";

const mcpDebug = (...args: unknown[]): void => {
  if (process.env["RAX_DEBUG"]) console.log(...args);
};

// ─── Types ───────────────────────────────────────────────────────────────────

type ConnectConfig = Omit<
  Pick<
    MCPServer,
    | "name"
    | "transport"
    | "endpoint"
    | "command"
    | "args"
    | "cwd"
    | "env"
    | "headers"
    | "auth"
    | "tokenStore"
  >,
  "transport"
> & { transport?: MCPServer["transport"] };

/**
 * Default OAuth token store when `config.auth` is set without an explicit
 * `config.tokenStore` — the persistent file store under `~/.reactive-agents/mcp-auth`
 * (matches `MCPServer.tokenStore`'s documented default, `.withMCP()`'s JSDoc, every
 * docs site, and the changeset; `rax mcp login <name>` writes to this same file store,
 * so a subsequent connection with no explicit `tokenStore` must read from it too —
 * final-review C1). Shared across servers: {@link MCPTokenStore} keys are
 * canonicalized per-resource-URL (see `canonicalResourceKey`), so two servers
 * never collide on this shared instance. Pass `createMemoryTokenStore()` explicitly
 * for tests/CI that must not touch disk.
 */
let defaultTokenStore: MCPTokenStore | undefined;
function getDefaultTokenStore(): MCPTokenStore {
  defaultTokenStore ??= createFileTokenStore();
  return defaultTokenStore;
}

/**
 * Sanitizes an error message before it crosses into `MCPConnectionError` /
 * `ToolExecutionError`. Uses `provider`'s observed-secret redactor when one
 * is available (every provider `createAuthProvider` builds from RA's own
 * config exposes one — see `./auth/hardened-provider.ts`); falls back to a
 * generic `Bearer <token>`-pattern strip otherwise (e.g. a caller-supplied
 * `type: "provider"`, which this task does not wrap, or a connect failure
 * that never got far enough to construct a provider at all).
 */
function sanitizeErrorMessage(message: string, provider: OAuthClientProvider | undefined): string {
  if (provider && hasRedactor(provider)) return provider.redactSecrets(message);
  return redactBearerTokens(message);
}

/**
 * The endpoint-must-be-HTTPS-unless-loopback half of `validateAuthConfig` below,
 * factored out (final-review I4) so a caller that never builds a `ConnectConfig` — e.g.
 * `apps/cli`'s `rax mcp login`/`logout`, which drives the SDK's `auth()` orchestrator
 * directly against a resolved endpoint string — can run the exact same check before
 * starting any network-facing OAuth flow. Deliberately does NOT include
 * `validateAuthConfig`'s stdio-transport or headers-ambiguity checks; neither applies to
 * a bare `--url` endpoint with no transport/headers config.
 *
 * RA-owned regardless of SDK behavior (Task 5): the MCP endpoint itself must be HTTPS
 * whenever `auth` is set (or is about to be driven), unless it's a loopback address —
 * same convention as `packages/runtime-shim/src/secure-serve.ts`'s `LOOPBACK_HOSTS`.
 * Distinct from `./auth/hardened-provider.ts`'s HTTPS check, which covers the
 * authorization/token/registration endpoints a discovered authorization-server
 * metadata document advertises, not this endpoint. Checked before any transport is
 * constructed or fetch issued — so an OAuth-protected resource never gets contacted in
 * plaintext even on the very first request.
 */
export function validateAuthEndpointIsHttps(serverName: string, endpoint: string): void {
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error(`MCP server "${serverName}": "endpoint" ("${endpoint}") is not a valid URL.`);
  }
  const isLoopback = LOOPBACK_HOSTS.has(endpointUrl.hostname.toLowerCase());
  if (endpointUrl.protocol !== "https:" && !isLoopback) {
    throw new Error(
      `MCP server "${serverName}": "auth" requires an HTTPS endpoint (got "${endpointUrl.protocol}//${endpointUrl.host}") unless the host is a loopback address (127.0.0.1/::1/localhost) — refusing a plaintext OAuth-protected connection.`,
    );
  }
}

/**
 * Config-time validation for `config.auth` — must run before any connection
 * attempt (network fetch or subprocess spawn), per the plan's "ambiguous
 * credential source" and "stdio gets credentials from the environment, not
 * OAuth" requirements. Throws a plain `Error`; the caller (`connectInternal`
 * via the `connect` Effect in `makeMCPClient`) wraps it into an
 * `MCPConnectionError` like any other connect-time failure.
 *
 * Deliberately does not echo any secret value in its error messages.
 */
function validateAuthConfig(config: ConnectConfig): void {
  if (!config.auth) return;

  const transport = resolveTransport(config);
  if (transport === "stdio") {
    throw new Error(
      `MCP server "${config.name}": "auth" is not supported for "stdio" transport — stdio servers get credentials from the environment (e.g. "env"), not OAuth.`,
    );
  }

  const hasAuthorizationHeader = Object.keys(config.headers ?? {}).some(
    (key) => key.toLowerCase() === "authorization",
  );
  if (hasAuthorizationHeader) {
    throw new Error(
      `MCP server "${config.name}": both "auth" and a "headers.Authorization" entry are set — ambiguous credential source. Use one or the other, not both.`,
    );
  }

  if (config.endpoint) {
    validateAuthEndpointIsHttps(config.name, config.endpoint);
  }
}

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
  /**
   * The OAuth provider used to connect, when `config.auth` was set. Kept so
   * later error paths (`callTool`, `disconnect`) can sanitize their error
   * messages via the provider's redactor (see `sanitizeErrorMessage` above) —
   * `connect`'s own errors are sanitized inside `connectHttpLike` instead,
   * since that's the only place still holding a reference to a provider that
   * never made it into a successful `ActiveConnection`.
   */
  authProvider?: OAuthClientProvider;
}

// ─── Module-level State ───────────────────────────────────────────────────────

/**
 * Registry of every live `makeMCPClient` instance's own connection table.
 *
 * Each instance created by `makeMCPClient` owns a private `activeConnections`
 * Map (see below) so that two Layer instances in the same process — e.g. two
 * concurrent agents, or parallel test suites — never clobber each other's
 * connections. This registry exists only so two process-wide concerns can
 * still reach every instance despite that isolation:
 *   1. `cleanupMcpTransport(serverName)` — an exported bare function called
 *      by external consumers (e.g. apps/cortex) that hold no reference to
 *      which instance owns a given server name.
 *   2. `ensureExitHandler()` — process signal handlers can only be
 *      registered once per process, but must still clean up every
 *      instance's connections on shutdown.
 * The registry holds no connection data itself; it is only a lookup path
 * for these two cases. Each instance still reads/writes its own Map.
 */
const connectionRegistry = new Set<Map<string, ActiveConnection>>();

// ─── Exit Cleanup ─────────────────────────────────────────────────────────────

/** Clean up a single named entry within one instance's connection table. */
function cleanupConnectionEntry(connections: Map<string, ActiveConnection>, serverName: string): void {
  const conn = connections.get(serverName);
  if (!conn) return;

  if (conn.dockerContainerName) {
    // Must use `docker rm -f` — killing the docker run process is not enough
    // because the Docker daemon keeps the container alive independently.
    mcpDebug(`[MCP cleanup] stopping container "${conn.dockerContainerName}"`);
    dockerRmForce(conn.dockerContainerName);
  }
  try { void conn.transport.close(); } catch { /* already gone */ }
  connections.delete(serverName);
  mcpDebug(`[MCP cleanup] "${serverName}" transport closed`);
}

function cleanupAll(): void {
  for (const connections of connectionRegistry) {
    for (const [name] of connections) {
      cleanupConnectionEntry(connections, name);
    }
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
 *
 * This is a bare top-level function with no instance handle, so it searches
 * every live `makeMCPClient` instance's connection table (via
 * `connectionRegistry`) and cleans up the entry wherever it is found. A
 * server name may legitimately exist in more than one instance now that each
 * instance's connections are isolated.
 */
export function cleanupMcpTransport(serverName: string): void {
  for (const connections of connectionRegistry) {
    cleanupConnectionEntry(connections, serverName);
  }
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

/**
 * Builds a minimal `MCPServer`-shaped view of `config` for `createAuthProvider`
 * (whose signature is `(server: MCPServer, store) => ...` per the plan). Only
 * `name`/`transport`/`endpoint`/`auth` are actually read by `createAuthProvider`;
 * the remaining `MCPServerSchema` fields are filled with connect-time-accurate
 * placeholders (no tools discovered yet, not yet connected).
 */
function toMCPServerLike(config: ConnectConfig): MCPServer {
  return {
    name: config.name,
    version: "unknown",
    transport: resolveTransport(config),
    endpoint: config.endpoint,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    headers: config.headers,
    tools: [],
    status: "disconnected",
    auth: config.auth,
    tokenStore: config.tokenStore,
  };
}

/**
 * @param authProviderOverride When set, used instead of constructing a fresh
 * `createAuthProvider(...)` — required for the authorization-code retry in
 * `connectHttpLike` below, which builds a SECOND transport (post-`finishAuth`)
 * that must reuse the exact same provider instance (its `state`/PKCE
 * verifier/loopback-listener are all tied to that one instance, not
 * reconstructible from `config` alone).
 */
function createTransport(
  config: ConnectConfig,
  overrideArgs?: string[],
  authProviderOverride?: OAuthClientProvider,
): Transport {
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
      const authProvider =
        authProviderOverride ?? createAuthProvider(toMCPServerLike(config), config.tokenStore ?? getDefaultTokenStore());
      return new StreamableHTTPClientTransport(new URL(config.endpoint), { requestInit: { headers }, authProvider });
    }
    case "sse": {
      if (!config.endpoint) throw new Error(
        `MCP server "${config.name}" has transport "sse" but no endpoint specified`,
      );
      const authProvider =
        authProviderOverride ?? createAuthProvider(toMCPServerLike(config), config.tokenStore ?? getDefaultTokenStore());
      return new SSEClientTransport(new URL(config.endpoint), { requestInit: { headers }, authProvider });
    }
    case "websocket":
      throw new Error(
        `MCP server "${config.name}": websocket transport is not supported. Use streamable-http or sse.`,
      );
    default:
      throw new Error(`MCP server "${config.name}": unknown transport "${String(config.transport)}"`);
  }
}

/** The extra members `createAuthorizationCodeProvider` adds beyond the plain SDK `OAuthClientProvider`. */
interface AuthorizationCodeProviderHandle {
  waitForAuthorizationCode(): Promise<string>;
  disposeAuthorizationListener(): Promise<void>;
}

/**
 * Type guard: does `provider` additionally expose the authorization-code
 * handle above? Only `createAuthorizationCodeProvider`'s return value does
 * (see `./auth/authorization-code-provider.ts`) — `createAuthProvider`'s
 * declared return type is the plain SDK `OAuthClientProvider`, so callers
 * that need the extra members narrow to it explicitly here rather than
 * widening that public return type.
 */
function hasAuthorizationCodeHandle(
  provider: OAuthClientProvider,
): provider is OAuthClientProvider & AuthorizationCodeProviderHandle {
  const candidate = provider as Partial<AuthorizationCodeProviderHandle>;
  // Both members are required — a provider exposing only one (e.g. a
  // caller-supplied `type: "provider"` that happens to name a method
  // `waitForAuthorizationCode` but not `disposeAuthorizationListener`)
  // must not be treated as ours: the dispose call at the cleanup site
  // would then throw a synchronous TypeError that masks the real connect
  // error instead of being caught by its `.catch()`.
  return (
    typeof candidate.waitForAuthorizationCode === "function" &&
    typeof candidate.disposeAuthorizationListener === "function"
  );
}

function isInteractiveAuthorizationCode(config: ConnectConfig): boolean {
  return config.auth?.type === "authorization_code" && config.auth.interactive === true;
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

  // Same provider construction as `createTransport`'s streamable-http/sse cases —
  // this path (Docker/subprocess auto-upgrade from stdio to HTTP) currently can
  // never carry `config.auth` in practice (`validateAuthConfig` rejects `auth` on
  // any config that resolves to "stdio" transport, and reaching this function
  // requires exactly that). Wired anyway for parity: if that stdio+auth
  // restriction is ever relaxed, this path must not silently skip auth.
  const authProvider = createAuthProvider(toMCPServerLike(config), config.tokenStore ?? getDefaultTokenStore());

  let lastError: unknown;
  for (const candidate of candidates) {
    const httpTransport: Transport =
      candidate.type === "streamable-http"
        ? new StreamableHTTPClientTransport(new URL(candidate.url), { requestInit: { headers: config.headers ?? {} }, authProvider })
        : new SSEClientTransport(new URL(candidate.url), { requestInit: { headers: config.headers ?? {} }, authProvider });

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
  validateAuthConfig(config);
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
  return connectHttpLike(config, effectiveTransport);
}

/**
 * HTTP/SSE connect, with the authorization-code interactive retry: the SDK
 * throws `UnauthorizedError` once its `auth()` orchestrator has called
 * `provider.redirectToAuthorization(url)` (our provider has, by that point,
 * either already thrown the `rax mcp login` error — non-interactive — or
 * already started the loopback listener and opened the browser / called
 * `onAuthorizationUrl` — interactive). For the interactive case: await the
 * authorization code the listener collects, call `transport.finishAuth(code)`
 * to exchange it for tokens, then reconnect with a FRESH transport + client —
 * the SDK's own `finishAuth` doc comment says this enables "the next
 * connection attempt" to succeed; the original transport's auth-loop guard
 * (`_hasCompletedAuthFlow`) and any half-open stream state are not meant to
 * be reused post-exchange. The same `authProvider` instance carries over,
 * so the freshly persisted tokens are picked up immediately.
 *
 * `attempt()` covers BOTH `sdkClient.connect(transport)` AND the subsequent
 * `listTools()` call inside `buildMCPServer` — not just the initial
 * handshake. Found live against Google's Home MCP server (2026-09-17):
 * Google's `initialize` succeeds with no token at all (its `POST /mcp`
 * returns 200 unauthenticated), and only `tools/list` returns a 401 — a
 * real-world server that gates a LATER request, not the first one. The MCP
 * spec never requires the first request to be the one that's challenged, so
 * treating only `sdkClient.connect()`'s own 401 as retryable silently
 * dropped every server shaped like this straight to a raw "Unauthorized"
 * with no interactive-login attempt at all.
 */
async function connectHttpLike(
  config: ConnectConfig,
  effectiveTransport: MCPServer["transport"],
): Promise<ActiveConnection> {
  const authProvider = config.auth
    ? createAuthProvider(toMCPServerLike(config), config.tokenStore ?? getDefaultTokenStore())
    : undefined;

  let transport = createTransport(config, undefined, authProvider);
  let sdkClient = new Client({ name: "reactive-agents", version: "1.0.0" }, { capabilities: {} });

  const attempt = async (): Promise<MCPServer> => {
    await sdkClient.connect(transport);
    return buildMCPServer(config.name, effectiveTransport, config.endpoint, config, sdkClient);
  };

  let server: MCPServer;
  try {
    try {
      server = await attempt();
    } catch (err) {
      if (
        !(err instanceof UnauthorizedError) ||
        !isInteractiveAuthorizationCode(config) ||
        authProvider === undefined ||
        !hasAuthorizationCodeHandle(authProvider)
      ) {
        throw err;
      }

      mcpDebug(`[MCP oauth] "${config.name}" — waiting for interactive login to complete…`);
      const code = await authProvider.waitForAuthorizationCode();

      const authTransport = transport as StreamableHTTPClientTransport | SSEClientTransport;
      await authTransport.finishAuth(code);
      try {
        await transport.close();
      } catch {
        /* already gone */
      }

      transport = createTransport(config, undefined, authProvider);
      sdkClient = new Client({ name: "reactive-agents", version: "1.0.0" }, { capabilities: {} });
      server = await attempt();
      mcpDebug(`[MCP oauth] "${config.name}" — interactive login complete`);
    }
  } catch (err) {
    // Any failure past this point (including a non-retryable error from the
    // FIRST `attempt()` above, and a retry that itself fails) must not leave
    // an orphaned, listening loopback socket + live timeout — see
    // `disposeAuthorizationListener`'s doc comment for why this is needed
    // even though the happy path and the timeout path both self-close.
    if (authProvider !== undefined && hasAuthorizationCodeHandle(authProvider)) {
      await authProvider.disposeAuthorizationListener().catch(() => {
        /* best-effort cleanup; the original error wins */
      });
    }
    // Sanitize in place (rather than constructing a new Error) so any
    // `instanceof` check a caller might still run against `err` (there are
    // none left at this point in this file, but this is the last point that
    // still has `authProvider` in scope) keeps working — only `.message`
    // changes, which is all `connect`'s `Effect.tryPromise` catch reads.
    if (err instanceof Error) {
      err.message = sanitizeErrorMessage(err.message, authProvider);
    }
    throw err;
  }

  mcpDebug(`[MCP init] "${config.name}" — connected via ${effectiveTransport}`);
  return { client: sdkClient, transport, server, authProvider };
}

// ─── MCP Client (Effect-TS facade) ───────────────────────────────────────────

export const makeMCPClient = Effect.gen(function* () {
  const serversRef = yield* Ref.make<Map<string, MCPServer>>(new Map());

  // Per-instance connection state (WS-mcp-isolation): each `makeMCPClient`
  // build gets its own private tables so two Layer instances in the same
  // process never share or clobber each other's MCP connections.
  const activeConnections = new Map<string, ActiveConnection>();
  const notificationCallbacks = new Map<
    string,
    (method: string, params: Record<string, unknown>) => void
  >();
  // Registered so `cleanupMcpTransport()` (bare export, no instance handle)
  // and the process exit handler can still reach this instance's table.
  connectionRegistry.add(activeConnections);

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
        const mapped = mapMcpToolResult(await conn.client.callTool({ name: toolName, arguments: args }));
        if (mapped.kind === "error") throw new Error(mapped.text || `MCP tool "${toolName}" returned an error`);
        return mapped.value;
      },
      catch: (e) => {
        if (e instanceof MCPConnectionError) return e;
        const rawMessage = e instanceof Error ? e.message : String(e);
        return new ToolExecutionError({
          message: sanitizeErrorMessage(rawMessage, conn.authProvider),
          toolName,
          input: args,
        });
      },
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
        new MCPConnectionError({
          message: sanitizeErrorMessage(e instanceof Error ? e.message : String(e), undefined),
          serverName,
          transport: "unknown",
        }),
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
