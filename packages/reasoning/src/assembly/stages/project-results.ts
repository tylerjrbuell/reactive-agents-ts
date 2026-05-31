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
 * budget is shown in FULL; an overflowing result is replaced by a clean
 * SYSTEM summary+ref (no `[STORED:]` marker, no `recall(` hint) — the model can
 * only act on it by reference. Full data stays recoverable system-side via the
 * ResultStore.
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
  const goal = c.log.byKind("goal").at(-1)?.text;
  if (goal) {
    messages = [...messages, { role: "user", content: goal }];
  }

  // 2. Reconstruct turns. Consecutive tool_called events (a parallel batch)
  //    collapse into one assistant turn; flush that turn when the first of its
  //    results arrives (subsequent parallel results just append after it).
  let pending: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  const flush = () => {
    if (pending.length === 0) return;
    messages = [...messages, { role: "assistant", content: "", toolCalls: pending }];
    trace = recordMessage(trace, { role: "assistant", chars: 0 });
    pending = [];
  };

  for (const e of c.log.events) {
    if (e.kind === "tool_called") {
      pending.push({ id: e.callId, name: e.tool, arguments: e.args });
    } else if (e.kind === "tool_result") {
      flush(); // close the assistant turn before emitting its result(s)
      const stored = c.store.get(e.ref);
      if (!stored) continue;
      const call = c.log.byKind("tool_called").find((x) => x.callId === e.callId);
      const fullText = c.store.materialize(e.ref, "bullets");
      let content: string;
      let projection: "full" | "summary+ref";
      if (fullText.length <= c.capability.recencyBudgetChars) {
        content = fullText;
        projection = "full";
        full++;
      } else {
        content = c.store.summarize(e.ref);
        projection = "summary+ref";
        summarized++;
      }
      messages = [
        ...messages,
        { role: "tool_result", toolCallId: e.callId, toolName: call?.tool ?? "tool", content },
      ];
      trace = recordMessage(trace, { role: "tool_result", chars: content.length, projection });
    }
  }
  flush(); // trailing unanswered calls (defensive; mirrors legacy faithfulness)

  return { ...c, messages, trace: pushStage(trace, "projectResults", `${full} full, ${summarized} summary+ref`) };
};
