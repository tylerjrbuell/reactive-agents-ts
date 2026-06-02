import { describe, it, expect } from "bun:test";
import { systemPromptStage } from "../../src/assembly/stages/system-prompt.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

it("renders persona + goal + remaining post-conditions", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const log = new EventLog().append({ kind: "goal", text: "fetch and write" }).append({ kind: "goal_state", remaining: ["write_file"] });
  const c = systemPromptStage({ log, capability: cap, store: new ResultStore(), persona: { system: "You are an agent." }, tools: { schemas: [] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) });
  expect(c.systemPrompt).toContain("You are an agent.");
  expect(c.systemPrompt).toContain("fetch and write");
  expect(c.systemPrompt).toContain("write_file");
});

it("Environment block + persona when no goal/goal_state events", () => {
  // The Environment block (date/time/timezone/platform) is ALWAYS injected — ported
  // from legacy buildStaticContext so project() doesn't drop temporal grounding
  // (date-hallucination regression). Persona follows; no goal/remaining sections here.
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const c = systemPromptStage({ log: new EventLog(), capability: cap, store: new ResultStore(), persona: { system: "Base." }, tools: { schemas: [] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) });
  expect(c.systemPrompt).toContain("Environment:");
  expect(c.systemPrompt).toContain("Date:");
  expect(c.systemPrompt).toContain("Base.");
  expect(c.systemPrompt).not.toContain("Goal:");
});
