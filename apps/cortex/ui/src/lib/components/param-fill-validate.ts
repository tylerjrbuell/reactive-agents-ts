import type { VariableDef } from "../types/agent-config.js";

export type ParamValues = Record<string, string>;
export type ParamErrors = Record<string, string>;

export function initialValues(vars: readonly VariableDef[]): ParamValues {
  const out: ParamValues = {};
  for (const v of vars) out[v.name] = v.default != null ? String(v.default) : "";
  return out;
}

export function validateParamValues(
  vars: readonly VariableDef[],
  values: ParamValues,
): ParamErrors {
  const errors: ParamErrors = {};
  for (const v of vars) {
    const raw = values[v.name] ?? "";
    if (raw.trim() === "") {
      if (v.required !== false) errors[v.name] = "Required";
      continue;
    }
    if (v.type === "number" && Number.isNaN(Number(raw))) {
      errors[v.name] = "Must be a number";
    } else if (v.type === "enum" && v.enumValues && !v.enumValues.includes(raw)) {
      errors[v.name] = `Must be one of: ${v.enumValues.join(", ")}`;
    }
  }
  return errors;
}

/** Separator for {@link paramSeedKey}: a NUL, which cannot occur in a variable name. */
const SEED_SEPARATOR = "\u0000";

/**
 * When the fill dialog re-seeds its inputs: the variable name set while it is
 * open, `""` while closed. A parent passing a fresh `variables` array with the
 * same names keeps the user's input; reopening or a new name set re-seeds.
 * Names are joined with NUL so `["a b"]` and `["a", "b"]` never collide.
 */
export function paramSeedKey(open: boolean, vars: readonly VariableDef[]): string {
  return open ? vars.map((v) => v.name).join(SEED_SEPARATOR) : "";
}

/**
 * A field's value for binding: `""` while unset. The dialog's fields render
 * before its seeding effect runs, and a kit input bound to `undefined`
 * throws `props_invalid_value`.
 */
export function paramValue(values: ParamValues, name: string): string {
  return values[name] ?? "";
}

/** Coerce string inputs to the typed values the run body expects. */
export function toVariableValues(
  vars: readonly VariableDef[],
  values: ParamValues,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const v of vars) {
    const raw = values[v.name] ?? "";
    if (raw.trim() === "" && v.required === false) continue;
    out[v.name] = v.type === "number" ? Number(raw) : raw;
  }
  return out;
}
