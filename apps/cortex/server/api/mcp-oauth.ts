/**
 * MCP OAuth sign-in for saved servers (Lab > Tools > Servers). The framework does the work
 * (`services/mcp-oauth.ts` wires `mcpLogin` / `mcpAuthStatus` / `mcpLogout` / `listMcpLogins`):
 *
 * - GET  /api/mcp-logins                        `{ servers, unused }`: each sign-in capable server's
 *                                               state, and stored logins no saved server uses (made
 *                                               with `rax mcp login`), for one-click Add
 * - GET  /api/mcp-servers/:serverId/oauth       one server's state (the page polls it while a
 *                                               sign-in waits for the browser)
 * - POST /api/mcp-servers/:serverId/oauth/login start (or join) a sign-in; answers with the
 *                                               authorization URL as soon as it exists
 * - POST /api/mcp-servers/:serverId/oauth/cancel stop a pending sign-in
 * - POST /api/mcp-servers/:serverId/oauth/logout sign out (revoke when supported, delete locally)
 *
 * The redirect lands on a loopback listener the framework opens on this machine; Cortex has no
 * callback route. Every POST answers 403 when `allowLocalAuth` is false (reachable from other
 * machines without an access token), on top of the request guard, because sign-in binds a local
 * port and writes the user's credential store. No response carries a token value.
 */
import { Elysia, t } from "elysia";
import { Effect, Either } from "effect";
import { getMcpServer, listMcpServers, parseMcpConfig } from "../db/mcp-queries.js";
import { cortexLog } from "../cortex-log.js";
import { sanitizedCause } from "../services/channel-hub-failure.js";
import { isAuthRequiredText } from "../services/mcp-auth-required.js";
import {
  authWireOf,
  frameworkMcpOAuth,
  makeMcpSignIns,
  oauthTargetOf,
  resourceKeyOf,
  unusedLoginsOf,
  type McpOAuthApi,
  type McpServerAuthWire,
  type McpSignIns,
} from "../services/mcp-oauth.js";

/** The database handle the query module takes (no second `bun:sqlite` import). */
type Db = Parameters<typeof getMcpServer>[0];

/** What the router needs; tests pass a memory-store API. */
export interface McpOAuthRouterDeps {
  readonly api?: McpOAuthApi;
  readonly signIns?: McpSignIns;
  /** Whether this Cortex may bind a local port and write the credential store (loopback bind, or an access token). */
  readonly allowLocalAuth: boolean;
}

const LOCAL_AUTH_REFUSAL = {
  error: "Cortex is reachable from other machines without an access token, so it will not sign in to MCP servers. Set CORTEX_TOKEN.",
} as const;
const NOT_FOUND = { error: "MCP server not found" } as const;
const NOT_APPLICABLE = {
  error: "Sign-in applies to HTTP servers with an endpoint, no Authorization header and no machine credentials.",
} as const;

const params = t.Object({ serverId: t.String() });

/** Build the router. */
export function mcpOAuthRouter(db: Db, deps: McpOAuthRouterDeps) {
  const api = deps.api ?? frameworkMcpOAuth();
  const signIns = deps.signIns ?? makeMcpSignIns(api);

  /** The wire state of one saved server, or null when it cannot sign in. Store failures become an error line. */
  const stateOf = async (serverId: string): Promise<McpServerAuthWire | { readonly error: string } | null> => {
    const row = getMcpServer(db, serverId);
    if (!row) return null;
    const target = oauthTargetOf(parseMcpConfig(row));
    if (!target) return NOT_APPLICABLE;
    const status = await Effect.runPromise(Effect.either(api.status(target.endpoint)));
    if (Either.isLeft(status)) return { error: sanitizedCause(status.left) };
    return authWireOf(status.right, row.last_status === "error" && isAuthRequiredText(row.last_error), signIns.stateOf(serverId));
  };

  /** Shared lookup for the POST routes: the row and its target, or the refusal to send. */
  const targetFor = (serverId: string, set: { status?: number | string }) => {
    if (!deps.allowLocalAuth) {
      set.status = 403;
      return { refusal: LOCAL_AUTH_REFUSAL } as const;
    }
    const row = getMcpServer(db, serverId);
    if (!row) {
      set.status = 404;
      return { refusal: NOT_FOUND } as const;
    }
    const target = oauthTargetOf(parseMcpConfig(row));
    if (!target) {
      set.status = 400;
      return { refusal: NOT_APPLICABLE } as const;
    }
    return { row, target } as const;
  };

  return new Elysia()
    .get("/api/mcp-logins", async ({ set }) => {
      const servers: Record<string, McpServerAuthWire> = {};
      const usedKeys = new Set<string>();
      for (const row of listMcpServers(db)) {
        const cfg = parseMcpConfig(row);
        // Any saved server at a URL (sign-in capable or not) means that login is not "unused".
        const key = typeof cfg.endpoint === "string" ? resourceKeyOf(cfg.endpoint) : null;
        if (key !== null) usedKeys.add(key);
        const target = oauthTargetOf(cfg);
        if (!target) continue;
        const status = await Effect.runPromise(Effect.either(api.status(target.endpoint)));
        if (Either.isRight(status)) {
          servers[row.server_id] = authWireOf(status.right, row.last_status === "error" && isAuthRequiredText(row.last_error), signIns.stateOf(row.server_id));
        }
      }
      const logins = await Effect.runPromise(Effect.either(api.list()));
      if (Either.isLeft(logins)) {
        set.status = 500;
        return { error: sanitizedCause(logins.left) };
      }
      return { servers, unused: unusedLoginsOf(logins.right, usedKeys) };
    })
    .get(
      "/api/mcp-servers/:serverId/oauth",
      async ({ params: p, set }) => {
        const out = await stateOf(p.serverId);
        if (out === null) {
          set.status = 404;
          return NOT_FOUND;
        }
        if ("error" in out) set.status = out === NOT_APPLICABLE ? 400 : 500;
        return out;
      },
      { params },
    )
    .post(
      "/api/mcp-servers/:serverId/oauth/login",
      async ({ params: p, set }) => {
        const found = targetFor(p.serverId, set);
        if ("refusal" in found) return found.refusal;
        cortexLog("info", "mcp", `sign-in "${found.row.name}" started`);
        const out = await signIns.start(p.serverId, found.target);
        if (out.status === "failed") {
          cortexLog("warn", "mcp", `sign-in "${found.row.name}" failed`);
          set.status = 502;
          return { error: out.error };
        }
        return out;
      },
      { params },
    )
    .post(
      "/api/mcp-servers/:serverId/oauth/cancel",
      async ({ params: p, set }) => {
        const found = targetFor(p.serverId, set);
        if ("refusal" in found) return found.refusal;
        return { cancelled: await signIns.cancel(p.serverId) };
      },
      { params },
    )
    .post(
      "/api/mcp-servers/:serverId/oauth/logout",
      async ({ params: p, set }) => {
        const found = targetFor(p.serverId, set);
        if ("refusal" in found) return found.refusal;
        await signIns.forget(p.serverId);
        const out = await Effect.runPromise(Effect.either(api.logout(found.target.endpoint)));
        if (Either.isLeft(out)) {
          set.status = 500;
          return { error: sanitizedCause(out.left) };
        }
        cortexLog("info", "mcp", `sign-out "${found.row.name}" removed=${out.right.removed} revocation=${out.right.revocation}`);
        return {
          removed: out.right.removed,
          revocation: out.right.revocation,
          ...(out.right.revocationDetail !== undefined ? { revocationDetail: sanitizedCause(out.right.revocationDetail) } : {}),
        };
      },
      { params },
    );
}
