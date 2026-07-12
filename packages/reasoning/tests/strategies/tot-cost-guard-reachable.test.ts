/**
 * Tree-of-thought's cost guards must be REACHABLE.
 *
 * ToT shipped two guards that exist to stop it spending without return. The
 * probe fleet (2026-07-12, p9) caught it burning 18 LLM calls / 28k tokens /
 * 117s to read three integers, sum them, and write the total to a file. Both
 * guards were structurally incapable of firing:
 *
 *   1. score-stagnation early exit — required `stagnationWindow` (3) recorded
 *      depths, but one score is recorded per depth and effectiveDepth =
 *      min(config.depth=3, maxBfsDepth). So it could only be satisfied on the
 *      FINAL depth, where `break` saves nothing; at `local` (maxBfsDepth 2) it
 *      could never be satisfied at all.
 *
 *   2. trivial-skip gate — requires classifyTaskComplexity() to return
 *      "trivial", whose only prose branch demands <=12 words AND <=80 chars.
 *      Any realistic task that names a file path exceeds that, so the gate is
 *      unreachable for exactly the tasks users write.
 *
 * (2) is asserted here as a CHARACTERIZATION of today's behavior, not as
 * desired behavior — its evidence (prompt length) is uncorrelated with
 * reasoning complexity, and replacing it is an ablation-gated change. This test
 * exists so the arithmetic that killed (1) cannot silently return.
 *
 * Run: bun test packages/reasoning/tests/strategies/tot-cost-guard-reachable.test.ts
 */
import { describe, test, expect } from "bun:test";

import { TOT_TIER_LIMITS, getToTDepthForTier } from "../../src/strategies/tree-of-thought.js";
import { classifyTaskComplexity } from "../../src/kernel/capabilities/comprehend/task-complexity.js";

/** The shipped default (types/config.ts: treeOfThought.depth). */
const DEFAULT_CONFIG_DEPTH = 3;

const TIERS = ["local", "mid", "large", "frontier"] as const;

describe("ToT cost guard — score-stagnation early exit is reachable", () => {
    for (const tier of TIERS) {
        test(`${tier}: the stagnation window can be satisfied before the final depth`, () => {
            const limits = TOT_TIER_LIMITS[tier];
            const effectiveDepth = getToTDepthForTier(DEFAULT_CONFIG_DEPTH, tier);

            // A plateau needs >= 2 observed depths to exist at all.
            expect(limits.stagnationWindow).toBeGreaterThanOrEqual(2);

            // The guard fires at the end of depth d when d >= stagnationWindow.
            // To SAVE work it must fire at some d strictly less than the final
            // depth — otherwise `break` is a no-op and the guard is dead code.
            const firesAtDepth = limits.stagnationWindow;
            const savesWork = firesAtDepth < effectiveDepth;

            if (tier === "local") {
                // Documented exception: maxBfsDepth 2 means both depths must be
                // paid before a plateau is even observable. Cost control at this
                // tier comes from breadth + the trivial-skip gate.
                expect(effectiveDepth).toBe(2);
                expect(savesWork).toBe(false);
            } else {
                expect(savesWork).toBe(true);
            }
        });
    }

    test("regression: window 3 against the default depth is dead at EVERY tier", () => {
        // This is the arithmetic that shipped. Kept as an explicit statement of
        // the bug so nobody restores it thinking it is conservative.
        const DEAD_WINDOW = 3;
        for (const tier of TIERS) {
            const effectiveDepth = getToTDepthForTier(DEFAULT_CONFIG_DEPTH, tier);
            expect(DEAD_WINDOW < effectiveDepth).toBe(false);
        }
    });
});

describe("ToT cost guard — trivial-skip gate (characterization of a known-weak signal)", () => {
    const SKIP_BFS_CONFIDENCE = 0.7;
    const isSkipped = (task: string) => {
        const v = classifyTaskComplexity(task);
        return v.complexity === "trivial" && v.confidence >= SKIP_BFS_CONFIDENCE;
    };

    test("a mechanically trivial task is NOT skipped once it names a file path", () => {
        // The p9 task. Read a file, add three integers, write the total — there
        // is nothing to explore, and BFS still ran the full tree.
        const task =
            'Read ./qa-out/p9/input.json, add up the numbers in the "values" array, ' +
            "and write ONLY the resulting integer to the file ./qa-out/p9/tree-of-thought.txt.";
        expect(task.length).toBeGreaterThan(80);
        expect(isSkipped(task)).toBe(false); // <-- the cost bug, in one line
    });

    test("the gate keys on prompt LENGTH, which cuts the wrong way in both directions", () => {
        // Short but genuinely open-ended -> skipped.
        expect(isSkipped("Summarize the file ./README.md in one sentence.")).toBe(true);
        // Long but mechanical -> explored.
        expect(
            isSkipped("Write the integer 42 to the file ./out/answer.txt, and then confirm the file exists on disk."),
        ).toBe(false);
    });
});
