import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => {
  const goal = c.log.byKind("goal").at(-1)?.text ?? "";
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const parts = [c.persona.system];
  if (goal) parts.push(`\nGoal: ${goal}`);
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);
  const systemPrompt = parts.join("\n");
  return { ...c, systemPrompt, trace: pushStage(c.trace, "systemPrompt", `goal+${remaining.length} remaining`) };
};
