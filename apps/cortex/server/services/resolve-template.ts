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

/**
 * A template variable. `{{name}}` tokens resolve against these.
 *
 * NOTE: `type`, `enumValues`, and `secret` are UI/reserved metadata — the launch
 * modal renders inputs by `type`/`enumValues`, and `secret` is reserved for a future
 * secret store. This resolver enforces none of them: it substitutes purely by `name`
 * and treats the `secret.` token namespace (not this flag) as unresolved.
 */
export interface VariableDef {
  name: string;
  /** UI metadata: controls which input widget the launch modal renders. */
  type: VariableType;
  description?: string;
  default?: string | number;
  required: boolean;
  /** UI metadata: option list rendered when `type === "enum"`. */
  enumValues?: string[];
  /** Reserved: future secret store integration. The resolver does NOT read this flag;
   *  it identifies secret tokens via the `secret.` name prefix instead. */
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
  return text.replace(TOKEN, (_full, name: string) => {
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

/**
 * Substitute `{{token}}` placeholders in every string leaf of `input`.
 *
 * @param input     - Any JSON-ish value; non-string leaves are passed through unchanged.
 * @param variables - Variable definitions keyed by `name`. Only `name`, `default`, and
 *                    `required` affect resolution; `type`/`enumValues`/`secret` are ignored.
 * @param values    - Caller-supplied overrides. A supplied value **always** wins over
 *                    `default`, including falsy values (`0`, `""`) — the merge uses `??`
 *                    so only `undefined`/missing keys fall through to `default`.
 * @returns `{ value, unresolved }` where `unresolved` lists every token that could not be
 *          substituted (missing required variable, unknown token, or `secret.` namespace).
 *          Tokens in `unresolved` are left literal in the output (`{{token}}`).
 */
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
