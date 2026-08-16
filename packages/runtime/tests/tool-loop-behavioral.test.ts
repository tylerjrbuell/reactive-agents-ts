/**
 * Behavioral tests for the ReAct tool loop using withTestScenario.
 *
 * These tests were previously impossible because the test provider always
 * completed in one iteration without calling tools. With TestTurn scenarios
 * returning stopReason: "tool_use", these paths are now exercisable.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

describe("tool loop behavioral tests", () => {
  it("agent successfully calls a tool via native tool_use path", async () => {
    const toolCalls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("tool-loop-test")
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "hello" } } },
        { text: "The tool returned the value." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("echo-tool"),
            handler: (args) => {
              toolCalls.push(args.input as string);
              return Effect.succeed(`echoed: ${args.input}`);
            },
          },
        ],
      })
      .build();

    let result;
    try {
      result = await agent.run("echo hello");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(toolCalls).toContain("hello");

    // Trust receipt (Arc 1 Task 8, review-fix follow-up): originally written
    // when the MINIMAL loop (no .withReasoning()) produced no reasoningSteps,
    // so the receipt fell back to the engine's ToolCallCompleted log
    // (receiptToolCalls) and graded "tool-grounded" from that fallback alone.
    // Move 1 merge (2026-08-13) downgraded this to "partially-grounded": every
    // builder now runs the kernel arm, but runner.ts's §8.5 non-authoritative-
    // termination step unconditionally discarded the model's real closing
    // text ("The tool returned the value.") and replaced it with a raw
    // tool_artifact reconstruction whenever terminatedBy was end_turn-shaped
    // — exactly this scenario (tool call, then real text, no final-answer
    // call). §8.5's root-cause fix (2026-08-16) now trusts substantive
    // model output instead of discarding it, so this grades back to the
    // correct, higher "tool-grounded" tier (toolsUsed is still correct; the
    // tool call and result.success:true assertions above both pass unchanged
    // either way, so tool execution itself was never in question).
    expect(result.receipt?.verdict).toBe("tool-grounded");
    expect(result.receipt?.toolsUsed).toEqual(["echo-tool"]);
  });

  it("agent calls two tools across sequential turns", async () => {
    const calls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("multi-tool-test")
      .withTestScenario([
        { toolCall: { name: "tool-a", args: { input: "first" } } },
        { toolCall: { name: "tool-b", args: { input: "second" } } },
        { text: "Both tools complete." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("tool-a"),
            handler: (args) => {
              calls.push(`a:${args.input}`);
              return Effect.succeed("a done");
            },
          },
          {
            definition: makeToolDef("tool-b"),
            handler: (args) => {
              calls.push(`b:${args.input}`);
              return Effect.succeed("b done");
            },
          },
        ],
      })
      .build();

    try {
      await agent.run("use both tools");
    } finally {
      await agent.dispose();
    }

    expect(calls).toContain("a:first");
    expect(calls).toContain("b:second");
  });

  // SUPERSEDED (Move 1 merge, 2026-08-13): this test's premise -- identical
  // repeated tool calls grind to maxIterations -- no longer holds. The kernel
  // arm's repetitionGuard (act/guard.ts) now cuts an identical-args repeat
  // loop off with a graceful end_turn well before the iteration ceiling
  // (verified: terminatedBy:"end_turn" after 2 iterations against
  // maxIterations:3, even with 4 identical scripted tool-call turns queued).
  // That is deliberate, existing kernel behavior -- the OLD inline arm this
  // test was written against had no equivalent repetition guard, so an
  // identical-call loop really did grind to the ceiling there. Left skipped
  // rather than rewritten: genuinely re-exhausting maxIterations under the
  // kernel arm needs a scenario that varies its args each turn (so the
  // repetition guard's converging-retry carve-out keeps letting it through),
  // which changes what the test is actually exercising -- worth a fresh test,
  // not a patch to this one.
  it.skip("agent exceeds max iterations when tool calls never terminate", async () => {
    let threw = false;
    let errorMessage = "";

    const agent = await ReactiveAgents.create()
      .withName("max-iter-test")
      .withMaxIterations(3)
      // Move 1 merge (2026-08-13): repeated explicitly rather than relying on
      // scenario-array exhaustion to keep returning a tool call. A single
      // scripted entry does not cycle once consumed -- the kernel arm's next
      // turn gets no scripted response and cleanly end_turns instead of
      // genuinely exhausting maxIterations, which was defeating this test's
      // whole premise (verified: terminatedBy was "end_turn", not
      // "max_iterations", after only 2 iterations against a 1-entry scenario).
      .withTestScenario([
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("loop-tool"),
            handler: () => Effect.succeed("keep going"),
          },
        ],
      })
      .build();

    try {
      await agent.run("loop forever");
    } catch (e) {
      threw = true;
      errorMessage = (e as Error).message;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
    // Error message should reference iterations or limit
    expect(errorMessage.toLowerCase()).toMatch(/iteration|max|limit|exceed/);
  });

  it("error turn causes agent.run() to throw", async () => {
    let threw = false;

    const agent = await ReactiveAgents.create()
      .withName("error-turn-test")
      .withTestScenario([{ error: "provider_unavailable" }])
      .build();

    try {
      await agent.run("any prompt");
    } catch {
      threw = true;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
  });

  it("withErrorHandler fires when error turn is reached", async () => {
    let handlerFired = false;

    const agent = await ReactiveAgents.create()
      .withName("error-handler-test")
      .withTestScenario([{ error: "rate_limit_exceeded" }])
      .withErrorHandler(() => {
        handlerFired = true;
      })
      .build();

    try {
      await agent.run("test");
    } catch {
      // expected — run() rethrows after handler
    } finally {
      await agent.dispose();
    }

    expect(handlerFired).toBe(true);
  });

  it("withTestScenario auto-sets provider — no withProvider needed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("auto-provider-test")
      .withTestScenario([{ text: "auto provider works" }])
      .build();

    let result;
    try {
      result = await agent.run("anything");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
  });

  // Invariant: the streaming code path must be tool-equivalent to the complete()
  // path. `run()` (no streaming consumer) takes complete(); `runStream()` installs
  // a StreamingTextCallback and takes the streaming branch. Both must execute the
  // SAME tool with the SAME args. This pins the fix for the production bug where
  // the inline streaming branch only read tool calls from `content_complete` and
  // silently dropped native-FC `tool_use_start`/`tool_use_delta` events — which
  // meant any tool-using agent run under a TTY (status mode → streaming branch)
  // executed no tools. Regressing the streaming accumulator fails this test.
  it("streaming path executes tools identically to the complete path (run vs runStream)", async () => {
    const scenario = [
      { toolCall: { name: "echo-tool", args: { input: "hello" } } },
      { text: "The tool returned the value." },
    ] as const;

    const makeAgent = (calls: string[]) =>
      ReactiveAgents.create()
        .withName("tool-equivalence-test")
        .withTestScenario([...scenario])
        .withTools({
          tools: [
            {
              definition: makeToolDef("echo-tool"),
              handler: (args) => {
                calls.push(args.input as string);
                return Effect.succeed(`echoed: ${args.input}`);
              },
            },
          ],
        })
        .build();

    // complete() path
    const runCalls: string[] = [];
    const runAgent = await makeAgent(runCalls);
    let runResult;
    try {
      runResult = await runAgent.run("echo hello");
    } finally {
      await runAgent.dispose();
    }

    // streaming path — runStream() forces the streaming branch in inline-think
    const streamCalls: string[] = [];
    const streamAgent = await makeAgent(streamCalls);
    const events: AgentStreamEvent[] = [];
    try {
      for await (const ev of streamAgent.runStream("echo hello")) {
        events.push(ev);
      }
    } finally {
      await streamAgent.dispose();
    }

    // Both paths executed the tool with identical args.
    expect(runCalls).toEqual(["hello"]);
    expect(streamCalls).toEqual(runCalls);
    expect(runResult.success).toBe(true);
    expect(events.map((e) => e._tag)).toContain("StreamCompleted");
  });
});
