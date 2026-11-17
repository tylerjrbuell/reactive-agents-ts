import { describe, expect, it } from "bun:test";
import { humanDuration, replayLine, secretActions } from "./webhook-card.js";

describe("humanDuration", () => {
  it("reads the framework's default window as minutes", () => {
    expect(humanDuration(300000)).toBe("5 minutes");
    expect(humanDuration(60000)).toBe("1 minute");
    expect(humanDuration(3600000)).toBe("1 hour");
    expect(humanDuration(7200000)).toBe("2 hours");
  });
  it("falls back to seconds, then milliseconds", () => {
    expect(humanDuration(90000)).toBe("90 seconds");
    expect(humanDuration(1000)).toBe("1 second");
    expect(humanDuration(250)).toBe("250 ms");
    expect(humanDuration(-1)).toBe("");
  });
});

describe("replayLine", () => {
  it("shows the window as a duration, never as raw milliseconds", () => {
    const line = replayLine(300000);
    expect(line).toContain("5 minutes");
    expect(line).not.toContain("300000");
    expect(line).not.toContain(" ms");
  });
});

describe("secretActions", () => {
  it("offers Replace, Generate and Remove beside a saved secret", () => {
    expect(secretActions(true).map((a) => a.id)).toEqual(["replace", "generate", "remove"]);
  });
  it("offers only Generate when no secret is saved", () => {
    expect(secretActions(false).map((a) => a.id)).toEqual(["generate"]);
  });
});
