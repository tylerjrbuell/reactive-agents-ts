// File: src/kernel/utils/llm-failure.ts
//
// Structural description of a failed LLM call (error class + message), shared by
// the failed `llm-exchange` emit (observable-llm.ts) and the `llm_error`
// terminal (consume-think-stream.ts -> terminal_decision / TerminalOutcome).
//
// STRUCTURAL ON PURPOSE: the provider layer owns its typed error; the kernel
// reads only string fields (`_tag` | `kind` | `name`) off whatever it is handed
// and never imports a provider symbol. A generic `name: "Error"` carries no
// information and is skipped. Pure; leaf module; measurement only.

/** Error class + message of a failed LLM call. */
export interface LlmFailure {
  readonly errorClass: string;
  readonly message: string;
}

const MESSAGE_MAX = 500;
const UNKNOWN_CLASS = "unknown";
const CLASS_FIELDS = ["_tag", "kind", "name"] as const;

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;

const classOf = (rec: Record<string, unknown> | undefined): string | undefined => {
  if (rec === undefined) return undefined;
  for (const field of CLASS_FIELDS) {
    const value = rec[field];
    if (typeof value === "string" && value.length > 0 && value !== "Error") return value;
  }
  return undefined;
};

/**
 * Describe a failed LLM call from whatever the stream/effect failed with.
 * Looks at the value itself, then one level down its `cause` (wrappers such as
 * the kernel's own ExecutionError carry the provider error there).
 */
export function describeLlmFailure(err: unknown): LlmFailure {
  const rec = asRecord(err);
  const inner = asRecord(rec?.["cause"]);
  const errorClass = classOf(inner) ?? classOf(rec) ?? UNKNOWN_CLASS;
  const rawMessage =
    typeof rec?.["message"] === "string" && rec["message"].length > 0 ? rec["message"] : String(err);
  return { errorClass, message: rawMessage.slice(0, MESSAGE_MAX) };
}
