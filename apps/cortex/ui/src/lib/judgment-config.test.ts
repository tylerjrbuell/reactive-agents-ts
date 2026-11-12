import { describe, expect, it } from "bun:test";
import { activeBackendOf, defaultJudgment, judgmentBodyOf, judgmentFrom, judgmentHeadOf, ollamaJudgmentNote } from "./judgment-config.js";

describe("judgmentFrom", () => {
  it("reads a stored config back, keep_alive number included", () => {
    expect(judgmentFrom({ enabled: true, backend: "ollama", model: "nimble", timeoutMs: 20000, keepAlive: 0 })).toEqual({
      enabled: true,
      backend: "ollama",
      model: "nimble",
      timeoutMs: 20000,
      keepAlive: "0",
    });
  });
  it("anything not enabled is the default (off)", () => {
    expect(judgmentFrom(undefined)).toEqual(defaultJudgment());
    expect(judgmentFrom({ enabled: false, backend: "jev" })).toEqual(defaultJudgment());
    expect(judgmentFrom({ enabled: true, backend: "gpt" })).toEqual({ enabled: true });
  });
  it("round-trips through the body", () => {
    const j = { enabled: true as const, backend: "jev" as const, model: "m", timeoutMs: 4000 };
    expect(judgmentFrom(judgmentBodyOf(j))).toEqual(j);
  });
});

describe("judgmentBodyOf", () => {
  it("is not sent while judgment is off, whatever else is filled in", () => {
    expect(judgmentBodyOf(defaultJudgment())).toBeUndefined();
    expect(judgmentBodyOf(undefined)).toBeUndefined();
    expect(judgmentBodyOf({ enabled: false, backend: "jev", model: "x" })).toBeUndefined();
  });
  it("sends only the fields that are set, trimmed", () => {
    expect(judgmentBodyOf({ enabled: true })).toEqual({ enabled: true });
    expect(judgmentBodyOf({ enabled: true, backend: "jev", model: " jev-1 ", timeoutMs: 5000, baseUrl: "  " })).toEqual({
      enabled: true,
      backend: "jev",
      model: "jev-1",
      timeoutMs: 5000,
    });
  });
  it("keep_alive rides only with the Ollama backend; a bad timeout is dropped", () => {
    expect(judgmentBodyOf({ enabled: true, backend: "ollama", keepAlive: "5m", timeoutMs: 0 })).toEqual({ enabled: true, backend: "ollama", keepAlive: "5m" });
    expect(judgmentBodyOf({ enabled: true, backend: "jev", keepAlive: "5m" })).toEqual({ enabled: true, backend: "jev" });
  });
});

describe("activeBackendOf", () => {
  it("follows the framework's presence rule when no backend is chosen", () => {
    expect(activeBackendOf({ enabled: true }, "none")).toMatchObject({ backend: "llm" });
    expect(activeBackendOf({ enabled: true }, "stored")).toMatchObject({ backend: "jev" });
    expect(activeBackendOf({ enabled: true }, "env")).toMatchObject({ backend: "jev" });
  });
  it("a chosen backend wins over the key", () => {
    expect(activeBackendOf({ enabled: true, backend: "ollama" }, "stored")).toEqual({ backend: "ollama", why: "chosen here" });
  });
});

describe("copy", () => {
  it("heads", () => {
    expect(judgmentHeadOf(undefined)).toBe("off");
    expect(judgmentHeadOf({ enabled: true })).toBe("on · automatic");
    expect(judgmentHeadOf({ enabled: true, backend: "jev" })).toBe("on · jev");
  });
  it("the Ollama note says Ollama Cloud cannot score", () => {
    expect(ollamaJudgmentNote(true)).toContain("not available on Ollama Cloud");
    expect(ollamaJudgmentNote(false)).toContain("nimble");
  });
});
