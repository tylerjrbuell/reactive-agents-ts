/**
 * Lab · Channels access control: the editor's rules for `gateway.accessControl`.
 *
 * The framework fails closed. With no access control, or an allowlist that is empty, every
 * sender is refused; `accessPolicy: "open"` is the one explicit opt-in to accept anyone.
 * Cortex adds no default of its own: it shows that state in one sentence and edits the list.
 * Sender keys are `<platform>:<id>` (`telegram:123456789`, `signal:+15551234567`); a bare id
 * does not match a platform-tagged sender, so the editor refuses it with the fix.
 */

/** The `gateway.accessControl` fields the editor writes (all optional, as the framework has them). */
export interface AccessControl {
  accessPolicy?: "allowlist" | "blocklist" | "open";
  allowedSenders?: string[];
  blockedSenders?: string[];
  unknownSenderAction?: "skip" | "escalate";
  replyToUnknown?: string;
  mode?: "chat" | "task";
  sessionTtlDays?: number;
}

/** The curated `gateway` block of a config. */
export interface GatewayBlock {
  accessControl?: AccessControl;
  queue?: { capacity?: number; overflow?: "drop-oldest" | "drop-newest" };
  crons?: { schedule: string; instruction: string; priority?: "low" | "normal" | "high" | "critical"; timezone?: string; enabled?: boolean }[];
}

/** Who can reach the agent. */
export type AccessMode = "deny-all" | "allowlist" | "blocklist" | "open";

/** The access mode a gateway block means (the framework's rule). */
export function accessModeOf(gateway: GatewayBlock | undefined): AccessMode {
  const ac = gateway?.accessControl;
  const policy = ac?.accessPolicy ?? "allowlist";
  if (policy === "open") return "open";
  if (policy === "blocklist") return "blocklist";
  return (ac?.allowedSenders?.length ?? 0) === 0 ? "deny-all" : "allowlist";
}

/** The one sentence under the access editor for a mode. */
export function accessSentence(mode: AccessMode, count = 0): string {
  switch (mode) {
    case "deny-all":
      return "Nobody can message this agent yet. Add the people who may, or allow everyone.";
    case "allowlist":
      return `${count} ${count === 1 ? "sender" : "senders"} may message this agent. Everyone else is ignored.`;
    case "blocklist":
      return "Anyone may message this agent except the blocked senders.";
    case "open":
      return "Anyone who finds this channel can message this agent, and it will answer with its tools.";
  }
}

/** Why an entry cannot be a sender key, or null when it can. */
export function senderProblem(entry: string): string | null {
  const s = entry.trim();
  if (s === "") return "Empty entry.";
  const m = /^([A-Za-z][A-Za-z0-9_-]*):(\S+)$/.exec(s);
  if (!m) return `"${s}" needs a platform prefix, like telegram:123456789 or signal:+15551234567.`;
  return null;
}

/** A sender key in canonical form: the platform lowercased, the id as typed. */
export function normalizeSender(entry: string): string {
  const s = entry.trim();
  const i = s.indexOf(":");
  return `${s.slice(0, i).toLowerCase()}:${s.slice(i + 1)}`;
}

/** Result of adding typed or pasted senders. */
export interface AddSendersResult {
  readonly access: AccessControl;
  readonly added: readonly string[];
  /** Entries refused, each with the reason. */
  readonly rejected: readonly { readonly entry: string; readonly reason: string }[];
}

/** Which list an editor row edits. */
export type SenderList = "allowedSenders" | "blockedSenders";

/** Add senders from text (commas, spaces or new lines between entries). Duplicates are skipped silently. */
export function addSenders(access: AccessControl | undefined, text: string, list: SenderList = "allowedSenders"): AddSendersResult {
  const current = [...(access?.[list] ?? [])];
  const added: string[] = [];
  const rejected: { entry: string; reason: string }[] = [];
  for (const raw of text.split(/[\s,]+/).filter((x) => x !== "")) {
    const reason = senderProblem(raw);
    if (reason) {
      rejected.push({ entry: raw, reason });
      continue;
    }
    const key = normalizeSender(raw);
    if (current.includes(key)) continue;
    current.push(key);
    added.push(key);
  }
  return { access: { ...(access ?? {}), [list]: current }, added, rejected };
}

/** Remove one sender. An emptied list is dropped from the config rather than saved as `[]`. */
export function removeSender(access: AccessControl | undefined, entry: string, list: SenderList = "allowedSenders"): AccessControl | undefined {
  const next = { ...(access ?? {}) };
  const rest = (next[list] ?? []).filter((s) => s !== entry);
  if (rest.length > 0) next[list] = rest;
  else delete next[list];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Turn "Allow everyone" on or off. On sets `accessPolicy: "open"` and keeps the allowlist so
 * switching it off restores who was allowed; off removes the policy, which is the framework's
 * default (an allowlist).
 */
export function setAllowEveryone(access: AccessControl | undefined, on: boolean): AccessControl | undefined {
  const next = { ...(access ?? {}) };
  if (on) next.accessPolicy = "open";
  else if (next.accessPolicy === "open") delete next.accessPolicy;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** `gateway` with its `accessControl` replaced; an empty block is dropped so nothing empty is saved. */
export function withAccess(gateway: GatewayBlock | undefined, access: AccessControl | undefined): GatewayBlock | undefined {
  const next: GatewayBlock = { ...(gateway ?? {}) };
  if (access && Object.keys(access).length > 0) next.accessControl = access;
  else delete next.accessControl;
  return Object.keys(next).length > 0 ? next : undefined;
}
