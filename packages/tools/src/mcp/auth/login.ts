/**
 * MCP client OAuth — public interactive sign-in API.
 *
 * `mcpLogin` / `mcpAuthStatus` / `mcpLogout` are the builder-facing entry
 * points for user-delegated MCP OAuth (authorization code + PKCE over a
 * loopback redirect). They were lifted out of `apps/cli`'s `rax mcp login |
 * status | logout` so any host (the CLI, Cortex, a builder's own server app)
 * drives the SAME flow `mcp-client.ts`'s `connect()` uses:
 *
 * - The provider is `createAuthProvider` (hardened per `hardened-provider.ts`:
 *   issuer mix-up and plaintext-endpoint refusal, secret redaction), so state
 *   + PKCE + RFC 9207 `iss` checks all live in the loopback listener.
 * - Credentials are persisted by that provider under
 *   {@link canonicalResourceKey}, in whatever {@link MCPTokenStore} the caller
 *   passes (default {@link createFileTokenStore}, `~/.reactive-agents/mcp-auth`).
 *   No key derivation or file format lives here, so a token from any earlier
 *   `rax mcp login` is read back unchanged.
 *
 * Token values never leave this module: results carry only derived facts
 * (expiry, scopes, whether a refresh token exists), and every surfaced error
 * message goes through the provider's redactor.
 */
import {
  auth,
  discoverOAuthServerInfo,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Data, Effect } from "effect";
import type { MCPServer } from "../../types.js";
import { validateAuthEndpointIsHttps } from "../mcp-client.js";
import type { AuthorizationCodeProviderExtra } from "./authorization-code-provider.js";
import { createAuthProvider } from "./create-provider.js";
import { hasRedactor, isHttpsOrLoopback, redactBearerTokens } from "./hardened-provider.js";
import { openBrowser as defaultOpenBrowser } from "./open-browser.js";
import { canonicalResourceKey, createFileTokenStore } from "./token-store.js";
import type { McpLoginMetadata, MCPTokenStore, StoredMcpCredentials } from "./types.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

/** `mcpLogin` failed: bad endpoint, refused/broken authorization server, timeout, or store IO. */
export class McpLoginError extends Data.TaggedError("McpLoginError")<{
  /** The endpoint passed to `mcpLogin`. */
  readonly endpoint: string;
  /** Human-readable reason, already redacted of every observed secret. */
  readonly message: string;
}> {}

/** Reading or deleting stored MCP credentials failed (unreadable file, refused permissions, bad URL). */
export class McpAuthStoreError extends Data.TaggedError("McpAuthStoreError")<{
  readonly endpoint: string;
  readonly message: string;
}> {}

// ─── Public types ────────────────────────────────────────────────────────────

/** Options shared by `mcpLogin`, `mcpAuthStatus` and `mcpLogout`. */
export interface McpAuthStoreOptions {
  /** Credential store. Default: `createFileTokenStore()` (`~/.reactive-agents/mcp-auth`). */
  readonly store?: MCPTokenStore;
}

/** Options for {@link mcpLogin}. */
export interface McpLoginOptions extends McpAuthStoreOptions {
  /** Label used in error messages. Default: the endpoint. */
  readonly name?: string;
  /** Statically registered client ID. Omitted: dynamic client registration. */
  readonly clientId?: string;
  /** Client secret, for confidential-client authorization servers. */
  readonly clientSecret?: string;
  /** Scopes to request (sent space-separated). */
  readonly scopes?: readonly string[];
  /** Fixed loopback callback port. Default: ephemeral. Register `http://127.0.0.1:<port>/callback` with the server. */
  readonly redirectPort?: number;
  /** How long to wait for the redirect, in milliseconds. Default: 300_000. */
  readonly timeoutMs?: number;
  /**
   * Receives the authorization URL the user must open. Use it to show the
   * link in your own UI. When set, no browser is opened unless
   * `openBrowser: true`.
   */
  readonly onAuthorizationUrl?: (url: URL) => void | Promise<void>;
  /** Open the system browser. Default: `true` without `onAuthorizationUrl`, `false` with it. */
  readonly openBrowser?: boolean;
  /** Transport recorded in the login metadata for listing. Default: `streamable-http`. */
  readonly transport?: "streamable-http" | "sse";
}

/** One stored login, as listed by {@link listMcpLogins}. Never contains token values. */
export interface McpLoginSummary {
  readonly resourceKey: string;
  /** The endpoint the login was made for. */
  readonly url: string;
  /** Present when the login was made with `mcpLogin({ name })`. */
  readonly name?: string;
  readonly transport?: "streamable-http" | "sse";
  readonly status: "signed-in" | "expired";
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/** What a successful {@link mcpLogin} stored. Never contains token values. */
export interface McpLoginResult {
  /** Store key ({@link canonicalResourceKey} of the endpoint). */
  readonly resourceKey: string;
  readonly resourceUrl: string;
  /** Access-token expiry (epoch ms), when the server reported `expires_in`. */
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/** Sign-in state for one MCP endpoint. Never contains token values. */
export interface McpAuthStatus {
  /** `signed-in`: a stored, unexpired access token. `expired`: past `expiresAt` (a refresh may still work). `absent`: no stored token. */
  readonly state: "signed-in" | "expired" | "absent";
  readonly resourceKey: string;
  readonly resourceUrl: string;
  readonly name?: string;
  readonly transport?: "streamable-http" | "sse";
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/** Options for {@link mcpLogout}. */
export interface McpLogoutOptions extends McpAuthStoreOptions {
  /** Try RFC 7009 revocation of the refresh token before deleting it. Default: `true`. */
  readonly revoke?: boolean;
}

/**
 * Outcome of the revocation attempt. Local credentials are deleted in every case.
 * `none`: nothing to revoke (no record, no refresh token, or `revoke: false`).
 * `unsupported`: the server advertises no revocation endpoint.
 * `insecure-endpoint`: refused to send the token over plaintext to a non-loopback host.
 */
export type McpRevocation = "revoked" | "none" | "unsupported" | "insecure-endpoint" | "failed";

/** Result of {@link mcpLogout}. */
export interface McpLogoutResult {
  readonly resourceKey: string;
  /** `true` when a stored record existed and was deleted. */
  readonly removed: boolean;
  readonly revocation: McpRevocation;
  /** Why revocation failed (redacted), when `revocation` is `failed`. */
  readonly revocationDetail?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Message of any thrown value, without relying on an identity check against the Error class. */
const messageOf = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const { message } = cause;
    if (typeof message === "string") return message;
  }
  return String(cause);
};

/** Narrows a provider built from an authorization_code config to its listener handle. */
const hasAuthorizationCodeExtras = (
  provider: OAuthClientProvider,
): provider is OAuthClientProvider & AuthorizationCodeProviderExtra => {
  const candidate = provider as Partial<AuthorizationCodeProviderExtra>;
  return (
    typeof candidate.waitForAuthorizationCode === "function" &&
    typeof candidate.disposeAuthorizationListener === "function"
  );
};

const scopesOf =(stored: StoredMcpCredentials | undefined): readonly string[] =>
  (stored?.tokens?.scope ?? "").split(" ").filter((s) => s.length > 0);

const expiresAtOf = (stored: StoredMcpCredentials): number | undefined => {
  const expiresIn = stored.tokens?.expires_in;
  return expiresIn === undefined ? undefined : stored.savedAt + expiresIn * 1000;
};

const keyFor = (endpoint: string): Effect.Effect<string, McpAuthStoreError> =>
  Effect.try({
    try: () => canonicalResourceKey(endpoint),
    catch: (cause) =>
      new McpAuthStoreError({ endpoint, message: `"${endpoint}" is not a valid URL: ${messageOf(cause)}` }),
  });

const readStored = (
  store: MCPTokenStore,
  key: string,
  endpoint: string,
): Effect.Effect<StoredMcpCredentials | undefined, McpAuthStoreError> =>
  Effect.tryPromise({
    try: () => store.get(key),
    catch: (cause) => new McpAuthStoreError({ endpoint, message: messageOf(cause) }),
  });

// ─── mcpLogin ────────────────────────────────────────────────────────────────

/**
 * Interactive OAuth sign-in to a remote MCP server: discovery, dynamic client
 * registration (when `clientId` is omitted), authorization code + PKCE (S256)
 * with a fresh `state`, redirect to a loopback listener on `127.0.0.1`, token
 * exchange. Tokens are saved to `store` under `canonicalResourceKey(endpoint)`,
 * where a later `connect()` to the same endpoint picks them up.
 *
 * The endpoint must be HTTPS unless it is a loopback address. Interrupting the
 * effect closes the loopback listener.
 *
 * @example
 * ```ts
 * const result = await Effect.runPromise(
 *   mcpLogin("https://mcp.example.com/mcp", {
 *     onAuthorizationUrl: (url) => showLinkToUser(url.toString()),
 *   }),
 * );
 * // result.expiresAt, result.scopes: no token values
 * ```
 */
export const mcpLogin = (
  endpoint: string,
  options: McpLoginOptions = {},
): Effect.Effect<McpLoginResult, McpLoginError> =>
  Effect.gen(function* () {
    const label = options.name ?? endpoint;
    const fail = (message: string): McpLoginError =>
      new McpLoginError({ endpoint, message: `MCP login "${label}" failed: ${message}` });

    yield* Effect.try({
      try: () => validateAuthEndpointIsHttps(label, endpoint),
      catch: (cause) => fail(messageOf(cause)),
    });

    const callback = options.onAuthorizationUrl;
    const launchBrowser = options.openBrowser ?? callback === undefined;
    if (callback === undefined && !launchBrowser) {
      return yield* Effect.fail(
        fail("no way to deliver the authorization URL: pass onAuthorizationUrl or leave openBrowser on"),
      );
    }

    const scope = options.scopes && options.scopes.length > 0 ? options.scopes.join(" ") : undefined;
    const store = options.store ?? createFileTokenStore();

    const deliverUrl = async (url: URL): Promise<void> => {
      if (callback) await callback(url);
      if (!launchBrowser) return;
      // With a callback the user already has the link; a missing browser is
      // not fatal. Without one, the browser is the only channel, so its
      // failure must end the login now instead of after the timeout.
      await defaultOpenBrowser(url).catch((cause: unknown) => {
        if (callback === undefined) throw cause;
      });
    };

    const server: MCPServer = {
      name: label,
      version: "1.0.0",
      transport: "streamable-http",
      endpoint,
      tools: [],
      status: "disconnected",
      auth: {
        type: "authorization_code",
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        scope,
        interactive: true,
        timeoutMs: options.timeoutMs,
        redirectPort: options.redirectPort,
        onAuthorizationUrl: deliverUrl,
      },
    };

    const provider = yield* Effect.try({
      try: () => createAuthProvider(server, store),
      catch: (cause) => fail(messageOf(cause)),
    });
    if (!provider || !hasAuthorizationCodeExtras(provider)) {
      return yield* Effect.fail(fail("could not build an authorization_code provider"));
    }
    const redact = (message: string): string =>
      hasRedactor(provider) ? provider.redactSecrets(message) : redactBearerTokens(message);

    yield* Effect.tryPromise({
      try: async () => {
        let result = await auth(provider, { serverUrl: endpoint, scope });
        if (result === "REDIRECT") {
          const authorizationCode = await provider.waitForAuthorizationCode();
          result = await auth(provider, { serverUrl: endpoint, authorizationCode, scope });
        }
        return result;
      },
      catch: (cause) => fail(redact(messageOf(cause))),
    }).pipe(
      Effect.flatMap((result) =>
        result === "AUTHORIZED"
          ? Effect.void
          : Effect.fail(fail(`authorization did not complete (got "${result}")`)),
      ),
      Effect.ensuring(
        Effect.promise(() =>
          provider.disposeAuthorizationListener().catch(() => {
            /* best-effort: the login outcome above is what the caller needs */
          }),
        ),
      ),
    );

    const resourceKey = canonicalResourceKey(endpoint);
    const stored = yield* readStored(store, resourceKey, endpoint).pipe(
      Effect.mapError((e) => fail(redact(e.message))),
    );
    if (!stored?.tokens) {
      return yield* Effect.fail(fail("the authorization server returned no tokens"));
    }
    const login: McpLoginMetadata = {
      transport: options.transport ?? "streamable-http",
      savedAt: Date.now(),
      ...(options.name !== undefined ? { name: options.name } : {}),
      ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
    };
    yield* Effect.tryPromise({
      try: () => store.set(resourceKey, { ...stored, login }),
      catch: (cause) => fail(redact(messageOf(cause))),
    });
    return {
      resourceKey,
      resourceUrl: endpoint,
      expiresAt: expiresAtOf(stored),
      scopes: scopesOf(stored),
      hasRefreshToken: stored.tokens.refresh_token !== undefined,
    };
  });

// ─── mcpAuthStatus / listMcpLogins ───────────────────────────────────────────

/** Derived, non-secret view of a record that holds tokens. */
const describeLogin = (resourceKey: string, stored: StoredMcpCredentials): McpLoginSummary => {
  const expiresAt = expiresAtOf(stored);
  return {
    resourceKey,
    url: stored.resourceUrl,
    status: expiresAt !== undefined && expiresAt <= Date.now() ? "expired" : "signed-in",
    scopes: scopesOf(stored),
    hasRefreshToken: stored.tokens?.refresh_token !== undefined,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(stored.login?.name !== undefined ? { name: stored.login.name } : {}),
    ...(stored.login?.transport !== undefined ? { transport: stored.login.transport } : {}),
  };
};

/**
 * Reports whether `store` holds a usable token for `endpoint`. Reads only the
 * store; no network call. `expired` means the access token is past its
 * reported lifetime; when `hasRefreshToken` is true, the next `connect()` may
 * still refresh it without a new login.
 */
export const mcpAuthStatus = (
  endpoint: string,
  options: McpAuthStoreOptions = {},
): Effect.Effect<McpAuthStatus, McpAuthStoreError> =>
  Effect.gen(function* () {
    const resourceKey = yield* keyFor(endpoint);
    const stored = yield* readStored(options.store ?? createFileTokenStore(), resourceKey, endpoint);
    if (!stored?.tokens) {
      return { state: "absent", resourceKey, resourceUrl: stored?.resourceUrl ?? endpoint, scopes: [], hasRefreshToken: false };
    }
    const { status, url, ...rest } = describeLogin(resourceKey, stored);
    return { state: status, resourceUrl: url, ...rest };
  });

/**
 * Every stored MCP login in `store`, signed-in or expired. Records without
 * tokens (e.g. only a registered client) are skipped. Logins saved before
 * login metadata existed are listed too, without `name` / `transport`.
 * Never returns token values.
 */
export const listMcpLogins = (
  options: McpAuthStoreOptions = {},
): Effect.Effect<readonly McpLoginSummary[], McpAuthStoreError> =>
  Effect.gen(function* () {
    const store = options.store ?? createFileTokenStore();
    const keys = yield* Effect.tryPromise({
      try: () => store.list(),
      catch: (cause) => new McpAuthStoreError({ endpoint: "", message: messageOf(cause) }),
    });
    const logins: McpLoginSummary[] = [];
    for (const key of keys) {
      const stored = yield* readStored(store, key, key);
      if (stored?.tokens) logins.push(describeLogin(key, stored));
    }
    return logins;
  });

// ─── mcpLogout ───────────────────────────────────────────────────────────────

interface RevocationOutcome {
  readonly revocation: McpRevocation;
  readonly detail?: string;
}

/**
 * Best-effort RFC 7009 revocation. Never fails: an outage, a missing endpoint
 * or a plaintext non-loopback endpoint all return an outcome, and the caller
 * deletes local credentials regardless. Both the authorization-server URL and
 * the revocation endpoint are checked BEFORE any request carries the refresh
 * token or client secret.
 */
async function revokeRefreshToken(endpoint: string, stored: StoredMcpCredentials): Promise<RevocationOutcome> {
  const refreshToken = stored.tokens?.refresh_token;
  if (!refreshToken) return { revocation: "none" };
  const clientSecret = stored.clientInformation?.client_secret;
  const redact = (message: string): string => {
    let out = message.split(refreshToken).join("[REDACTED]");
    if (clientSecret) out = out.split(clientSecret).join("[REDACTED]");
    return redactBearerTokens(out);
  };

  let serverInfo;
  try {
    serverInfo = await discoverOAuthServerInfo(endpoint);
  } catch (cause) {
    return { revocation: "failed", detail: redact(`discovery failed: ${messageOf(cause)}`) };
  }
  if (!isHttpsOrLoopback(serverInfo.authorizationServerUrl)) return { revocation: "insecure-endpoint" };

  const metadata = serverInfo.authorizationServerMetadata;
  const revocationEndpoint = metadata && "revocation_endpoint" in metadata ? metadata.revocation_endpoint : undefined;
  if (!revocationEndpoint) return { revocation: "unsupported" };
  if (!isHttpsOrLoopback(revocationEndpoint)) return { revocation: "insecure-endpoint" };

  const body = new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" });
  const clientId = stored.clientInformation?.client_id;
  if (clientId) body.set("client_id", clientId);
  if (clientSecret) body.set("client_secret", clientSecret);

  try {
    const res = await fetch(revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    return res.ok ? { revocation: "revoked" } : { revocation: "failed", detail: `HTTP ${res.status}` };
  } catch (cause) {
    return { revocation: "failed", detail: redact(messageOf(cause)) };
  }
}

/**
 * Signs out of `endpoint`: revokes the refresh token when the server supports
 * it (unless `revoke: false`), then deletes the stored credentials. A
 * revocation outage never blocks the local delete.
 */
export const mcpLogout = (
  endpoint: string,
  options: McpLogoutOptions = {},
): Effect.Effect<McpLogoutResult, McpAuthStoreError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => validateAuthEndpointIsHttps(endpoint, endpoint),
      catch: (cause) => new McpAuthStoreError({ endpoint, message: messageOf(cause) }),
    });
    const resourceKey = yield* keyFor(endpoint);
    const store = options.store ?? createFileTokenStore();
    const stored = yield* readStored(store, resourceKey, endpoint);
    if (!stored) return { resourceKey, removed: false, revocation: "none" };

    const outcome: RevocationOutcome =
      options.revoke === false
        ? { revocation: "none" }
        : yield* Effect.promise(() => revokeRefreshToken(endpoint, stored));

    yield* Effect.tryPromise({
      try: () => store.delete(resourceKey),
      catch: (cause) => new McpAuthStoreError({ endpoint, message: messageOf(cause) }),
    });
    return {
      resourceKey,
      removed: true,
      revocation: outcome.revocation,
      ...(outcome.detail !== undefined ? { revocationDetail: outcome.detail } : {}),
    };
  });
