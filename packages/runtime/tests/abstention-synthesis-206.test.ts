// Run: bun test packages/runtime/tests/abstention-synthesis-206.test.ts --timeout 20000
// Live Ollama opt-in: REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS=1 bun test packages/runtime/tests/abstention-synthesis-206.test.ts --timeout 180000
//
// GH #206 — a budget-exhausted run with no valid answer ends with a
// deterministic honest abstention cause instead of silence. `success` stays
// false (this is not a success claim), and the message names what was
// attempted. Since 2026-11-10 that cause rides `error`; `output` is "".
//
// The offline cases pin the behavior with the deterministic `test` provider. The
// live case drives a real local model (Ollama) through a guaranteed-failing
// required tool so the run cannot ground an answer, proving the abstention
// end-to-end on the real provider path.
import { describe, it, test, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/index.js";

// Probe Ollama once at module load (top-level await). The live case auto-skips
// when no server is reachable (e.g. CI), staying keyless-safe. Prefer a small
// fast model over whatever happens to be first on the box.
const FAST_MODELS = ["qwen3:4b", "granite4:latest", "gemma4:e4b", "qwen3:14b"];
const ollamaState = await (async (): Promise<
  { up: true; model: string } | { up: false }
> => {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { up: false };
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (body.models ?? []).map((m) => m.name);
    const preferred = FAST_MODELS.find((m) => names.includes(m));
    const fallback = names.find((m) => !m.includes("embed"));
    const model = preferred ?? fallback;
    return model ? { up: true, model } : { up: false };
  } catch {
    return { up: false };
  }
})();

describe("GH #206 — honest abstention on budget exhaustion", () => {
  it("ships an honest abstention cause (on error, output empty) when the loop exhausts with no answer", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-empty-loop")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(false);
    // Owner decision 2026-11-10: the harness never writes text into output.
    // W4-live: the default-on zero-evidence stand-down owns this terminal
    // earlier (<=2 iterations) and records the honest `no_substantive_output`
    // abstention; both honest-abstention sentinels share this prefix. The
    // sentinel is the run's cause on `error`, never a harness-authored answer.
    expect(result.output).toBe("");
    expect(result.metadata.harnessAuthoredOutput).toBeUndefined();
    expect(String(result.error)).toContain("Could not complete the task");
    await agent.dispose();
  }, 20000);

  it("ships an abstention when the model ends its turn on a rejected continuation", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-continuation")
      .withTestScenario([{ text: "I'll make one more attempt with a different search query:" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 6, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Find the current Bitcoin price.");

    expect(result.success).toBe(false);
    // The rejected continuation itself must never ship as the answer.
    expect(result.output).not.toContain("one more attempt");
    // Owner decision 2026-11-10: a failed run's output is EMPTY (the harness
    // never writes the answer). The honest cause rides `result.error` instead:
    // the kernel's own verifier rejection, naming the continuation it refused.
    expect(result.output).toBe("");
    expect(result.metadata.harnessAuthoredOutput).toBeUndefined();
    expect(String(result.error)).toContain("Verifier rejected output");
    expect(String(result.error)).toContain("continuation-intent");
    await agent.dispose();
  }, 20000);

  // W4-live (round-1 fix, Important 3): the stand-down pre-empts the
  // budget-exhaustion terminal on the default path, so the #206
  // budget_exhausted_no_output e2e arm is exercised with `.withLongHorizon()` —
  // the stand-down's escape hatch defers it, the run exhausts, and the exact
  // #206 sentinel text ships. This keeps that path e2e-tested (not just the
  // unit-pinned string).
  it("long-horizon deferred: budget-exhaustion still ships the exact #206 sentinel", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-budget-longhorizon")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .withLongHorizon()
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(false);
    // Owner decision 2026-11-10: output stays empty; the exact #206 sentinel
    // is the run's cause on `result.error`, never a harness-authored answer.
    expect(result.output).toBe("");
    expect(result.metadata.harnessAuthoredOutput).toBeUndefined();
    expect(String(result.error)).toContain("Could not complete the task within the available budget.");
    await agent.dispose();
  }, 20000);

  // ── Live proof (opt-in + reachable Ollama). The only tool always fails and
  // is REQUIRED, so the run can neither ground an answer nor satisfy the tool
  // gate: it must fail with an honest abstention, never silence. ──
  test.skipIf(
    process.env.REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS !== "1" || !ollamaState.up,
  )(
    "live: exhausted local-model run ships an honest abstention, never empty output",
    async () => {
      const model = ollamaState.up ? ollamaState.model : "";
      const agent = await ReactiveAgents.create()
        .withName("abstention-206-live")
        .withProvider("ollama")
        .withModel(model)
        .withoutMemory()
        .withTools({
          tools: [
            {
              definition: {
                name: "must-fetch",
                description: "Fetch a live value from a remote service. Usually fails.",
                parameters: [
                  { name: "query", type: "string" as const, description: "What to fetch", required: true },
                ],
                riskLevel: "low" as const,
                timeoutMs: 5_000,
                requiresApproval: false,
                source: "function" as const,
              },
              handler: () => Effect.fail(new Error("upstream unavailable")),
            },
          ],
          required: ["must-fetch"],
        })
        .withReasoning({ strategies: { reactive: { maxIterations: 1, temperature: 0.2 } } })
        .build();

      try {
        const r = await agent.run(
          "Use the must-fetch tool to get the current price of ZZZ-token from the remote service, then report it.",
        );

        // One iteration with a tool that always fails cannot yield a grounded
        // answer, so the run must not claim success and must not end silent:
        // the honest abstention is its cause on `error`, and output stays
        // empty (owner decision 2026-11-10).
        expect(r.success).toBe(false);
        expect(r.output).toBe("");
        // W4-live: the default-on zero-evidence stand-down owns this terminal
        // earlier; both honest-abstention sentinels share this prefix.
        expect(String(r.error)).toContain("Could not complete the task");
        console.log(`[live #206] model=${model} error=${JSON.stringify(r.error)}`);
      } finally {
        await agent.dispose();
      }
    },
    180_000,
  );
});
