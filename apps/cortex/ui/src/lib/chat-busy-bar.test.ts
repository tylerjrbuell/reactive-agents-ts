import { describe, expect, test } from "bun:test";
import { busyBarState } from "./chat-busy-bar.js";

describe("busyBarState", () => {
  test("a running reply animates the bar", () => {
    expect(busyBarState({ sending: true, busy: false, phase: "idle" })).toBe("run");
  });
  test("a history action animates the bar", () => {
    expect(busyBarState({ sending: false, busy: true, phase: "idle" })).toBe("run");
  });
  test("idle does not animate", () => {
    expect(busyBarState({ sending: false, busy: false, phase: "idle" })).toBe("off");
  });
  test("stopping or pausing is a calmer pulse, even after sending flips off", () => {
    expect(busyBarState({ sending: true, busy: false, phase: "stopping" })).toBe("calm");
    expect(busyBarState({ sending: false, busy: false, phase: "pausing" })).toBe("calm");
  });
});
