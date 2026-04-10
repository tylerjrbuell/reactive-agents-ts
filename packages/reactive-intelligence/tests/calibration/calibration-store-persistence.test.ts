// Run: bun test packages/reactive-intelligence/tests/calibration/calibration-store-persistence.test.ts --timeout 15000
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

describe("CalibrationStore persistent dbPath", () => {
  it("should persist calibration data across store instances with file-backed db", () => {
    const dbPath = path.join(os.tmpdir(), `cal-test-${Date.now()}.sqlite`);
    tmpFiles.push(dbPath);

    // Store 1: save calibration
    const store1 = new CalibrationStore(dbPath);
    store1.save({
      modelId: "persist-test-model",
      calibrationScores: [0.3, 0.4, 0.5],
      sampleCount: 3,
      highEntropyThreshold: 0.75,
      convergenceThreshold: 0.38,
      calibrated: false,
      lastUpdated: Date.now(),
      driftDetected: false,
    });

    // Store 2: load from same path — data should survive
    const store2 = new CalibrationStore(dbPath);
    const loaded = store2.load("persist-test-model");

    expect(loaded).not.toBeNull();
    expect(loaded!.modelId).toBe("persist-test-model");
    expect(loaded!.highEntropyThreshold).toBe(0.75);
    expect(loaded!.convergenceThreshold).toBe(0.38);
    expect(loaded!.sampleCount).toBe(3);
  }, 15000);

  it("should accept calibrationDbPath in ReactiveIntelligenceConfig", async () => {
    const dbPath = path.join(os.tmpdir(), `cal-config-test-${Date.now()}.sqlite`);
    tmpFiles.push(dbPath);

    const layer = createReactiveIntelligenceLayer({
      calibrationDbPath: dbPath,
    });

    // Use the layer to update calibration, then verify it was persisted to the file
    const program = Effect.gen(function* () {
      const sensor = yield* EntropySensorService;
      // Update calibration to trigger a store write
      yield* sensor.updateCalibration("config-test-model", [0.3, 0.4, 0.5, 0.6]);
      return yield* sensor.getCalibration("config-test-model");
    });

    const cal = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(cal.modelId).toBe("config-test-model");
    expect(cal.sampleCount).toBe(4);

    // Verify the file exists on disk (persistent, not :memory:)
    expect(fs.existsSync(dbPath)).toBe(true);
  }, 15000);
});
