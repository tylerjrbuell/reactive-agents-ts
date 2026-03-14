import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";
import { VALIDATION_DATASET } from "./validation-dataset.js";

describe("validation dataset accuracy", () => {
  const layer = createReactiveIntelligenceLayer();

  /**
   * High-signal examples: well-structured reasoning with tool progress.
   * Without logprobs/embeddings, composite is driven by structural quality
   * (high for good format) and behavioral disorder (low when tools succeed).
   * With good behavioral steps, composite lands in ~0.50–0.60 range.
   */
  test("classification accuracy >= 80% on high-signal examples", async () => {
    const highSignal = VALIDATION_DATASET.filter((e) => e.category === "high-signal");
    expect(highSignal.length).toBeGreaterThanOrEqual(15);

    let correct = 0;
    const failures: string[] = [];

    for (const example of highSignal) {
      const program = Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        return yield* sensor.score(example.input);
      });
      const score = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      if (score.composite < 0.60) {
        correct++;
      } else {
        failures.push(`  FAIL: "${example.label}" composite=${score.composite.toFixed(3)}`);
      }
    }

    const accuracy = correct / highSignal.length;
    console.log(
      `High-signal accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${highSignal.length})`,
    );
    if (failures.length > 0) console.log(failures.join("\n"));
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  /**
   * Low-signal examples: malformed, repetitive, stalled, or drifting.
   * Loop steps (repeated failures) push behavioral disorder high (~0.9),
   * and poor format gives moderate structural. Composite lands > 0.65.
   */
  test("classification accuracy >= 80% on low-signal examples", async () => {
    const lowSignal = VALIDATION_DATASET.filter((e) => e.category === "low-signal");
    expect(lowSignal.length).toBeGreaterThanOrEqual(15);

    let correct = 0;
    const failures: string[] = [];

    for (const example of lowSignal) {
      const program = Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        return yield* sensor.score(example.input);
      });
      const score = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      if (score.composite > 0.65) {
        correct++;
      } else {
        failures.push(`  FAIL: "${example.label}" composite=${score.composite.toFixed(3)}`);
      }
    }

    const accuracy = correct / lowSignal.length;
    console.log(
      `Low-signal accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${lowSignal.length})`,
    );
    if (failures.length > 0) console.log(failures.join("\n"));
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  /**
   * Ambiguous examples: short but valid, exploratory, jargon-heavy.
   * These should fall in the broad middle range (0.35–0.85) since
   * they have moderate structural quality and mixed behavioral signals.
   */
  test("ambiguous examples fall in middle range", async () => {
    const ambiguous = VALIDATION_DATASET.filter((e) => e.category === "ambiguous");
    expect(ambiguous.length).toBeGreaterThanOrEqual(15);

    let inRange = 0;
    const failures: string[] = [];

    for (const example of ambiguous) {
      const program = Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        return yield* sensor.score(example.input);
      });
      const score = await Effect.runPromise(program.pipe(Effect.provide(layer)));
      if (score.composite >= 0.35 && score.composite <= 0.85) {
        inRange++;
      } else {
        failures.push(`  FAIL: "${example.label}" composite=${score.composite.toFixed(3)}`);
      }
    }

    const ratio = inRange / ambiguous.length;
    console.log(
      `Ambiguous in-range: ${(ratio * 100).toFixed(1)}% (${inRange}/${ambiguous.length})`,
    );
    if (failures.length > 0) console.log(failures.join("\n"));
    expect(ratio).toBeGreaterThanOrEqual(0.7);
  });

  /**
   * Verify the dataset has enough examples per category.
   */
  test("dataset has >= 60 total examples with >= 15 per category", () => {
    expect(VALIDATION_DATASET.length).toBeGreaterThanOrEqual(60);

    const counts = { "high-signal": 0, "low-signal": 0, ambiguous: 0 };
    for (const example of VALIDATION_DATASET) {
      counts[example.category]++;
    }

    expect(counts["high-signal"]).toBeGreaterThanOrEqual(15);
    expect(counts["low-signal"]).toBeGreaterThanOrEqual(15);
    expect(counts["ambiguous"]).toBeGreaterThanOrEqual(15);

    console.log(
      `Dataset: ${VALIDATION_DATASET.length} total — ` +
        `high-signal: ${counts["high-signal"]}, ` +
        `low-signal: ${counts["low-signal"]}, ` +
        `ambiguous: ${counts["ambiguous"]}`,
    );
  });
});
