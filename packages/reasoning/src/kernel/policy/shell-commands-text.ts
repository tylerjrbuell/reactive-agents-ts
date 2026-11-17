/**
 * policy/shell-commands-text.ts — one compact line for what a command-running
 * tool may execute, shared by every plan-producer catalog renderer
 * (`renderCatalog` in plan-producer-context.ts, `planToolCatalogLine` in
 * plan-steps.ts).
 *
 * A planner that cannot see the command list plans steps like `gh --version` or
 * `gh auth status` only to learn whether the shell can run them. The tool's own
 * `commandPolicy` (tools package, one list) answers that up front: which
 * executables are allowed and already on PATH (checked once per PATH by
 * `shellCommandAvailability`, no process spawn), which are allowed but missing,
 * and which are not enabled. With `sandbox: "docker"` the commands run in a
 * container whose PATH is not ours, so no PATH split is shown there.
 */
import { shellCommandAvailability, type ShellCommandPolicy } from "@reactive-agents/tools";

/** What a planner is told next to a listed command set: no availability-check steps. */
export const COMMANDS_LISTED_RULE =
  "Do not plan a step only to check that a tool or command exists or is installed; the catalog lists what is available.";

/**
 * `commands on PATH: gh, ls; not installed: git; not enabled: curl`, or
 * `undefined` when the policy lists nothing. Segments that are empty are left out.
 */
export function shellCommandsText(policy: ShellCommandPolicy | undefined): string | undefined {
  if (policy === undefined) return undefined;
  const segments: string[] = [];
  if (policy.sandbox === "docker") {
    if (policy.allowedCommands.length > 0) segments.push(`commands: ${policy.allowedCommands.join(", ")}`);
  } else {
    const { available, missing } = shellCommandAvailability(policy);
    if (available.length > 0) segments.push(`commands on PATH: ${available.join(", ")}`);
    if (missing.length > 0) segments.push(`not installed: ${missing.join(", ")}`);
  }
  if (policy.notEnabledCommands.length > 0) segments.push(`not enabled: ${policy.notEnabledCommands.join(", ")}`);
  return segments.length > 0 ? segments.join("; ") : undefined;
}
