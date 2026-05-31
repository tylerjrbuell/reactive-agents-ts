import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const finalizeStage = (c: AssemblyCtx): AssemblyCtx => ({
  ...c,
  trace: pushStage(c.trace, "finalize", "stub"),
});
