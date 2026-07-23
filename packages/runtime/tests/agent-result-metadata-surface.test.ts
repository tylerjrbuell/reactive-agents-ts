// Run: bun test packages/runtime/tests/agent-result-metadata-surface.test.ts
//
// DEBT-REGISTER §3 (2026-07-23) — the public `AgentResult.metadata` type had to
// catch up with what the runtime already puts there.
//
// `reactive-agent.ts` builds `enrichedMetadata` by SPREADING the raw engine
// metadata, so `verdict` and `extensions` have ridden onto `AgentResult.metadata`
// since the cross-cutting cascade shipped — but `AgentResultMetadata` declared
// neither. The values were present and unreadable: any consumer wanting the
// terminal judgment had to cast away the published type, which is the same
// "declared surface disagrees with real surface" defect this register tracks,
// pointed at users instead of at us.
//
// These are TYPE assertions. They pass trivially at runtime; their job is to
// fail `tsc` if either field is dropped from `AgentResultMetadata`.
//
// RED-ON-CUT: delete `verdict` (or `extensions`) from `AgentResultMetadata`
// in `src/builder/types.ts` and `bun run typecheck` fails on this file.
import { describe, it, expect } from "bun:test";
import type { AgentResultMetadata } from "../src/builder/types.js";
import type { TerminatedBy } from "@reactive-agents/core";

describe("AgentResultMetadata declares what the runtime actually forwards", () => {
  it("exposes the terminal verdict without a cast", () => {
    const metadata: AgentResultMetadata = {
      duration: 0,
      cost: 0,
      tokensUsed: 0,
      stepsCount: 0,
      verdict: {
        enforced: true,
        groundedOnRequired: false,
        failed: ["grounding-on-required"],
        repairGaps: ["per-iteration"],
      },
    };

    // Reading through the declared type — no `as`, no index signature.
    const enforced: boolean | undefined = metadata.verdict?.enforced;
    const gaps: readonly string[] | undefined = metadata.verdict?.repairGaps;

    expect(enforced).toBe(true);
    expect(gaps).toEqual(["per-iteration"]);
  });

  it("exposes the extension slot without a cast", () => {
    const metadata: AgentResultMetadata = {
      duration: 0,
      cost: 0,
      tokensUsed: 0,
      stepsCount: 0,
      extensions: { myNewSignal: 42 },
    };

    const slot: Readonly<Record<string, unknown>> | undefined = metadata.extensions;
    expect(slot?.["myNewSignal"]).toBe(42);
  });

  it("keeps `abstained` inside the canonical TerminatedBy union", () => {
    // The engine's `terminatedByRaw` cast (execution-engine.ts) named a
    // hand-written 5-value union that omitted "abstained", so every typed
    // downstream read was told an abstention could not occur. It is bound to
    // this union now; pinning the member here means dropping "abstained" from
    // core breaks a test rather than silently re-narrowing the engine.
    const abstained: TerminatedBy = "abstained";
    expect(abstained).toBe("abstained");
  });
});
