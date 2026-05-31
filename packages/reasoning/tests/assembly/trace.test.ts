import { describe, it, expect } from "bun:test";
import { emptyTrace, pushStage, recordMessage } from "../../src/assembly/trace.js";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("AssemblyTrace — observability by construction", () => {
  it("accumulates stage notes and per-message projection decisions", () => {
    const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    let t = emptyTrace(cap);
    t = pushStage(t, "projectResults", "1 full, 2 cleared");
    t = recordMessage(t, { role: "tool_result", chars: 120, projection: "summary+ref" });
    expect(t.stages[0]!.name).toBe("projectResults");
    expect(t.messages[0]!.projection).toBe("summary+ref");
    expect(t.capability.window).toBe(15360);
  });
});
