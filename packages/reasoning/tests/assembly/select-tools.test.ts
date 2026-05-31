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
it("finalize records non-tool_result messages into the trace", () => {
  const c0 = { ...base(), messages: [{ role: "user", content: "hi" }, { role: "tool_result", content: "X" }] };
  const c = finalizeStage(c0);
  // only the user message is recorded here (tool_result already recorded by projectResults upstream)
  expect(c.trace.messages.length).toBe(1);
  expect(c.trace.messages[0]!.role).toBe("user");
  expect(c.trace.messages[0]!.chars).toBe(2);
});
