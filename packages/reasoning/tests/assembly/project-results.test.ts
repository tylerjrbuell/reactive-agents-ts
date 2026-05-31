import { describe, it, expect } from "bun:test";
import { projectResultsStage } from "../../src/assembly/stages/project-results.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

function ctxWith(value: unknown) {
  const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" }); // tiny window
  const store = new ResultStore();
  const ref = store.put("github/list_commits", value);
  const log = new EventLog()
    .append({ kind: "tool_called", tool: "github/list_commits", callId: "c1", args: {} })
    .append({ kind: "tool_result", callId: "c1", ref, shape: "Array" });
  return { input: { log, capability: cap, store, persona: { system: "" }, tools: { schemas: [] } }, ref };
}

describe("projectResults — full | preview+ref | cleared", () => {
  it("OVERFLOW → preview+ref (bounded preview + ref, no marker)", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `message ${i} ${"x".repeat(50)}` } }));
    const { input, ref } = ctxWith(big);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain(`result_ref="${ref}"`);
    expect(tr.content).not.toContain("[STORED:");
    expect(tr.content).not.toContain("recall(");
    // preview+ref carries CONTENT (some commit messages), not just a bare shape —
    // the Phase-4 regression was bare-ref stripping all content.
    expect(tr.content).toContain("message 0");
    // …but bounded (does not inline all 50 verbose commits).
    expect(tr.content.length).toBeLessThanOrEqual(input.capability.recencyBudgetChars + 400);
    expect(ctx.trace.messages.some((m) => m.projection === "preview+ref")).toBe(true);
  });
  it("FITTING result → present full", () => {
    const small = [{ sha: "s0", commit: { message: "tiny" } }];
    const { input } = ctxWith(small);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain("tiny");
    expect(ctx.trace.messages.some((m) => m.projection === "full")).toBe(true);
  });
});
