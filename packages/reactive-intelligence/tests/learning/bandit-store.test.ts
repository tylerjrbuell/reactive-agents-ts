import { describe, test, expect } from "bun:test";
import { BanditStore } from "../../src/learning/bandit-store.js";

describe("BanditStore", () => {
  test("save and load arm stats", () => {
    const store = new BanditStore(":memory:");
    const stats = { contextBucket: "research", armId: "react", alpha: 3.0, beta: 1.5, pulls: 4 };
    store.save(stats);
    const loaded = store.load("research", "react");
    expect(loaded).toEqual(stats);
  });

  test("load returns null for non-existent arm", () => {
    const store = new BanditStore(":memory:");
    expect(store.load("missing", "arm")).toBeNull();
  });

  test("listArms returns all arms for a bucket", () => {
    const store = new BanditStore(":memory:");
    store.save({ contextBucket: "code", armId: "react", alpha: 2, beta: 1, pulls: 2 });
    store.save({ contextBucket: "code", armId: "plan", alpha: 1, beta: 3, pulls: 3 });
    store.save({ contextBucket: "other", armId: "react", alpha: 1, beta: 1, pulls: 0 });

    const arms = store.listArms("code");
    expect(arms).toHaveLength(2);
    expect(arms.map((a) => a.armId).sort()).toEqual(["plan", "react"]);
  });

  test("save overwrites existing arm", () => {
    const store = new BanditStore(":memory:");
    store.save({ contextBucket: "b", armId: "a", alpha: 1, beta: 1, pulls: 0 });
    store.save({ contextBucket: "b", armId: "a", alpha: 5, beta: 2, pulls: 6 });
    const loaded = store.load("b", "a");
    expect(loaded).toEqual({ contextBucket: "b", armId: "a", alpha: 5, beta: 2, pulls: 6 });
  });
});
