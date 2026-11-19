// Run: bun test packages/reasoning/tests/strategies/final-pass-unread-results.test.ts --timeout 20000
//
// Trace 01M7T84BKRW64TD0HQA6E8GHSP follow-up. af93dc066 made a reflexion
// improve pass at its pass cap run the 4 market-trend searches of its last
// think (pending-batch "drained": one act, no think). No think read them, and
// the terminal never writes answers, so the run still shipped the pre-search
// draft "The EV market is large.": the research was fetched and ignored.
//
// The strategy terminal (`strategies/substrate/unread-results.ts`, wired in
// `runStrategy`) now runs ONE shared terminal synthesis when the answering pass
// ended with unread domain tool results and the output to ship was authored
// before them. Bounded: no call otherwise, skipped (recorded) on a spent budget.
//
// RED-ON-CUT (shown during the mission, then restored): make
// `decideUnreadResults` return `{ _tag: "None" }` first thing: the reflexion
// test ships "The EV market is large." with 5 llmCalls.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { decideUnreadResults } from "../../src/strategies/substrate/unread-results.js";
import type { KernelMessage } from "../../src/kernel/state/kernel-state.js";

const searchTool = {
  name: "web-search",
  description: "Search the web for one query",
  parameters: [{ name: "query", type: "string" as const, description: "Search query", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const searchSchema = { name: searchTool.name, description: searchTool.description, parameters: searchTool.parameters };

/** Run budget 10; every reflexion pass gets 2 iterations; one improve pass. */
const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 10, maxIterationsExplicit: true },
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1, kernelMaxIterations: 2 },
  },
};

const search = (id: string, query: string) => ({ id, name: searchTool.name, args: { query } });

const SYNTHESIZED = "EV market report: battery pack costs fell 14% in 2026 and public charging grew 31%.";

const TURNS: TestTurn[] = [
  { toolCall: search("g1", "EV market size 2026") },
  { text: "FINAL ANSWER: The EV market is large." },
  { text: "UNSATISFIED: the report never researched market trends." },
  { toolCall: search("i1", "EV market overview") },
  {
    toolCalls: [
      search("t1", "EV market trends 2026"),
      search("t2", "EV battery cost trend"),
      search("t3", "EV adoption by region"),
      search("t4", "EV charging infrastructure growth"),
    ],
  },
  // Served only to a prompt carrying the drained results AND the draft.
  { text: SYNTHESIZED, match: "charging grew 31%[\\s\\S]*draft answer written before[\\s\\S]*The EV market is large" },
  { text: "UNGROUNDED: a call that never saw the drained results." },
];

const FINDINGS: Record<string, string> = {
  "EV market trends 2026": "EV sales grew 25% in 2026.",
  "EV battery cost trend": "Battery pack costs fell 14% in 2026.",
  "EV adoption by region": "Norway leads adoption at 90% of new sales.",
  "EV charging infrastructure growth": "Public charging grew 31% in 2026.",
};

async function runReflexion() {
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(searchTool, (args) =>
      Effect.sync(() => FINDINGS[String(args.query)] ?? `General notes on "${String(args.query)}".`),
    );
    const reasoning = yield* ReasoningService;
    return yield* reasoning.execute({
      taskDescription: "Research the EV market and write a short report covering its size and market trends.",
      taskType: "research",
      memoryContext: "",
      availableTools: [searchTool.name],
      availableToolSchemas: [searchSchema],
      strategy: "reflexion",
      taskId: "final-pass-unread-results",
    });
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(TURNS), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base))));
}

describe("final pass with unread tool results: one shared terminal synthesis", () => {
  it("reflexion: the drained 4-search batch is synthesized into the answer, not the pre-search draft", async () => {
    const result = await runReflexion();
    expect(result.output).toBe(SYNTHESIZED);
    expect(result.output).not.toContain("UNGROUNDED");
    // generate 2 + critique 1 + improve 2 + ONE synthesis.
    expect(result.metadata.llmCalls).toBe(6);
    expect((result.metadata as { unreadResultsSynthesis?: unknown }).unreadResultsSynthesis).toEqual({
      unread: 4,
      tools: ["web-search", "web-search", "web-search", "web-search"],
      outcome: "synthesized",
    });
    const signal = result.steps.find((s) => s.metadata?.intervention?.actor === "unread-results-synthesis");
    expect(signal?.type).toBe("harness_signal");
  }, 20000);
});

// ── The pure decision ────────────────────────────────────────────────────────

const assistant = (content: string, calls: readonly string[] = []): KernelMessage => ({
  role: "assistant",
  content,
  ...(calls.length > 0 ? { toolCalls: calls.map((name, i) => ({ id: `c${i}`, name, arguments: {} })) } : {}),
});
const result = (toolName: string, content: string, isError = false): KernelMessage => ({
  role: "tool_result",
  toolCallId: `r-${toolName}`,
  toolName,
  content,
  ...(isError ? { isError: true } : {}),
});

describe("decideUnreadResults", () => {
  const drained: readonly KernelMessage[] = [
    assistant("Draft: the market is large."),
    assistant("", ["web-search"]),
    result("web-search", "Charging grew 31%."),
  ];

  it("synthesizes when the shipped draft predates the unread results, carrying results and draft", () => {
    const d = decideUnreadResults({ messages: drained, output: "the market is large.", earlierPassOutputs: [], budgetSpent: false });
    expect(d._tag).toBe("Synthesize");
    if (d._tag === "Synthesize") {
      expect(d.toolData).toContain("Charging grew 31%.");
      expect(d.toolData).toContain("the market is large.");
      expect(d.tools).toEqual(["web-search"]);
    }
  });

  it("a draft from an earlier pass is stale too", () => {
    const messages = [assistant("", ["web-search"]), result("web-search", "x")];
    expect(decideUnreadResults({ messages, output: "Old answer.", earlierPassOutputs: ["Old answer."], budgetSpent: false })._tag).toBe("Synthesize");
  });

  it("no unread results (the model's last turn read them): no call", () => {
    const read = [...drained, assistant("FINAL ANSWER: charging grew 31%.")];
    expect(decideUnreadResults({ messages: read, output: "charging grew 31%.", earlierPassOutputs: [], budgetSpent: false })._tag).toBe("None");
  });

  it("an answer written in the batch's own turn, or with final-answer, is the model's: no call", () => {
    const sameTurn = [assistant("Report: done.", ["file-write"]), result("file-write", "wrote 120 bytes")];
    expect(decideUnreadResults({ messages: sameTurn, output: "Report: done.", earlierPassOutputs: ["Report: done."], budgetSpent: false })._tag).toBe("None");
    const finalAnswer = [assistant("Draft."), assistant("", ["web-search", "final-answer"]), result("web-search", "x"), result("final-answer", "ok")];
    expect(decideUnreadResults({ messages: finalAnswer, output: "Draft.", earlierPassOutputs: [], budgetSpent: false })._tag).toBe("None");
  });

  it("an output rendered after the results (not a prior draft), errors and meta results: no call", () => {
    expect(decideUnreadResults({ messages: drained, output: "A synthesized report.", earlierPassOutputs: [], budgetSpent: false })._tag).toBe("None");
    const noise = [assistant("Draft."), assistant("", ["web-search", "todo"]), result("web-search", "boom", true), result("todo", "ok")];
    expect(decideUnreadResults({ messages: noise, output: "Draft.", earlierPassOutputs: [], budgetSpent: false })._tag).toBe("None");
  });

  it("a result identical to one the run already read is not new: no call", () => {
    const again = [assistant("Draft: 5."), assistant("", ["add"]), result("add", "5")];
    const earlier = [assistant("", ["add"]), result("add", "5"), assistant("Draft: 5.")];
    expect(decideUnreadResults({ messages: again, output: "Draft: 5.", earlierPassOutputs: [], earlierPassMessages: earlier, budgetSpent: false })._tag).toBe("None");
    expect(decideUnreadResults({ messages: again, output: "Draft: 5.", earlierPassOutputs: [], budgetSpent: false })._tag).toBe("Synthesize");
  });

  it("a spent run budget skips the call and says why", () => {
    const d = decideUnreadResults({ messages: drained, output: "the market is large.", earlierPassOutputs: [], budgetSpent: true });
    expect(d).toEqual({ _tag: "Skip", reason: "budget-exhausted", tools: ["web-search"] });
  });
});
