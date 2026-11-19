// File: src/strategies/code-action/sandbox-tool-result.ts
//
// What the generated code receives from a tool call, and when the value it
// returns is not an answer. Pure and deterministic (no LLM).
//
// Cortex trace 01M7T338WQJ4TV6Z6M6T3SNHHP (2026-11-19): an MCP tool's text
// result reached the code as a JSON string, the code read `res.websites` off
// the string, got undefined, and returned `{ error: "No websites found ..." }`.
// code-action then shipped that object as a completed answer.
import { contradictedEmptyAnswer } from "../../kernel/capabilities/verify/contradicted-empty.js";
import { formatResultShapes } from "./result-shape.js";
import type { SucceededToolCall } from "./result-shape.js";

/**
 * The value a sandbox tool call resolves to. Text that is a JSON object or
 * array (how MCP tools return structured data) is decoded, so generated code
 * can read its fields. Any other value, including text that does not parse,
 * is returned unchanged.
 *
 * @param result - the `result` of a successful ToolService call
 */
export function decodeSandboxToolResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  const text = result.trim();
  const first = text[0];
  if (first !== "{" && first !== "[") return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return result;
  }
}

/**
 * The error message when the code's returned value is only an error: a plain
 * object whose single field is a non-empty `error`. Such a value reports that
 * the code failed; it is not an answer. Returns undefined for anything else,
 * including objects that carry data beside the error.
 *
 * @param value - the sandbox's final result
 */
export function errorShapedResult(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "error") return undefined;
  const error: unknown = Reflect.get(value, "error");
  const message = typeof error === "string" ? error : JSON.stringify(error) ?? "";
  return message.trim().length > 0 ? message : undefined;
}

/**
 * Why a sandbox run that finished without throwing still produced no answer,
 * or undefined when its result can be judged as an answer. Three cases:
 * the returned value is only an error (`errorShapedResult`), the code called
 * tools and every call failed, or the value says nothing was found while a
 * successful call of the run returned data (`contradictedEmptyAnswer`).
 * code-action treats each as a failing verdict: it retries while iterations
 * remain and fails the run at the cap.
 *
 * @param run.finalResult - the value the code returned
 * @param run.attempted - tool calls the code made this iteration
 * @param run.succeeded - tool calls that returned a result
 * @param run.lastFailure - the last failed call's message, if any
 * @param run.evidence - every successful tool call of the run so far
 */
export function unusableSandboxResult(run: {
  readonly finalResult: unknown;
  readonly attempted: number;
  readonly succeeded: number;
  readonly lastFailure: string | undefined;
  /** Every successful tool call of the run so far (all iterations). */
  readonly evidence?: readonly SucceededToolCall[];
}): string | undefined {
  const returnedError = errorShapedResult(run.finalResult);
  if (returnedError !== undefined) return `the code returned an error instead of an answer: ${returnedError}`;
  if (run.attempted > 0 && run.succeeded === 0) {
    return `every tool call failed (${run.attempted} attempted)${run.lastFailure !== undefined ? `; last error: ${run.lastFailure}` : ""}`;
  }
  // A nothing-found answer the run's own tool results contradict (trace
  // 01M7T7BJMFHVT2PCHNYWMG9S4P): the code misread a result, it did not find nothing.
  const evidence = run.evidence ?? [];
  const contradiction = contradictedEmptyAnswer(
    run.finalResult,
    evidence.map((c) => ({ name: c.fnName, result: c.result })),
  );
  if (contradiction !== undefined) {
    const shapes = formatResultShapes(evidence.filter((c) => c.fnName === contradiction.contradictedBy));
    return `the code returned ${contradiction.answer} (nothing found), but ${contradiction.contradictedBy} returned data. ` +
      `The code misread a result. Actual result shape:\n${shapes}`;
  }
  return undefined;
}
