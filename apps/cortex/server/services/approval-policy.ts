/**
 * The approval policy a Cortex agent runs with: the data half of the framework's
 * `.withApprovalPolicy()` (`AgentConfig.approvalPolicy`: `mode`, `tools`,
 * `commands`). Cortex stores and forwards that shape as is; this module is the
 * one reader, so the chat, desk-run and gateway paths agree.
 *
 * Older configs kept the gate under `durableRuns`: the Lab shape
 * (`durableRuns.approvalTools` + `approvalMode`) and the server's build shape
 * (`durableRuns.approvalPolicy { tools, mode }`). Both counted only while durable
 * runs were on, and both are read here so no stored gate is lost.
 */

/** The approval modes Cortex offers (framework `ApprovalMode`). */
export type CortexApprovalMode = "detach" | "block";

/** The data half of the framework approval policy, as Cortex stores it. */
export interface CortexApprovalPolicy {
  /**
   * `detach`: the run pauses durably and resumes after Approve (needs durable
   * runs; the build turns them on). `block`: decided in process; Cortex supplies
   * no `onApprove`, so a gated call is refused and the agent is told so.
   */
  readonly mode: CortexApprovalMode;
  /** Tool names whose calls need approval. */
  readonly tools?: readonly string[];
  /** Shell command rules (`"git push"` matches `git push origin main`). */
  readonly commands?: readonly string[];
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Trimmed, non-empty, de-duplicated strings in their first order. */
function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim().replace(/\s+/g, " ");
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

const modeOf = (v: unknown): CortexApprovalMode | undefined => (v === "detach" || v === "block" ? v : undefined);

/**
 * The approval policy a stored or posted config asks for, or `undefined` when it
 * gates nothing (no tools, no command rules). A policy with no rules is dropped on
 * purpose: any policy makes the framework also gate every registered tool flagged
 * `requiresApproval` (file-write, file-edit, code-execute, the full shell).
 *
 * Reads, in order: the top-level `approvalPolicy`; then, while `durableRuns` is on,
 * the legacy `durableRuns.approvalPolicy` and `durableRuns.approvalTools` /
 * `approvalMode`. `mode` defaults to `detach` (Cortex's pause-and-approve flow;
 * an explicit mode is always sent, so the framework's own default never applies).
 */
export function approvalPolicyOf(raw: Readonly<Record<string, unknown>>): CortexApprovalPolicy | undefined {
  const top = record(raw.approvalPolicy);
  const dr = record(raw.durableRuns);
  const legacy = dr && dr.enabled === true ? dr : undefined;
  const legacyPolicy = record(legacy?.approvalPolicy);

  const tools = top
    ? cleanList(top.tools)
    : cleanList(legacyPolicy?.tools).length > 0 ? cleanList(legacyPolicy?.tools) : cleanList(legacy?.approvalTools);
  const commands = cleanList(top?.commands);
  if (tools.length === 0 && commands.length === 0) return undefined;
  const mode = top
    ? modeOf(top.mode)
    : modeOf(legacyPolicy?.mode) === "block" || legacy?.approvalMode === "block" ? "block" : undefined;
  return {
    mode: mode ?? "detach",
    ...(tools.length > 0 ? { tools } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  };
}
