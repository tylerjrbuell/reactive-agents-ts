import { describe, expect, test } from "bun:test";
import { canRetry, canStart, canStop, DEVICE_OPTIONS, isWorking, nextPollMs, parseLocalSpeechStatus, phaseLabel, phaseTone, portProblem, serverLine, type LocalSpeechStatus } from "./local-speech.js";
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
  endpoint: "127.0.0.1:8000",
  port: 8000,
  device: "auto",
  running: true,
  ...over,
});

describe("local speech status", () => {
  test("parses the server body and refuses anything that is not a status", () => {
    expect(
      parseLocalSpeechStatus({ phase: "failed", keepRunning: true, eligible: true, message: "m", lastError: "e", attempts: 3, locked: true, container: "cortex-speaches", endpoint: "127.0.0.1:8000", port: 8000, device: "auto", running: true }),
    ).toEqual(status({ phase: "failed", message: "m", lastError: "e", attempts: 3, locked: true }));
    expect(parseLocalSpeechStatus({ phase: "bogus" })).toBeNull();
    expect(parseLocalSpeechStatus(null)).toBeNull();
    expect(parseLocalSpeechStatus({ phase: "disabled" })).toMatchObject({ keepRunning: false, port: 8000, device: "auto", running: null });
    expect(parseLocalSpeechStatus({ phase: "stopped", device: "rocm", port: 1.5 })).toMatchObject({ phase: "stopped", device: "auto", port: 8000 });
  });

  test("server line, Start and Stop follow whether the server answers", () => {
    expect(serverLine(status())).toBe("Running on 127.0.0.1:8000.");
    expect(serverLine(status({ running: false, phase: "stopped" }))).toBe("Not running on 127.0.0.1:8000.");
    expect(serverLine(status({ running: null, endpoint: null, port: 8123 }))).toBe("Port 8123.");
    expect(canStart(status({ running: false, phase: "stopped", keepRunning: false }))).toBe(true);
    expect(canStart(status())).toBe(false);
    expect(canStart(status({ running: false, phase: "starting" }))).toBe(false);
    expect(canStop(status({ keepRunning: false }))).toBe(true);
    expect(canStop(status({ running: false, phase: "stopped", keepRunning: false }))).toBe(false);
    expect(canStop(status({ phase: "stopping" }))).toBe(false);
  });

  test("port field: a whole number from 1024 to 65535", () => {
    expect(portProblem("8123")).toBeNull();
    expect(portProblem(" 80 ")).toContain("1024");
    expect(portProblem("80a")).toContain("port number");
    expect(DEVICE_OPTIONS.map((o) => o.value)).toEqual(["auto", "cpu", "cuda"]);
  });

  test("labels and tones cover every phase", () => {
    expect(phaseLabel("downloading")).toBe("Downloading models");
    expect(phaseLabel("failed")).toBe("Failed");
    expect(phaseTone("ready")).toBe("ok");
    expect(phaseTone("failed")).toBe("bad");
    expect(phaseTone("starting")).toBe("warn");
    expect(phaseTone("disabled")).toBe("muted");
  });

  test("polls fast while working (also a hand Start with keep-running off), slowly when kept running, else never", () => {
    expect(nextPollMs(status({ phase: "starting" }))).toBe(2500);
    expect(nextPollMs(status({ phase: "downloading", keepRunning: false }))).toBe(2500);
    expect(nextPollMs(status({ phase: "stopping", keepRunning: false }))).toBe(2500);
    expect(nextPollMs(status())).toBe(30_000);
    expect(nextPollMs(status({ keepRunning: false, phase: "disabled" }))).toBeNull();
    expect(nextPollMs(null)).toBeNull();
    expect(isWorking("checking")).toBe(true);
    expect(isWorking("ready")).toBe(false);
    expect(phaseLabel("stopped")).toBe("Stopped");
  });

  test("Retry shows after a failure, with or without keep-running", () => {
    expect(canRetry(status({ phase: "failed" }))).toBe(true);
    expect(canRetry(status())).toBe(false);
    expect(canRetry(status({ phase: "failed", keepRunning: false }))).toBe(true);
    expect(canRetry(status({ phase: "failed", eligible: false }))).toBe(false);
  });

  test("the api client calls the local routes", async () => {
    const seen: { url: string; method: string | undefined; body: unknown }[] = [];
    const api = voiceApi("http://cortex.test", async (input, init) => {
      seen.push({ url: String(input), method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ phase: "disabled", keepRunning: false, eligible: true }), { status: 200 });
    });
    expect((await api.localStatus()).ok).toBe(true);
    await api.setKeepRunning(true);
    await api.localEnsure();
    await api.localStart();
    await api.localStop();
    await api.localConfig({ port: 8123, device: "cpu" });
    expect(seen).toEqual([
      { url: "http://cortex.test/api/voice/local/status", method: "GET", body: undefined },
      { url: "http://cortex.test/api/voice/local/keep-running", method: "POST", body: { enabled: true } },
      { url: "http://cortex.test/api/voice/local/ensure", method: "POST", body: undefined },
      { url: "http://cortex.test/api/voice/local/start", method: "POST", body: undefined },
      { url: "http://cortex.test/api/voice/local/stop", method: "POST", body: undefined },
      { url: "http://cortex.test/api/voice/local/config", method: "POST", body: { port: 8123, device: "cpu" } },
    ]);
  });
});
