import type { AssemblyCtx } from "../project.js";
import { pushStage, recordMessage } from "../trace.js";

/**
 * Build the provider-valid conversation thread and project each tool result.
 *
 * The thread MUST satisfy the Anthropic/OpenAI native-FC contract:
 *   1. it opens with a `user` turn (the goal),
 *   2. every `tool_result` is answered by a `tool_use` of the matching id in the
 *      IMMEDIATELY-preceding assistant turn,
 *   3. a parallel batch of calls collapses into ONE assistant turn whose results
 *      all follow in the next user turn.
 *
 * Per-result projection (the honesty layer): a result that fits the recency
 * budget is shown in FULL; an overflowing result is replaced by a clean SYSTEM
 * preview+ref — a bounded, structure-aware content preview (heading skeleton for
 * markdown, else head) + the ref (no `[STORED:]` marker, no `recall(` hint). The
 * model can summarize from the preview AND act on the full data by reference.
 * Full data stays recoverable system-side via the ResultStore.
 *
 * Walks `log.events` in order (NOT byKind, which loses cross-kind ordering) so
 * turns are reconstructed faithfully.
 */
export const projectResultsStage = (c: AssemblyCtx): AssemblyCtx => {
  let messages = [...c.messages];
  let trace = c.trace;
  let full = 0;
  let summarized = 0;

  // 1. Opening user turn = goal. Provider threads must begin with a user message.
  // project-results is the SOLE builder of c.messages, so it is also the SOLE
  // trace recorder — record each turn here, in thread order (finalize must NOT
  // re-record, or assistants double-count and the goal lands last → a trace that
  // lies about the real thread).
  const goal = c.log.byKind("goal").at(-1)?.text;
  if (goal) {
    messages = [...messages, { role: "user", content: goal }];
    trace = recordMessage(trace, { role: "user", chars: goal.length });
  }

  // 2. Reconstruct turns. Consecutive tool_called events (a parallel batch)
  //    collapse into one assistant turn; flush that turn when the first of its
  //    results arrives (subsequent parallel results just append after it).
  //
  // Recency-aware per-result projection (2026-06-02):
  //   • Latest tool_result   → FULL if ≤ recencyBudgetChars (model attention).
  //                            That's the result the model is acting on NOW.
  //   • Older tool_results   → FULL if ≤ toolResultPreserveBudget (tight legacy
  //                            cap, tier-aware). Otherwise preview+ref so the
  //                            thread doesn't bloat with stale full payloads.
  //
  // Phase-A 2026-06-02 measurement: a flat per-result preserve cap (legacy's
  // 4000-chars for local tier) regressed transcribe 100→0% and recall 100→33%
  // because preview+ref stripped the verbatim content the SOLE/latest result
  // carried. The recency split preserves the latest result's content (large
  // budget, model can act) while still collapsing accumulated history.
  let pending: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  // Thought continuity (RA_THOUGHT_CONTINUITY=1, experimental pending
  // ablation). Default OFF: every replayed assistant turn renders
  // `content: ""`, so the model re-reads its tool calls but never a word of
  // its own reasoning — plans and derivations are re-derived from scratch
  // each turn while the persona says "think step by step". ON: the thought
  // event recorded for the turn is rendered as the assistant content, capped
  // so accumulated prose cannot crowd out tool results. A trailing thought
  // with no following tool call is NOT rendered — that is the terminal
  // answer, which reaches the caller by its own path.
  const renderThoughts = process.env.RA_THOUGHT_CONTINUITY === "1";
  const THOUGHT_CAP = 600;
  let pendingThought: string | undefined;
  const flush = () => {
    if (pending.length === 0) return;
    const thought =
      renderThoughts && pendingThought !== undefined
        ? pendingThought.length > THOUGHT_CAP
          ? `${pendingThought.slice(0, THOUGHT_CAP)}…`
          : pendingThought
        : "";
    messages = [...messages, { role: "assistant", content: thought, toolCalls: pending }];
    trace = recordMessage(trace, { role: "assistant", chars: thought.length });
    pending = [];
    pendingThought = undefined;
  };

  // Pre-pass: index the last tool_result event so we can route it to the
  // recency budget while older results take the preserve budget.
  const toolResultEvents = c.log.events.filter((e) => e.kind === "tool_result");
  const lastResultIdx = toolResultEvents.length - 1;
  let resultSeen = 0;

  for (const e of c.log.events) {
    if (e.kind === "thought") {
      pendingThought = e.text;
    } else if (e.kind === "tool_called") {
      pending.push({ id: e.callId, name: e.tool, arguments: e.args });
    } else if (e.kind === "tool_result") {
      flush(); // close the assistant turn before emitting its result(s)
      const stored = c.store.get(e.ref);
      if (!stored) continue;
      const call = c.log.byKind("tool_called").find((x) => x.callId === e.callId);
      const fullText = c.store.materialize(e.ref, "bullets");
      const isLatest = resultSeen === lastResultIdx;
      // Latest result keeps the generous attention budget so verbatim-style
      // tasks (transcribe / recall a specific sentinel) don't have their
      // content stripped by preview+ref. Older results compress aggressively
      // (legacy tier cap) so the message thread doesn't accumulate stale
      // full payloads across iterations.
      const budget = isLatest
        ? c.capability.recencyBudgetChars
        : c.capability.toolResultPreserveBudget;
      let content: string;
      let projection: "full" | "preview+ref";
      if (fullText.length <= budget) {
        content = fullText;
        projection = "full";
        full++;
      } else {
        content = c.store.preview(e.ref, budget);
        projection = "preview+ref";
        summarized++;
      }
      messages = [
        ...messages,
        { role: "tool_result", toolCallId: e.callId, toolName: call?.tool ?? "tool", content },
      ];
      trace = recordMessage(trace, { role: "tool_result", chars: content.length, projection });
      resultSeen++;
    }
  }
  flush(); // trailing unanswered calls (defensive; mirrors legacy faithfulness)

  return { ...c, messages, trace: pushStage(trace, "projectResults", `${full} full, ${summarized} preview+ref`) };
};
