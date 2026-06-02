import { describe, it, expect } from "bun:test";
import { selectToolsStage } from "../../src/assembly/stages/select-tools.js";
import { finalizeStage } from "../../src/assembly/stages/finalize.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

const base = () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  return { log: new EventLog(), capability: cap, store: new ResultStore(), persona: { system: "" }, tools: { schemas: [{ name: "file-write" }, { name: "file-write" }] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) };
};

it("selectTools passes a stable deduped set + records names", () => {
  const c = selectToolsStage(base());
  expect(c.toolSchemas.length).toBe(1); // deduped
  expect(c.trace.tools).toEqual(["file-write"]);
});
it("finalize is a pure stage-marker — does NOT record messages (single-source by projectResults)", () => {
  // Trace.messages is recorded single-source by projectResults (the sole c.messages
  // builder), in thread order. finalize must NOT re-record — re-recording double-
  // counted assistants and appended the goal last, producing a lying trace.
  const c0 = { ...base(), messages: [{ role: "user", content: "hi" }, { role: "tool_result", content: "X" }] };
  const c = finalizeStage(c0);
  expect(c.trace.messages.length).toBe(0); // finalize records nothing
  expect(c.trace.stages.at(-1)?.name).toBe("finalize"); // it only marks the stage
});
