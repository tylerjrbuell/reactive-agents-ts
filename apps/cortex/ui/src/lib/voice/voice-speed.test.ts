import { describe, expect, test } from "bun:test";
import { createReadAloud, type TtsEngine } from "@reactive-agents/ui-core";
import { atRateLimit, rateLabel, speedHint, stepRate } from "./voice-speed.js";
import { createVoiceRuntime } from "./voice-runtime.js";
import { loadPrefs, VOICE_PREFS_KEY } from "./voice-prefs.js";

describe("stepRate", () => {
  test("moves one step each way", () => {
    expect(stepRate(1, "faster")).toBe(1.25);
    expect(stepRate(1, "slower")).toBe(0.75);
    expect(stepRate(1.5, "faster")).toBe(1.75);
  });
  test("stops at 0.75 and 2", () => {
    expect(stepRate(2, "faster")).toBe(2);
    expect(stepRate(0.75, "slower")).toBe(0.75);
    expect(atRateLimit(2, "faster")).toBe(true);
    expect(atRateLimit(0.75, "slower")).toBe(true);
    expect(atRateLimit(1, "faster")).toBe(false);
  });
  test("a saved speed between steps goes to the nearest step that way; below the range climbs to 0.75", () => {
    expect(stepRate(1.1, "faster")).toBe(1.25);
    expect(stepRate(1.1, "slower")).toBe(1);
    expect(stepRate(0.5, "faster")).toBe(0.75);
    expect(stepRate(0.5, "slower")).toBe(0.75);
  });
});

describe("labels and hints", () => {
  test("rateLabel", () => {
    expect(rateLabel(1)).toBe("1×");
    expect(rateLabel(1.25)).toBe("1.25×");
  });
  test("only a server voice carries the hint", () => {
    expect(speedHint("browser")).toBeNull();
    expect(speedHint("server")).toContain("ignores");
  });
});

describe("a speed change reaches the very next chunk", () => {
  test("the engine is handed the current rate for each chunk it speaks", () => {
    let rate = 1;
    const seen: Array<{ text: string; rate: number | undefined }> = [];
    const ends: Array<() => void> = [];
    const tts: TtsEngine = {
      id: "t",
      label: "t",
      available: () => ({ ok: true }),
      voices: async () => [],
      speak: (text, o, h) => {
        seen.push({ text, rate: o.rate });
        ends.push(h.onEnd);
        return { pause() {}, resume() {}, cancel() {} };
      },
    };
    const reader = createReadAloud({ engine: () => tts, rate: () => rate, prefetchAhead: 0 });
    reader.play("s", "First paragraph here.\n\nSecond paragraph here.");
    expect(seen[0]?.rate).toBe(1);
    rate = stepRate(rate, "faster"); // pressed + while chunk one is being read
    ends[0]?.();
    expect(seen[1]?.rate).toBe(1.25);
  });
});

describe("the speed the banner changes is the saved default reading speed", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  test("voice mode starts from the saved rate and a step persists", () => {
    const storage = memory();
    storage.setItem(VOICE_PREFS_KEY, JSON.stringify({ rate: 1.5 }));
    const rt = createVoiceRuntime({ win: {}, base: "http://x", fetch: async () => new Response("{}"), storage });
    let rate = 0;
    rt.prefs.subscribe((p) => (rate = p.rate))();
    expect(rate).toBe(1.5);
    rt.setPrefs({ rate: stepRate(rate, "faster") });
    expect(loadPrefs(storage).rate).toBe(1.75);
  });
});
