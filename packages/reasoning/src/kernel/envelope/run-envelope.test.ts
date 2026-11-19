import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
  mergeRunEnvelopeIntoKernelInput,
  withModelFacet,
} from "./run-envelope.js";
import { resolveHarnessConfig } from "../../harness-config.js";
import type { KernelInput } from "../state/kernel-state.js";

describe("RunEnvelope — the run-wide cross-cutting carrier", () => {
  it("buildRunEnvelope splits fields into policy (judgment) and rails (repair)", () => {
    const env = buildRunEnvelope({
      fabricationGuard: "block",
      grounding: { mode: "block" },
      stallPolicy: { ignoredNudgeTolerance: 2 },
      approvalPolicy: { mode: "detach", tools: new Set(["file-write"]), requireFor: undefined },
    });
    expect(env.policy.fabricationGuard).toBe("block");
    expect(env.policy.grounding?.mode).toBe("block");
    expect(env.rails.stallPolicy?.ignoredNudgeTolerance).toBe(2);
    expect(env.rails.approvalPolicy?.mode).toBe("detach");
  });

  it("emptyRunEnvelope has no policy and no rails (zero-config = zero behavior change)", () => {
    expect(emptyRunEnvelope.policy).toEqual({});
    expect(emptyRunEnvelope.rails).toEqual({});
  });

  it("provideTestEnvelope makes the service readable in an effect", async () => {
    const read = Effect.gen(function* () {
      const env = yield* RunEnvelope;
      return env.policy.fabricationGuard;
    });
    const result = await Effect.runPromise(
      provideTestEnvelope(read, buildRunEnvelope({ fabricationGuard: "warn" })),
    );
    expect(result).toBe("warn");
  });
});

describe("RunEnvelope — harness sub-record", () => {
  it("always carries a resolved harness, even with no options", () => {
    const env = buildRunEnvelope();
    expect(env.harness.lazyDisclosure).toBe(true);
    expect(Object.isFrozen(env.harness)).toBe(true);
  });

  it("resolves the caller's harness config into the envelope", () => {
    const env = buildRunEnvelope({ harness: { verboseRules: true } });
    expect(env.harness.verboseRules).toBe(true);
  });

  it("folds the harness into a KernelInput that does not already carry one", () => {
    const env = buildRunEnvelope({ harness: { toolIndex: true } });
    const folded = mergeRunEnvelopeIntoKernelInput({ task: "t" } as KernelInput, env);
    expect(folded.harness?.toolIndex).toBe(true);
  });

  it("never overwrites an explicit KernelInput.harness — per-pass override wins", () => {
    const env = buildRunEnvelope({ harness: { toolIndex: true } });
    const explicit = resolveHarnessConfig({ toolIndex: false });
    const folded = mergeRunEnvelopeIntoKernelInput(
      { task: "t", harness: explicit } as KernelInput,
      env,
    );
    expect(folded.harness?.toolIndex).toBe(false);
  });
});

describe("RunEnvelope — model facet (audit G1, 2026-11-18)", () => {
  const facet = { providerName: "gemini", contextProfile: { tier: "frontier" as const }, calibrationMode: "skip" as const };

  it("withModelFacet folds provider, profile and calibration mode onto the rails", () => {
    const env = withModelFacet(buildRunEnvelope(), facet);
    expect(env.rails.providerName).toBe("gemini");
    expect(env.rails.contextProfile?.tier).toBe("frontier");
    expect(env.rails.calibrationMode).toBe("skip");
  });

  it("withModelFacet keeps fields already on the envelope and returns the same object when nothing is added", () => {
    const env = buildRunEnvelope({ providerName: "ollama" });
    expect(withModelFacet(env, { providerName: "gemini" })).toBe(env);
    expect(withModelFacet(env, {})).toBe(env);
  });

  it("merges the facet onto a pass that carries none (a hand-built strategy sub-kernel)", () => {
    const folded = mergeRunEnvelopeIntoKernelInput({ task: "t" } as KernelInput, buildRunEnvelope(facet));
    expect(folded.providerName).toBe("gemini");
    expect(folded.contextProfile?.tier).toBe("frontier");
    expect(folded.calibrationMode).toBe("skip");
  });

  it("an explicit pass value wins over the envelope", () => {
    const folded = mergeRunEnvelopeIntoKernelInput(
      { task: "t", providerName: "ollama", calibrationMode: "auto" } as KernelInput,
      buildRunEnvelope(facet),
    );
    expect(folded.providerName).toBe("ollama");
    expect(folded.calibrationMode).toBe("auto");
    expect(folded.contextProfile?.tier).toBe("frontier");
  });

  it("an envelope without the facet writes no facet keys (byte-identical pass)", () => {
    const folded = mergeRunEnvelopeIntoKernelInput({ task: "t" } as KernelInput, buildRunEnvelope());
    expect("providerName" in folded || "contextProfile" in folded || "calibrationMode" in folded).toBe(false);
  });
});
