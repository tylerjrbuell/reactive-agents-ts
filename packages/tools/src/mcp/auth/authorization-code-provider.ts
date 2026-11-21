/**
 * MCP client OAuth — interactive authorization-code grant.
 *
 * Part of Task 4 of `wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md`.
 *
 * Builds a real `@modelcontextprotocol/sdk` `OAuthClientProvider` for the
 * user-delegated authorization-code (+ PKCE) grant. Unlike Task 3's
 * machine-to-machine providers, this one can't just wrap an SDK-provided
 * class — the SDK ships no authorization-code `OAuthClientProvider`
 * implementation, because the redirect/browser/loopback-listener part is
 * inherently host-environment-specific. This file IS that implementation.
 *
 * Ordering constraint that shapes this file: the SDK's `auth()` orchestrator
 * reads `provider.redirectUrl` (a synchronous getter) to build the
 * authorization URL *before* it calls `provider.redirectToAuthorization(url)`.
 * A real redirect_uri must already be a live, listening loopback address by
 * that point, or the authorization server would redirect the browser
 * somewhere nothing is listening. The SDK gives us exactly one async hook
 * that fires earlier in the same call — `saveDiscoveryState`, invoked right
 * after RFC 9728/8414 discovery completes — so the loopback listener is
 * started from inside that hook (`interactive: true` only), not from
 * `redirectToAuthorization`. `saveDiscoveryState` is also the only hook that
 * ever sees the discovered authorization-server metadata, which is where
 * this file captures the RFC 9207 `issuer` / `authorization_response_iss_parameter_supported`
 * values the loopback listener needs (Task 0 finding: the installed SDK
 * does not implement RFC 9207 `iss` validation at all — assigned to this
 * task's listener, per the plan's Task 4 amendment).
 *
 * Non-interactive (`config.interactive !== true`): no listener is ever
 * started (checked inside `saveDiscoveryState`, a no-op when not
 * interactive), `redirectUrl` stays a placeholder that is never dialed, and
 * `redirectToAuthorization` — the SDK's own hook for "the user must now go
 * approve this" — throws a `rax mcp login <name>` error instead of doing
 * anything. This is a plain `Error`; the caller
 * (`packages/tools/src/mcp/mcp-client.ts`'s `connect` Effect) wraps *any*
 * thrown error from a connect attempt into `MCPConnectionError`, so the
 * caller-visible error is an `MCPConnectionError` either way — this file
 * doesn't need to import that class (a cross-package-boundary type this
 * deep in the auth internals would be an odd dependency to carry) to
 * satisfy that requirement.
 */
import { randomUUID } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { MCPServer } from "../../types.js";
import { canonicalResourceKey } from "./token-store.js";
import { markAuthRequired } from "../connection-failure.js";
import type { MCPAuthConfig, MCPTokenStore } from "./types.js";
import { openBrowser } from "./open-browser.js";
import { startLoopbackRedirectListener, type LoopbackListener } from "./loopback-redirect.js";

export type AuthorizationCodeConfig = Extract<MCPAuthConfig, { type: "authorization_code" }>;

export interface AuthorizationCodeProviderExtra {
  /**
   * Resolves with the authorization code once a valid callback reaches the
   * loopback listener (or rejects on timeout). Only meaningful when
   * `config.interactive === true` — throws synchronously otherwise (no
   * listener was ever started to wait on).
   */
  waitForAuthorizationCode(): Promise<string>;
  /**
   * Closes the loopback listener if one is active; a no-op otherwise. The
   * happy path (a valid callback, or a timeout) already self-closes the
   * listener — this exists for the OTHER failure paths the SDK's `auth()`
   * orchestrator can take after the listener has started but before a
   * callback ever arrives, e.g. `startAuthorization` itself rejecting an
   * authorization server that doesn't support S256 PKCE. Without this, that
   * kind of failure would leave an open, listening loopback socket (and a
   * live timeout keeping the process alive) for up to `config.timeoutMs`.
   * The caller (`mcp-client.ts`'s `connectHttpLike`) calls this on any
   * connect failure once a provider has been constructed.
   */
  disposeAuthorizationListener(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const CALLBACK_PATH = "/callback";

/**
 * Never dialed. A falsy `redirectUrl` tells the SDK's `auth()` orchestrator
 * this is a *non-interactive* grant (its literal check is
 * `const nonInteractiveFlow = !provider.redirectUrl`, the same test
 * `client_credentials`/`jwt-bearer` providers rely on to skip the redirect
 * branch entirely) — which is wrong for authorization_code with
 * `interactive: false`: that case must still reach `redirectToAuthorization`
 * so this file's own check can throw the `rax mcp login` error there. A
 * truthy placeholder keeps the SDK on the redirect branch without ever
 * starting a real listener.
 */
const NON_INTERACTIVE_PLACEHOLDER_REDIRECT_URL = "http://127.0.0.1:0/callback";

function loginHint(server: MCPServer): string {
  return `rax mcp login ${server.name}`;
}

/**
 * Builds an authorization-code `OAuthClientProvider` for `server`, backed by
 * `store` for both token and (when `config.clientId` is omitted / dynamic
 * client registration is used) client-information persistence.
 */
export function createAuthorizationCodeProvider(
  server: MCPServer,
  config: AuthorizationCodeConfig,
  store: MCPTokenStore,
): OAuthClientProvider & AuthorizationCodeProviderExtra {
  const resourceUrl = server.endpoint;
  if (!resourceUrl) {
    throw new Error(`MCP server "${server.name}": OAuth auth requires an "endpoint"`);
  }
  const key = canonicalResourceKey(resourceUrl);

  // Generated once per provider instance (i.e. once per connect attempt),
  // never reused across attempts — a fixed `state` would let an attacker
  // replay an old authorization response against a later listener.
  const csrfState = randomUUID();

  let expectedIssuer: string | undefined;
  let issParameterRequired = false;
  let listener: LoopbackListener | undefined;
  let redirectUrlValue = NON_INTERACTIVE_PLACEHOLDER_REDIRECT_URL;
  let codeVerifierValue: string | undefined;

  async function ensureListenerStarted(): Promise<void> {
    if (config.interactive !== true || listener) return;
    listener = await startLoopbackRedirectListener({
      port: config.redirectPort,
      path: CALLBACK_PATH,
      expectedState: csrfState,
      expectedIssuer,
      issParameterRequired,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    redirectUrlValue = listener.redirectUrl.toString();
  }

  return {
    get redirectUrl(): string {
      return redirectUrlValue;
    },

    clientMetadataUrl: config.clientMetadataUrl,

    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [redirectUrlValue],
        token_endpoint_auth_method: config.clientSecret ? "client_secret_post" : "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: config.scope,
        client_name: `reactive-agents (${server.name})`,
      };
    },

    // Fixed per provider instance — see `csrfState`'s own comment.
    state: (): string => csrfState,

    clientInformation: async (): Promise<OAuthClientInformationMixed | undefined> => {
      if (config.clientId) {
        return { client_id: config.clientId, client_secret: config.clientSecret };
      }
      const stored = await store.get(key);
      return stored?.clientInformation;
    },
    saveClientInformation: async (info: OAuthClientInformationMixed): Promise<void> => {
      // Statically configured client — nothing to persist; `clientInformation()`
      // above never reads the store in that case either.
      if (config.clientId) return;
      const existing = await store.get(key);
      await store.set(key, {
        tokens: existing?.tokens,
        clientInformation: info,
        discoveryState: existing?.discoveryState,
        login: existing?.login,
        resourceUrl,
        savedAt: Date.now(),
      });
    },

    tokens: async (): Promise<OAuthTokens | undefined> => {
      const stored = await store.get(key);
      return stored?.tokens;
    },
    saveTokens: async (newTokens: OAuthTokens): Promise<void> => {
      const existing = await store.get(key);
      await store.set(key, {
        tokens: newTokens,
        clientInformation: existing?.clientInformation,
        discoveryState: existing?.discoveryState,
        login: existing?.login,
        resourceUrl,
        savedAt: Date.now(),
      });
    },

    redirectToAuthorization: async (url: URL): Promise<void> => {
      if (config.interactive !== true) {
        // Tagged so the connect failure carries `reason: "auth-required"`.
        throw markAuthRequired(new Error(
          `MCP server "${server.name}": OAuth authorization is required but "interactive" is not enabled. Run \`${loginHint(server)}\` to log in.`,
        ));
      }
      if (config.onAuthorizationUrl) {
        await config.onAuthorizationUrl(url);
      } else {
        await openBrowser(url);
      }
    },

    saveCodeVerifier: (verifier: string): void => {
      codeVerifierValue = verifier;
    },
    codeVerifier: (): string => {
      if (!codeVerifierValue) {
        throw new Error(
          `MCP server "${server.name}": no PKCE code verifier saved for this authorization attempt`,
        );
      }
      return codeVerifierValue;
    },

    invalidateCredentials: async (scope): Promise<void> => {
      if (scope === "all") {
        await store.delete(key);
        return;
      }
      if (scope === "tokens") {
        const existing = await store.get(key);
        if (existing) {
          await store.set(key, { ...existing, tokens: undefined });
        }
      }
      // 'client' / 'verifier' / 'discovery': not exercised by this grant's
      // tests; 'all' above already covers full-record invalidation.
    },

    saveDiscoveryState: async (discoveryState): Promise<void> => {
      const metadata = discoveryState.authorizationServerMetadata;
      expectedIssuer = metadata?.issuer;
      // `authorization_response_iss_parameter_supported` (RFC 9207) is not a
      // named field on the SDK's `AuthorizationServerMetadata` type — its
      // backing schema is a `looseObject`, so the field survives at runtime
      // but isn't in the declared type. One narrow, explicit cast to read
      // it; every other field above is read through the declared type.
      const extra = metadata as Record<string, unknown> | undefined;
      issParameterRequired = extra?.["authorization_response_iss_parameter_supported"] === true;
      await ensureListenerStarted();
    },

    waitForAuthorizationCode: async (): Promise<string> => {
      if (!listener) {
        throw new Error(
          `MCP server "${server.name}": no authorization listener is active (interactive login was never started)`,
        );
      }
      return listener.code;
    },

    disposeAuthorizationListener: async (): Promise<void> => {
      await listener?.close();
    },
  };
}
