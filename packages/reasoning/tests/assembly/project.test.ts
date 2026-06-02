import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("project — pure total assembler", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  it("is deterministic — same inputs → byte-identical output", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const store = new ResultStore();
    const a = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    const b = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
    expect(a.request.systemPrompt).toContain("P");
  });
  it("returns a populated trace with all 5 stages in order", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const { trace } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] } });
    expect(trace.stages.map((s) => s.name)).toEqual(["systemPrompt", "selectTools", "projectResults", "compactHistory", "finalize"]);
  });
});
