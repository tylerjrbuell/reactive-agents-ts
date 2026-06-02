import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const finalizeStage = (c: AssemblyCtx): AssemblyCtx => {
  // Trace.messages is recorded single-source by project-results (the sole c.messages
  // builder), in thread order with per-result projection tags. finalize must NOT
  // re-record — doing so double-counted assistant turns and appended the goal last,
  // producing a trace that misrepresented the real thread. finalize only marks the
  // stage (and is the seam for any future request-shaping that needs a last word).
  return { ...c, trace: pushStage(c.trace, "finalize", `${c.messages.length} messages`) };
};
