// Run: bun test packages/reasoning/tests/strategies/temperature-command-first.test.ts --timeout 15000
//
// GH #246 (Wave-4 measurement integrity, remainder): every non-kernel strategy's
// LLM-call assembly must honor `input.temperature` command-first — an explicit
// command wins over the pass default, unset keeps today's default exactly.
//
// Pattern under test (mirrors the reviewed reactive/direct fix 129fc70b):
//   temperature: input.temperature ?? <pass default>
// `input.temperature` already carries the runtime's command-first merge
// (`config.temperature ?? config.contextProfile?.temperature`, reasoning-think.ts).
//
// Arms per strategy: commanded value reaches the wire (RED at HEAD: the pass
// default wins); unset keeps the pass default (regression arm, green both sides).
// Intentionally-fixed temps are pinned too: tree-of-thought candidate scoring
// stays 0.2 even under a command (determinism-sensitive judgment, not generation).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  type TestTurn,
} from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

// ── Capturing LLM layer ───────────────────────────────────────────────────────
// Wraps TestLLMService, recording the temperature of every LLM request across
// all three call shapes (complete / stream / completeStructured). NaN marks a
// call that carried no temperature (e.g. a judgment pass that never sets one).

function capturingLayer(scenario: TestTurn[], temps: number[], heads?: string[]) {
  const inner = TestLLMService(scenario);
  const record = (req: unknown) => {
    const t = (req as { readonly temperature?: unknown }).temperature;
    temps.push(typeof t === "number" ? t : Number.NaN);
    const msgs = (req as { readonly messages?: readonly { readonly content?: unknown }[] }).messages;
    const head = msgs?.[0]?.content;
    heads?.push(typeof head === "string" ? head.slice(0, 60) : "?");
  };
  const wrapped: typeof LLMService.Service = {
    ...inner,
    complete: ((req: Parameters<typeof inner.complete>[0]) => {
      record(req);
      return inner.complete(req);
    }) as typeof inner.complete,
    stream: ((req: Parameters<typeof inner.stream>[0]) => {
      record(req);
      return inner.stream(req);
    }) as typeof inner.stream,
    completeStructured: (<A>(req: Parameters<typeof inner.completeStructured<A>>[0]) => {
      record(req);
      return inner.completeStructured<A>(req);
    }) as typeof inner.completeStructured,
  };
  return Layer.succeed(LLMService, LLMService.of(wrapped));
}

const defined = (temps: readonly number[]) => temps.filter((t) => !Number.isNaN(t));

const baseInput = {
  taskDescription: "Say hello",
  taskType: "simple",
  memoryContext: "",
  availableTools: [] as string[],
  config: defaultReasoningConfig,
};

const reflexionLLM = (temps: number[]) =>
  capturingLayer(
    [{ match: "Evaluate whether", text: "SATISFIED: The response is accurate and complete." }],
    temps,
  );

const planExecuteLLM = (temps: number[], heads?: string[]) =>
  capturingLayer(
    [
      {
        match: "planning agent",
        text: JSON.stringify({
          steps: [
            { title: "Do the task", instruction: "Complete the task", type: "analysis" },
            { title: "Refine the result", instruction: "Refine the completed task", type: "analysis" },
          ],
        }),
      },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: test result" },
      { match: "GOAL:", text: "SATISFIED: Done." },
      { match: "Synthesize", text: "Final synthesized answer." },
    ],
    temps,
    heads,
  );

function toolLayer() {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      execute: () =>
        Effect.succeed({
          success: true,
          result: "result-of-tool",
        }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test tool",
          parameters: [{ name: "query", type: "string", required: false }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
}

describe("GH #246 — commanded temperature reaches every strategy", () => {
  it("reflexion: commanded 0 reaches the generate kernel pass; unset keeps 0.7", async () => {
    const cmd: number[] = [];
    await Effect.runPromise(
      provideTestEnvelope(
        executeReflexion({ ...baseInput, temperature: 0 }).pipe(Effect.provide(reflexionLLM(cmd))),
      ),
    );
    expect(defined(cmd)).toContain(0);

    const un: number[] = [];
    await Effect.runPromise(
      provideTestEnvelope(
        executeReflexion({ ...baseInput }).pipe(Effect.provide(reflexionLLM(un))),
      ),
    );
    expect(defined(un)).toContain(0.7);
    expect(defined(un)).not.toContain(0);
  }, 15000);

  it("tree-of-thought: commanded 0 reaches generation; scoring stays fixed at 0.2; unset keeps defaults", async () => {
    const cmd: number[] = [];
    await Effect.runPromise(
      provideTestEnvelope(
        executeTreeOfThought({ ...baseInput, temperature: 0 }).pipe(
          Effect.provide(capturingLayer([{ text: "FINAL ANSWER: test result" }], cmd)),
        ),
      ),
    );
    const cmdDefined = defined(cmd);
    expect(cmdDefined.length).toBeGreaterThan(0);
    expect(cmdDefined).toContain(0);
    // Every generation-shaped call carries the command; only the
    // determinism-sensitive scoring judgment keeps its fixed 0.2.
    expect(cmdDefined.every((t) => t === 0 || t === 0.2)).toBe(true);

    const un: number[] = [];
    await Effect.runPromise(
      provideTestEnvelope(
        executeTreeOfThought({ ...baseInput }).pipe(
          Effect.provide(capturingLayer([{ text: "FINAL ANSWER: test result" }], un)),
        ),
      ),
    );
    const unDefined = defined(un);
    expect(unDefined.length).toBeGreaterThan(0);
    expect(unDefined).not.toContain(0);
    expect(unDefined.some((t) => t === 0.7 || t === 0.8)).toBe(true);
  }, 15000);

  it("plan-execute: commanded 0 reaches plan + step + patch/augment calls; unset keeps 0.5", async () => {
    const run = async (temps: number[], heads: string[], temperature?: number) =>
      Effect.runPromise(
        provideTestEnvelope(
          executePlanExecute({
            ...baseInput,
            ...(temperature !== undefined ? { temperature } : {}),
          }).pipe(Effect.provide(planExecuteLLM(temps, heads))),
        ),
      );

    const cmd: number[] = [];
    const cmdHeads: string[] = [];
    await run(cmd, cmdHeads, 0);
    expect(cmd.length).toBeGreaterThan(0);
    // Plan generation is the first LLM call.
    expect(cmd[0]).toBe(0);
    // Per-class assertion: generation seams (plan, analysis steps via
    // step-executor, patch/augment recovery) carry the command; the reflect
    // pass is a runCritiquePass judgment (intentionally fixed 0.3, same class
    // as reflexion critique / ToT scoring); "did not match JSON" calls are the
    // shared pipeline's parse-repair retry (fixed 0.1, out of scope).
    cmd.forEach((t, i) => {
      const h = cmdHeads[i] ?? "";
      if (h.startsWith("GOAL: Say hello\n\nSTEP RESULTS")) {
        expect(t).toBe(0.3);
      } else if (h.startsWith("Your previous respon")) {
        expect(t).toBe(0.1);
      } else {
        expect(t).toBe(0);
      }
    });
    // The recovery path ran (augment), so the patch/augment threading is covered.
    expect(cmdHeads.some((h) => h.startsWith("GOAL: Say hello\n\nCOMP"))).toBe(true);

    const un: number[] = [];
    const unHeads: string[] = [];
    await run(un, unHeads);
    expect(un.length).toBeGreaterThan(0);
    expect(un[0]).toBe(0.5);
    expect(defined(un)).not.toContain(0);
    // Step-executor analysis calls keep their 0.5 default when unset.
    expect(un.filter((_, i) => (unHeads[i] ?? "").startsWith("OVERALL GOAL:")).every((t) => t === 0.5)).toBe(true);
  }, 15000);

  it("blueprint: commanded 0 reaches plan + worker + solve; unset keeps 0.4/0.5/0.3", async () => {
    const toolSchema = {
      name: "web-search",
      description: "search",
      parameters: [{ name: "query", type: "string", description: "q", required: false }],
    };
    const run = async (temps: number[], temperature?: number) =>
      Effect.runPromise(
        provideTestEnvelope(
          executeBlueprint({
            taskDescription: "Find AI news then summarize it",
            taskType: "research",
            memoryContext: "",
            availableTools: ["web-search"],
            availableToolSchemas: [toolSchema],
            config: defaultReasoningConfig,
            ...(temperature !== undefined ? { temperature } : {}),
          }).pipe(
            Effect.provide(
              Layer.merge(
                toolLayer(),
                capturingLayer(
                  [
                    {
                      json: {
                        steps: [
                          { title: "compose query", instruction: "compose", type: "analysis" },
                          {
                            title: "search",
                            instruction: "search",
                            type: "tool_call",
                            toolName: "web-search",
                            toolArgs: { query: "{{from_step:s1}}" },
                            dependsOn: ["s1"],
                          },
                        ],
                      },
                    },
                    { text: "the composed query" },
                    { text: "Synthesized answer." },
                  ],
                  temps,
                ),
              ),
            ),
          ),
        ),
      );

    const cmd: number[] = [];
    const cmdResult = await run(cmd, 0);
    expect(cmdResult.status).toBe("completed");
    const cmdDefined = defined(cmd);
    // plan (structured) + worker inline analysis + solve.
    expect(cmdDefined.length).toBeGreaterThanOrEqual(3);
    expect(cmdDefined.every((t) => t === 0)).toBe(true);

    const un: number[] = [];
    const unResult = await run(un);
    expect(unResult.status).toBe("completed");
    const unDefined = defined(un);
    expect(unDefined).toContain(0.4);
    expect(unDefined).toContain(0.5);
    expect(unDefined).toContain(0.3);
    expect(unDefined).not.toContain(0);
  }, 15000);

  it("code-action: commanded temperature reaches the plan call; unset keeps 0", async () => {
    const toolSchema = {
      name: "search",
      description: "Search the web",
      parameters: [{ name: "query", type: "string", description: "query", required: true }],
    };
    const run = async (temps: number[], temperature?: number) =>
      Effect.runPromise(
        provideTestEnvelope(
          executeCodeAction({
            taskDescription: "search and finish",
            taskType: "simple",
            memoryContext: "",
            availableTools: ["search"],
            availableToolSchemas: [toolSchema],
            config: defaultReasoningConfig,
            ...(temperature !== undefined ? { temperature } : {}),
          }).pipe(Effect.provide(Layer.merge(toolLayer(), capturingLayer(
            [{ text: "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```" }],
            temps,
          )))),
        ),
      );

    // The plan default is already 0, so a nonzero command proves threading.
    const cmd: number[] = [];
    await run(cmd, 0.9);
    expect(defined(cmd)[0]).toBe(0.9);

    const zero: number[] = [];
    await run(zero, 0);
    expect(defined(zero)[0]).toBe(0);

    const un: number[] = [];
    await run(un);
    expect(defined(un)[0]).toBe(0);
  }, 15000);

  it("adaptive: commanded 0 reaches the LLM classify call + dispatched sub-strategy; unset keeps 0.2/0.7", async () => {
    // Ambiguous long task with no tools: dodges every heuristicClassify rule
    // (verified: first LLM call carries the "task analyzer" system prompt), so
    // the adaptive.ts classify seam is exercised, not just the dispatch.
    const ambiguous = "Please consider the various implications of the following household organization situation and provide a thorough detailed response about it";
    const run = async (temps: number[], temperature?: number) =>
      Effect.runPromise(
        provideTestEnvelope(
          executeAdaptive({
            taskDescription: ambiguous,
            taskType: "simple",
            memoryContext: "",
            availableTools: [],
            config: defaultReasoningConfig,
            ...(temperature !== undefined ? { temperature } : {}),
          }).pipe(
            Effect.provide(capturingLayer([{ text: "FINAL ANSWER: test result" }], temps)),
          ),
        ),
      );

    const cmd: number[] = [];
    await run(cmd, 0);
    const cmdDefined = defined(cmd);
    expect(cmdDefined.length).toBeGreaterThan(0);
    // Classify is the first LLM call.
    expect(cmdDefined[0]).toBe(0);
    expect(cmdDefined).toContain(0);

    const un: number[] = [];
    await run(un);
    const unDefined = defined(un);
    expect(unDefined.length).toBeGreaterThan(0);
    expect(unDefined[0]).toBe(0.2);
    expect(unDefined).not.toContain(0);
  }, 15000);
});
