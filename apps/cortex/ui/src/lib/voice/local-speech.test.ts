import { describe, expect, test } from "bun:test";
import { canRetry, isWorking, nextPollMs, parseLocalSpeechStatus, phaseLabel, phaseTone, type LocalSpeechStatus } from "./local-speech.js";
import { voiceApi } from "./voice-api.js";

const status = (over: Partial<LocalSpeechStatus> = {}): LocalSpeechStatus => ({
  phase: "ready",
  keepRunning: true,
  eligible: true,
  message: "",
  lastError: null,
  attempts: 0,
  locked: false,
  container: "cortex-speaches",
  endpoint: "localhost:8000",
  ...over,
});

describe("local speech status", () => {
  test("parses the server body and refuses anything that is not a status", () => {
    expect(parseLocalSpeechStatus({ phase: "failed", keepRunning: true, eligible: true, message: "m", lastError: "e", attempts: 3, locked: true, container: "cortex-speaches", endpoint: "localhost:8000" })).toEqual(
      status({ phase: "failed", message: "m", lastError: "e", attempts: 3, locked: true }),
    );
    expect(parseLocalSpeechStatus({ phase: "bogus" })).toBeNull();
    expect(parseLocalSpeechStatus(null)).toBeNull();
    expect(parseLocalSpeechStatus({ phase: "disabled" })?.keepRunning).toBe(false);
  });

  test("labels and tones cover every phase", () => {
    expect(phaseLabel("downloading")).toBe("Downloading models");
    expect(phaseLabel("failed")).toBe("Failed");
    expect(phaseTone("ready")).toBe("ok");
    expect(phaseTone("failed")).toBe("bad");
    expect(phaseTone("starting")).toBe("warn");
    expect(phaseTone("disabled")).toBe("muted");
  });

  test("polls fast while working, slowly when settled, never when off", () => {
    expect(nextPollMs(status({ phase: "starting" }))).toBe(2500);
    expect(nextPollMs(status())).toBe(30_000);
    expect(nextPollMs(status({ keepRunning: false, phase: "disabled" }))).toBeNull();
    expect(nextPollMs(null)).toBeNull();
    expect(isWorking("checking")).toBe(true);
    expect(isWorking("ready")).toBe(false);
  });

  test("Retry shows only after a failure with the opt-in on", () => {
    expect(canRetry(status({ phase: "failed" }))).toBe(true);
    expect(canRetry(status())).toBe(false);
    expect(canRetry(status({ phase: "failed", keepRunning: false }))).toBe(false);
  });

  test("the api client calls the three local routes", async () => {
    const seen: { url: string; method: string | undefined; body: unknown }[] = [];
    const api = voiceApi("http://cortex.test", async (input, init) => {
      seen.push({ url: String(input), method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ phase: "disabled", keepRunning: false, eligible: true }), { status: 200 });
    });
    expect((await api.localStatus()).ok).toBe(true);
    await api.setKeepRunning(true);
    await api.localEnsure();
    expect(seen).toEqual([
      { url: "http://cortex.test/api/voice/local/status", method: "GET", body: undefined },
      { url: "http://cortex.test/api/voice/local/keep-running", method: "POST", body: { enabled: true } },
      { url: "http://cortex.test/api/voice/local/ensure", method: "POST", body: undefined },
    ]);
  });
});
