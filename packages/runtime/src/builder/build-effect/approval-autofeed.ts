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

import type {
  ApprovalMode,
  AuthoredApprovalPolicy,
  ConfiguredApprovalPolicy,
} from "@reactive-agents/reasoning";

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

/**
 * The shell command rules (`["git push"]`) of an approval policy, or
 * `undefined` when there is no policy or it names none.
 *
 * The ONE reader of `policy.commands`. The same list goes to two places: the
 * kernel approval gate (`ApprovalGateConfig.commands`, via
 * {@link configureApprovalPolicy}) and every shell the agent registers
 * (`ShellExecuteConfig.approvalCommands`, via `resolveShellRegistration`). The
 * read-only git/gh shell runs a rule-matched write without asking, so a list
 * that reached the shell but not the gate would run that write unapproved.
 */
export function approvalCommandsOf(
  policy: AuthoredApprovalPolicy | undefined,
): readonly string[] | undefined {
  const commands = policy?.commands;
  return commands !== undefined && commands.length > 0 ? [...commands] : undefined;
}

/**
 * Resolve an authored `.withApprovalPolicy()` argument into its configured
 * stage: `mode` decided by the caller, per-tool `requiresApproval` flags folded
 * into `tools` (F2), and the shell command rules from
 * {@link approvalCommandsOf}. Shared by the full runtime (runtime-construction)
 * and sub-agents (`buildLightRuntimeConfig`), so a new policy field reaches both.
 */
export function configureApprovalPolicy(
  authored: AuthoredApprovalPolicy,
  mode: ApprovalMode,
  registeredDefs: readonly ApprovalFlaggable[],
): ConfiguredApprovalPolicy {
  const commands = approvalCommandsOf(authored);
  return {
    mode,
    tools: foldApprovalRequiredTools(authored.tools ?? [], registeredDefs),
    requireFor: authored.requireFor,
    ...(commands !== undefined ? { commands } : {}),
    // Block-mode in-process decider. Carried as the raw callback here
    // (serialization-free, like requireFor); the config→envelope mapper
    // (buildRunEnvelopeFromConfig) Effect-wraps it onto the rails.
    onApprove: authored.onApprove,
  };
}
