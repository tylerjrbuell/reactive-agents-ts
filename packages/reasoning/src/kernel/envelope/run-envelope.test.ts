import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
  mergeRunEnvelopeIntoKernelInput,
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
    const env = buildRunEnvelope({ harness: { stableToolSurface: true } });
    expect(env.harness.stableToolSurface).toBe(true);
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
