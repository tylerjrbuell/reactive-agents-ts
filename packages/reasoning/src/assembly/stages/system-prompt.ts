import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => ({
  ...c,
  systemPrompt: c.persona.system,
  trace: pushStage(c.trace, "systemPrompt", "stub"),
});
