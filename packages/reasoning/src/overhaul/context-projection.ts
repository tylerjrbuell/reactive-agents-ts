/**
 * Overhaul — ContextManager projection (principle #1).
 *
 * The model-visible window is a SYSTEM-owned projection. For any stored tool
 * result that OVERFLOWS the recency budget, we replace its message content with a
 * clean SYSTEM SUMMARY + reference — NO copyable `[STORED:]` marker, NO preview to
 * transcribe, NO `recall(...)` hint. The model can only act on it by REFERENCE
 * (write_result_to_file(result_ref, path)). Results that FIT the budget are left
 * untouched (the model can still reason over / transcribe them).
 *
 * This closes the gap the end-to-end run exposed: with the marker present, weak
 * models (cogito) copy it instead of referencing. Remove the marker → nothing to
 * copy → the model uses the tool (as it did in the isolated spike).
 *
 * Pure. Reads the scratchpad (full bodies) read-only. Lives outside kernel/**;
 * the kernel calls it through one flag-gated seam in attend/context-utils.ts.
 */
import { describeShape } from "@reactive-agents/tools";

/** Active only under RA_OVERHAUL=1 (opt-in on the overhaul branch). */
export const overhaulProjectionEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.RA_OVERHAUL === "1";

interface ToolResultMsg {
  readonly role: string;
  readonly content: string;
  readonly storedKey?: string;
  readonly toolName?: string;
}

/** Clean system summary that points the model at the reference tool. No bulk,
 *  no marker, no recall hint. */
export function summarizeStored(ref: string, tool: string | undefined, fullValue: string): string {
  let shape: string;
  try {
    shape = describeShape(JSON.parse(fullValue));
  } catch {
    shape = `text (${fullValue.length} chars)`;
  }
  const toolLabel = tool ? `${tool} ` : "";
  return (
    `${toolLabel}result is stored as result_ref="${ref}" (${shape}). ` +
    `The full data is held in the system store — it is NOT shown here to keep context clean. ` +
    `To write it to a file, call write_result_to_file(result_ref="${ref}", path, format). ` +
    `Do not retype or summarize the data yourself.`
  );
}

/**
 * Rewrite overflowing stored tool_result messages to the clean summary+ref.
 *
 * @param messages  conversation thread (storedKey still intact, pre-provider)
 * @param scratchpad full-body store keyed by storedKey
 * @param overflowBudget chars above which a stored result is projected to summary
 */
export function applyOverhaulContextProjection<
  M extends { readonly role: string; readonly content: string; readonly storedKey?: string; readonly toolName?: string },
>(messages: readonly M[], scratchpad: ReadonlyMap<string, string>, overflowBudget: number): M[] {
  return messages.map((msg) => {
    if (msg.role !== "tool_result") return msg;
    const tr = msg as M & ToolResultMsg;
    const ref = tr.storedKey;
    if (!ref) return msg; // small result, already fully inline — leave it
    const full = scratchpad.get(ref);
    if (full === undefined) return msg;
    if (full.length <= overflowBudget) return msg; // fits — keep full (model may reason/transcribe)
    // Overflows — project to a clean summary+ref. No marker, no preview, no recall.
    return { ...tr, content: summarizeStored(ref, tr.toolName, full) } as M;
  });
}
