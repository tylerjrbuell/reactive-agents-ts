/**
 * MCP OAuth sign-in for saved Cortex servers. Cortex renders and wires the framework's flow
 * (`mcpLogin`, `mcpAuthStatus`, `mcpLogout`, `listMcpLogins` from `@reactive-agents/tools`); it
 * keeps no token, key derivation or file format of its own. The token store is the framework
 * default (`~/.reactive-agents/mcp-auth`), the same one `rax mcp login` writes and every agent's
 * MCP connect reads, so one login serves the CLI, Cortex and agents.
 *
 * - {@link oauthTargetOf}: which saved servers can sign in (HTTP transport with an endpoint, no
 *   explicit `Authorization` header, `auth` absent or `authorization_code`), and the login options
 *   their saved config implies.
 * - {@link makeMcpSignIns}: the sign-in flows, single-flight per server. `start` answers as soon as
 *   the framework hands over the authorization URL (`onAuthorizationUrl`); the loopback redirect
 *   finishes the login in the background and the page polls the status. Loopback only: Cortex has no
 *   callback route.
 *
 * Nothing here returns a token value: every wire shape is built from the framework's derived facts.
 */
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  canonicalResourceKey,
  listMcpLogins,
  mcpAuthStatus,
  mcpLogin,
  mcpLogout,
  type McpAuthStatus,
  type McpAuthStoreError,
  type McpLoginError,
  type McpLoginOptions,
  type McpLoginResult,
  type McpLoginSummary,
  type McpLogoutResult,
  type MCPTokenStore,
} from "@reactive-agents/tools";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { sanitizedCause } from "./channel-hub-failure.js";

/** The framework calls this module uses; tests pass a memory token store. */
export interface McpOAuthApi {
  readonly login: (endpoint: string, options: McpLoginOptions) => Effect.Effect<McpLoginResult, McpLoginError>;
  readonly status: (endpoint: string) => Effect.Effect<McpAuthStatus, McpAuthStoreError>;
  readonly logout: (endpoint: string) => Effect.Effect<McpLogoutResult, McpAuthStoreError>;
  readonly list: () => Effect.Effect<readonly McpLoginSummary[], McpAuthStoreError>;
}

/** The framework API over `store` (omitted: the framework default file store). */
export function frameworkMcpOAuth(store?: MCPTokenStore): McpOAuthApi {
  const opt = store === undefined ? {} : { store };
  return {
    login: (endpoint, options) => mcpLogin(endpoint, { ...options, ...opt }),
    status: (endpoint) => mcpAuthStatus(endpoint, opt),
    logout: (endpoint) => mcpLogout(endpoint, opt),
    list: () => listMcpLogins(opt),
  };
}

/** A saved server that can sign in, and the login options its saved config implies. */
export interface McpOAuthTarget {
  readonly endpoint: string;
  readonly transport: "streamable-http" | "sse";
  readonly name: string;
  readonly options: Omit<McpLoginOptions, "store" | "onAuthorizationUrl" | "openBrowser">;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * The sign-in target of a saved server, or null when sign-in does not apply: a stdio server, no
 * endpoint, an explicit `Authorization` header (the caller's chosen credential), `auth: false`, or a
 * machine grant (`client_credentials`, `private_key_jwt`, `provider`). Mirrors the framework's
 * stored-login rule (`storedLoginAuthConfig`), plus a saved `authorization_code` config.
 */
export function oauthTargetOf(cfg: MCPServerConfig): McpOAuthTarget | null {
  const transport = cfg.transport;
  if (transport !== "streamable-http" && transport !== "sse") return null;
  const endpoint = str(cfg.endpoint);
  if (endpoint === undefined) return null;
  if (Object.keys(cfg.headers ?? {}).some((k) => k.toLowerCase() === "authorization")) return null;
  const auth: unknown = cfg.auth;
  if (auth !== undefined && !(isRecord(auth) && auth.type === "authorization_code")) return null;
  const a = isRecord(auth) ? auth : {};
  const clientId = str(a.clientId);
  const clientSecret = str(a.clientSecret);
  const scope = str(a.scope);
  const redirectPort = num(a.redirectPort);
  const timeoutMs = num(a.timeoutMs);
  return {
    endpoint,
    transport,
    name: cfg.name,
    options: {
      name: cfg.name,
      transport,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(clientSecret !== undefined ? { clientSecret } : {}),
      ...(scope !== undefined ? { scopes: scope.split(/\s+/).filter(Boolean) } : {}),
      ...(redirectPort !== undefined ? { redirectPort } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

/** The store key of an endpoint, or null for a URL the framework cannot key. */
export const resourceKeyOf = (endpoint: string): string | null => {
  try {
    return canonicalResourceKey(endpoint);
  } catch {
    return null;
  }
};

/** A sign-in that is waiting for the browser, or the last one that failed. */
export type McpSignInState =
  | { readonly phase: "pending"; readonly authorizationUrl: string; readonly startedAt: number }
  | { readonly phase: "failed"; readonly error: string; readonly at: number };

/** What `start` answers. */
export type McpSignInStart =
  | { readonly status: "pending"; readonly authorizationUrl: string; readonly startedAt: number }
  | { readonly status: "signed-in" }
  | { readonly status: "failed"; readonly error: string };

/** The sign-in flows of one Cortex server process. */
export interface McpSignIns {
  /** Start (or join) the sign-in of `serverId`. Answers once the authorization URL exists, or the flow ended first. */
  readonly start: (serverId: string, target: McpOAuthTarget) => Promise<McpSignInStart>;
  /** Stop a pending sign-in (closes the loopback listener). True when one was running. */
  readonly cancel: (serverId: string) => Promise<boolean>;
  /** The pending or last failed sign-in of `serverId`. */
  readonly stateOf: (serverId: string) => McpSignInState | undefined;
  /** Forget a server's state (it was deleted or signed out). Stops a pending flow. */
  readonly forget: (serverId: string) => Promise<void>;
}

/** Longest wait for the authorization server to hand over the URL (discovery + registration). */
export const SIGN_IN_URL_WAIT_MS = 30_000;
/** Default time for the person to finish in the browser (the framework's own default). */
export const SIGN_IN_TIMEOUT_MS = 300_000;

interface Flow {
  readonly fiber: Fiber.RuntimeFiber<McpLoginResult, McpLoginError>;
  readonly answer: Promise<McpSignInStart>;
}

/** Build the flows over `api`. */
export function makeMcpSignIns(api: McpOAuthApi, opts: { readonly urlWaitMs?: number } = {}): McpSignIns {
  const urlWaitMs = opts.urlWaitMs ?? SIGN_IN_URL_WAIT_MS;
  const flows = new Map<string, Flow>();
  const states = new Map<string, McpSignInState>();

  const failureText = (exit: Exit.Exit<McpLoginResult, McpLoginError>): string => {
    if (Exit.isSuccess(exit)) return "";
    if (Cause.isInterruptedOnly(exit.cause)) return "Sign-in was cancelled.";
    return sanitizedCause(Cause.squash(exit.cause));
  };

  const start = (serverId: string, target: McpOAuthTarget): Promise<McpSignInStart> => {
    const running = flows.get(serverId);
    if (running) return running.answer;

    let deliver: (url: URL) => void = () => undefined;
    const urlArrived = new Promise<URL>((resolve) => {
      deliver = resolve;
    });
    const fiber = Effect.runFork(
      api.login(target.endpoint, {
        ...target.options,
        timeoutMs: target.options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
        openBrowser: false,
        onAuthorizationUrl: (url) => deliver(url),
      }),
    );
    const done = Effect.runPromise(Fiber.await(fiber));
    states.delete(serverId);

    // When the flow ends: success leaves the store as the answer; failure is kept for the page.
    // A flow already taken out of `flows` (cancelled, or timed out below) writes nothing.
    void done.then((exit) => {
      if (flows.get(serverId)?.fiber !== fiber) return;
      flows.delete(serverId);
      if (Exit.isSuccess(exit)) states.delete(serverId);
      else states.set(serverId, { phase: "failed", error: failureText(exit), at: Date.now() });
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const tooSlow = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), urlWaitMs);
    });
    const answer = Promise.race([urlArrived, done, tooSlow]).then(async (first): Promise<McpSignInStart> => {
      clearTimeout(timer);
      if (first === "timeout") {
        if (flows.get(serverId)?.fiber === fiber) flows.delete(serverId);
        await Effect.runPromise(Fiber.interrupt(fiber));
        const error = "The authorization server did not answer in time.";
        states.set(serverId, { phase: "failed", error, at: Date.now() });
        return { status: "failed", error };
      }
      if (first instanceof URL) {
        const pending = { phase: "pending" as const, authorizationUrl: first.toString(), startedAt: Date.now() };
        if (flows.get(serverId)?.fiber === fiber) states.set(serverId, pending);
        return { status: "pending", authorizationUrl: pending.authorizationUrl, startedAt: pending.startedAt };
      }
      return Exit.isSuccess(first) ? { status: "signed-in" } : { status: "failed", error: failureText(first) };
    });
    flows.set(serverId, { fiber, answer });
    return answer;
  };

  const cancel = async (serverId: string): Promise<boolean> => {
    const flow = flows.get(serverId);
    if (!flow) return false;
    flows.delete(serverId);
    states.delete(serverId);
    await Effect.runPromise(Fiber.interrupt(flow.fiber));
    return true;
  };

  return {
    start,
    cancel,
    stateOf: (serverId) => {
      const s = states.get(serverId);
      // A pending state outlives its flow only between the flow ending and the `then` above.
      return s?.phase === "pending" && !flows.has(serverId) ? undefined : s;
    },
    forget: async (serverId) => {
      await cancel(serverId);
      states.delete(serverId);
    },
  };
}

/** One server's sign-in state on the wire. Never carries a token value. */
export interface McpServerAuthWire {
  /** `signed-in` / `expired` / `absent`: the framework's store state for this server's URL. */
  readonly state: McpAuthStatus["state"];
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
  /** The last Test or Refresh failed because the server wants a login. */
  readonly authRequired: boolean;
  /** A sign-in waiting for the browser, or the last one that failed. */
  readonly signIn?: McpSignInState;
}

/** A stored login no saved Cortex server uses (e.g. made with `rax mcp login`). Never carries a token value. */
export interface McpLoginWire {
  readonly resourceKey: string;
  readonly url: string;
  readonly name?: string;
  readonly transport?: "streamable-http" | "sse";
  readonly status: McpLoginSummary["status"];
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/** The non-secret wire view of a framework status (spelled out field by field, so nothing else rides along). */
export function authWireOf(status: McpAuthStatus, authRequired: boolean, signIn: McpSignInState | undefined): McpServerAuthWire {
  return {
    state: status.state,
    ...(status.expiresAt !== undefined ? { expiresAt: status.expiresAt } : {}),
    scopes: [...status.scopes],
    hasRefreshToken: status.hasRefreshToken,
    // A store that holds a login answers the question: the old failure was before the login.
    authRequired: authRequired && status.state === "absent",
    ...(signIn !== undefined ? { signIn } : {}),
  };
}

/** The logins in `logins` whose URL no saved server uses, as wire rows. */
export function unusedLoginsOf(logins: readonly McpLoginSummary[], usedKeys: ReadonlySet<string>): McpLoginWire[] {
  return logins
    .filter((l) => !usedKeys.has(l.resourceKey))
    .map((l) => ({
      resourceKey: l.resourceKey,
      url: l.url,
      ...(l.name !== undefined ? { name: l.name } : {}),
      ...(l.transport !== undefined ? { transport: l.transport } : {}),
      status: l.status,
      ...(l.expiresAt !== undefined ? { expiresAt: l.expiresAt } : {}),
      scopes: [...l.scopes],
      hasRefreshToken: l.hasRefreshToken,
    }));
}
