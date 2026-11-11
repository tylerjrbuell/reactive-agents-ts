/**
 * AgentConfig → TypeScript source ("config as code").
 *
 * Prints the builder chain that reproduces an `AgentConfig`. It reads the same
 * call list that `agentConfigToBuilder()` applies (`agentConfigToBuilderCalls`),
 * so the printed code and the live builder cannot drift apart.
 *
 * Secrets never appear in the output. MCP `env` and `headers` values and any
 * `apiKey` / `secret` / `password` string print as `process.env.NAME ?? ""`.
 */
import type { AgentConfig } from "../agent-config.js";
import { HarnessProfile, type HarnessProfileName } from "../capabilities/profile.js";
import { agentConfigToBuilderCalls, type BuilderCall } from "./config-calls.js";

/** Options for {@link agentConfigToSource}. */
export interface AgentConfigSourceOptions {
  /**
   * `"module"` prints an `import` line and an exported `const`.
   * `"expression"` prints only the builder chain.
   * Default: `"module"`.
   */
  readonly format?: "module" | "expression";
  /** Package to import `ReactiveAgents` from. Default: `"reactive-agents"`. */
  readonly importFrom?: string;
  /**
   * End the chain with `.build()`. When `false`, the chain stops at the
   * configured builder. Default: `true`.
   */
  readonly build?: boolean;
}

/** A secret replaced by an environment variable reference. */
class EnvRef {
  constructor(readonly name: string) {}
}

const INDENT = "  ";
const INLINE_MAX = 72;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SECRET_KEYS = new Set(["apiKey", "secret", "password"]);
/** Records keyed by user names (tools, models): never treated as secrets. */
const NAME_KEYED_RECORDS = new Set(["riskLevels", "maxCallsPerTool", "pricingRegistry"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof EnvRef);

/** Upper snake case, safe as a `process.env.NAME` identifier. */
const envName = (parts: readonly string[]): string => {
  const name = parts
    .join("_")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(name) ? `_${name}` : name || "SECRET";
};

/** An env-var name that is already a valid identifier is kept as written. */
const envKeyName = (key: string): string => (IDENTIFIER.test(key) ? key : envName([key]));

const redactRecordValues = (
  rec: Record<string, unknown>,
  nameOf: (key: string) => string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = typeof v === "string" ? new EnvRef(nameOf(k)) : v;
  return out;
};

/**
 * Replace secret strings with env references. `hint` collects context for the
 * variable name (method, then the nearest `name` or `path` field).
 */
const redact = (value: unknown, hint: readonly string[]): unknown => {
  if (Array.isArray(value)) return value.map((v) => redact(v, hint));
  if (!isRecord(value)) return value;
  const own = typeof value["name"] === "string" ? [value["name"]] : typeof value["path"] === "string" ? [value["path"]] : [];
  const h = [...hint, ...own];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "env" && isRecord(v)) out[k] = redactRecordValues(v, envKeyName);
    else if (k === "headers" && isRecord(v)) out[k] = redactRecordValues(v, (key) => envName([...h, key]));
    else if (SECRET_KEYS.has(k) && typeof v === "string") out[k] = new EnvRef(envName([...h, k]));
    else if (NAME_KEYED_RECORDS.has(k)) out[k] = v;
    else out[k] = redact(v, h);
  }
  return out;
};

const methodHint = (method: string): string => {
  if (method === "withMCP") return "MCP";
  return method.replace(/^with(out)?/, "");
};

const printKey = (key: string): string => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

const isScalar = (v: unknown): boolean => !Array.isArray(v) && !isRecord(v);

/** Print a value as a TypeScript expression at the given indent level. */
const printValue = (value: unknown, level: number): string => {
  if (value instanceof EnvRef) return `process.env.${value.name} ?? ""`;
  if (value === undefined) return "undefined";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  const pad = INDENT.repeat(level + 1);
  const close = INDENT.repeat(level);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => printValue(v, level + 1));
    const inline = `[${items.join(", ")}]`;
    if (value.every(isScalar) && inline.length <= INLINE_MAX) return inline;
    return `[\n${items.map((i) => `${pad}${i},`).join("\n")}\n${close}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const items = entries.map(([k, v]) => `${printKey(k)}: ${printValue(v, level + 1)}`);
    const inline = `{ ${items.join(", ")} }`;
    if (entries.every(([, v]) => isScalar(v)) && inline.length <= INLINE_MAX) return inline;
    return `{\n${items.map((i) => `${pad}${i},`).join("\n")}\n${close}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

/** `HarnessProfile.<name>()` when the patch is exactly a named preset. */
const profileExpression = (arg: unknown): string | undefined => {
  if (!isRecord(arg) || typeof arg["name"] !== "string") return undefined;
  const name = arg["name"];
  if (name !== "lean" && name !== "balanced" && name !== "intelligent") return undefined;
  const preset: HarnessProfileName = name;
  return JSON.stringify(HarnessProfile[preset]()) === JSON.stringify(arg) ? `HarnessProfile.${preset}()` : undefined;
};

const printCall = (c: BuilderCall): { readonly line: string; readonly usesProfile: boolean } => {
  if (c.method === "withProfile") {
    const expr = profileExpression(c.args[0]);
    if (expr) return { line: `.withProfile(${expr})`, usesProfile: true };
  }
  const args = c.args.map((a) => printValue(redact(a, [methodHint(c.method)]), 1));
  return { line: `.${c.method}(${args.join(", ")})`, usesProfile: false };
};

/**
 * Print TypeScript that builds the agent described by an `AgentConfig`.
 *
 * The output is a `ReactiveAgents.create()` chain with one call per
 * {@link agentConfigToBuilderCalls} entry, in the same order, so evaluating it
 * gives the same builder as `agentConfigToBuilder(config)`. Formatting is
 * deterministic: the same config always prints the same text.
 *
 * Secrets are never printed. MCP `env` values print as `process.env.<KEY>`,
 * MCP `headers` values as `process.env.MCP_<SERVER>_<HEADER>`, and `apiKey` /
 * `secret` / `password` strings as an upper-snake name built from where they
 * sit (a gateway webhook `secret` on `/hook` becomes
 * `process.env.GATEWAY_HOOK_SECRET`). Each reference ends in `?? ""`.
 *
 * `outputSchemaOptions` print as a comment: the schema object is code-only,
 * so add `.withOutputSchema(schema, options)` yourself.
 *
 * @param config - The agent configuration to print.
 * @param options - Output format; see {@link AgentConfigSourceOptions}.
 * @returns TypeScript source text.
 *
 * @example
 * ```typescript
 * agentConfigToSource({ name: "helper", provider: "anthropic", execution: { maxIterations: 5 } });
 * // import { ReactiveAgents } from "reactive-agents";
 * //
 * // export const agent = await ReactiveAgents.create()
 * //   .withName("helper")
 * //   .withProvider("anthropic")
 * //   .withMaxIterations(5)
 * //   .build();
 * ```
 */
export function agentConfigToSource(config: AgentConfig, options: AgentConfigSourceOptions = {}): string {
  const format = options.format ?? "module";
  const build = options.build ?? true;
  const importFrom = options.importFrom ?? "reactive-agents";

  const printed = agentConfigToBuilderCalls(config).map(printCall);
  const lines = printed.map((p) => `${INDENT}${p.line}`);
  if (config.outputSchemaOptions) {
    const opts = printValue(config.outputSchemaOptions, 1);
    const oneLine = opts.includes("\n") ? JSON.stringify(config.outputSchemaOptions) : opts;
    lines.push(`${INDENT}// .withOutputSchema(schema, ${oneLine}) — the schema object is code-only`);
  }
  if (build) lines.push(`${INDENT}.build()`);
  const chain = ["ReactiveAgents.create()", ...lines].join("\n");

  if (format === "expression") return chain;

  const imports = printed.some((p) => p.usesProfile) ? "HarnessProfile, ReactiveAgents" : "ReactiveAgents";
  const declaration = build ? `export const agent = await ${chain};` : `export const builder = ${chain};`;
  return `import { ${imports} } from ${JSON.stringify(importFrom)};\n\n${declaration}\n`;
}
