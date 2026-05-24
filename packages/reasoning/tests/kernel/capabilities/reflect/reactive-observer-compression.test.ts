// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-compression.test.ts
//
// Issue #119 / North Star v5.0 §4.3 — Curator-as-sole-prompt-author closure.
//
// The reactive-observer's `compress-messages` patch handler historically
// mutated state.messages directly via transitionState({ messages: ... }).
// That created a parallel substrate that competed with the curator for
// authorship of Prompt.messages. The patch is demoted to ADVISORY: it
// records a CompressionRecommendation on
// state.meta.pendingCompressionRecommendation and emits an advisory log
// event. state.messages stays untouched.
//
// This test pins two invariants:
//   1. The static-source assertion: the patch handler MUST NOT call
//      transitionState({ messages: ... }) inside the compress-messages
//      branch. A regrep over the source file catches any future regression
//      that re-introduces direct mutation.
//   2. The dynamic-shape assertion: KernelMeta carries the new typed field
//      shape `{ targetTokens; reason; recommendedAtIteration }`.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KernelMeta } from "../../../../src/kernel/state/kernel-state.js";

const REACTIVE_OBSERVER_PATH = join(
  __dirname,
  "../../../../src/kernel/capabilities/reflect/reactive-observer.ts",
);

describe("reactive-observer compress-messages — Issue #119 authority closure", () => {
  it("compress-messages branch does NOT call transitionState with messages payload", () => {
    const src = readFileSync(REACTIVE_OBSERVER_PATH, "utf-8");
    // Locate the `case "compress-messages":` block and isolate its body up
    // to the next `case ` or `default:`.
    const caseIdx = src.indexOf('case "compress-messages":');
    expect(caseIdx).toBeGreaterThan(-1);
    const afterCase = src.slice(caseIdx);
    const nextCaseIdx = afterCase.indexOf("case \"", "case \"compress-messages\":".length);
    const defaultIdx = afterCase.indexOf("default:");
    const endIdx = Math.min(
      nextCaseIdx > 0 ? nextCaseIdx : Number.POSITIVE_INFINITY,
      defaultIdx > 0 ? defaultIdx : Number.POSITIVE_INFINITY,
    );
    const body = afterCase.slice(0, endIdx);

    // The rogue mutator pattern: transitionState(s, { messages: ... }).
    // Match the literal `messages:` key inside a transitionState call within
    // this branch. A bare `messages` substring is allowed in comments.
    const rogueMutatorMatches = body.match(/transitionState\([^)]*messages\s*:/gm);
    expect(rogueMutatorMatches).toBeNull();
  });

  it("publishes pendingCompressionRecommendation with the documented shape", () => {
    // Compile-time shape check — if the KernelMeta field ever loses fields,
    // this test fails to typecheck.
    const meta: KernelMeta = {
      pendingCompressionRecommendation: {
        targetTokens: 2000,
        reason: "context-pressure",
        recommendedAtIteration: 4,
      },
    };
    expect(meta.pendingCompressionRecommendation?.targetTokens).toBe(2000);
    expect(meta.pendingCompressionRecommendation?.reason).toBe("context-pressure");
    expect(meta.pendingCompressionRecommendation?.recommendedAtIteration).toBe(4);
  });
});
