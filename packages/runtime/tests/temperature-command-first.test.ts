// Run: bun test packages/runtime/tests/temperature-command-first.test.ts --timeout 15000
/**
 * GH temp-threading (Wave-4 capture defect): commanded temperature must reach
 * the kernel request, COMMAND-FIRST: `config.temperature ?? config.contextProfile?.temperature`.
 *
 * The defect: reasoning-think.ts:336 forwarded ONLY `contextProfile.temperature`
 * into the kernel, dropping the commanded `.withModel({ temperature })` sitting
 * on the same config object. think.ts:339 (`input.temperature ??
 * profile.temperature ?? 0.7`) then always stamped a nonzero tier/profile value,
 * shadowing every adapter's `request.temperature ?? defaultTemperature`.
 * Captures claiming "temp 0" sampled at the tier-profile temperature instead.
 *
 * Harness: builder-seam-behavioral.test.ts's `.withReplayLLM` capturing-LLMService
 * pattern (harness A), pointed at the REASONING kernel path: the capture reads
 * the exact CompletionRequest the kernel builds, so `request.temperature` here
 * IS `think.ts:339`'s `temp` on its way to the wire.
 *
 * Arms:
 *  1. RED-ON-HEAD: command 0 + profile default 0.5 => captured request carries
 *     temperature 0 verbatim (at HEAD: 0.5, the profile value wins).
 *  2. Regression, green both sides: NO command + profile default 0.5 => 0.5
 *     (unset command keeps today's behavior; also pins that the command-first
 *     swap did not break the profile path).
 */
import { describe, it, expect } from "bun:test";
import { Layer } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService([{ text: "FINAL ANSWER: done" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

/** Run the REASONING kernel with a capturing LLMService; return the first request. */
async function kernelCapture(
  apply: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<Req | undefined> {
  const captured: Req[] = [];
  const agent = await apply(
    ReactiveAgents.create()
      .withName("temp-threading")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2),
  )
    .withReplayLLM(capturingLayer(captured))
    .build();
  try {
    await agent.run("What is 2 + 2?");
    return captured[0];
  } finally {
    await agent.dispose();
  }
}

describe("Commanded temperature threads command-first to the kernel (GH temp-threading)", () => {
  it("commanded 0 beats the tier/profile default (0.5) and reaches the request verbatim", async () => {
    const req = await kernelCapture((b) =>
      b
        .withContextProfile({ temperature: 0.5 })
        .withModel({ temperature: 0 }),
    );
    expect(req).toBeDefined();
    // RED at HEAD: reasoning-think.ts:336 drops config.temperature, so the
    // kernel stamps the profile's 0.5. After the fix: 0 survives `??` chains.
    expect(req!.temperature).toBe(0);
  }, 15000);

  it("unset command keeps the profile default on the request (no behavior change)", async () => {
    const req = await kernelCapture((b) => b.withContextProfile({ temperature: 0.5 }));
    expect(req).toBeDefined();
    expect(req!.temperature).toBe(0.5);
  }, 15000);
});
