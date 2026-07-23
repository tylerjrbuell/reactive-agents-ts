import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
} from "./run-envelope.js";

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
