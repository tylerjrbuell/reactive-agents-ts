/**
 * Lab > Tools > Servers: the pure rules behind MCP OAuth sign-in. The server answers the state
 * (`GET /api/mcp-logins`, `GET /api/mcp-servers/:id/oauth`, from the framework's `mcpAuthStatus` /
 * `listMcpLogins`); these rules only word it and pick the actions. Each rule has a case in
 * `mcp-oauth-view.test.ts`.
 */
import { formatRelativeTime, type StatusTone } from "@reactive-agents/ui-core";
import { EMPTY_MCP_DRAFT, type McpDraft } from "./tool-workshop.js";

/** A sign-in waiting for the browser, or the last one that failed. */
export type McpSignInWire =
  | { readonly phase: "pending"; readonly authorizationUrl: string; readonly startedAt: number }
  | { readonly phase: "failed"; readonly error: string; readonly at: number };

/** One server's sign-in state (never a token value). */
export interface McpServerAuth {
  readonly state: "signed-in" | "expired" | "absent";
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
  /** The last Test or Refresh failed because the server wants a login. */
  readonly authRequired: boolean;
  readonly signIn?: McpSignInWire;
}

/** A stored login no saved server uses (made with `rax mcp login`). */
export interface McpUnusedLogin {
  readonly resourceKey: string;
  readonly url: string;
  readonly name?: string;
  readonly transport?: "streamable-http" | "sse";
  readonly status: "signed-in" | "expired";
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/** What `GET /api/mcp-logins` answers. */
export interface McpLoginsReply {
  readonly servers: Readonly<Record<string, McpServerAuth>>;
  readonly unused: readonly McpUnusedLogin[];
}

/** The chip a server shows for its sign-in, or null when sign-in has nothing to say. Never the `running` tone. */
export function authChip(auth: McpServerAuth | undefined): { readonly label: string; readonly tone: StatusTone } | null {
  if (auth === undefined) return null;
  if (auth.signIn?.phase === "pending") return { label: "Waiting for sign-in", tone: "attention" };
  if (auth.state === "signed-in") return { label: "Signed in", tone: "done" };
  if (auth.state === "expired") return { label: "Sign-in expired", tone: "attention" };
  if (auth.authRequired) return { label: "Sign-in required", tone: "failed" };
  return null;
}

/** The one-line detail under the sign-in actions. */
export function authDetail(auth: McpServerAuth, now: number): string {
  if (auth.signIn?.phase === "pending") return "Finish in the browser tab that opened, on the computer running Cortex.";
  if (auth.signIn?.phase === "failed" && auth.state === "absent") return auth.signIn.error;
  if (auth.state === "signed-in") {
    const until = auth.expiresAt !== undefined ? `Token renews ${formatRelativeTime(auth.expiresAt, now)}` : "Signed in";
    return auth.scopes.length > 0 ? `${until}. Scopes: ${auth.scopes.join(", ")}` : until;
  }
  if (auth.state === "expired") {
    return auth.hasRefreshToken ? "The access token expired. The next connection renews it, or sign in again." : "The access token expired. Sign in again.";
  }
  if (auth.authRequired) return "This server asks you to sign in before it lists its tools.";
  return "Sign in if this server uses OAuth. The login is shared with rax and every agent.";
}

/** Which sign-in actions apply now. */
export function authActions(auth: McpServerAuth): { readonly signIn: boolean; readonly cancel: boolean; readonly signOut: boolean } {
  const pending = auth.signIn?.phase === "pending";
  return { signIn: !pending && auth.state !== "signed-in", cancel: pending, signOut: !pending && auth.state !== "absent" };
}

/** True while the page should poll this server's sign-in state. */
export const signInPending = (auth: McpServerAuth | undefined): boolean => auth?.signIn?.phase === "pending";

/** Poll interval while a sign-in waits for the browser. */
export const SIGN_IN_POLL_MS = 1_500;

/** A name for a login without one: the URL's host. */
export function loginLabel(login: Pick<McpUnusedLogin, "name" | "url">): string {
  if (login.name !== undefined && login.name.trim() !== "") return login.name;
  try {
    return new URL(login.url).host;
  } catch {
    return login.url;
  }
}

/** Unused logins the list shows before "Show all". */
export const LOGINS_SHOWN = 5;

/**
 * The logins to draw: signed-in ones first (an expired one without a refresh token is least
 * useful), at most {@link LOGINS_SHOWN} until expanded. `hidden` = how many "Show all" adds.
 */
export function visibleLogins(logins: readonly McpUnusedLogin[], expanded: boolean): { readonly rows: readonly McpUnusedLogin[]; readonly hidden: number } {
  const rank = (l: McpUnusedLogin): number => (l.status === "signed-in" ? 0 : l.hasRefreshToken ? 1 : 2);
  const sorted = [...logins].sort((a, b) => rank(a) - rank(b));
  if (expanded || sorted.length <= LOGINS_SHOWN) return { rows: sorted, hidden: 0 };
  return { rows: sorted.slice(0, LOGINS_SHOWN), hidden: sorted.length - LOGINS_SHOWN };
}

/** The Add form prefilled from a stored login: name, URL and transport; nothing secret. */
export function draftFromLogin(login: McpUnusedLogin): McpDraft {
  const name = loginLabel(login).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
  return { ...EMPTY_MCP_DRAFT, name, transport: login.transport ?? "streamable-http", endpoint: login.url };
}

/** Defensive reads of the wire (an older server may answer less). */
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function signInOf(v: unknown): McpSignInWire | undefined {
  if (!isRecord(v)) return undefined;
  if (v.phase === "pending" && typeof v.authorizationUrl === "string") {
    return { phase: "pending", authorizationUrl: v.authorizationUrl, startedAt: typeof v.startedAt === "number" ? v.startedAt : 0 };
  }
  if (v.phase === "failed" && typeof v.error === "string") return { phase: "failed", error: v.error, at: typeof v.at === "number" ? v.at : 0 };
  return undefined;
}

/** One server's sign-in state from the wire, or undefined when the shape is not one. */
export function serverAuthOf(v: unknown): McpServerAuth | undefined {
  if (!isRecord(v) || (v.state !== "signed-in" && v.state !== "expired" && v.state !== "absent")) return undefined;
  const signIn = signInOf(v.signIn);
  return {
    state: v.state,
    ...(typeof v.expiresAt === "number" ? { expiresAt: v.expiresAt } : {}),
    scopes: strings(v.scopes),
    hasRefreshToken: v.hasRefreshToken === true,
    authRequired: v.authRequired === true,
    ...(signIn !== undefined ? { signIn } : {}),
  };
}

/** `GET /api/mcp-logins` from the wire. */
export function loginsReplyOf(j: Record<string, unknown>): McpLoginsReply {
  const servers: Record<string, McpServerAuth> = {};
  if (isRecord(j.servers)) {
    for (const [id, raw] of Object.entries(j.servers)) {
      const auth = serverAuthOf(raw);
      if (auth) servers[id] = auth;
    }
  }
  const unused: McpUnusedLogin[] = [];
  for (const raw of Array.isArray(j.unused) ? j.unused : []) {
    if (!isRecord(raw) || typeof raw.url !== "string" || typeof raw.resourceKey !== "string") continue;
    unused.push({
      resourceKey: raw.resourceKey,
      url: raw.url,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(raw.transport === "sse" || raw.transport === "streamable-http" ? { transport: raw.transport } : {}),
      status: raw.status === "expired" ? "expired" : "signed-in",
      ...(typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
      scopes: strings(raw.scopes),
      hasRefreshToken: raw.hasRefreshToken === true,
    });
  }
  return { servers, unused };
}
