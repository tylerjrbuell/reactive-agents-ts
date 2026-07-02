/**
 * Auto-feed per-tool `requiresApproval` flags into the approval policy (F2).
 *
 * The kernel approval gate (`shouldGate`) only pauses for tools present in
 * `policy.tools` / matched by `requireFor`. The per-tool `requiresApproval`
 * flag on a ToolDefinition was declared but never wired to the gate — the
 * "fast-follow" that `tool-gating.ts` documents but `builder/types.ts` noted was
 * never done — so `shell-execute` / `code-execute` / `file-write` (all
 * `requiresApproval: true`) ran with zero approval even under a configured
 * policy unless the integrator re-listed each name by hand.
 *
 * This folds those flags in at config assembly. It runs **only when an approval
 * policy exists** (non-breaking: headless agents with no `.withApprovalPolicy`
 * are unaffected; a fail-closed no-policy default is a separate, breaking
 * decision). The caller assembles the list of *registered* tool definitions
 * (built-ins, the terminal/shell tool when enabled, and custom tools) so this
 * stays pure and only gates tools that are actually callable.
 */

interface ApprovalFlaggable {
  readonly name: string;
  readonly requiresApproval?: boolean;
}

/** Names of tool definitions that declare `requiresApproval: true`. Pure. */
export function requiresApprovalToolNames(
  defs: readonly ApprovalFlaggable[],
): readonly string[] {
  return defs.filter((d) => d.requiresApproval === true).map((d) => d.name);
}

/**
 * Union the auto-gated (`requiresApproval: true`) names from the registered tool
 * definitions into an approval policy's configured tool list. Deduplicated.
 */
export function foldApprovalRequiredTools(
  configuredTools: readonly string[],
  registeredDefs: readonly ApprovalFlaggable[],
): readonly string[] {
  return [
    ...new Set([...configuredTools, ...requiresApprovalToolNames(registeredDefs)]),
  ];
}
