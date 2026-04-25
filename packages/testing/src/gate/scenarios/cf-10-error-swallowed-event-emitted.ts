// packages/testing/src/gate/scenarios/cf-10-error-swallowed-event-emitted.ts
//
// Targeted weakness: S0.2 (silent `catchAll(() => Effect.void)` sites).
// Closing commit: 4c3b4e29.
//
// Regression triggered when: the wiring test under
// `packages/runtime/tests/error-swallowed-wiring.test.ts` no longer finds
// the conventional shape `<package>/<path>:<line-or-anchor>` across the
// production-side `emitErrorSwallowed` calls. The wiring test is the
// active enforcement; this gate scenario is a *meta* layer that asserts
// the protection itself still ships — i.e. the test file exists and
// reports a non-zero number of sites.
//
// Why this scenario uses a meta-assertion rather than running an agent:
// emitErrorSwallowed fires from production-only code paths (memory
// flushes, telemetry batches, transient stream cleanup) that don't
// trigger reliably from a one-turn test scenario. The meaningful
// regression detector is "do we still scan the codebase for them?"

import { readFileSync, existsSync } from "node:fs";
import type { ScenarioModule } from "../types.js";

const WIRING_TEST_PATH = "packages/runtime/tests/error-swallowed-wiring.test.ts";

export const scenario: ScenarioModule = {
  id: "cf-10-error-swallowed-event-emitted",
  targetedWeakness: "S0.2",
  closingCommit: "4c3b4e29",
  description:
    "Confirms the ErrorSwallowed wiring contract is still enforced: the wiring test file exists, scans production code, and the standard site-string convention is still asserted. Removing the wiring test or weakening its assertions regresses S0.2.",
  config: {
    name: "cf-10-error-swallowed-event-emitted",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    const exists = existsSync(WIRING_TEST_PATH);
    const src = exists ? readFileSync(WIRING_TEST_PATH, "utf-8") : "";
    // The four contracts the wiring test enforces. Removing any weakens
    // S0.2 protection — gate fails and points at 4c3b4e29.
    return {
      wiringTestExists: exists,
      wiringTestAssertsMinimum: src.includes("toBeGreaterThanOrEqual(20)"),
      wiringTestAssertsUniqueness: src.includes("unique (no collisions"),
      wiringTestAssertsFormat: src.includes("convention"),
      wiringTestUsesEmitErrorSwallowed: src.includes("emitErrorSwallowed"),
    };
  },
};
