import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const selectToolsStage = (c: AssemblyCtx): AssemblyCtx => ({
  ...c,
  toolSchemas: c.tools.schemas,
  trace: pushStage(c.trace, "selectTools", "stub"),
});
