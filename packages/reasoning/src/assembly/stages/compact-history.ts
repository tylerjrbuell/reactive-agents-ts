import type { AssemblyCtx } from "../project.js";
import { pushStage, recordCompaction } from "../trace.js";
import { compact, type ResultInfo, type CompactMessage } from "../compaction.js";

/**
 * compactHistoryStage — the SINGLE compaction path (C4).
 *
 * Delegates to the pure `compact()` re-projection: over-budget threads drop
 * non-protected exchanges oldest-first, honest stubs enumerate the dropped
 * recallable refs, and protected classes (goal, `preserveOnCompaction`,
 * most-recent evidence) always survive. The dropped-ref enumeration + shrink
 * self-check land on the trace (`trace.compaction`) so `think.ts` can append the
 * `compaction-marker` ledger fact and signal a no-shrink event via `patch.ledger`.
 *
 * `preserveOnCompaction` is made LIVE here (audit 03-F4): its value rides the
 * `tool_result` EventLog event (set in from-kernel-state from the observation
 * step) into the per-callId `ResultInfo` map `compact()` reads.
 */
export const compactHistoryStage = (c: AssemblyCtx): AssemblyCtx => {
  // Budget the MESSAGE thread against the space actually left in the window
  // AFTER the non-message sections of the assembled prompt. `capability.window`
  // is the raw model window (input+output combined); compaction previously
  // budgeted messages at the FULL window (×4 chars), ignoring the system prompt,
  // the tool schemas, and the output reserve that ride alongside messages in the
  // same window — so a thread "within budget" could still overflow once
  // assembled (tight defect, robust path). Reserve that headroom so the valve
  // matches its stated intent: keep the ASSEMBLED prompt within the window.
  //
  // Over-reservation is the safe direction (compacts slightly earlier, never
  // under-budgets): for text-parse the tool reference is rendered INTO the
  // system prompt AND counted again here via toolSchemas — a deliberate
  // conservative double-count, not a bug. The ×4 chars/token proxy matches the
  // heuristic used everywhere else in assembly.
  const inputBudgetTokens = Math.max(0, c.capability.window - c.capability.outputBudget);
  const nonMessageChars =
    c.systemPrompt.length + JSON.stringify(c.toolSchemas).length;
  const MIN_MESSAGE_CHARS = 2000; // never starve the thread below a floor
  const limitChars = Math.max(
    MIN_MESSAGE_CHARS,
    inputBudgetTokens * 4 - nonMessageChars,
  );

  // Build callId → {ref, preserve} from the EventLog so compaction can protect
  // preserved results and enumerate dropped refs — no parallel per-message array.
  const resultInfo = new Map<string, ResultInfo>();
  for (const e of c.log.byKind("tool_result")) {
    resultInfo.set(e.callId, { ref: e.ref, preserve: e.preserve === true });
  }

  const result = compact({
    messages: c.messages as readonly CompactMessage[],
    limitChars,
    resultInfo,
  });

  if (!result.attempted) {
    return { ...c, trace: pushStage(c.trace, "compactHistory", "under limit, no-op") };
  }

  const note = result.shrank
    ? `compacted ${result.droppedBlocks} exchange(s), ${result.droppedRefs.length} ref(s) dropped`
    : `NO-SHRINK: over limit but nothing droppable (all protected)`;

  const trace = recordCompaction(pushStage(c.trace, "compactHistory", note), {
    droppedRefs: result.droppedRefs,
    shrank: result.shrank,
    noShrinkEvent: result.noShrinkEvent,
    droppedBlocks: result.droppedBlocks,
  });

  return { ...c, messages: result.messages, trace };
};
