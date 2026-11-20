/**
 * MCP client OAuth — which provider a connection uses.
 *
 * `connect()` used to build a provider only when `config.auth` was set, so a
 * server configured by URL alone never read a login made with `mcpLogin` /
 * `rax mcp login` for that same URL. {@link resolveConnectAuthProvider} closes
 * that gap without changing anything for servers that have no stored login:
 *
 * - `auth: false`: no provider, ever.
 * - `auth` set: exactly `createAuthProvider` (unchanged).
 * - `auth` omitted, HTTP transport, and the store holds tokens for
 *   `canonicalResourceKey(endpoint)`: a NON-interactive authorization_code
 *   provider over that record. It sends the stored bearer, refreshes through
 *   the hardened provider, and never opens a browser. Tokens are only ever
 *   looked up under this endpoint's own key, so they never reach another
 *   resource.
 * - Otherwise: no provider (unchanged).
 */
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { MCPServer } from "../../types.js";
import type { AuthorizationCodeConfig } from "./authorization-code-provider.js";
import { createAuthProvider } from "./create-provider.js";
import { isHttpsOrLoopback } from "./hardened-provider.js";
import { canonicalResourceKey } from "./token-store.js";
import type { MCPTokenStore } from "./types.js";

const hasAuthorizationHeader = (headers: Readonly<Record<string, string>> | undefined): boolean =>
  Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization");

/**
 * The auth config that reuses a stored login for `server`, or `undefined`
 * when there is none to reuse. Never throws: a server that did not ask for
 * auth must not fail to connect because the credential store is unreadable.
 */
export async function storedLoginAuthConfig(
  server: MCPServer,
  store: MCPTokenStore,
): Promise<AuthorizationCodeConfig | undefined> {
  if (server.auth !== undefined) return undefined;
  if (server.transport !== "streamable-http" && server.transport !== "sse") return undefined;
  const endpoint = server.endpoint;
  if (!endpoint || !isHttpsOrLoopback(endpoint)) return undefined;
  // An explicit Authorization header is the caller's chosen credential.
  if (hasAuthorizationHeader(server.headers)) return undefined;

  let key: string;
  try {
    key = canonicalResourceKey(endpoint);
  } catch {
    return undefined;
  }
  const stored = await store.get(key).catch(() => undefined);
  if (!stored?.tokens) return undefined;

  return {
    type: "authorization_code",
    interactive: false,
    // Dynamic registration leaves the client in the record; a static client ID
    // is only in the login metadata (its secret is never stored).
    clientId: stored.clientInformation ? undefined : stored.login?.clientId,
  };
}

/** The OAuth provider `connect()` uses for `server`; see the module comment for the rules. */
export async function resolveConnectAuthProvider(
  server: MCPServer,
  store: MCPTokenStore,
): Promise<OAuthClientProvider | undefined> {
  if (server.auth === false) return undefined;
  if (server.auth) return createAuthProvider(server, store);
  const auth = await storedLoginAuthConfig(server, store);
  return auth ? createAuthProvider({ ...server, auth }, store) : undefined;
}
