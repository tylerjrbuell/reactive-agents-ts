/**
 * MCP client OAuth — machine-to-machine provider construction.
 *
 * Part of Task 3 of `wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md`.
 *
 * Turns a `server.auth` config (Task 2's {@link MCPAuthConfig}) into a real
 * `@modelcontextprotocol/sdk` `OAuthClientProvider`, wired into an
 * {@link MCPTokenStore} so tokens survive across `connect()` calls (the SDK's
 * own `ClientCredentialsProvider`/`PrivateKeyJwtProvider` keep tokens in
 * memory only — see their `tokens()`/`saveTokens()` in
 * `@modelcontextprotocol/sdk/client/auth-extensions.js`, both synchronous,
 * both backed by a private instance field that dies with the provider
 * instance).
 *
 * `authorization_code` is Task 4's `createAuthorizationCodeProvider` — the
 * interactive, loopback-listener-backed grant (see
 * `./authorization-code-provider.ts`). The `default` branch below is the
 * actual exhaustiveness guard: every currently known `MCPAuthConfig["type"]`
 * has its own `case`, so `config` narrows to `never` in `default`. If a
 * future `MCPAuthConfig` variant is added without a corresponding `case`,
 * `default`'s `config` stops narrowing to `never` and the
 * `satisfies never` assignment fails to compile — a real type-checked
 * exhaustiveness check, not a runtime string comparison.
 */
import {
  ClientCredentialsProvider,
  PrivateKeyJwtProvider,
} from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { MCPServer } from "../../types.js";
import { createAuthorizationCodeProvider } from "./authorization-code-provider.js";
import { hardenProvider } from "./hardened-provider.js";
import { canonicalResourceKey } from "./token-store.js";
import type { MCPTokenStore } from "./types.js";

/**
 * Wraps an in-memory-only `OAuthClientProvider` (the SDK's M2M providers) so
 * `tokens()`/`saveTokens()` round-trip through `store` instead of (only) the
 * provider's private field.
 *
 * `tokens()` checks the store FIRST — this is what makes a second `connect()`
 * against the same resource reuse a persisted token without a network round
 * trip: `StreamableHTTPClientTransport._commonHeaders()` calls
 * `authProvider.tokens()` before every request and attaches it as a Bearer
 * header directly, without ever calling the SDK's `auth()` orchestrator (and
 * therefore without a token-endpoint POST) when `tokens()` already returns a
 * token.
 *
 * Every other `OAuthClientProvider` member is delegated to `inner` untouched
 * (`clientInformation`, `addClientAuthentication`, `prepareTokenRequest`,
 * etc. — the SDK's M2M providers implement these correctly already; only
 * token persistence is missing).
 */
function withPersistence(
  inner: OAuthClientProvider,
  store: MCPTokenStore,
  resourceUrl: string,
): OAuthClientProvider {
  const key = canonicalResourceKey(resourceUrl);

  return {
    get redirectUrl() {
      return inner.redirectUrl;
    },
    get clientMetadata() {
      return inner.clientMetadata;
    },
    clientMetadataUrl: inner.clientMetadataUrl,
    state: inner.state ? () => inner.state!() : undefined,

    clientInformation: () => inner.clientInformation(),
    saveClientInformation: inner.saveClientInformation
      ? (info) => inner.saveClientInformation!(info)
      : undefined,

    tokens: async (): Promise<OAuthTokens | undefined> => {
      const stored = await store.get(key);
      if (stored?.tokens) return stored.tokens;
      return await inner.tokens();
    },
    saveTokens: async (tokens: OAuthTokens): Promise<void> => {
      await inner.saveTokens(tokens);
      const existing = await store.get(key);
      await store.set(key, {
        tokens,
        clientInformation: existing?.clientInformation,
        discoveryState: existing?.discoveryState,
        login: existing?.login,
        resourceUrl,
        savedAt: Date.now(),
      });
    },

    redirectToAuthorization: (url) => inner.redirectToAuthorization(url),
    saveCodeVerifier: (verifier) => inner.saveCodeVerifier(verifier),
    codeVerifier: () => inner.codeVerifier(),

    addClientAuthentication: inner.addClientAuthentication,
    prepareTokenRequest: inner.prepareTokenRequest
      ? (scope) => inner.prepareTokenRequest!(scope)
      : undefined,
    validateResourceURL: inner.validateResourceURL
      ? (serverUrl, resource) => inner.validateResourceURL!(serverUrl, resource)
      : undefined,

    invalidateCredentials: async (scope) => {
      await inner.invalidateCredentials?.(scope);
      if (scope === "all" || scope === "tokens") {
        await store.delete(key);
      }
    },

    // Deliberately NOT implemented: the SDK's `OAuthClientProvider.discoveryState`/
    // `saveDiscoveryState` use the SDK's own `OAuthDiscoveryState` shape (RFC 9728
    // "authorizationServerUrl" + friends), which is a different, incompatible type
    // from this package's `OAuthDiscoveryState` (Task 2, `./types.ts` — a smaller,
    // MCPTokenStore-facing shape). `inner` (the SDK's own M2M provider classes)
    // doesn't implement these either — they're optional, and the M2M grant this
    // task covers doesn't need cross-connect discovery-state caching for its tests
    // to pass. Bridging the two shapes is left for whichever task next needs
    // discovery-state persistence.
  };
}

/** Server endpoint, required for any grant type that needs a store key or a resource URL. */
function requireEndpoint(server: MCPServer): string {
  if (!server.endpoint) {
    throw new Error(
      `MCP server "${server.name}": OAuth auth requires an "endpoint" (transport "${server.transport}" has none)`,
    );
  }
  return server.endpoint;
}

/**
 * Builds an `OAuthClientProvider` for `server`, or `undefined` when
 * `server.auth` is unset (today's static-header-token behavior — a caller
 * passing `headers: { Authorization: "Bearer ..." }` without `auth` — is
 * completely unaffected by this function; see `mcp-client.ts`'s
 * `createTransport`, which only reaches for this when `server.auth` exists).
 */
export function createAuthProvider(
  server: MCPServer,
  store: MCPTokenStore,
): OAuthClientProvider | undefined {
  const config = server.auth;
  if (!config) return undefined;

  switch (config.type) {
    case "provider":
      // Escape hatch: RA does not wrap a caller-supplied provider. The
      // caller owns its own security properties (token persistence,
      // refresh, etc.) — wrapping it here would be an unrequested and
      // possibly unwanted behavior change.
      return config.provider;

    case "client_credentials": {
      const inner = new ClientCredentialsProvider({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: config.scope,
        expectedIssuer: config.expectedIssuer,
      });
      // Hardened per Task 5 — closes Task 0's issuer-mix-up / HTTPS-downgrade
      // gaps and provides the error-message redactor `mcp-client.ts` uses.
      // Not applied to `type: "provider"` (see that case's own comment).
      return hardenProvider(withPersistence(inner, store, requireEndpoint(server)), {
        serverName: server.name,
      });
    }

    case "private_key_jwt": {
      const inner = new PrivateKeyJwtProvider({
        clientId: config.clientId,
        privateKey: config.privateKey,
        algorithm: config.algorithm,
        scope: config.scope,
        expectedIssuer: config.expectedIssuer,
      });
      return hardenProvider(withPersistence(inner, store, requireEndpoint(server)), {
        serverName: server.name,
      });
    }

    case "authorization_code":
      return hardenProvider(createAuthorizationCodeProvider(server, config, store), {
        serverName: server.name,
      });

    default: {
      // Exhaustiveness guard: every known `MCPAuthConfig["type"]` has a
      // `case` above, so `config` is `never` here. Adding a new variant to
      // `MCPAuthConfig` without a corresponding `case` breaks this
      // assignment at compile time.
      const _exhaustive = config satisfies never;
      throw new Error(
        `MCP server "${server.name}": unsupported auth type "${String((_exhaustive as { type?: unknown })?.type)}"`,
      );
    }
  }
}
