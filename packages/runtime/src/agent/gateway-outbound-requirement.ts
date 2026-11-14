/**
 * Declared outbound-reply requirement for LEGACY gateway channel turns.
 *
 * A legacy MCP channel turn delivers its reply by calling the channel server's send tool, and the
 * prompt says so (`channelOutboundToolGuidance`). Since requirement basis landed, prose alone is
 * advisory: a run that web-searches and never sends would end done. This module turns the prose into
 * a DECLARED requirement (the kernel's `requiredTools` provenance) so the run cannot succeed without
 * a successful send.
 *
 * Scope is exactly the turns whose delivery is by tool. A native adapter or channel-router turn
 * (the adapter delivers the reply) carries no outbound server, so no requirement is added. With no
 * unambiguous send tool on the surface there is no requirement either (no tool, no requirement).
 *
 * Pure, no I/O.
 */

/** Key under `task.metadata.context` carrying the MCP server whose send tool must deliver the reply. */
export const OUTBOUND_SERVER_CONTEXT_KEY = "outboundServer";

/** Names that are the channel's primary send action: send_message, post, reply, dm, ... */
const PRIMARY_SEND = /^(send|post|reply)[_-]?(message|msg|dm|text|reply)?$|^dm$/i;
/** Looser "this sends something" test, used only when it picks exactly one tool. */
const ANY_SEND = /send|post|reply|dm/i;

/**
 * The outbound server for a gateway event, or `undefined` when delivery is not by tool
 * (adapter-backed / router-owned / no MCP server named).
 */
export function outboundServerOf(mcpServer: unknown, adapterBacked: boolean): string | undefined {
  if (adapterBacked) return undefined;
  const server = typeof mcpServer === "string" ? mcpServer.trim() : "";
  return server === "" ? undefined : server;
}

/**
 * The single tool to require for `server`, chosen from the registered surface; `undefined` when
 * none is unambiguous. Never requires several tools (they would all have to be called).
 */
export function declaredOutboundTool(
  server: string,
  toolNames: readonly string[],
): string | undefined {
  const prefix = `${server}/`;
  const local = toolNames
    .filter((n) => n.startsWith(prefix))
    .map((name) => ({ name, bare: name.slice(prefix.length) }));
  const primary = local.find((t) => PRIMARY_SEND.test(t.bare));
  if (primary !== undefined) return primary.name;
  const loose = local.filter((t) => ANY_SEND.test(t.bare));
  return loose.length === 1 ? loose[0]!.name : undefined;
}

/**
 * Add the declared outbound tool to a required-tools set. Unchanged when the task carries no
 * outbound server or no unambiguous send tool is registered.
 */
export function withDeclaredOutbound(
  required: readonly string[] | undefined,
  task: Parameters<typeof outboundServerFromTask>[0],
  defs: readonly { readonly name: string }[],
): readonly string[] | undefined {
  const server = outboundServerFromTask(task);
  if (server === undefined) return required;
  const tool = declaredOutboundTool(server, defs.map((d) => d.name));
  if (tool === undefined || (required ?? []).includes(tool)) return required;
  return [...(required ?? []), tool];
}

/** Read the outbound server off a task's `metadata.context`. */
export function outboundServerFromTask(task: {
  readonly metadata?: { readonly context?: Readonly<Record<string, unknown>> };
}): string | undefined {
  const v = task.metadata?.context?.[OUTBOUND_SERVER_CONTEXT_KEY];
  return typeof v === "string" && v !== "" ? v : undefined;
}
