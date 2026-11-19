// File: tests/strategies/strategy-conformance.test.ts
//
// Strategy conformance over the registry (Plan 9 Phase 0b). Every registered
// strategy is run through the same invariants, so a new strategy is covered on
// registration instead of by a hand-written per-strategy test:
//
//   C1  HITL safety: an approval-gated tool never executes without a decision.
//       The run either ends with the paused result, or refuses loudly
//       (code-action cannot pause by design: a failed result, authority
//       `strategy-error`, its error naming the refusal).
//   C2  Spend: a normal run reports llmCalls > 0 and tokens > 0.
//   C3  Ledger: a normal run's result carries a runLedger array, and any tool
//       the run executed appears in it.
//   C4  Outcome: the result carries the minted terminalOutcome.
//   C6  Budget: a run past its declared budget never claims `completed`.
//   C7  Honesty: a `completed` result never carries an honesty marker
//       (budgetTerminalPartial, harnessAuthoredOutput, verificationWarning).
//   C8  Verdict: every result carries the terminal verdict record (inert).
//   C9  Honest partial: a strategy-specific forced terminal (HONEST_PARTIAL)
//       reaches the caller as `partial` with its markers; its clean control is
//       `completed` with none (C9c); C9x holds strategy-specific checks.
//   C10 Call cap: `maxCallsPerTool` handed to ReasoningService.execute holds on
//       every strategy. The model asks for `add` twice; with {add:1} it runs
//       once and the extra call is refused with a tool-gate guard-fired event.
//       The uncapped control runs it twice (the script really asks twice).
//   C11 Model facet: providerName / contextProfile / calibrationMode handed to
//       ReasoningService.execute reach every kernel pass (wire-request provider
//       and output budget match reactive's; a calibration skip applies none).
//   C12 Body error: a strategy-body failure ends on the shared terminal: a
//       failed result, terminalOutcome + terminal_decision authority
//       `strategy-error`, the cause on `error`.
//
// KNOWN_GAPS lists cells that are red today. The list may only shrink: a
// fixed gap whose cell turns green fails here until it is removed, and a new
// red cell fails until it is fixed or deliberately listed.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMError, LLMService, TestLLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { classifyTask } from "../../src/kernel/capabilities/comprehend/task-classification.js";
import type { Verifier, VerificationContext, VerificationResult } from "../../src/kernel/capabilities/verify/verifier.js";
import { StrategyRegistry, StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { process.env.RA_LAZY_TOOLS = "0"; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

/** Aliases resolve to the same implementation; test each implementation once. */
const ALIASES: ReadonlySet<string> = new Set(["react", "rewoo"]);

/**
 * Cells red today ("strategy:check"). May only shrink. Each names its fix.
 *  - *:C5             an unparseable plan fails the whole run with ExecutionError instead of
 *                     degrading to a planless run (Plan 9 S2).
 *  - direct:C9, adaptive:C9  no forced-terminal scenario yet (direct's 1-turn cap and adaptive's
 *                     delegation need their own); add one to HONEST_PARTIAL to close.
 */
const KNOWN_GAPS: ReadonlySet<string> = new Set<string>([
  "plan-execute-reflect:C5",
  "blueprint:C5",
  "direct:C9",
  "adaptive:C9",
]);

const addTool = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    { name: "a", type: "number" as const, description: "First number", required: true },
    { name: "b", type: "number" as const, description: "Second number", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const addSchema = { name: "add", description: addTool.description, parameters: addTool.parameters };

const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 4 },
  },
};

/** Strategies whose first model call asks for a structured plan. */
const PLANNERS: ReadonlySet<string> = new Set(["plan-execute-reflect", "blueprint"]);

const PLAN = {
  steps: [{ title: "Add", instruction: "Add 2 and 3 with the add tool", type: "tool_call", toolName: "add", toolArgs: { a: 2, b: 3 } }],
};

/** A scripted model that plans (for planners, unless `badPlan`), calls `add` whenever asked, then answers. */
const script = (strategy: string, badPlan = false) =>
  TestLLMServiceLayer([
    ...(PLANNERS.has(strategy) && !badPlan ? [{ json: PLAN }] : []),
    { match: "Observation", text: "FINAL ANSWER: 5" },
    { match: "add", toolCall: { name: "add", args: { a: 2, b: 3 } } },
    { text: "FINAL ANSWER: 5" },
  ]);

interface CellRun {
  readonly result?: { readonly status: string; readonly error?: string | null; readonly metadata: Record<string, unknown> };
  readonly refused: boolean;
  readonly toolExecutions: number;
  readonly error?: string;
}

const runCell = (name: ReasoningStrategy, gated: boolean, badPlan = false, extra: Record<string, unknown> = {}): Promise<CellRun> => {
  let toolExecutions = 0;
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) =>
      Effect.sync(() => {
        toolExecutions += 1;
        return (args.a as number) + (args.b as number);
      }),
    );
    const registry = yield* StrategyRegistry;
    const fn = yield* registry.get(name);
    return yield* fn({
      taskDescription: "Use the add tool to add 2 and 3, then report the sum.",
      taskType: "computation",
      memoryContext: "",
      availableTools: ["add"],
      availableToolSchemas: [addSchema],
      requiredTools: ["add"],
      config,
      taskId: `conformance-${name}`,
      ...extra,
    });
  });
  const envelope = buildRunEnvelope(gated ? { approvalPolicy: { mode: "detach", tools: new Set(["add"]) } } : {});
  return Effect.runPromise(
    provideTestEnvelope(
      program.pipe(
        Effect.provide(Layer.mergeAll(script(name, badPlan), createToolsLayer(), StrategyRegistryLive)),
        Effect.map((result): CellRun => ({ result, refused: false, toolExecutions })),
        Effect.catchAll((e) => Effect.succeed<CellRun>({ refused: true, toolExecutions, error: `${e._tag}: ${e.message}` })),
      ),
      envelope,
    ),
  );
};

const strategies = await Effect.runPromise(
  Effect.gen(function* () {
    const registry = yield* StrategyRegistry;
    return (yield* registry.list()).filter((s) => !ALIASES.has(s));
  }).pipe(Effect.provide(StrategyRegistryLive)),
);

/** A result metadata field that says the answer is not a verified completion. */
const hasHonestyMarker = (m: Record<string, unknown>): boolean =>
  m["budgetTerminalPartial"] !== undefined || m["harnessAuthoredOutput"] !== undefined || m["verificationWarning"] !== undefined;

// ── C9 scenarios: a forced terminal per strategy (folded in from the six
// `*-honest-partial.integration.test.ts` files). Each strategy reaches its
// honest partial a different way, so each names its own input and script.

const GATHER_SCHEMA = { name: "gather", description: "gather research data", parameters: [{ name: "q", type: "string", required: true }] };
const AUDIT_SCHEMA = { name: "audit", description: "audit gathered data", parameters: [{ name: "q", type: "string", required: true }] };
const gatherTools = () => succeedingToolLayer({ finding: "KEY FACT: the topic's core metric rose 12% last quarter." }, GATHER_SCHEMA.parameters);

interface ScenarioRun {
  readonly input: Record<string, unknown>;
  readonly turns: TestTurn[];
  /** Tool layer; default: a succeeding `gather` tool. */
  readonly tools?: Layer.Layer<ToolService>;
}

interface HonestPartialScenario {
  readonly forced: ScenarioRun;
  readonly control: ScenarioRun;
  readonly budgetMarker?: boolean;
  readonly harnessAuthored?: boolean;
  readonly warningContains?: string;
  readonly outputContains?: string;
  /** A strategy-specific check; returns "ok" or what went wrong. */
  readonly extra?: () => Promise<string>;
}

const runScenario = (name: string, sc: ScenarioRun) =>
  Effect.runPromise(
    provideTestEnvelope(
      Effect.gen(function* () {
        const fn = yield* (yield* StrategyRegistry).get(name as ReasoningStrategy);
        return yield* fn({ taskType: "research", memoryContext: "", config: defaultReasoningConfig, ...sc.input } as never);
      }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(sc.turns), sc.tools ?? gatherTools(), StrategyRegistryLive))),
    ),
  );

const RESEARCH_TASK = "Research the topic thoroughly and write your findings to report.md.";
const LONG_BUDGET_CLIFF = { horizonProfile: "long", budgetLimits: { tokenLimit: 1 } };
const researchTurns: TestTurn[] = [
  { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
  { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
  { text: "FINAL ANSWER: unsynthesized guess." },
];
const qaControl = (turns: TestTurn[], extra: Record<string, unknown> = {}): ScenarioRun => ({
  input: { taskDescription: "What is 2 + 2?", taskType: "qa", availableTools: [], availableToolSchemas: [], ...extra },
  turns,
});
const gatherInput = { taskDescription: RESEARCH_TASK, availableTools: ["gather"], availableToolSchemas: [GATHER_SCHEMA] };

const failingVerifier: Verifier = {
  verify: (ctx: VerificationContext): VerificationResult => ({
    verified: false,
    checks: [{ name: "always-fail", passed: false, severity: "reject" }],
    summary: "deliverable did not meet the acceptance bar",
    action: ctx.action,
    softFail: false,
    severity: "reject",
  }),
};
const oneIteration = {
  ...defaultReasoningConfig,
  strategies: { ...defaultReasoningConfig.strategies, reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 1 } },
};
const CODE_RESPONSE = '```typescript\n(async () => { return "result-token"; })()\n```';
const codeActionRun = (extra: Record<string, unknown>): ScenarioRun => ({
  input: { taskDescription: "Compute the result token.", taskType: "code", availableTools: [], config: oneIteration, ...extra },
  turns: [{ text: CODE_RESPONSE }],
  tools: Layer.empty as Layer.Layer<ToolService>,
});

const BLUEPRINT_PLAN = {
  steps: [
    { title: "Gather A", instruction: "Gather data on topic A", type: "tool_call", toolName: "gather", toolArgs: { q: "topic-a" } },
    { title: "Gather B", instruction: "Gather data on topic B", type: "tool_call", toolName: "gather", toolArgs: { q: "topic-b" } },
  ],
};
const blueprintRun = (extra: Record<string, unknown>): ScenarioRun => ({
  input: { taskDescription: "Research topics A and B and summarize the findings.", availableTools: ["gather"], availableToolSchemas: [GATHER_SCHEMA], ...extra },
  turns: [
    { json: BLUEPRINT_PLAN },
    { match: "Synthesize a clear, complete answer", text: "FINAL REPORT: A and B both rose 12%." },
    { text: "FINAL REPORT: A and B both rose 12%." },
  ],
});

// ToT's cost-gated skip path runs one react branch kernel, so the scenario stays deterministic.
const TOT_SKIP = { taskClassification: classifyTask("What is 2 + 2?"), maxIterations: 6 };

const HONEST_PARTIAL: Readonly<Record<string, HonestPartialScenario>> = {
  // reactive: the terminal pace band ships a partial naming the outstanding report.md.
  reactive: {
    forced: { input: { ...gatherInput, maxIterations: 6, ...LONG_BUDGET_CLIFF }, turns: researchTurns },
    control: qaControl([{ text: "FINAL ANSWER: 4." }], { maxIterations: 3 }),
    budgetMarker: true,
    warningContains: "report.md",
  },
  // reflexion: the critique's SATISFIED cannot upgrade past the generate pass's envelope.
  reflexion: {
    forced: {
      input: { taskDescription: "Research the topic thoroughly.", memoryContext: "Write your findings to report.md.", availableTools: ["gather"], availableToolSchemas: [GATHER_SCHEMA], ...LONG_BUDGET_CLIFF },
      turns: [
        { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
        { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
        { match: "COMPLETED based on the execution evidence", text: "SATISFIED: the research is complete." },
        { text: "POLISHED: the metric rose 12% last quarter." },
      ],
    },
    control: qaControl([
      { match: "2 \\+ 2", text: "FINAL ANSWER: 4." },
      { match: "COMPLETED based on the execution evidence", text: "SATISFIED: answered." },
      { text: "4." },
    ]),
    budgetMarker: true,
    warningContains: "report.md",
  },
  // plan-execute: plan generation alone crosses tokenLimit:1, so no step wave launches.
  // plan-execute: the budget halts the plan AFTER a step's work landed, so the
  // honest partial is that step's own result. (A cliff before any step ran has
  // no work to ship: since 2026-11-10 it fails with its cause on `error`
  // instead of shipping the harness's [BUDGET] note as output.) The ALPHA
  // analysis call alone (~50k fakeUsage tokens) crosses the 40k limit, so BETA
  // never launches; mirrors plan-execute-cumulative-budget.integration.test.ts.
  "plan-execute-reflect": {
    forced: {
      input: { ...gatherInput, horizonProfile: "long", budgetLimits: { tokenLimit: 40_000 } },
      turns: [
        { json: { steps: [
          { title: "ALPHA long draft", instruction: "Draft the long-form findings section.", type: "analysis" },
          { title: "BETA review", instruction: "Review the draft.", type: "analysis", dependsOn: ["s1"] },
        ] } },
        { match: "ALPHA", text: "L".repeat(200_000) },
        { text: "FINAL REPORT: unused." },
      ],
    },
    control: qaControl([
      { json: { steps: [{ title: "Answer", instruction: "Answer the question directly.", type: "composite" }] } },
      { match: "2 \\+ 2", text: "FINAL ANSWER: 4." },
      { match: "STEP RESULTS", text: "SATISFIED: the question is answered." },
      { text: "FINAL REPORT: 4." },
    ]),
    budgetMarker: true,
    harnessAuthored: true,
    outputContains: "LLLL",
    warningContains: "Token budget exhausted",
  },
  // tree-of-thought: forced through the skip path; the long-horizon thread is what arms the partial.
  "tree-of-thought": {
    forced: { input: { ...gatherInput, ...TOT_SKIP, ...LONG_BUDGET_CLIFF }, turns: researchTurns },
    control: qaControl([{ text: "FINAL ANSWER: 4." }], { maxIterations: 3 }),
    budgetMarker: true,
    extra: async () => {
      // Without horizonProfile the budget partial cannot form: pins that ToT threads the horizon.
      const r = await runScenario("tree-of-thought", { input: { ...gatherInput, ...TOT_SKIP, budgetLimits: { tokenLimit: 1 } }, turns: researchTurns });
      return r.metadata["budgetTerminalPartial"] === undefined ? "ok" : "budget partial formed without the long-horizon thread";
    },
  },
  // blueprint: a budget crossed before SOLVE ships the worker's own step results
  // (never a harness-written list; owner decision 2026-11-10 — a budget crossed by
  // planning ships no output, pinned in tests/kernel/harness-text-leftovers.test.ts).
  blueprint: {
    forced: {
      input: { taskDescription: "Research topics A and B and summarize the findings.", availableTools: ["gather"], availableToolSchemas: [GATHER_SCHEMA], budgetLimits: { tokenLimit: 40_000 } },
      turns: [
        { json: { steps: [
          { title: "Gather A", instruction: "Gather data on topic A", type: "tool_call", toolName: "gather", toolArgs: { q: "topic-a" } },
          { title: "BETA long draft", instruction: "Draft the long-form findings section.", type: "analysis", dependsOn: ["s1"] },
          { title: "Gather B", instruction: "Gather data on topic B", type: "tool_call", toolName: "gather", toolArgs: { q: "topic-b" }, dependsOn: ["s2"] },
        ] } },
        { match: "BETA", text: "L".repeat(200_000) },
        { text: "FINAL REPORT: unused." },
      ],
    },
    control: blueprintRun({}),
    budgetMarker: true,
    harnessAuthored: true,
    outputContains: "LLLL",
    extra: async () => {
      // Blueprint's own SOLVE mint declares no per-iteration repair.
      const r = await runScenario("blueprint", blueprintRun({}));
      const gaps = (r.metadata["verdict"] as { repairGaps?: readonly string[] } | undefined)?.repairGaps ?? [];
      return gaps.includes("per-iteration") ? "ok" : `repairGaps=${JSON.stringify(gaps)}`;
    },
  },
  // code-action: a failing verifier verdict at the iteration cap is partial, not completed.
  "code-action": {
    forced: codeActionRun({ verifier: failingVerifier }),
    control: codeActionRun({}),
    outputContains: "result-token",
    warningContains: "failing verifier verdict",
  },
};

// ── C10: the call cap reaches every strategy through ReasoningService.execute,
// the user path (`.withTools({ maxCallsPerTool })` lands there).

const ADD_TWICE = [
  { name: "add", args: { a: 2, b: 3 } },
  { name: "add", args: { a: 4, b: 5 } },
];
/** plan-execute gets one composite step, so the two calls go through a kernel turn. */
const CAP_PLAN = { steps: [{ title: "Add", instruction: "Add the numbers with the add tool", type: "composite", toolHints: ["add"] }] };
/** blueprint's worker runs only `tool_call` steps (0-LLM direct dispatch): two of them. */
const CAP_BLUEPRINT_PLAN = {
  steps: ADD_TWICE.map((c, i) => ({ title: `Add ${i + 1}`, instruction: "Add the numbers", type: "tool_call", toolName: "add", toolArgs: c.args })),
};
/** direct's 1-turn cap ends before the act step: it never runs a tool, so C10 does not apply. */
const NO_TOOL_RUNS: ReadonlySet<string> = new Set(["direct"]);
const ADD_TWICE_CODE =
  "```typescript\n(async () => {\n  const first = await add({ a: 2, b: 3 });\n  let second: unknown;\n" +
  "  try { second = await add({ a: 4, b: 5 }); } catch (e) { second = String(e); }\n" +
  "  return `${String(first)} ${String(second)}`;\n})()\n```";
const capTurns = (strategy: string): TestTurn[] =>
  strategy === "code-action"
    ? [{ text: ADD_TWICE_CODE }]
    : strategy === "blueprint"
      ? [{ json: CAP_BLUEPRINT_PLAN }, { text: "FINAL ANSWER: 5 and 9" }]
      : [
        ...(PLANNERS.has(strategy) ? [{ json: CAP_PLAN }] : []),
        { toolCalls: ADD_TWICE },
        { text: "FINAL ANSWER: 5 and 9" },
      ];

interface CapRun {
  readonly executions: number;
  readonly refusals: number;
  readonly error?: string;
}

const runCap = (strategy: ReasoningStrategy, cap: Readonly<Record<string, number>> | undefined): Promise<CapRun> => {
  let executions = 0;
  const program = Effect.gen(function* () {
    const log = yield* Ref.make(0);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === "tool-gate" ? Ref.update(log, (n) => n + 1) : Effect.void,
    );
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) =>
      Effect.sync(() => {
        executions += 1;
        return (args.a as number) + (args.b as number);
      }),
    );
    const reasoning = yield* ReasoningService;
    const outcome = yield* reasoning
      .execute({
        taskDescription: "Use the add tool to add 2 and 3, and 4 and 5, then report both sums.",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        availableToolSchemas: [addSchema],
        strategy,
        taskId: `cap-${strategy}`,
        // ToT: the cost-gated skip path runs one react branch kernel (deterministic).
        taskClassification: classifyTask("What is 2 + 2?"),
        ...(cap !== undefined ? { maxCallsPerTool: cap } : {}),
      })
      .pipe(
        Effect.map(() => undefined),
        Effect.catchAll((e) => Effect.succeed(`${e._tag}: ${String((e as { message?: unknown }).message)}`)),
      );
    return { refusals: yield* Ref.get(log), error: outcome };
  });
  // One ToolService instance: the one the test registers `add` on is the one ReasoningService captures.
  const base = Layer.mergeAll(TestLLMServiceLayer(capTurns(strategy)), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base)),
      Effect.map(({ refusals, error }): CapRun => ({ executions, refusals, ...(error !== undefined ? { error } : {}) })),
    ),
  );
};

// ── C11: the run's model facet (provider, context profile, calibration mode)
// reaches every kernel pass of every strategy. Handed to
// ReasoningService.execute once; no strategy forwards it. Before 2026-11-18
// reflexion, tree-of-thought and plan-execute step kernels ran as provider
// "unknown" on the mid profile (audit G1).

/** Strategies that run no kernel pass on this script (sandbox loop; 0-LLM DAG worker). */
const NO_KERNEL_PASS: ReadonlySet<string> = new Set(["code-action", "blueprint"]);

interface FacetRun {
  /** `wire-request` facts: provider + output budget of each kernel model call. */
  readonly wires: readonly { readonly provider: unknown; readonly outputBudget: unknown }[];
  /** Fields a model calibration overrode on a kernel profile. */
  readonly overrides: readonly unknown[];
  readonly error?: string;
}

const runFacet = (strategy: ReasoningStrategy, facet: Record<string, unknown>): Promise<FacetRun> => {
  const program = Effect.gen(function* () {
    const wires = yield* Ref.make<FacetRun["wires"]>([]);
    const overrides = yield* Ref.make<readonly unknown[]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) => {
      if (ev._tag !== "GuardFiredEmitted") return Effect.void;
      const m = ev.metadata ?? {};
      if (ev.guard === "wire-request") return Ref.update(wires, (xs) => [...xs, { provider: m["provider"], outputBudget: m["outputBudget"] }]);
      if (ev.guard === "profile-overrides-applied") return Ref.update(overrides, (xs) => [...xs, m["field"]]);
      return Effect.void;
    });
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) => Effect.sync(() => (args.a as number) + (args.b as number)));
    const reasoning = yield* ReasoningService;
    const error = yield* reasoning
      .execute({
        taskDescription: "Use the add tool to add 2 and 3, and 4 and 5, then report both sums.",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        availableToolSchemas: [addSchema],
        strategy,
        taskId: `facet-${strategy}`,
        taskClassification: classifyTask("What is 2 + 2?"),
        ...facet,
      })
      .pipe(
        Effect.map(() => undefined),
        Effect.catchAll((e) => Effect.succeed(`${e._tag}: ${String((e as { message?: unknown }).message)}`)),
      );
    return { wires: yield* Ref.get(wires), overrides: yield* Ref.get(overrides), ...(error !== undefined ? { error } : {}) };
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(capTurns(strategy)), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base))));
};

const FRONTIER_GEMINI = { providerName: "gemini", contextProfile: { tier: "frontier" } };
/** A model with a shipped calibration that overrides `toolResultMaxChars` (calibration-mode.test.ts). */
const CALIBRATED_MODEL = "cogito:14b";
/** reactive's own wire facts on the same facet: the reference every strategy must match. */
let reactiveReference: Promise<FacetRun> | undefined;
const reference = (): Promise<FacetRun> => (reactiveReference ??= runFacet("reactive", FRONTIER_GEMINI));

// ── C12: a strategy-body failure still ends through the shared terminal: a
// minted result with its terminalOutcome, a `terminal_decision` whose
// authority is recorded, and the cause on `error`. Before 2026-11-18 an
// ExecutionError escaped `runStrategy` with none of them (audit G2).

/** Strategies whose body has no failure of its own: a provider failure is a kernel `llm_error` terminal, or the run delegates. */
const NO_BODY_ERROR: ReadonlySet<string> = new Set(["reactive", "direct", "adaptive"]);

interface BodyErrorScenario {
  readonly turns: TestTurn[];
  /** A direct `complete` call whose messages contain this text fails with a typed LLMError ("" = every one). */
  readonly failOn?: string;
  readonly envelope?: Parameters<typeof buildRunEnvelope>[0];
  readonly taskDescription?: string;
  /** Text the cause on `error` must carry. */
  readonly errorContains: string;
}

const BODY_ERROR: Readonly<Record<string, BodyErrorScenario>> = {
  // The refusal fires before any model call: a refused config is a run end too.
  "code-action": {
    turns: [{ text: CODE_RESPONSE }],
    envelope: { approvalPolicy: { mode: "detach", tools: new Set(["add"]) } },
    errorContains: "code-action cannot honor .withApprovalPolicy",
  },
  // The generate pass spends its share on tool calls; the tool-less synthesis fallback fails (E4).
  reflexion: {
    turns: [{ toolCall: { name: "add", args: { a: 2, b: 3 } } }],
    failOn: "final answer to the task now",
    errorContains: "synthesis fallback failed",
  },
  // The BFS explore's first expansion call fails at the provider.
  "tree-of-thought": {
    turns: [{ text: "unused" }],
    failOn: "",
    taskDescription: "Design a three-step plan to add 2 and 3 using the add tool, comparing approaches.",
    errorContains: "Strategy execution failed (tree-of-thought)",
  },
  // An unparseable plan fails the plan step (the C5 gap): the failure still mints a terminal.
  "plan-execute-reflect": { turns: [{ text: "not a plan" }], errorContains: "Strategy execution failed (plan-execute-reflect)" },
  blueprint: { turns: [{ text: "not a plan" }], errorContains: "Strategy execution failed (blueprint)" },
};

interface BodyErrorRun {
  readonly result?: { readonly status: string; readonly error?: string | null; readonly metadata: Record<string, unknown> };
  readonly decisions: readonly { readonly authority: unknown; readonly finalStatus: unknown; readonly reason: string }[];
  readonly escaped?: string;
}

const runBodyError = (strategy: ReasoningStrategy, sc: BodyErrorScenario): Promise<BodyErrorRun> => {
  const program = Effect.gen(function* () {
    const decisions = yield* Ref.make<BodyErrorRun["decisions"]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === "terminal_decision"
        ? Ref.update(decisions, (xs) => [...xs, { authority: ev.metadata?.["authority"], finalStatus: ev.metadata?.["finalStatus"], reason: ev.reason }])
        : Effect.void,
    );
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) => Effect.sync(() => (args.a as number) + (args.b as number)));
    const reasoning = yield* ReasoningService;
    const outcome = yield* reasoning
      .execute({
        taskDescription: sc.taskDescription ?? "Use the add tool to add 2 and 3, then report the sum.",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        availableToolSchemas: [addSchema],
        strategy,
        taskId: `body-error-${strategy}`,
        ...(sc.envelope !== undefined ? { envelope: buildRunEnvelope(sc.envelope) } : {}),
      })
      .pipe(
        Effect.map((result) => ({ result })),
        Effect.catchAll((e) => Effect.succeed({ escaped: `${e._tag}: ${String((e as { message?: unknown }).message)}` })),
      );
    return { ...outcome, decisions: yield* Ref.get(decisions) };
  });
  const scripted = TestLLMService(sc.turns);
  const failOn = sc.failOn;
  const llm = failOn === undefined
    ? TestLLMServiceLayer(sc.turns)
    : Layer.succeed(LLMService, LLMService.of({
        ...scripted,
        complete: (req) => JSON.stringify(req.messages).includes(failOn)
          ? Effect.fail(new LLMError({ message: "provider unavailable", provider: "test" }))
          : scripted.complete(req),
      }));
  const base = Layer.mergeAll(llm, createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base))));
};

/** Assert a cell, honoring the shrink-only KNOWN_GAPS list. */
const cell = (strategy: string, check: string, ok: boolean, detail: string): void => {
  const key = `${strategy}:${check}`;
  if (KNOWN_GAPS.has(key)) {
    expect(ok ? `${key} is green: remove it from KNOWN_GAPS` : "still red").toBe("still red");
    return;
  }
  expect(ok ? "ok" : `${key} RED: ${detail}`).toBe("ok");
};

describe("strategy conformance over the registry", () => {
  it("covers every registered implementation", () => {
    expect(strategies.length).toBeGreaterThanOrEqual(8);
  });

  for (const strategy of strategies) {
    it(`${strategy}: C1 an approval-gated tool never executes without a decision`, async () => {
      const r = await runCell(strategy, true);
      const raw = r.result?.metadata["rawTerminatedBy"];
      const paused = raw === "awaiting-approval";
      // C1 is safety: no execution without a decision, and no success claimed around it.
      cell(strategy, "C1", r.toolExecutions === 0 && (r.refused || r.result?.status !== "completed" || paused), `executions=${r.toolExecutions} status=${r.result?.status}`);
      // C1p: the pending approval is surfaced (paused result), or the strategy refuses loudly:
      // since C12 a refusal is a failed result whose terminal authority is `strategy-error`
      // and whose error names the refusal.
      const ext = r.result?.metadata["extensions"] as { terminalOutcome?: { authority?: unknown } } | undefined;
      const refusedLoudly = r.refused || (
        r.result?.status === "failed" &&
        ext?.terminalOutcome?.authority === "strategy-error" &&
        String(r.result.error ?? "").includes("cannot honor .withApprovalPolicy")
      );
      cell(strategy, "C1p", r.toolExecutions === 0 && (paused || refusedLoudly), `executions=${r.toolExecutions} paused=${paused} refused=${r.refused} status=${r.result?.status} terminatedBy=${String(r.result?.metadata["terminatedBy"])}/${String(raw)} output=${String((r.result as { output?: unknown } | undefined)?.output).slice(0, 80)}`);
    }, 30_000);

    it(`${strategy}: C2-C4 spend, ledger and outcome on a normal run`, async () => {
      const r = await runCell(strategy, false);
      const m = r.result?.metadata ?? {};
      const llmCalls = typeof m["llmCalls"] === "number" ? m["llmCalls"] : 0;
      const tokens = typeof m["tokensUsed"] === "number" ? m["tokensUsed"] : 0;
      cell(strategy, "C2", !r.refused && llmCalls > 0 && tokens > 0, `refused=${r.refused} error=${r.error ?? "-"} llmCalls=${llmCalls} tokens=${tokens}`);
      const ledger = Array.isArray(m["runLedger"]) ? (m["runLedger"] as { kind?: string; toolName?: string; toolCallId?: string }[]) : undefined;
      const toolInLedger = ledger?.some((e) => e.kind === "tool-invocation" && e.toolName === "add") ?? false;
      cell(strategy, "C3", ledger !== undefined && (r.toolExecutions === 0 || toolInLedger), `ledger=${ledger?.length ?? "absent"} executions=${r.toolExecutions} toolInLedger=${toolInLedger}`);
      // C3d: one ledger source per run: no tool call is recorded twice.
      const callIds = (ledger ?? []).flatMap((e) => (e.kind === "tool-invocation" && e.toolCallId !== undefined ? [e.toolCallId] : []));
      cell(strategy, "C3d", new Set(callIds).size === callIds.length, `invocations=${callIds.length} distinct=${new Set(callIds).size}`);
      const ext = m["extensions"] as { terminalOutcome?: unknown } | undefined;
      cell(strategy, "C4", ext?.terminalOutcome !== undefined, `terminalOutcome=${ext?.terminalOutcome !== undefined}`);
    }, 30_000);

    it(`${strategy}: C6-C8 budget never yields completed; markers and status agree; verdict record`, async () => {
      // C6: a run past its declared budget never claims completion.
      const forced = await runCell(strategy, false, false, { horizonProfile: "long", budgetLimits: { tokenLimit: 1 } });
      cell(strategy, "C6", forced.result?.status !== "completed", `status=${forced.result?.status} refused=${forced.refused}`);
      // C7: honesty markers and a `completed` status never appear together.
      const clean = await runCell(strategy, false);
      const disagree = [forced, clean].filter((r) => r.result?.status === "completed" && hasHonestyMarker(r.result.metadata));
      cell(strategy, "C7", disagree.length === 0, `completed with markers: ${disagree.length}`);
      // C8: every exit crosses the terminal mint, so a verdict record is present (judgment inert).
      const verdict = clean.result?.metadata["verdict"] as { enforced?: boolean } | undefined;
      cell(strategy, "C8", verdict !== undefined && verdict.enforced === false, `verdict=${JSON.stringify(verdict)?.slice(0, 80)}`);
    }, 30_000);

    const scenario = HONEST_PARTIAL[strategy];
    it(`${strategy}: C9 a forced terminal's honesty markers reach the result; a clean run carries none`, async () => {
      if (scenario === undefined) {
        cell(strategy, "C9", false, "no forced-terminal scenario");
        return;
      }
      const forced = await runScenario(strategy, scenario.forced);
      const fm = forced.metadata;
      const warning = String(fm["verificationWarning"] ?? "");
      const forcedOk =
        forced.status === "partial" &&
        String(forced.output ?? "").length > 0 &&
        (scenario.outputContains === undefined || String(forced.output).includes(scenario.outputContains)) &&
        (scenario.budgetMarker !== true || fm["budgetTerminalPartial"] === true) &&
        (scenario.harnessAuthored !== true || fm["harnessAuthoredOutput"] === true) &&
        (scenario.warningContains === undefined || warning.includes(scenario.warningContains));
      cell(strategy, "C9", forcedOk, `status=${forced.status} budgetTerminalPartial=${String(fm["budgetTerminalPartial"])} harnessAuthored=${String(fm["harnessAuthoredOutput"])} warning=${warning.slice(0, 80)}`);
      const control = await runScenario(strategy, scenario.control);
      cell(strategy, "C9c", control.status === "completed" && !hasHonestyMarker(control.metadata), `status=${control.status} markers=${hasHonestyMarker(control.metadata)}`);
      if (scenario.extra !== undefined) {
        const detail = await scenario.extra();
        cell(strategy, "C9x", detail === "ok", detail);
      }
    }, 30_000);

    it(`${strategy}: C10 maxCallsPerTool caps a tool on every strategy; the extra call is refused`, async () => {
      if (NO_TOOL_RUNS.has(strategy)) return;
      const capped = await runCap(strategy, { add: 1 });
      const control = await runCap(strategy, undefined);
      // C10c: the script really asks twice, so the capped cell measures the cap.
      cell(strategy, "C10c", control.executions === 2, `uncapped executions=${control.executions} error=${control.error ?? "-"}`);
      cell(
        strategy,
        "C10",
        capped.executions === 1 && capped.refusals >= 1,
        `capped executions=${capped.executions} refusals=${capped.refusals} error=${capped.error ?? "-"}`,
      );
    }, 30_000);

    it(`${strategy}: C11 every kernel pass carries the run's provider, context profile and calibration mode`, async () => {
      if (NO_KERNEL_PASS.has(strategy)) return;
      const ref = await reference();
      const refBudget = ref.wires[0]?.outputBudget;
      // C11r: the reference measures the facet (frontier budget, not the mid default), so the cell cannot pass vacuously.
      cell("reactive", "C11r", ref.wires.length > 0 && ref.wires.every((w) => w.provider === "gemini" && w.outputBudget === refBudget), `reference wires=${JSON.stringify(ref.wires)}`);
      const r = await runFacet(strategy, FRONTIER_GEMINI);
      const off = r.wires.filter((w) => w.provider !== "gemini" || w.outputBudget !== refBudget);
      cell(strategy, "C11", r.wires.length > 0 && off.length === 0, `wires=${r.wires.length} off=${JSON.stringify(off.slice(0, 2))} reference budget=${String(refBudget)} error=${r.error ?? "-"}`);
      // C11k: an explicit calibration skip applies no shipped calibration on any pass; auto (control) does.
      const skip = await runFacet(strategy, { modelId: CALIBRATED_MODEL, calibrationMode: "skip" });
      const auto = await runFacet(strategy, { modelId: CALIBRATED_MODEL, calibrationMode: "auto" });
      cell(strategy, "C11k", skip.overrides.length === 0 && auto.overrides.includes("toolResultMaxChars"), `skip overrides=${JSON.stringify(skip.overrides)} auto overrides=${JSON.stringify(auto.overrides)}`);
    }, 30_000);

    it(`${strategy}: C12 a strategy-body failure ends through the shared terminal with a recorded authority`, async () => {
      if (NO_BODY_ERROR.has(strategy)) return;
      const sc = BODY_ERROR[strategy];
      if (sc === undefined) {
        cell(strategy, "C12", false, "no body-error scenario");
        return;
      }
      const r = await runBodyError(strategy, sc);
      const ext = r.result?.metadata["extensions"] as { terminalOutcome?: { authority?: unknown } } | undefined;
      const last = r.decisions[r.decisions.length - 1];
      cell(
        strategy,
        "C12",
        r.escaped === undefined &&
          r.result?.status === "failed" &&
          String(r.result.error ?? "").includes(sc.errorContains) &&
          ext?.terminalOutcome?.authority === "strategy-error" &&
          last?.authority === "strategy-error" &&
          last.finalStatus === "failed",
        `escaped=${r.escaped ?? "-"} status=${r.result?.status} error=${String(r.result?.error ?? "").slice(0, 120)} outcomeAuthority=${String(ext?.terminalOutcome?.authority)} decisions=${JSON.stringify(r.decisions)}`,
      );
    }, 30_000);

    if (PLANNERS.has(strategy)) {
      it(`${strategy}: C5 an unparseable plan never fails the whole run`, async () => {
        const r = await runCell(strategy, false, true);
        // A failed result is still a failed run (a body error mints one since C12): degrade means not failed.
        cell(strategy, "C5", !r.refused && r.result !== undefined && r.result.status !== "failed", `refused=${r.refused} status=${r.result?.status} error=${r.error ?? "-"}`);
      }, 30_000);
    }
  }
});
