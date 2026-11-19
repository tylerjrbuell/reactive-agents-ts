// File: src/strategies/code-action/result-shape.ts
//
// The structural shape of a value a tool call returned, rendered compactly so a
// repair prompt can show the model what the data really looks like. Pure and
// deterministic (no LLM), token-bounded, and types-only: no data values reach
// the prompt through this, only key names and value types.
//
// Cortex traces 01M7T7A58VBP4CHMSJPKQ516SR / 01M7T7C5JZ2K8TKZN8KE8PSNRF
// (2026-11-19, gpt-4o): the model wrote the whole program before seeing any
// result and guessed `websites[0].websiteId`, then `.results`, then
// `{ websites }`. Each repair prompt carried only the error, so every next
// guess was blind too. Two of three runs took three attempts.

/** Keys rendered per object before the rest are counted. */
const MAX_KEYS = 10;
/** Nesting levels rendered before a value collapses to its type name. */
const MAX_DEPTH = 3;
/** Characters one shape may use in a prompt. */
const MAX_SHAPE_CHARS = 360;
/** Tool calls one shape list may show. */
const MAX_CALLS = 8;

/**
 * One successful tool call the generated code made: the identifier the code
 * called it by, the arguments it passed, and the decoded value it received.
 */
export interface SucceededToolCall {
  readonly fnName: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly result: unknown;
}

const keyLabel = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

function shapeOf(value: unknown, depth: number): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const count = `(${value.length} item${value.length === 1 ? "" : "s"})`;
    return depth >= MAX_DEPTH ? `array ${count}` : `[${shapeOf(value[0], depth + 1)}] ${count}`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    if (depth >= MAX_DEPTH) return "object";
    const shown = keys
      .slice(0, MAX_KEYS)
      .map((k) => `${keyLabel(k)}: ${shapeOf(Reflect.get(value, k), depth + 1)}`);
    const more = keys.length > MAX_KEYS ? `, ...+${keys.length - MAX_KEYS} keys` : "";
    return `{ ${shown.join(", ")}${more} }`;
  }
  return typeof value;
}

/**
 * The shape of a value: key names and value types, arrays shown by their first
 * element and item count. Truncated to a fixed character budget.
 *
 * @example describeValueShape({ websites: [{ id: "a", name: "b" }], page: 1 })
 * // => '{ websites: [{ id: string, name: string }] (1 item), page: number }'
 */
export function describeValueShape(value: unknown): string {
  const shape = shapeOf(value, 0);
  return shape.length > MAX_SHAPE_CHARS ? `${shape.slice(0, MAX_SHAPE_CHARS)}...` : shape;
}

const argsLabel = (args: unknown): string => {
  const text = JSON.stringify(args) ?? "";
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
};

/**
 * One line per distinct successful call (same identifier and same result shape
 * shown once), at most a fixed number of lines. Empty when no call succeeded.
 *
 * @param calls - successful tool calls, in call order
 */
export function formatResultShapes(calls: readonly SucceededToolCall[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const call of calls) {
    const shape = describeValueShape(call.result);
    const key = `${call.fnName}\u0000${shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (lines.length === MAX_CALLS) {
      lines.push("- ...");
      break;
    }
    lines.push(`- ${call.fnName}(${argsLabel(call.args)}) returned: ${shape}`);
  }
  return lines.join("\n");
}

/**
 * The repair-prompt section naming what the successful calls really returned,
 * or an empty string when none succeeded (the prompt is then unchanged).
 *
 * @param calls - successful tool calls of the failed attempt, in call order
 */
export function resultShapesSection(calls: readonly SucceededToolCall[]): string {
  const lines = formatResultShapes(calls);
  return lines.length === 0
    ? ""
    : `These calls succeeded before the failure. Read their results by these actual shapes:\n${lines}`;
}
