import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./fallback.js";
import { makeLlmWorldGenerator } from "./generator.js";

describe("world generator", () => {
  it("uses a valid structured world on the first attempt", async () => {
    const valid = makeFallbackWorld(1);
    const gen = makeLlmWorldGenerator({ run: async () => ({ object: valid }) });
    const r = await gen.generate(1);
    expect(r.source).toBe("llm");
    expect(r.attempts).toBe(1);
  });
  it("regenerates past an invalid response, then succeeds", async () => {
    const valid = makeFallbackWorld(2);
    let calls = 0;
    const gen = makeLlmWorldGenerator({ run: async () => (++calls === 1 ? { object: { id: "bad" } } : { object: valid }) });
    const r = await gen.generate(2);
    expect(r.source).toBe("llm");
    expect(r.attempts).toBe(2);
  });
  it("falls back after exhausting attempts", async () => {
    const gen = makeLlmWorldGenerator({ run: async () => ({ object: { junk: true } }) }, { maxAttempts: 2 });
    const r = await gen.generate(3);
    expect(r.source).toBe("fallback");
    expect(r.attempts).toBe(2);
    expect(r.world.agents).toHaveLength(8);
  });
  it("falls back when the agent throws", async () => {
    const gen = makeLlmWorldGenerator({ run: async () => { throw new Error("provider down"); } });
    const r = await gen.generate(4);
    expect(r.source).toBe("fallback");
    expect(r.attempts).toBe(1);
  });

  it("expands a compact structured blueprint into a validated island", async () => {
    const blueprint = {
      weather: { condition: "sunny", tempC: 24 },
      terrainRows: ["OOOOOOOO", "OBGBGFBBO", "OBGFWFGFBO", "OBGRWRGBBO", "OBFGWWGFBO", "OBFGWGFBO", "OBGFGFBBO", "OOOOOOOO"],
      secrets: ["A spring runs under camp.", "A radio repeats at dusk."],
    };
    const generator = makeLlmWorldGenerator({ run: async () => ({ object: blueprint }) });

    const result = await generator.generate(7);

    expect(result.source).toBe("llm");
    expect(result.world.terrain).toHaveLength(64);
    expect(result.world.island).toEqual({ width: 8, height: 8 });
  }, 15000);
});
