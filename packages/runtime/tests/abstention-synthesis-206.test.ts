// Run: bun test packages/runtime/tests/abstention-synthesis-206.test.ts --timeout 20000
// Live Ollama opt-in: REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS=1 bun test packages/runtime/tests/abstention-synthesis-206.test.ts --timeout 180000
//
// GH #206 — a budget-exhausted run with no valid answer ships a deterministic
// honest abstention instead of empty output. `success` stays false (this is not
// a success claim), and the message names what was attempted.
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
  it("ships an abstention (not empty output) when the loop exhausts with no answer", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-empty-loop")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(false);
    expect(typeof result.output).toBe("string");
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain("Could not complete the task within the available budget.");
    expect(result.metadata.harnessAuthoredOutput).toBe(true);
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
    expect(result.output).toContain("Could not complete the task within the available budget.");
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
        // answer, so the run must not claim success and must not ship empty
        // output: it ships the honest abstention.
        expect(r.success).toBe(false);
        expect(typeof r.output).toBe("string");
        expect(r.output.trim().length).toBeGreaterThan(0);
        expect(r.output).toContain("Could not complete the task within the available budget.");
        console.log(`[live #206] model=${model} output=${JSON.stringify(r.output)}`);
      } finally {
        await agent.dispose();
      }
    },
    180_000,
  );
});
