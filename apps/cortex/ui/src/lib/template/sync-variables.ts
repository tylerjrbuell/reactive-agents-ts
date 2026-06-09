import { scanTemplateVars } from "./scan-template-vars.js";
import type { VariableDef } from "../types/agent-config.js";

/**
 * Derive `config.variables` from the `{{tokens}}` currently present across the
 * config: keep every detected token (preserving prior enrichment by name),
 * default new ones to a required string, and drop variables whose token is no
 * longer anywhere in the config. Pure — `AgentConfigPanel` runs this reactively
 * so the Variables editor stays in sync without a manual "Rescan" step.
 *
 * The reserved `secret.` namespace is excluded by `scanTemplateVars`, so secret
 * tokens never become editable variables.
 */
export function syncVariables(
  config: { variables?: VariableDef[] },
): VariableDef[] {
  const found = scanTemplateVars(config);
  const existing = new Map((config.variables ?? []).map((v) => [v.name, v]));
  return found.map(
    (name) => existing.get(name) ?? { name, type: "string", required: true },
  );
}

/**
 * True when two variable lists declare the same names in the same order. Used to
 * decide whether the reactive sync actually changed the variable *set* — edits to
 * an existing variable's enrichment (type/default/…) keep names stable, so they
 * must NOT trigger a re-sync (which would otherwise loop or clobber the edit).
 */
export function sameVariableNames(
  a: readonly VariableDef[],
  b: readonly VariableDef[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
  }
  return true;
}
