import { describe, expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { conformanceCases, type ConformanceCase } from "./conformance-cases.js";
import type { MakeHarness } from "./harness.js";

/** Fixed virtual start time, so timestamp-windowed adapters (signatures, replay) see a real-looking clock. */
const START_MS = 1_700_000_000_000;

/** Run one conformance case against a harness factory under a virtual clock. Rejects on violation. */
export const runConformanceCase = (testCase: ConformanceCase, make: MakeHarness): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(START_MS);
      yield* testCase({ make });
    }).pipe(Effect.scoped, Effect.provide(TestContext.TestContext)),
  );

/**
 * The shared conformance suite every `ChannelAdapter` must pass. `makeHarness` builds a fake
 * platform plus a started adapter inside the provided scope (no network, no tokens).
 *
 * `skip` lists case names that cannot apply to this adapter, each with a reason, e.g. a stateless
 * webhook has no connection to drop. Skips are visible in the test output.
 */
export const runAdapterConformance = (
  name: string,
  makeHarness: MakeHarness,
  options: { readonly skip?: Readonly<Record<string, string>> } = {},
): void => {
  describe(`ChannelAdapter conformance: ${name}`, () => {
    for (const [caseName, testCase] of Object.entries(conformanceCases)) {
      const skipReason = options.skip?.[caseName];
      if (skipReason !== undefined) {
        test.skip(`${caseName} (skipped: ${skipReason})`, () => {});
        continue;
      }
      test(caseName, async () => {
        await expect(runConformanceCase(testCase, makeHarness)).resolves.toBeUndefined();
      });
    }
  });
};
