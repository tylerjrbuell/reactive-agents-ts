import { describe, test, expect } from "bun:test";
import { BanditStore } from "../../src/learning/bandit-store.js";
import { selectArm, updateArm } from "../../src/learning/bandit.js";

describe("Thompson Sampling bandit", () => {
  test("selectArm returns a valid arm ID", () => {
    const store = new BanditStore(":memory:");
    const armIds = ["react", "plan", "tot"];
    const selected = selectArm("bucket", armIds, store);
    expect(armIds).toContain(selected);
  });

  test("cold start (all pulls < 5) returns a valid arm ID", () => {
    const store = new BanditStore(":memory:");
    // All arms have 0 pulls — cold start path
    const armIds = ["a", "b", "c"];
    const selected = selectArm("cold", armIds, store);
    expect(armIds).toContain(selected);
  });

  test("updateArm with reward > 0.5 increments alpha", () => {
    const store = new BanditStore(":memory:");
    updateArm("ctx", "arm1", 0.8, store);
    const stats = store.load("ctx", "arm1")!;
    expect(stats.alpha).toBe(2); // 1 (default) + 1
    expect(stats.beta).toBe(1);  // unchanged
    expect(stats.pulls).toBe(1);
  });

  test("updateArm with reward <= 0.5 increments beta", () => {
    const store = new BanditStore(":memory:");
    updateArm("ctx", "arm2", 0.3, store);
    const stats = store.load("ctx", "arm2")!;
    expect(stats.alpha).toBe(1); // unchanged
    expect(stats.beta).toBe(2);  // 1 (default) + 1
    expect(stats.pulls).toBe(1);
  });
});
