import { describe, expect, test } from "bun:test";
import type { AudioLike } from "@reactive-agents/ui-core";
import { diagnosisLine, diagnosisOf, runAudioDiagnostic, toastDue, toneWav } from "./audio-diagnostic.js";

function audioWith(play: (self: AudioLike) => Promise<void>) {
  const made: AudioLike[] = [];
  const createAudio = () => {
    const a: AudioLike = {
      onended: null,
      onerror: null,
      onplaying: null,
      play() {
        return play(a);
      },
      pause() {},
    };
    made.push(a);
    return a;
  };
  return { createAudio, made };
}
const urls = { createObjectURL: () => "blob:t", revokeObjectURL: () => undefined, retryDelayMs: 0 };
const abort = () => Object.assign(new Error("interrupted by a call to pause()"), { name: "AbortError" });

describe("audio diagnostic", () => {
  test("the tone is a valid short WAV", () => {
    const w = toneWav(300, 16_000);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe("RIFF");
    expect(w.length).toBe(44 + 4800 * 2);
  });

  test("played: the element plays and ends", async () => {
    const { createAudio, made } = audioWith(async (a) => {
      a.onplaying?.();
      queueMicrotask(() => a.onended?.());
    });
    expect(await runAudioDiagnostic({ createAudio, ...urls })).toBe("played");
    expect(made.length).toBe(1);
  });

  test("paused by something outside Cortex (twice) is reported as such", async () => {
    const { createAudio } = audioWith(async () => {
      throw abort();
    });
    expect(await runAudioDiagnostic({ createAudio, ...urls })).toBe("external-pause");
  });

  test("a single outside pause is retried and still plays", async () => {
    let n = 0;
    const { createAudio } = audioWith(async (a) => {
      if (n++ === 0) throw abort();
      queueMicrotask(() => a.onended?.());
    });
    expect(await runAudioDiagnostic({ createAudio, ...urls })).toBe("played");
  });

  test("blocked by the browser", async () => {
    const { createAudio } = audioWith(async () => {
      throw Object.assign(new Error("not allowed"), { name: "NotAllowedError" });
    });
    expect(await runAudioDiagnostic({ createAudio, ...urls })).toBe("blocked");
  });

  test("status lines and the error mapping", () => {
    expect(diagnosisOf({ kind: "playback", code: "external-pause", message: "m" })).toBe("external-pause");
    expect(diagnosisOf({ kind: "playback", message: "m" })).toBe("failed");
    expect(diagnosisLine("played").tone).toBe("ok");
    expect(diagnosisLine("external-pause").text).toContain("outside Cortex");
    expect(diagnosisLine("blocked").text).toContain("Blocked by the browser");
  });

  test("the hint toasts at most once a minute", () => {
    expect(toastDue(null, 1000)).toBe(true);
    expect(toastDue(1000, 30_000)).toBe(false);
    expect(toastDue(1000, 61_000)).toBe(true);
  });
});
