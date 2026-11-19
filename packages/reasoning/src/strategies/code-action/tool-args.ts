// File: src/strategies/code-action/tool-args.ts
//
// Shapes the argument a sandboxed tool call passes before it reaches
// ToolService. Generated code calls a tool as `fn()` for a tool with no
// required parameters, which posts `undefined`; ToolService takes an object.
// Cortex run 01M7SZFGGV6W2K8R4V2H873NPM (2026-11-19) failed all 10 iterations
// on `Object.keys(args)` of that `undefined`.

/** Shaped tool-call arguments: `args` to dispatch, or `error` to throw into the generated code. */
export interface SandboxToolArgs {
  readonly args: Record<string, unknown>;
  readonly error?: string;
}

const isArgsObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shape one sandbox tool-call argument. `undefined` and `null` become `{}`
 * (a zero-argument call). An object passes through. Any other value gets an
 * `error` naming the expected call shape; `args` is then `{}` and must not
 * be dispatched.
 *
 * @param args - the raw value the generated code passed
 * @param fnName - the identifier the model calls the tool by
 * @param firstParam - a parameter name to show in the example call, if any
 */
export function shapeSandboxToolArgs(args: unknown, fnName: string, firstParam?: string): SandboxToolArgs {
  if (args === undefined || args === null) return { args: {} };
  if (isArgsObject(args)) return { args };
  const example = firstParam !== undefined ? `${fnName}({ ${firstParam}: value })` : `${fnName}({})`;
  const got = Array.isArray(args) ? "an array" : `a ${typeof args}`;
  return { args: {}, error: `${fnName} takes one object argument, e.g. ${example}; got ${got}` };
}
