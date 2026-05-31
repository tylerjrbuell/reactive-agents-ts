import type { AssemblyCtx } from "../project.js";
import { pushStage, setTools } from "../trace.js";

export const selectToolsStage = (c: AssemblyCtx): AssemblyCtx => {
  const seen = new Set<string>();
  const deduped = c.tools.schemas.filter((s) => {
    const n = (s as { name?: string }).name ?? "";
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const names = deduped.map((s) => (s as { name?: string }).name ?? "");
  return { ...c, toolSchemas: deduped, trace: setTools(pushStage(c.trace, "selectTools", `${deduped.length} tools`), names) };
};
