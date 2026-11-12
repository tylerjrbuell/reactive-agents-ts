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

type McpAuth = NonNullable<MCPServerConfig["auth"]>;

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
  if (cfg.auth !== undefined) out.auth = maskAuth(cfg.auth);
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
  if (incoming.auth !== undefined) out.auth = restoreAuth(incoming.auth, stored?.auth);
  return out;
}
