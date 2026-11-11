/**
 * The approval gate as the builder and the chat edit it: the data half of the
 * framework's `.withApprovalPolicy()` (`AgentConfig.approvalPolicy`: `mode`,
 * `tools`, `commands`). Pure; the server's `approvalPolicyOf` reads the same shape.
 *
 * - `tools`: tool names whose calls need approval.
 * - `commands`: shell command rules. A rule is a word prefix: `git push` matches
 *   `git push origin main`, not `git pull`; a trailing `*` changes nothing and a
 *   rule with no words (a bare `*`) matches nothing.
 * - `mode`: `detach` makes the run wait live until you approve or deny (durable
 *   runs are separate: with them on, the wait also survives a restart);
 *   `block` decides in place, and Cortex has no in-process approver, so a gated
 *   call is refused and the agent is told so.
 *
 * Once any tool or rule is set, the framework also gates every tool flagged
 * `requiresApproval` (file-write, file-edit, code-execute, the full shell):
 * {@link autoGatedTools} names the ones this agent has, so the editor shows them
 * locked on.
 */

import { shellState, type ShellPresets } from "./shell-from-picks.js";

/** Framework approval modes. */
export type ApprovalMode = "detach" | "block";

/** The approval policy in the builder config (always present; empty lists = no gate). */
export interface ApprovalPolicyConfig {
  mode: ApprovalMode;
  tools: string[];
  commands: string[];
}

/** The default: nothing gated, pause-and-approve when something is. */
export function defaultApprovalPolicy(): ApprovalPolicyConfig {
  return { mode: "detach", tools: [], commands: [] };
}

/** True when the policy gates anything (any tool or any rule). */
export function hasApprovalGate(p: Pick<ApprovalPolicyConfig, "tools" | "commands"> | undefined): boolean {
  return !!p && (p.tools.length > 0 || p.commands.length > 0);
}

/** A typed rule as stored: trimmed, inner whitespace collapsed. */
export function normalizeRule(rule: string): string {
  return rule.trim().replace(/\s+/g, " ");
}

/**
 * True when a rule can never match: the framework drops a trailing `*` and a
 * rule with no words left (`*`, `"  "`) matches nothing.
 */
export function ruleMatchesNothing(rule: string): boolean {
  const words = normalizeRule(rule).split(" ").filter((w) => w !== "");
  if (words.at(-1) === "*") words.pop();
  return words.length === 0;
}

/** The rules with `rule` added (normalized, no duplicate); unchanged for an empty rule. */
export function addRule(commands: readonly string[], rule: string): string[] {
  const r = normalizeRule(rule);
  return r === "" || commands.includes(r) ? [...commands] : [...commands, r];
}

/** The rules without `rule`. */
export function removeRule(commands: readonly string[], rule: string): string[] {
  return commands.filter((c) => c !== rule);
}

/** The tool list with `tool` switched on or off. */
export function toggleGatedTool(tools: readonly string[], tool: string): string[] {
  return tools.includes(tool) ? tools.filter((t) => t !== tool) : [...tools, tool];
}

/**
 * Tool names the gate can name for this agent: the selected tools, with a shell
 * toolset pick (`git`) shown as the tool it calls, `shell-execute`, which also
 * stands for the full host shell. Gating `shell-execute` asks before every shell
 * call; command rules ask only for matching ones.
 */
export function gateableTools(tools: readonly string[], terminalTools: boolean | undefined, presets: ShellPresets): string[] {
  const out = tools.filter((t) => !Object.hasOwn(presets, t));
  if (shellState(terminalTools, tools, presets) !== "off" && !out.includes("shell-execute")) out.push("shell-execute");
  return [...new Set(out)];
}

/** True when the agent runs the full host shell (gated by the framework once any policy is set). */
export function hasFullShell(tools: readonly string[], terminalTools: boolean | undefined): boolean {
  return terminalTools === true || tools.includes("shell-execute");
}

/**
 * The tools this agent has that the framework gates on its own once any policy is
 * set: selected names flagged `requiresApproval` (`required`, from
 * `GET /api/tools/approval-required`), plus `shell-execute` when the full host
 * shell is on. Empty while the policy gates nothing (no policy, no folding).
 */
export function autoGatedTools(
  policy: Pick<ApprovalPolicyConfig, "tools" | "commands">,
  selectedTools: readonly string[],
  fullShell: boolean,
  required: readonly string[],
): string[] {
  if (!hasApprovalGate(policy)) return [];
  const have = new Set(selectedTools);
  if (fullShell) have.add("shell-execute");
  return required.filter((t) => have.has(t));
}

/**
 * The `approvalPolicy` a run or chat body sends, or `undefined` when nothing is
 * gated. Only rules that can match are sent; the mode is always explicit.
 */
export function approvalPolicyBody(p: ApprovalPolicyConfig | undefined): { mode: ApprovalMode; tools?: string[]; commands?: string[] } | undefined {
  if (!p) return undefined;
  const commands = p.commands.filter((c) => !ruleMatchesNothing(c));
  if (p.tools.length === 0 && commands.length === 0) return undefined;
  return {
    mode: p.mode,
    ...(p.tools.length > 0 ? { tools: [...p.tools] } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  };
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/**
 * The editable policy from a stored or session config: the top-level
 * `approvalPolicy`, else the legacy gate kept under `durableRuns`
 * (`approvalTools` / `approvalMode`, or `approvalPolicy`), which counted only
 * while durable runs were on.
 */
export function approvalPolicyFrom(raw: Readonly<Record<string, unknown>>): ApprovalPolicyConfig {
  const top = record(raw.approvalPolicy);
  if (top) {
    return { mode: top.mode === "block" ? "block" : "detach", tools: strings(top.tools), commands: strings(top.commands) };
  }
  const dr = record(raw.durableRuns);
  if (!dr || dr.enabled !== true) return defaultApprovalPolicy();
  const legacy = record(dr.approvalPolicy);
  const tools = strings(legacy?.tools).length > 0 ? strings(legacy?.tools) : strings(dr.approvalTools);
  const mode: ApprovalMode = legacy?.mode === "block" || dr.approvalMode === "block" ? "block" : "detach";
  return { mode, tools, commands: [] };
}

/**
 * The chat session PATCH for a change to its approval gate. Always sends the
 * whole top-level `approvalPolicy`, so it replaces a legacy gate kept under
 * `durableRuns`; empty lists clear the gate (the server drops an empty policy).
 */
export function approvalPatch(
  cfg: Readonly<Record<string, unknown>>,
  change: (p: ApprovalPolicyConfig) => ApprovalPolicyConfig,
): { approvalPolicy: { mode: ApprovalMode; tools: string[]; commands: string[] } } {
  const next = change(approvalPolicyFrom(cfg));
  return { approvalPolicy: { mode: next.mode, tools: [...next.tools], commands: [...next.commands] } };
}

/** One line for the editor and the chat menu: `2 tools · 1 command · pause` or `off`. */
export function approvalSummary(p: ApprovalPolicyConfig): string {
  if (!hasApprovalGate(p)) return "off";
  const parts = [
    ...(p.tools.length > 0 ? [`${p.tools.length} tool${p.tools.length === 1 ? "" : "s"}`] : []),
    ...(p.commands.length > 0 ? [`${p.commands.length} command${p.commands.length === 1 ? "" : "s"}`] : []),
  ];
  return `${parts.join(" · ")} · ${p.mode === "detach" ? "pause" : "refuse"}`;
}

/** Labels for the two modes, shared by the builder and the chat menu. */
export const APPROVAL_MODE_LABEL: Readonly<Record<ApprovalMode, { label: string; detail: string }>> = {
  detach: { label: "Pause and ask me", detail: "The run waits until you approve or deny it" },
  block: { label: "Refuse", detail: "Cortex has no in-place approver: the call does not run and the agent is told it was refused" },
};
