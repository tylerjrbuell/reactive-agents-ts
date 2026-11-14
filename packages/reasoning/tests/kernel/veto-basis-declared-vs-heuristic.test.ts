// Run: bun test packages/reasoning/tests/kernel/veto-basis-declared-vs-heuristic.test.ts --timeout 20000
//
// Terminal-decision audit 2026-11-14 (wiki/Research/Harness-Reports/2026-11-14-terminal-decision-basis-audit.md):
// heuristics holding veto power produced 9 of 12 wrong failures. The rule these
// pins hold: a requirement may block success only when it is DECLARED (the
// caller named it) or a literal anchor checked against a receipt; a semantic
// category inferred from prose may only advise. Zero-token, scripted.
//
// RED-ON-CUT, one per pin (proven 2026-11-14, each restored):
//  - contract-outstanding.ts classify: make `unlandedActions` basis "declared" -> pin 1 fails.
//  - requirement-basis.ts: action-required task-text -> "declared" -> pin 1 fails.
//  - derive-conditions.ts seedPostConditions: drop the SideEffectLanded filter -> pin 2 fails.
//  - verifier.ts continuation severity back to "reject" -> pin 4 fails; fab `fab.hard &&` removed -> pin 5 fails.
//  - claimed-actions.ts: restore `candidates.length === 0` early return -> pin 6 fails.
//  - loop-detector.ts: `succeeded.has` back to `state.toolsUsed.has` -> pin 7 fails.
//  - act.ts guard onObservation `false` back to `!guardFailed` -> pin 8 fails.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../src/kernel/state/kernel-state.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { requirementBasis } from "../../src/kernel/contract/requirement-basis.js";
import { classifyContractOutstanding } from "../../src/kernel/loop/contract-outstanding.js";
import { deriveConditions, seedPostConditions } from "../../src/kernel/capabilities/verify/derive-conditions.js";
import { sideEffectLanded } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { defaultVerifier } from "../../src/kernel/capabilities/verify/verifier.js";
import { unbackedClaimedActions } from "../../src/kernel/capabilities/verify/claimed-actions.js";
import { checkAllToolsCalled } from "../../src/kernel/capabilities/reflect/loop-detector.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import type { ReasoningStep } from "../../src/types/index.js";

const EMAIL_TASK = "Send an email to the team announcing that the release shipped.";

const obs = (tool: string, success: boolean, text: string): ReasoningStep =>
  makeStep("observation", text, { toolCallId: `c-${tool}`, observationResult: makeObservationResult(tool, success, text) });

describe("pin 1: declared blocks, heuristic advises", () => {
  it("basis follows provenance: declared tools declared, literal anchors evidence, prose action heuristic", () => {
    const contract = compileRunContract(`${EMAIL_TASK} Write the summary to ./summary.md.`, { requiredTools: ["send-message"] });
    const byId = (id: string) => contract.requirements.find((r) => r.id === id)!;
    expect(requirementBasis(byId("tool:send-message"))).toBe("declared");
    expect(requirementBasis(byId("artifact:./summary.md"))).toBe("evidence");
    expect(requirementBasis(byId("action:send-message"))).toBe("heuristic");
    expect(requirementBasis(byId("answer"))).toBe("heuristic");
  });

  it("a prose-derived action with no receipt is advisory, a declared required tool with no receipt blocks", () => {
    const runContract = compileRunContract(EMAIL_TASK);
    const state = makeKernelState({ meta: { ...makeKernelState().meta, runContract } });
    const prose = classifyContractOutstanding(state, makeKernelInput({ task: EMAIL_TASK }), "Done.");
    expect(prose.blocking).toEqual([]);
    expect(prose.advisory.some((a) => a.startsWith("perform the requested action"))).toBe(true);

    const declared = classifyContractOutstanding(
      state,
      makeKernelInput({ task: EMAIL_TASK, requiredTools: ["send-message"] }),
      "Done.",
    );
    expect(declared.blocking).toEqual([{ text: "call the `send-message` tool", basis: "declared" }]);
  });
});

describe("pin 2: a derived SideEffectLanded never reaches the stored delivery set", () => {
  it("is derived (advisory guess) but the seed drops it on every surface", () => {
    const derived = deriveConditions(EMAIL_TASK, []);
    expect(derived).toContainEqual(sideEffectLanded());
    for (const surface of [undefined, [], [{ name: "send-message" }]]) {
      expect(seedPostConditions(derived, surface)).toEqual([]);
    }
  });
});

describe("pin 3: the exit gate does not fail a prose-action task, and still fails a declared one", () => {
  const baseOpts: KernelRunOptions = {
    maxIterations: 8,
    strategy: "reactive",
    kernelType: "react",
    taskId: "veto-basis-e2e",
    modelId: "llama3.2:3b",
  };
  const schemas = [{ name: "send-message", description: "send a message", parameters: [{ name: "text", type: "string", required: true }] }];
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: "sent" }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: schemas[0]!.parameters }),
  });
  const run = (input: KernelInput, replies: readonly string[]): Promise<KernelState> =>
    Effect.runPromise(
      runPass(reactKernel, input, baseOpts).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer(replies.map((text) => ({ text }))), tools, EventBusLive)),
      ),
    ).then((p) => p.state);

  it("prose-only action task: an answer that claims nothing ends done", async () => {
    const answer = "Here is the announcement text you can send to the team: the release shipped today and all checks passed.";
    const state = await run({ task: EMAIL_TASK, availableToolSchemas: schemas, contextProfile: { tier: "local" } } as KernelInput, [answer, answer, answer]);
    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });

  it("declared requiredTool never called: the run does not end done", async () => {
    const answer = "Here is the announcement text you can send to the team: the release shipped today and all checks passed.";
    const state = await run(
      { task: EMAIL_TASK, requiredTools: ["send-message"], availableToolSchemas: schemas, contextProfile: { tier: "local" } } as KernelInput,
      [answer, answer, answer, answer],
    );
    // The required tool never produced a receipt: the run abstains (kernel status
    // stays "done" for an abstention, the terminal says it was not an answer).
    expect(state.status === "failed" || state.meta.terminatedBy === "abstained").toBe(true);
    expect(String(state.error)).toContain("send-message");
  });
});

describe("pin 4: continuation-intent warns, never rejects alone", () => {
  it("severity is warn", () => {
    const r = defaultVerifier.verify({
      action: "final-answer",
      content: "I'll make one more attempt with a different search query:",
      actionSuccess: true,
      task: "find the price",
      priorSteps: [],
      terminal: true,
      toolsUsed: new Set(),
    });
    const check = r.checks.find((c) => c.name === "output-not-continuation-intent")!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warn");
    expect(r.checks.every((c) => c.severity !== "reject" || c.name !== "output-not-continuation-intent")).toBe(true);
  });
});

describe("pin 5: fabricated measurement rejects only a unit-bearing number no observation holds", () => {
  const evidence = obs("code-execute", true, "benchmark output: baseline=90ms");
  const verify = (content: string) =>
    defaultVerifier.verify({
      action: "final-answer",
      content,
      actionSuccess: true,
      task: "benchmark it",
      priorSteps: [evidence],
      terminal: true,
      toolsUsed: new Set(["code-execute"]),
      fabricationGuard: "block",
    });
  const sev = (content: string) => verify(content).checks.find((c) => c.name === "output-not-fabricated-measurement")!.severity;

  it("a made-up timing (150 ms appears in no observation) still rejects", () => {
    expect(sev("The optimized version runs in 150 ms, a clear improvement.")).toBe("reject");
  });

  it("a bare percent read from a perf word only warns", () => {
    expect(sev("The change gave a 28% performance improvement.")).toBe("warn");
  });
});

describe("pin 6: an outward action claim with no non-meta receipt is unbacked whatever the surface holds", () => {
  it("empty surface, meta-only receipts, and an unrelated surface all flag the claim", () => {
    const claim = "I've sent the email to the team.";
    expect(unbackedClaimedActions(claim, [], new Set())).toHaveLength(1);
    expect(unbackedClaimedActions(claim, [], new Set(["recall"]))).toHaveLength(1);
    expect(unbackedClaimedActions(claim, ["web-search"], new Set())).toHaveLength(1);
    expect(unbackedClaimedActions("The email has been successfully sent.", [], new Set())).toHaveLength(1);
  });

  it("stays quiet when any real tool succeeded, or the verb describes the answer text itself", () => {
    expect(unbackedClaimedActions("I've sent the email to the team.", [], new Set(["web-search"]))).toHaveLength(0);
    expect(unbackedClaimedActions("I've written the summary below.", [], new Set())).toHaveLength(0);
    expect(unbackedClaimedActions("Emails are sent through SMTP servers.", [], new Set())).toHaveLength(0);
    expect(unbackedClaimedActions("I have not sent the email.", [], new Set())).toHaveLength(0);
  });
});

describe("pin 7: all_tools_called counts successful receipts, not attempts", () => {
  const schemas = [{ name: "file-read", description: "read", parameters: [] }];
  const input = makeKernelInput({ task: "read it", availableToolSchemas: schemas });
  const options = { maxIterations: 5, strategy: "plan-execute", kernelType: "react", exitOnAllToolsCalled: true } as KernelRunOptions;

  it("a tool that was only attempted (every call errored) does not end the step", () => {
    const state = makeKernelState({ toolsUsed: new Set(["file-read"]), steps: [obs("file-read", false, "ENOENT")] });
    const after = checkAllToolsCalled(state, input, options);
    expect(after.status).not.toBe("done");
    expect(after.meta.terminatedBy).toBeUndefined();
  });

  it("a tool with a successful receipt ends it", () => {
    const state = makeKernelState({ toolsUsed: new Set(["file-read"]), steps: [obs("file-read", true, "contents")] });
    const after = checkAllToolsCalled(state, input, options);
    expect(after.status).toBe("done");
  });
});

describe("pin 8: a guard's reply is never recorded ok:true in the trace", () => {
  const schemas = [{ name: "probe", description: "probe", parameters: [{ name: "q", type: "string", required: true }] }];
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: "ok" }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: schemas[0]!.parameters }),
  });
  let n = 0;
  const call = (q: string) => {
    n += 1;
    return { text: Array.from({ length: 450 }, (_, i) => `v${n}x${i}`).join(" "), toolCall: { name: "probe", args: { q } } };
  };

  it("the repeat-call warning is emitted as a not-ok ToolCallCompleted", async () => {
    const { texts, completed } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const pass = yield* runPass(
          reactKernel,
          { task: "Probe the source and report what it says.", availableToolSchemas: schemas, contextProfile: { tier: "local" } } as KernelInput,
          { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "veto-basis-guard-ok", modelId: "llama3.2:3b" },
        );
        const raw = yield* Ref.get(events);
        return {
          texts: pass.state.steps.map((s) => String(s.content)),
          completed: raw.flatMap((e) => (e._tag === "ToolCallCompleted" ? [{ callId: e.callId, success: e.success }] : [])),
        };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([call("a"), call("b"), call("c"), { text: "The source said ok." }]),
            tools,
            EventBusLive,
          ),
        ),
      ),
    );
    expect(texts.some((t) => t.includes("already called probe 2 times"))).toBe(true);
    expect(completed.length).toBeGreaterThanOrEqual(3);
    // two real calls succeeded, the guard's reply (third) did not
    expect(completed.filter((c) => c.success).length).toBe(2);
    expect(completed.some((c) => !c.success)).toBe(true);
  });
});
