// Run: bun test packages/reasoning/tests/kernel/trace-wire-facts.test.ts --timeout 20000
//
// Tracing audit 2026-10-29 pins: every harness signal carries a ledger id that
// signal-rendered/-effect can pair with, llm-exchange names its provider, the
// wire boundary records num_ctx + source / output clamp / shipped-tool
// provenance / per-turn surface diff, and the plan-posture signal is tracked.
// Everything is read back THROUGH the normalized trace (toTraceEvent), the
// shape rax-diagnose and replay consume.
// RED-ON-CUT: remove the providerId plumbing in observable-llm.ts, the
// emitWireRequest call in prepare-think-gateway-call.ts, the injectSignal call
// in stall-deliverable.ts / loop-resolution.ts, or registerPostureSignal in
// think.ts and the matching test fails.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { RunEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js";
import { injectSignal, recoveryTarget } from "../../src/kernel/capabilities/reflect/signal-injection.js";
import { classifyToolProvenance, diffToolSurface } from "../../src/kernel/capabilities/reason/wire-facts.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import {
  initialKernelState,
  transitionState,
  type KernelInput,
  type KernelRunOptions,
} from "../../src/kernel/state/kernel-state.js";

const SCHEMAS = [
  { name: "crypto-price", description: "price", parameters: [{ name: "coin", type: "string", required: true }] },
  { name: "my-tool", description: "user tool", parameters: [{ name: "q", type: "string", required: true }] },
  { name: "todo", description: "checklist", parameters: [{ name: "action", type: "string", required: true }] },
];
const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { ok: 1 } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "t", parameters: [{ name: "q", type: "string", required: true }] }),
});
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
const opts: KernelRunOptions = {
  maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "wire-facts", modelId: "llama3.2:3b",
};

const TAGS = ["GuardFiredEmitted", "LLMExchangeEmitted", "HarnessSignalInjectedEmitted", "SignalRenderedEmitted"] as const;

async function runTraced(posture?: "plan"): Promise<readonly TraceEvent[]> {
  const raw = await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      for (const t of TAGS) yield* bus.on(t, (ev) => Ref.update(events, (xs) => [...xs, ev]));
      const input = {
        task: "Plan the BTC lookup.",
        availableToolSchemas: SCHEMAS,
        metaTools: { todo: true },
        providerName: "ollama",
        contextProfile: { tier: "local", maxTokens: 8192 },
      } as unknown as KernelInput;
      yield* runPass(reactKernel, input, opts);
      return yield* Ref.get(events);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeObservableLLM().pipe(
            Layer.provide(
              TestLLMServiceLayer([
                { text: pad(), toolCalls: [{ name: "my-tool", args: { q: "a" } }] },
                { text: pad(), toolCalls: [{ name: "crypto-price", args: { coin: "BTC" } }] },
                { text: "done." },
              ]),
            ),
          ),
          toolLayer,
          EventBusLive,
          Layer.succeed(RunEnvelope, buildRunEnvelope({ ...(posture ? { posture } : {}) })),
        ),
      ),
    ),
  );
  return raw.flatMap((e, i) => {
    const t = toTraceEvent(e, i);
    return t ? [t] : [];
  });
}

const guards = (t: readonly TraceEvent[], name: string) =>
  t.flatMap((e) => (e.kind === "guard-fired" && e.guard === name ? [e] : []));

describe("wire facts through the normalized trace", () => {
  it("llm-exchange names the real provider, not 'unknown'", async () => {
    const trace = await runTraced();
    const ex = trace.flatMap((e) => (e.kind === "llm-exchange" ? [e] : []));
    expect(ex.length).toBeGreaterThan(0);
    for (const e of ex) expect(e.provider).toBe("anthropic"); // TestLLMService.getModelConfig().provider
  });

  it("wire-request records numCtx+source, output clamp, tool provenance and the per-turn surface diff", async () => {
    const trace = await runTraced();
    const wire = guards(trace, "wire-request");
    expect(wire.length).toBeGreaterThanOrEqual(2);
    const first = wire[0]!.metadata as Record<string, unknown>;
    expect(first.numCtx).toBe(8192);
    expect(first.numCtxSource).toBe("profile");
    expect(first.outputClamped).toBe(false);
    expect(first.toolSurfaceDiff).toBeNull(); // first call: nothing to diff against
    const shipped = first.toolsShipped as { name: string; provenance: string }[];
    const byName = Object.fromEntries(shipped.map((s) => [s.name, s.provenance]));
    expect(byName["crypto-price"]).toBe("builtin");
    expect(byName["my-tool"]).toBe("user");
    // The shipped array matches the llm-exchange for the same turn (no divergent recomputation).
    const ex = trace.flatMap((e) => (e.kind === "llm-exchange" ? [e] : []))[0]!;
    expect(shipped.map((s) => s.name).sort()).toEqual([...ex.toolSchemaNames].sort());
    const second = wire[1]!.metadata as Record<string, unknown>;
    expect(second.toolSurfaceDiff).toEqual({ added: expect.any(Array), removed: expect.any(Array) });
  });

  it("plan posture: posture signal is injected, rendered and id-linked on guard-fired", async () => {
    const trace = await runTraced("plan");
    const injected = trace.flatMap((e) => (e.kind === "harness-signal-injected" && e.origin === "policy/run-posture:posture-applied" ? [e] : []));
    expect(injected.length).toBe(1);
    const id = injected[0]!.signalId;
    expect(id).toMatch(/^sig-/);
    const rendered = trace.flatMap((e) => (e.kind === "signal-rendered" && e.signalId === id ? [e] : []));
    expect(rendered.length).toBe(1);
    const posture = guards(trace, "posture-applied");
    expect(posture.length).toBeGreaterThan(0);
    for (const g of posture) expect((g.metadata as Record<string, unknown>).signalId).toBe(id);
  });
});

describe("pure wire-fact helpers", () => {
  it("classifies provenance: meta > builtin > mcp > user", () => {
    expect(classifyToolProvenance("todo")).toBe("meta");
    expect(classifyToolProvenance("web-search")).toBe("builtin");
    expect(classifyToolProvenance("github/create_issue")).toBe("mcp");
    expect(classifyToolProvenance("my-tool")).toBe("user");
    expect(classifyToolProvenance("x", "harness")).toBe("meta");
  });
  it("diffs surfaces; first call has none", () => {
    expect(diffToolSurface(undefined, ["a"])).toBeUndefined();
    expect(diffToolSurface(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });
});

describe("harness signals carry ledger ids that render/effect can pair with", () => {
  it("injectSignal opens the ledger entry, emits the SAME id, and returns the pending ref", async () => {
    const options = { strategy: "react" } as unknown as KernelRunOptions;
    const state = initialKernelState(options);
    const { result, trace } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("HarnessSignalInjectedEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        const result = yield* injectSignal(state, {
          signalKind: "nudge", origin: "t", content: "go", field: "errorRecovery",
          target: { policy: "required-tool", tool: "web-search" },
        });
        const raw = yield* Ref.get(events);
        return { result, trace: raw.flatMap((e, i) => { const t = toTraceEvent(e, i); return t ? [t] : []; }) };
      }).pipe(Effect.provide(EventBusLive)),
    );
    const inj = trace.find((e) => e.kind === "harness-signal-injected");
    expect(inj?.kind === "harness-signal-injected" && inj.signalId).toBe(result.signalId);
    expect(result.state.signalLedger?.map((e) => e.signalId)).toEqual([result.signalId]);
    expect(result.pendingSignals).toEqual([
      { signalId: result.signalId, field: "errorRecovery", target: { policy: "required-tool", tool: "web-search" } },
    ]);
  });

  it("loop-resolution recovery redirect registers the signal and rides a pending ref with a tool target", async () => {
    const options = { strategy: "react" } as unknown as KernelRunOptions;
    const steps = [
      makeStep("action", "call", { toolCall: { id: "1", name: "web-search", arguments: {} } }),
      makeStep("observation", "ENOENT", { observationResult: makeObservationResult("web-search", false, "ENOENT not found") }),
    ];
    const state = transitionState(initialKernelState(options), { steps });
    const r = await Effect.runPromise(
      resolveDetectedLoop({
        state, currentInput: { task: "t" } as unknown as KernelInput, currentOptions: options, loopMsg: "loop",
        failureRecoveryRedirects: 0, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 2, maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    );
    expect(r.outcome).toBe("next");
    const ledger = r.state.signalLedger ?? [];
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.target).toEqual({ policy: "denied-tool-retry", tool: "web-search" });
    expect(r.state.pendingGuidance?.pendingSignals?.map((p) => p.signalId)).toEqual([ledger[0]!.signalId]);
  });

  it("recoveryTarget names a tool (the classifier needs one) and never an alternate for policy refusals", () => {
    expect(recoveryTarget({ failedUnresolved: ["a"], alternativeCandidates: ["b"] })).toEqual({ policy: "alternate-tool", tool: "b" });
    expect(recoveryTarget({ failedUnresolved: ["a"], alternativeCandidates: [] })).toEqual({ policy: "denied-tool-retry", tool: "a" });
    expect(recoveryTarget({ failedUnresolved: ["a"], alternativeCandidates: ["b"], policyBlocked: ["a"] })).toEqual({ policy: "denied-tool-retry", tool: "a" });
  });

  it("census pin: every emitHarnessSignalInjected site passes a ledger signalId, or is a named trace-only origin", () => {
    const root = join(import.meta.dir, "../../src/kernel");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(root);
    const TRACE_ONLY = ["unresolved-tool-call-guard", "strategy-switch/classifier-skip", "text-parse-shadow"];
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("utils/diagnostics.ts") || f.endsWith("signal-injection.ts")) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/emitHarnessSignalInjected\(\{[\s\S]*?\n\s*\}\)/g)) {
        const call = m[0];
        if (/signalId/.test(call) || TRACE_ONLY.some((o) => call.includes(o))) continue;
        offenders.push(`${f.slice(root.length)}: ${call.slice(0, 120).replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
