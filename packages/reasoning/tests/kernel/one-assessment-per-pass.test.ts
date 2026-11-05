// Run: bun test packages/reasoning/tests/kernel/one-assessment-per-pass.test.ts --timeout 20000
//
// Plan 9 advisor record item 9 (post-review 2026-11-05): "one progress
// authority". The H1 fix made a pass assess twice — once at pass start, before
// the act, for the low-delta / F3 arg-variety / stall / gathering-phase guards,
// and again after the act for loop detection's staleness. The guards read a
// value one act behind. A pass now assesses ONCE, right after the kernel step
// (iterate-assessment-seam.ts assessAfterAct); the next pass's start readers
// reuse that value, and only a state carrying no assessment takes a seed.
//
// RED-ON-CUT (each verified, then restored):
//   - drift pin: the pre-change tree (assess() also called in
//     staleIterationsAtTurnBoundary) fails the call-site census.
//   - post-act pins: delete the `assessAfterAct` line under the kernel step in
//     iterate-pass.ts and the three end-to-end tests here fail (the guards read
//     the pass-start value again), as does the staleness CONTROL in
//     staleness-after-deliverable.test.ts.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

// ── Drift pin: one assess() call site in the kernel ──────────────────────────

const KERNEL_SRC = join(import.meta.dir, "../../src/kernel");

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Code lines (comments dropped) that CALL assess(), per kernel file. */
function assessCallSites(): string[] {
  return productionFiles(KERNEL_SRC).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line: line.trim(), at: `${relative(KERNEL_SRC, file)}:${i + 1}` }))
      .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
      .filter(({ line }) => /(^|[^\w.])assess\(/.test(line) && !line.startsWith("export function assess("))
      .map(({ at }) => at),
  );
}

describe("one assess() call site in the kernel (drift pin)", () => {
  it("only assessAndRecordPass calls assess(); every pass reaches it once, after its act", () => {
    const sites = assessCallSites();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toStartWith("loop/iterate-assessment-seam.ts:");
  });
});

// ── End-to-end: the guards read the post-act assessment ─────────────────────

const P = (name: string, type = "string") => ({ name, type, required: true });

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `a${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown>) => ({ text: pad(), toolCall: { name, args } });

async function run(
  input: KernelInput,
  opts: KernelRunOptions,
  tools: ReturnType<typeof mockToolServiceLayer>,
  turns: Parameters<typeof TestLLMServiceLayer>[0],
): Promise<readonly TraceEvent[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      yield* runPass(reactKernel, input, opts);
      const raw = yield* Ref.get(events);
      return raw.flatMap((e, i): TraceEvent[] => {
        const t = toTraceEvent(e, i);
        return t ? [t] : [];
      });
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
}

describe("the pass's assessment is taken after its act", () => {
  const SCHEMAS = [{ name: "web-search", description: "search the web", parameters: [P("q")] }];
  const input: KernelInput = {
    task: "Gather the core metric and tell me what it is.",
    availableToolSchemas: SCHEMAS,
    contextProfile: { tier: "local" },
  } as KernelInput;
  const opts: KernelRunOptions = {
    maxIterations: 6,
    strategy: "reactive",
    kernelType: "react",
    taskId: "one-assessment-gather",
    modelId: "llama3.2:3b",
  };
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: { finding: "KEY FACT: the core metric rose 12%." } }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
  });

  const turns = () => [call("web-search", { q: "core metric" }), { text: "The core metric rose 12%." }];

  it("the gathering phase is assessed before the act pass's guards run (post-act snapshot)", async () => {
    const trace = await run(input, opts, tools, turns());
    // Pass-start assessment: the guards after the act read a value from before
    // it, so the first `gather` phase appeared only after the act pass's own
    // post-iteration snapshot (the first snapshot that shows the call).
    const firstGather = trace.findIndex((e) => e.kind === "assessment" && e.phase === "gather");
    const firstSnapshotWithCall = trace.findIndex(
      (e) => e.kind === "kernel-state-snapshot" && e.toolsUsed.includes("web-search"),
    );
    expect(firstGather).toBeGreaterThanOrEqual(0);
    expect(firstSnapshotWithCall).toBeGreaterThanOrEqual(0);
    expect(firstGather).toBeLessThan(firstSnapshotWithCall);
  });

  it("one assessment per pass, plus the run-start seed", async () => {
    const trace = await run(input, opts, tools, turns());
    // Three passes (think → act → think), each reaching the kernel step once.
    // The seed (iter 0) precedes the first think; each pass then assesses once
    // after its step, at the iteration the step left the state on.
    const assessed = trace.flatMap((e) => (e.kind === "assessment" ? [e.iter] : []));
    expect(assessed).toEqual([0, 0, 1, 2]);
  });
});

// F3 arg-variety (audit 02-#11, long-horizon profile): a model VARYING its args
// across failures is exploring, so the immediate repeated-identical-failure
// redirect stands down. On the pass of the second failure the pass-start
// assessment had seen only the first failure (variety 1), so the redirect fired
// on an exploring model.
describe("F3 reads the failure the act just produced", () => {
  const SCHEMAS = [{ name: "fetch", description: "fetch a url", parameters: [P("url")] }];
  const input: KernelInput = {
    task: "Fetch the status page and tell me whether the service is up.",
    availableToolSchemas: SCHEMAS,
    contextProfile: { tier: "local" },
  } as KernelInput;
  const opts: KernelRunOptions = {
    maxIterations: 8,
    strategy: "reactive",
    kernelType: "react",
    taskId: "one-assessment-f3",
    modelId: "llama3.2:3b",
    horizonProfile: "long",
  };
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: false, result: "HTTP 503: upstream unavailable" }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
  });
  const f3Redirects = (trace: readonly TraceEvent[]) =>
    trace.filter(
      (e) =>
        e.kind === "harness-signal-injected" &&
        (e.metadata as Record<string, unknown> | undefined)?.trigger === "repeated-identical-failure",
    );

  it("two failures with different args get no immediate F3 redirect", async () => {
    const trace = await run(input, opts, tools, [
      call("fetch", { url: "https://status.example.com/a" }),
      call("fetch", { url: "https://status.example.com/b" }),
      { text: "The status page is unreachable (HTTP 503), so the service looks down." },
    ]);
    expect(f3Redirects(trace)).toEqual([]);
  });

  it("CONTROL: two identical failing calls still get the F3 redirect", async () => {
    const trace = await run(input, opts, tools, [
      call("fetch", { url: "https://status.example.com/a" }),
      call("fetch", { url: "https://status.example.com/a" }),
      { text: "The status page is unreachable (HTTP 503), so the service looks down." },
    ]);
    expect(f3Redirects(trace).length).toBeGreaterThan(0);
  });
});
