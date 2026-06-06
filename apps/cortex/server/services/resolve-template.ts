/**
 * Server-authoritative template resolver for Cortex parameterized runs.
 *
 * Pure. Substitutes `{{token}}` in every string leaf of a JSON-ish value from
 * supplied values (falling back to per-variable defaults). The `secret.`
 * namespace is reserved for a future secret store and resolves to "unresolved"
 * in Phase 1. This is the SINGLE resolver — the UI delegates to it via
 * `POST /api/template/resolve`; there is no client twin.
 */

export type VariableType = "string" | "number" | "enum" | "multiline";

export interface VariableDef {
  name: string;
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;
  enumValues?: string[];
  secret?: boolean;
}

export interface ResolveResult<T> {
  value: T;
  unresolved: string[];
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Extract deduped `{{token}}` names from a string, excluding the `secret.` namespace. */
export function scanTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]!;
    if (name.startsWith("secret.")) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function resolveString(
  text: string,
  byName: Map<string, VariableDef>,
  values: Readonly<Record<string, string | number>>,
  unresolved: Set<string>,
): string {
  return text.replace(TOKEN, (_full, nameRaw: string) => {
    const name = nameRaw;
    if (name.startsWith("secret.")) {
      unresolved.add(name);
      return `{{${name}}}`;
    }
    const def = byName.get(name);
    const raw = values[name] ?? def?.default;
    if (raw != null) return String(raw);
    if (def === undefined || def.required !== false) {
      unresolved.add(name);
      return `{{${name}}}`;
    }
    return "";
  });
}

function walk(
  node: unknown,
  byName: Map<string, VariableDef>,
  values: Readonly<Record<string, string | number>>,
  unresolved: Set<string>,
): unknown {
  if (typeof node === "string") return resolveString(node, byName, values, unresolved);
  if (Array.isArray(node)) return node.map((n) => walk(n, byName, values, unresolved));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(val, byName, values, unresolved);
    }
    return out;
  }
  return node;
}

export function resolveTemplate<T>(
  input: T,
  variables: readonly VariableDef[],
  values: Readonly<Record<string, string | number>>,
): ResolveResult<T> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const unresolved = new Set<string>();
  const value = walk(input, byName, values, unresolved) as T;
  return { value, unresolved: [...unresolved] };
}
