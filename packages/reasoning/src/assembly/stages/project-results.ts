import type { AssemblyCtx } from "../project.js";
import { pushStage, recordMessage } from "../trace.js";

export const projectResultsStage = (c: AssemblyCtx): AssemblyCtx => {
  const results = c.log.byKind("tool_result");
  const calls = c.log.byKind("tool_called");
  let messages = [...c.messages];
  let trace = c.trace;
  let full = 0;
  let summarized = 0;
  for (const r of results) {
    const call = calls.find((x) => x.callId === r.callId);
    const stored = c.store.get(r.ref);
    if (!stored) continue;
    const fullText = c.store.materialize(r.ref, "bullets");
    let content: string;
    let projection: "full" | "summary+ref";
    if (fullText.length <= c.capability.recencyBudgetChars) {
      content = fullText;
      projection = "full";
      full++;
    } else {
      content = c.store.summarize(r.ref);
      projection = "summary+ref";
      summarized++;
    }
    messages = [...messages, { role: "tool_result", toolCallId: r.callId, toolName: call?.tool ?? "tool", content }];
    trace = recordMessage(trace, { role: "tool_result", chars: content.length, projection });
  }
  return { ...c, messages, trace: pushStage(trace, "projectResults", `${full} full, ${summarized} summary+ref`) };
};
