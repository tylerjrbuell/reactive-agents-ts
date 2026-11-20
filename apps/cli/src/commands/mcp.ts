/**
 * `rax mcp login | logout | status` — CLI-driven OAuth for MCP client
 * connections (Task 6 of
 * `wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md`).
 *
 * Thin wrapper over the public `@reactive-agents/tools` sign-in API
 * (`mcpLogin`, `mcpLogout`, `listMcpLogins`). Discovery, dynamic client
 * registration, PKCE, the loopback redirect, token exchange, RFC 7009
 * revocation, secret redaction and the `canonicalResourceKey` store layout
 * all live there, shared with `connect()`, Cortex and builders. This file
 * only parses flags, resolves a server name to its endpoint, and prints.
 *
 * Server resolution: this CLI has exactly one existing "list of configured
 * MCP servers by name" mechanism — `apps/cli/src/commands/run.ts`'s
 * `.rax/mcp.json` (an explicit `--mcp-config <path>`, else auto-detected at
 * `<cwd>/.rax/mcp.json`). That shape is duplicated here (not imported —
 * `run.ts`'s `MCPConfigFile` interface isn't exported, and the two files'
 * needs differ: `run.ts` builds live `.withMCP()` connections, this file
 * only needs a server's `name` → `endpoint` mapping) rather than invented
 * fresh. The `--url <endpoint>` fallback needs no config file at all.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Either } from "effect";
import {
  listMcpLogins,
  mcpLogin,
  mcpLogout,
  openBrowser,
  validateAuthEndpointIsHttps,
  type MCPTokenStore,
  type McpLoginSummary,
  type McpLogoutResult,
} from "@reactive-agents/tools";
import { fail, info, kv, section, success, warn } from "../ui.js";

// ─── Server resolution (`.rax/mcp.json`, matching `run.ts`) ───────────────

interface MCPConfigFileEntry {
  readonly name: string;
  readonly transport: string;
  readonly endpoint?: string;
}

interface MCPConfigFile {
  readonly servers: readonly MCPConfigFileEntry[];
}

function defaultMcpConfigPath(): string {
  return resolve(process.cwd(), ".rax", "mcp.json");
}

function loadMcpConfigFile(mcpConfigPath?: string): { file: string; config: MCPConfigFile } | undefined {
  const file = mcpConfigPath ?? defaultMcpConfigPath();
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, "utf-8");
  const config = JSON.parse(raw) as MCPConfigFile;
  return { file, config };
}

function resolveEndpointFromConfig(name: string, mcpConfigPath?: string): string {
  const loaded = loadMcpConfigFile(mcpConfigPath);
  if (!loaded) {
    throw new Error(
      `rax mcp: no MCP config found for server "${name}" (looked for ${mcpConfigPath ?? defaultMcpConfigPath()}). ` +
        `Configure it there, or use --url <endpoint> for an ad-hoc login.`,
    );
  }
  const entry = loaded.config.servers.find((s) => s.name === name);
  if (!entry) {
    const known = loaded.config.servers.map((s) => s.name).join(", ") || "(none)";
    throw new Error(`rax mcp: server "${name}" not found in ${loaded.file}. Known servers: ${known}`);
  }
  if (!entry.endpoint) {
    throw new Error(
      `rax mcp: server "${name}" (transport "${entry.transport}") has no "endpoint" configured — OAuth requires an HTTP endpoint.`,
    );
  }
  return entry.endpoint;
}

export interface MCPTarget {
  readonly kind: "name" | "url";
  readonly value: string;
}

export interface ResolvedTarget {
  readonly url: string;
  /** Human-facing label — the configured server name, or the raw URL for `--url`. */
  readonly label: string;
}

export function resolveTarget(target: MCPTarget, mcpConfigPath?: string): ResolvedTarget {
  const resolved =
    target.kind === "url"
      ? { url: target.value, label: target.value }
      : { url: resolveEndpointFromConfig(target.value, mcpConfigPath), label: target.value };
  // Final-review I4: HTTPS-unless-loopback, checked at resolution so a bad
  // `--url` or config endpoint fails before any network call. `mcpLogin` /
  // `mcpLogout` run the same check; this one also labels the error with the
  // server name.
  validateAuthEndpointIsHttps(resolved.label, resolved.url);
  return resolved;
}

// ─── Argument parsing ──────────────────────────────────────────────────────

function parseTargetAndFlag(
  argv: readonly string[],
  extraFlags: (arg: string, next: () => string | undefined) => boolean,
  usage: string,
): { target: MCPTarget; mcpConfigPath?: string } {
  let name: string | undefined;
  let url: string | undefined;
  let mcpConfigPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string | undefined => argv[++i];
    if (arg === "--url") {
      const v = next();
      if (v === undefined) throw new Error(`${usage}: --url requires a value`);
      url = v;
    } else if (arg === "--mcp-config") {
      const v = next();
      if (v === undefined) throw new Error(`${usage}: --mcp-config requires a value`);
      mcpConfigPath = v;
    } else if (extraFlags(arg, next)) {
      // handled by caller
    } else if (!arg.startsWith("--") && name === undefined && url === undefined) {
      name = arg;
    } else if (arg.startsWith("--")) {
      throw new Error(`${usage}: unknown flag "${arg}"`);
    } else {
      throw new Error(`${usage}: unexpected argument "${arg}"`);
    }
  }

  if (url !== undefined && name !== undefined) {
    throw new Error(`${usage}: pass either <name> or --url <endpoint>, not both`);
  }
  if (url !== undefined) {
    return { target: { kind: "url", value: url }, mcpConfigPath };
  }
  if (name !== undefined) {
    return { target: { kind: "name", value: name }, mcpConfigPath };
  }
  throw new Error(`${usage}: requires <name> or --url <endpoint>`);
}

export interface MCPLoginArgs {
  readonly target: MCPTarget;
  readonly mcpConfigPath?: string;
  readonly clientId?: string;
  /**
   * Confidential-client secret, for authorization servers that issue one
   * alongside the client ID (e.g. Google's "Web application" OAuth client
   * type) rather than a public/native client. Optional — most MCP servers
   * following the spec's default posture use a public client with no secret.
   */
  readonly clientSecret?: string;
  readonly scope?: string;
  readonly noBrowser: boolean;
  readonly timeoutMs?: number;
  /**
   * Pin the loopback redirect listener to a fixed port instead of an
   * ephemeral one. Required when the authorization server validates the
   * `redirect_uri` against a pre-registered exact value (most "Web
   * application"-style OAuth clients) rather than accepting any loopback
   * port per RFC 8252 — register `http://127.0.0.1:<this port>/callback`
   * as that server's authorized redirect URI.
   */
  readonly redirectPort?: number;
}

const LOGIN_USAGE =
  "Usage: rax mcp login <name|--url <endpoint>> [--client-id <id>] [--client-secret <secret>] [--scope <scope>] [--redirect-port <port>] [--no-browser]";

export function parseLoginArgs(argv: readonly string[]): MCPLoginArgs {
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  let scope: string | undefined;
  let noBrowser = false;
  let timeoutMs: number | undefined;
  let redirectPort: number | undefined;

  const { target, mcpConfigPath } = parseTargetAndFlag(
    argv,
    (arg, next) => {
      if (arg === "--client-id") {
        const v = next();
        if (v === undefined) throw new Error(`${LOGIN_USAGE}: --client-id requires a value`);
        clientId = v;
        return true;
      }
      if (arg === "--client-secret") {
        const v = next();
        if (v === undefined) throw new Error(`${LOGIN_USAGE}: --client-secret requires a value`);
        clientSecret = v;
        return true;
      }
      if (arg === "--scope") {
        const v = next();
        if (v === undefined) throw new Error(`${LOGIN_USAGE}: --scope requires a value`);
        scope = v;
        return true;
      }
      if (arg === "--no-browser") {
        noBrowser = true;
        return true;
      }
      if (arg === "--timeout") {
        const v = next();
        if (v === undefined) throw new Error(`${LOGIN_USAGE}: --timeout requires a value (milliseconds)`);
        const parsed = Number(v);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`${LOGIN_USAGE}: --timeout must be a positive number of milliseconds`);
        }
        timeoutMs = parsed;
        return true;
      }
      if (arg === "--redirect-port") {
        const v = next();
        if (v === undefined) throw new Error(`${LOGIN_USAGE}: --redirect-port requires a value`);
        const parsed = Number(v);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
          throw new Error(`${LOGIN_USAGE}: --redirect-port must be an integer between 1 and 65535`);
        }
        redirectPort = parsed;
        return true;
      }
      return false;
    },
    LOGIN_USAGE,
  );

  return { target, mcpConfigPath, clientId, clientSecret, scope, noBrowser, timeoutMs, redirectPort };
}

export interface MCPLogoutArgs {
  readonly target: MCPTarget;
  readonly mcpConfigPath?: string;
}

const LOGOUT_USAGE = "Usage: rax mcp logout <name|--url <endpoint>>";

export function parseLogoutArgs(argv: readonly string[]): MCPLogoutArgs {
  const { target, mcpConfigPath } = parseTargetAndFlag(argv, () => false, LOGOUT_USAGE);
  return { target, mcpConfigPath };
}

export type MCPStatusArgs = Record<string, never>;

export function parseStatusArgs(argv: readonly string[]): MCPStatusArgs {
  if (argv.length > 0) {
    throw new Error(`Usage: rax mcp status — unexpected argument "${argv[0]}"`);
  }
  return {};
}

// ─── `login` ────────────────────────────────────────────────────────────────

/** Runs an auth-API effect at the CLI edge, rethrowing its typed (already redacted) error as a plain Error. */
async function runAuth<A>(effect: Effect.Effect<A, { readonly message: string }>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right;
}

export interface MCPCliDeps {
  readonly store?: MCPTokenStore;
  /** Test/scripting hook — replaces the default "print to stderr + maybe open browser" behavior. */
  readonly onAuthorizationUrl?: (url: URL) => void | Promise<void>;
}

async function defaultOnAuthorizationUrl(url: URL, noBrowser: boolean): Promise<void> {
  // Always printed — even when a browser opens, a headless/SSH user needs
  // this to copy the link, and it is never wrong to show it.
  console.error(info(`Open this URL to authorize:\n  ${url.toString()}`));
  if (noBrowser) return;
  try {
    await openBrowser(url);
  } catch (err) {
    console.error(
      warn(`Could not open a browser automatically: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

export async function runLogin(args: MCPLoginArgs, deps: MCPCliDeps = {}): Promise<void> {
  const { url: resourceUrl, label } = resolveTarget(args.target, args.mcpConfigPath);
  const scopes = args.scope?.split(/\s+/).filter((s) => s.length > 0);

  await runAuth(
    mcpLogin(resourceUrl, {
      ...(deps.store !== undefined ? { store: deps.store } : {}),
      // Recorded in the login metadata so `status` (and Cortex) can show it.
      ...(args.target.kind === "name" ? { name: args.target.value } : {}),
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      scopes,
      redirectPort: args.redirectPort,
      timeoutMs: args.timeoutMs,
      // The CLI opens the browser itself so a launch failure prints a warning
      // instead of being swallowed.
      onAuthorizationUrl:
        deps.onAuthorizationUrl ?? ((url: URL) => defaultOnAuthorizationUrl(url, args.noBrowser)),
      openBrowser: false,
    }),
  );

  console.log(success(`Logged in to "${label}" (${resourceUrl}).`));
}

// ─── `logout` ───────────────────────────────────────────────────────────────

/** Warning for a revocation outcome worth telling the user about; local credentials are deleted regardless. */
function revocationWarning(result: McpLogoutResult): string | undefined {
  switch (result.revocation) {
    case "failed":
      return `Token revocation failed (${result.revocationDetail ?? "unknown error"}) — deleted local credentials anyway.`;
    case "insecure-endpoint":
      return "Skipped token revocation — the authorization server or its revocation endpoint is not HTTPS and is not a loopback address — deleted local credentials anyway.";
    case "revoked":
    case "unsupported":
    case "none":
      return undefined;
  }
}

export async function runLogout(args: MCPLogoutArgs, deps: MCPCliDeps = {}): Promise<void> {
  const { url: resourceUrl, label } = resolveTarget(args.target, args.mcpConfigPath);
  const result = await runAuth(
    mcpLogout(resourceUrl, deps.store !== undefined ? { store: deps.store } : {}),
  );

  if (!result.removed) {
    console.log(info(`No stored credentials for "${label}" (${resourceUrl}).`));
    return;
  }
  const warning = revocationWarning(result);
  if (warning !== undefined) console.error(warn(warning));
  console.log(success(`Logged out of "${label}" (${resourceUrl}).`));
}

// ─── `status` ───────────────────────────────────────────────────────────────

function formatExpiry(login: McpLoginSummary): string {
  if (login.status === "expired") return "expired";
  if (login.expiresAt === undefined) return "unknown";
  const remainingSeconds = Math.round((login.expiresAt - Date.now()) / 1000);
  return remainingSeconds > 0 ? `expires in ${remainingSeconds}s` : "expired";
}

export async function runStatus(_args: MCPStatusArgs, deps: MCPCliDeps = {}): Promise<void> {
  const logins = await runAuth(listMcpLogins(deps.store !== undefined ? { store: deps.store } : {}));

  if (logins.length === 0) {
    console.log(info("No stored MCP OAuth credentials."));
    return;
  }

  console.log(section("MCP OAuth credentials"));
  for (const login of logins) {
    // `McpLoginSummary` carries no token values — only derived, non-secret facts.
    if (login.name !== undefined) console.log(kv("Name", login.name));
    console.log(kv("Resource", login.url));
    console.log(kv("Status", login.status));
    console.log(kv("Scope", login.scopes.length > 0 ? login.scopes.join(" ") : "(none)"));
    console.log(kv("Expiry", formatExpiry(login)));
    console.log(kv("Refresh token", login.hasRefreshToken ? "yes" : "no"));
    console.log("");
  }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

const HELP = `
  Usage: rax mcp <subcommand> [options]

  Manage OAuth credentials for remote MCP servers.

  Subcommands:
    login <name|--url <endpoint>> [options]   Run the authorization_code login flow
    logout <name|--url <endpoint>>            Delete stored credentials (revokes if possible)
    status                                    List stored credentials (never prints tokens)

  login options:
    --client-id <id>       Statically registered client ID (default: dynamic client registration)
    --client-secret <s>    Client secret, for confidential-client authorization servers
    --scope <scope>        OAuth scope to request
    --redirect-port <port> Fixed loopback callback port (default: ephemeral) — required by
                            authorization servers that validate an exact pre-registered
                            redirect_uri; register http://127.0.0.1:<port>/callback there
    --no-browser           Don't launch a browser — still prints the authorization URL and waits
    --timeout <ms>         Authorization callback timeout in milliseconds (default: 300000)
    --mcp-config <path>    Path to MCP server config JSON (default: .rax/mcp.json)

  logout options:
    --mcp-config <path>   Path to MCP server config JSON (default: .rax/mcp.json)

  Examples:
    rax mcp login docs-server
    rax mcp login --url https://mcp.example.com/mcp --client-id my-client --scope "read write"
    rax mcp login docs-server --no-browser
    rax mcp logout docs-server
    rax mcp status
`.trimEnd();

export async function runMcp(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;

  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP);
    return;
  }

  switch (sub) {
    case "login": {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(HELP);
        return;
      }
      await runLogin(parseLoginArgs(rest));
      return;
    }
    case "logout": {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(HELP);
        return;
      }
      await runLogout(parseLogoutArgs(rest));
      return;
    }
    case "status": {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(HELP);
        return;
      }
      await runStatus(parseStatusArgs(rest));
      return;
    }
    default:
      console.error(fail(`Unknown mcp subcommand: ${sub}`));
      console.log(HELP);
      process.exit(1);
  }
}
