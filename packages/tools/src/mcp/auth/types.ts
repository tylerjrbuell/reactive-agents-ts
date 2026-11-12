/**
 * MCP client OAuth — config + persistence types.
 *
 * Part of Task 2 of `wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md`.
 * These types describe *configuration the caller supplies* (via
 * `MCPServerConfig.auth` / `MCPServer.auth`) and the *persisted-credential*
 * shape a {@link MCPTokenStore} round-trips. They intentionally do not
 * implement any OAuth flow — that is Task 3+ (wiring real providers into
 * `packages/tools/src/mcp/mcp-client.ts`'s transport construction).
 *
 * Secrets: `clientSecret` and `privateKey` below are config-caller-supplied
 * strings. This task does NOT add env-var interpolation syntax (e.g.
 * `"${MY_SECRET}"`) — that is explicitly out of scope per the plan. Callers
 * should read secrets from their own env/secret-manager and pass the
 * resolved string.
 */
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
  OAuthProtectedResourceMetadata,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Cached OAuth discovery results (RFC 9728 protected-resource metadata +
 * RFC 8414 / OIDC authorization-server metadata) for a given MCP server
 * resource, so a reconnect can skip re-discovery.
 *
 * Not an SDK type — the SDK exposes the pieces (`OAuthProtectedResourceMetadata`,
 * `AuthorizationServerMetadata`) but not a bundled "what did we discover last
 * time" shape. This is intentionally minimal; later tasks that add real
 * discovery caching (Task 3/4) may extend it.
 */
export interface OAuthDiscoveryState {
  readonly resourceMetadata?: OAuthProtectedResourceMetadata;
  readonly authorizationServerMetadata?: AuthorizationServerMetadata;
}

/**
 * OAuth configuration for connecting to a protected MCP server.
 *
 * Discriminated on `type`:
 * - `"client_credentials"` — RFC 6749 §4.4 client-credentials grant (machine-to-machine).
 * - `"private_key_jwt"` — RFC 7523 JWT client assertion instead of a shared secret.
 * - `"authorization_code"` — RFC 6749 §4.1 (+ PKCE) user-delegated flow; supports
 *   dynamic client registration (omit `clientId`) and the MCP client-ID metadata
 *   document extension via `clientMetadataUrl`.
 * - `"provider"` — full escape hatch: hand the MCP SDK's own
 *   {@link OAuthClientProvider} directly, bypassing everything above.
 */
export type MCPAuthConfig =
  | {
      readonly type: "client_credentials";
      readonly clientId: string;
      readonly clientSecret: string;
      readonly scope?: string;
      /**
       * Issuer URL of the authorization server these credentials belong to. When set, they
       * are sent only there (SDK >= 1.31 advisory GHSA-6qxp-vccf-f47h); omitted, the MCP
       * server chooses the receiver, which the SDK now warns about.
       */
      readonly expectedIssuer?: string;
    }
  | {
      readonly type: "private_key_jwt";
      readonly clientId: string;
      /** PEM or JWK JSON. */
      readonly privateKey: string;
      readonly algorithm: string;
      readonly scope?: string;
      /** Issuer URL the client assertion may be sent to; see `client_credentials`. */
      readonly expectedIssuer?: string;
    }
  | {
      readonly type: "authorization_code";
      /** Omitted ⇒ dynamic client registration. */
      readonly clientId?: string;
      readonly clientSecret?: string;
      /** Client ID metadata document URL (MCP client-ID metadata extension). */
      readonly clientMetadataUrl?: string;
      readonly scope?: string;
      /**
       * Open a browser and listen for the redirect during connect.
       * Default `false`: fail with a `rax mcp login` hint instead.
       */
      readonly interactive?: boolean;
      /** Default: ephemeral (OS-assigned) port. */
      readonly redirectPort?: number;
      /** Default: 300_000 (5 minutes). */
      readonly timeoutMs?: number;
      /** Called instead of launching a browser (e.g. print the URL, send to a UI). */
      readonly onAuthorizationUrl?: (url: URL) => void | Promise<void>;
    }
  | {
      readonly type: "provider";
      readonly provider: OAuthClientProvider;
    };

/**
 * Persisted OAuth credential bundle for one MCP server resource.
 *
 * `resourceUrl` is the ORIGINAL server URL (not the canonicalized key) —
 * kept for diagnostics / display; the store itself indexes by
 * {@link canonicalResourceKey}, never by this raw string.
 */
export interface StoredMcpCredentials {
  readonly tokens?: OAuthTokens;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly discoveryState?: OAuthDiscoveryState;
  readonly resourceUrl: string;
  readonly savedAt: number;
}

/**
 * Persistent store for {@link StoredMcpCredentials}, keyed by
 * {@link canonicalResourceKey}. Implementations: {@link createMemoryTokenStore}
 * (process-lifetime only) and {@link createFileTokenStore} (permission-restricted
 * on-disk persistence under `~/.reactive-agents/mcp-auth` by default).
 */
export interface MCPTokenStore {
  get(key: string): Promise<StoredMcpCredentials | undefined>;
  set(key: string, value: StoredMcpCredentials): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<readonly string[]>;
}
