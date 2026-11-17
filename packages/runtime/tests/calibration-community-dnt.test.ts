/**
 * Community calibration honors the environment telemetry opt-out.
 *
 * `calibration: "auto"` fetches a community profile from the profile endpoint
 * by default. A user who set `DO_NOT_TRACK` or `REACTIVE_AGENTS_TELEMETRY=0`
 * asked for no outbound framework calls, so `resolveCalibration` must not
 * make that request. The default (no opt-out) is unchanged.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveCalibration } from "../src/engine/phases/agent-loop/setup/calibration";

const ENV_KEYS = ["DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;

describe("resolveCalibration: community fetch vs telemetry opt-out", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const savedFetch = globalThis.fetch;
  let requested: string[] = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    requested = [];
    // 404 => no profile and no cache write, so every call reaches fetch.
    const recordingFetch = (input: string | URL | Request): Promise<Response> => {
      requested.push(String(input));
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    globalThis.fetch = recordingFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const run = (modelId: string) =>
    Effect.runPromise(
      resolveCalibration({ calibration: "auto", provider: "test", defaultModel: modelId }),
    );

  const uniqueModel = (tag: string) => `dnt-probe-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  test("default (no opt-out): the community profile is requested", async () => {
    await run(uniqueModel("default"));
    expect(requested.length).toBe(1);
  });

  test("DO_NOT_TRACK=1: no community request", async () => {
    process.env["DO_NOT_TRACK"] = "1";
    await run(uniqueModel("dnt"));
    expect(requested).toEqual([]);
  });

  test("REACTIVE_AGENTS_TELEMETRY=0: no community request", async () => {
    process.env["REACTIVE_AGENTS_TELEMETRY"] = "0";
    await run(uniqueModel("telemetry-off"));
    expect(requested).toEqual([]);
  });
});
