import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

it("end-to-end: 50-commit overflow → summary+ref in request, full data in store", () => {
  // Force overflow via per-result preserve budget (RA_TOOL_RESULT_BUDGET_CHARS).
  // After 2026-06-02 separation between recency-window total and per-result
  // cap, tier-aware default (local=4000) is too generous for this fixture.
  const prev = process.env.RA_TOOL_RESULT_BUDGET_CHARS;
  process.env.RA_TOOL_RESULT_BUDGET_CHARS = "400";
  const cap = resolveCapability({ window: 1000, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  if (prev === undefined) delete process.env.RA_TOOL_RESULT_BUDGET_CHARS;
  else process.env.RA_TOOL_RESULT_BUDGET_CHARS = prev;
  const store = new ResultStore();
  const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i} ${"x".repeat(60)}` } }));
  const ref = store.put("github/list_commits", big);
  const log = new EventLog().append({ kind: "goal", text: "write all 50" })
    .append({ kind: "tool_called", tool: "github/list_commits", callId: "c1", args: {} })
    .append({ kind: "tool_result", callId: "c1", ref, shape: "Array(50)" });
  const { request, trace } = project({ log, capability: cap, store, persona: { system: "Agent" }, tools: { schemas: [{ name: "write_result_to_file" }] } });
  const tr = request.messages.find((m) => m.role === "tool_result")!;
  expect(tr.content).toContain(`result_ref="${ref}"`);
  expect(tr.content).not.toContain("[STORED:");
  expect(store.materialize(ref, "bullets").split("\n").length).toBe(50); // full data recoverable system-side
  expect(trace.tools).toContain("write_result_to_file");
  expect(request.systemPrompt).toContain("write all 50");
});
