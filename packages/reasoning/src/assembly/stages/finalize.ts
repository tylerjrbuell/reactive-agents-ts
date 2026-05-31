import type { AssemblyCtx } from "../project.js";
import { pushStage, recordMessage } from "../trace.js";

export const finalizeStage = (c: AssemblyCtx): AssemblyCtx => {
  let trace = c.trace;
  for (const m of c.messages) {
    if (m.role !== "tool_result") {
      trace = recordMessage(trace, { role: m.role, chars: (m.content ?? "").length });
    }
  }
  return { ...c, trace: pushStage(trace, "finalize", `${c.messages.length} messages`) };
};
