// The wither ratchet (north-star spec §5, RATIFIED 2026-07-11).
//
// The builder's public `with*`/`without*` surface may only SHRINK. New
// capability arrives as (a) a profile field, (b) a compose phase/policy, or
// (c) a documented option on an EXISTING wither — never a new top-level method
// without deleting one. Same discipline as the `as unknown as` ceiling and the
// benchmarks feature-matrix ratchet: design it out, never bump it up.
//
// If this test fails because the count went UP, you added a method. Fold it
// into an existing wither instead (see wither-surface-consolidation.md). If you
// genuinely removed one, lower CEILING to the new number in the same commit.
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

// Frozen 2026-07-11 at 89 (was 92; withTerminalTools → withTools({terminal}),
// withTelemetry → withObservability({telemetry}), withoutTracing →
// withObservability({tracing:false}) removed this wave). MONOTONE DOWN ONLY.
// Lowered to 85 on 2026-07-19 (v0.14 debt burndown Wave 1b, DEBT-REGISTER
// P0-6/P0-10): withIdentity / withInteraction / withOrchestration
// (provide-and-forget layers nothing resolved) and withProgressCheckpoint
// (unimplemented promise) removed.
const WITHER_CEILING = 85;

function witherNames(): string[] {
  const proto = Object.getPrototypeOf(ReactiveAgents.create());
  return Object.getOwnPropertyNames(proto).filter((n) => /^with(out)?[A-Z]/.test(n));
}

describe("builder wither-surface ratchet", () => {
  it("public with*/without* method count may only shrink", () => {
    const count = witherNames().length;
    expect(count).toBeLessThanOrEqual(WITHER_CEILING);
  });

  it("the removed methods stay removed (folded into their config equivalents)", () => {
    const names = new Set(witherNames());
    expect(names.has("withTerminalTools")).toBe(false); // → withTools({ terminal })
    expect(names.has("withTelemetry")).toBe(false); // → withObservability({ telemetry })
    expect(names.has("withoutTracing")).toBe(false); // → withObservability({ tracing: false })
    // v0.14 Wave 1b (DEBT-REGISTER P0-6/P0-10) — provide-and-forget layers /
    // unimplemented promises removed rather than left lying:
    expect(names.has("withIdentity")).toBe(false); // layer nothing resolved
    expect(names.has("withInteraction")).toBe(false); // layer nothing resolved (use withApprovalPolicy / withUserInteraction)
    expect(names.has("withOrchestration")).toBe(false); // literal no-op layer
    expect(names.has("withProgressCheckpoint")).toBe(false); // dead-ended config; use withDurableRuns
  });
});
