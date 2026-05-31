import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const compactHistoryStage = (c: AssemblyCtx): AssemblyCtx => ({
  ...c,
  trace: pushStage(c.trace, "compactHistory", "stub"),
});
