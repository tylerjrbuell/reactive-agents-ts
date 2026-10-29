import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  buildHandoffSummary,
  looksLikeHarnessInternalText,
  CARRIED_OBSERVATION_PREFIX,
} from "../../../src/kernel/capabilities/verify/harness-internal-text.js";
import { defaultVerifier } from "../../../src/kernel/capabilities/verify/verifier.js";
import type { VerificationContext } from "../../../src/kernel/capabilities/verify/verifier.js";
import { finalizeStrategyResult } from "../../../src/kernel/capabilities/sense/finalize-result.js";
import { provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";

const fields = {
  switchNumber: 2,
  previousStrategy: "reactive",
  stepsCompleted: 4,
  failureReason: "loop detected",
  toolsCalled: ["web-search"],
  permanentlyFailedTools: [] as string[],
  keyObservations: ["obs one"],
};

describe("looksLikeHarnessInternalText", () => {
  it("recognises every summary the producer builds (no drift)", () => {
    expect(looksLikeHarnessInternalText(buildHandoffSummary(fields))).toBe(true);
    expect(
      looksLikeHarnessInternalText(buildHandoffSummary({ ...fields, permanentlyFailedTools: ["web-search"] })),
    ).toBe(true);
  });

  it("recognises the leaked live shape (label lines + unavailable-tools line)", () => {
    const leaked =
      "New strategy: reactive\nSteps completed: 0\nFailure reason: tool-unavailable (web-search)\n" +
      "Permanently unavailable tools (do not retry — synthesize without them): web-search";
    expect(looksLikeHarnessInternalText(leaked)).toBe(true);
  });

  it("recognises the carried-observation text and a bare header", () => {
    expect(looksLikeHarnessInternalText(`${CARRIED_OBSERVATION_PREFIX} Tool "x" is permanently unavailable`)).toBe(true);
    expect(looksLikeHarnessInternalText("Strategy Switch Handoff (switch #1):")).toBe(true);
  });

  it("recognises 3+ labels without a strong marker", () => {
    expect(looksLikeHarnessInternalText("Previous strategy: a\nSteps completed: 2\nFailure reason: x")).toBe(true);
  });

  it("does not match plain answers or empty input", () => {
    expect(looksLikeHarnessInternalText("Hello!")).toBe(false);
    expect(looksLikeHarnessInternalText("")).toBe(false);
    expect(looksLikeHarnessInternalText(undefined)).toBe(false);
    expect(looksLikeHarnessInternalText(null)).toBe(false);
  });

  it("does not match answers that merely mention the same words", () => {
    expect(
      looksLikeHarnessInternalText(
        "The report notes a strategy switch handoff happened. Steps completed: 3 of 5, and the failure reason was a timeout.",
      ),
    ).toBe(false);
    // two coincidental labels at line start (a CI-style report) stay below the bar
    expect(looksLikeHarnessInternalText("Steps completed: 3\nFailure reason: timeout")).toBe(false);
    expect(looksLikeHarnessInternalText("Tools called: none were needed; the tool is not permanently unavailable.")).toBe(false);
  });
});

describe("verifier output-not-harness-parrot — handoff echo", () => {
  const ctx: VerificationContext = {
    action: "final-answer",
    content: "",
    actionSuccess: true,
    task: "Say hello in one word.",
    terminal: true,
    priorSteps: [],
  };
  it("rejects output echoing the handoff summary", () => {
    const r = defaultVerifier.verify({
      ...ctx,
      content: buildHandoffSummary({ ...fields, permanentlyFailedTools: ["web-search"] }),
    });
    expect(r.checks.find((c) => c.name === "output-not-harness-parrot")?.passed).toBe(false);
  });
  it("passes a legit answer mentioning the words", () => {
    const r = defaultVerifier.verify({
      ...ctx,
      content: "Hello — and no, the failure reason was not a strategy switch handoff.",
    });
    expect(r.checks.find((c) => c.name === "output-not-harness-parrot")?.passed).toBe(true);
  });
});

describe("finalizeStrategyResult — parroted handoff on an abstained terminal", () => {
  const base = { strategy: "reactive" as const, steps: [], status: "completed" as const, start: 0, totalTokens: 1, totalCost: 0 };
  it("replaces handoff text with the honest sentinel even when already abstained", async () => {
    const parrot = buildHandoffSummary({ ...fields, permanentlyFailedTools: ["web-search"] });
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          ...base,
          output: parrot,
          extraMetadata: { rawTerminatedBy: "abstained", terminatedBy: "abstained" },
        }),
      ),
    );
    expect(looksLikeHarnessInternalText(r.output as string)).toBe(false);
    expect(r.output).not.toBe(parrot);
    expect((r.metadata as { terminatedBy?: string }).terminatedBy).toBe("abstained");
  });
  it("leaves a legit abstained explanation untouched", async () => {
    const text = "I could not use web-search; hello.";
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({ ...base, output: text, extraMetadata: { rawTerminatedBy: "abstained", terminatedBy: "abstained" } }),
      ),
    );
    expect(r.output).toBe(text);
  });
});
