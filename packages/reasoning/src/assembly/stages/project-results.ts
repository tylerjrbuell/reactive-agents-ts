import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const projectResultsStage = (c: AssemblyCtx): AssemblyCtx => ({
  ...c,
  trace: pushStage(c.trace, "projectResults", "stub"),
});
