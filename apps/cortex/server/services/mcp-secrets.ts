/**
 * MCP server credentials are write-only through the API.
 *
 * `env` values, `headers` values and the OAuth secrets in `auth` (`clientSecret`, `privateKey`)
 * are stored in the database in full (the server needs them to connect) but come back from
 * `GET /api/mcp-servers` as {@link MCP_SECRET_MASK}. The Tool Workshop edits a server by
 * sending the whole config back, so a value still equal to the mask on PATCH (or on a JSON
 * import by the same name) means "keep the stored one". Names, commands, endpoints and
 * non-secret auth fields stay readable: they are what the form edits.
 */
import type { MCPServerConfig } from "@reactive-agents/runtime";

/** What a stored secret looks like in a response. Never a real credential. */
export const MCP_SECRET_MASK = "••••••••";

/** An OAuth config object. `auth: false` (never reuse a stored login) holds no secret. */
type McpAuth = Exclude<NonNullable<MCPServerConfig["auth"]>, false>;

/** The auth config object of a saved server, or undefined for none / `false`. */
export const mcpAuthObjectOf = (auth: unknown): McpAuth | undefined =>
  auth !== null && typeof auth === "object" && !Array.isArray(auth) && "type" in auth && typeof auth.type === "string" ? (auth as McpAuth) : undefined;

const maskValues = (rec: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.keys(rec).map((k) => [k, MCP_SECRET_MASK]));

function maskAuth(auth: McpAuth): McpAuth {
  switch (auth.type) {
    case "client_credentials":
      return { ...auth, clientSecret: MCP_SECRET_MASK };
    case "private_key_jwt":
      return { ...auth, privateKey: MCP_SECRET_MASK };
    case "authorization_code":
      return auth.clientSecret !== undefined && auth.clientSecret !== "" ? { ...auth, clientSecret: MCP_SECRET_MASK } : auth;
    default:
      return auth;
  }
}

/** `cfg` with every credential replaced by the mask (a copy; the input is untouched). */
export function maskMcpConfig(cfg: MCPServerConfig): MCPServerConfig {
  const out: MCPServerConfig = { ...cfg };
  if (cfg.env !== undefined) out.env = maskValues(cfg.env);
  if (cfg.headers !== undefined) out.headers = maskValues(cfg.headers);
  const auth = mcpAuthObjectOf(cfg.auth);
  if (auth !== undefined) out.auth = maskAuth(auth);
  return out;
}

/** Keys to write and keys to drop for one credential record (env or headers). */
export type McpSecretEdit = {
  readonly set?: Readonly<Record<string, string>>;
  readonly remove?: readonly string[];
};

/** A write-only credential edit: individual env / header keys, never the whole config. */
export type McpSecretUpdate = { readonly env?: McpSecretEdit; readonly headers?: McpSecretEdit };

/** Why `update` cannot be applied (empty key, empty or masked value), or null. Never includes a value. */
export function mcpSecretUpdateProblem(update: McpSecretUpdate): string | null {
  for (const [field, edit] of [["env", update.env], ["headers", update.headers]] as const) {
    for (const [key, value] of Object.entries(edit?.set ?? {})) {
      if (key.trim() === "") return `${field}: key names cannot be empty`;
      if (value === "") return `${field}.${key}: value cannot be empty (remove the key instead)`;
      if (value === MCP_SECRET_MASK) return `${field}.${key}: send the new value, not the mask`;
    }
    if ((edit?.remove ?? []).some((k) => k.trim() === "")) return `${field}: key names cannot be empty`;
  }
  return null;
}

const editRecord = (current: Readonly<Record<string, string>> | undefined, edit: McpSecretEdit | undefined): Record<string, string> | undefined => {
  if (edit === undefined) return current === undefined ? undefined : { ...current };
  const next: Record<string, string> = { ...current, ...edit.set };
  for (const key of edit.remove ?? []) delete next[key];
  return next;
};

/**
 * `stored` with the given env / header keys set, replaced or removed; every other key keeps its stored
 * value. An emptied record is dropped. Check {@link mcpSecretUpdateProblem} first.
 */
export function applyMcpSecretUpdate(stored: MCPServerConfig, update: McpSecretUpdate): MCPServerConfig {
  const out: MCPServerConfig = { ...stored };
  for (const field of ["env", "headers"] as const) {
    const next = editRecord(stored[field], update[field]);
    if (next !== undefined && Object.keys(next).length > 0) out[field] = next;
    else delete out[field];
  }
  return out;
}

/** Entries whose value is still the mask take the stored value; a masked entry with no stored one is dropped. */
function restoreRecord(incoming: Readonly<Record<string, string>>, stored: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const kept = stored?.[k];
    if (v !== MCP_SECRET_MASK) out[k] = v;
    else if (kept !== undefined) out[k] = kept;
  }
  return out;
}

/** The secret to keep for an auth field that came back masked: the stored one, only for the same auth kind. */
const keptSecret = (incoming: string | undefined, stored: string | undefined): string | undefined =>
  incoming === MCP_SECRET_MASK ? stored : incoming;

function restoreAuth(incoming: McpAuth, stored: McpAuth | undefined): McpAuth {
  const same = stored !== undefined && stored.type === incoming.type ? stored : undefined;
  switch (incoming.type) {
    case "client_credentials": {
      const s = same?.type === "client_credentials" ? same.clientSecret : undefined;
      return { ...incoming, clientSecret: keptSecret(incoming.clientSecret, s) ?? "" };
    }
    case "private_key_jwt": {
      const s = same?.type === "private_key_jwt" ? same.privateKey : undefined;
      return { ...incoming, privateKey: keptSecret(incoming.privateKey, s) ?? "" };
    }
    case "authorization_code": {
      const s = same?.type === "authorization_code" ? same.clientSecret : undefined;
      const secret = keptSecret(incoming.clientSecret, s);
      const { clientSecret: _drop, ...rest } = incoming;
      return secret === undefined ? rest : { ...rest, clientSecret: secret };
    }
    default:
      return incoming;
  }
}

/**
 * `incoming` (a config the user submitted) with each still-masked credential replaced by the
 * one in `stored`. A mask with nothing stored behind it is dropped, never saved as a value.
 */
export function restoreMaskedMcpConfig(incoming: MCPServerConfig, stored: MCPServerConfig | undefined): MCPServerConfig {
  const out: MCPServerConfig = { ...incoming };
  if (incoming.env !== undefined) {
    const env = restoreRecord(incoming.env, stored?.env);
    if (Object.keys(env).length > 0) out.env = env;
    else delete out.env;
  }
  if (incoming.headers !== undefined) {
    const headers = restoreRecord(incoming.headers, stored?.headers);
    if (Object.keys(headers).length > 0) out.headers = headers;
    else delete out.headers;
  }
  const auth = mcpAuthObjectOf(incoming.auth);
  if (auth !== undefined) out.auth = restoreAuth(auth, mcpAuthObjectOf(stored?.auth));
  return out;
}
