import { describe, expect, test } from "bun:test";
import { runProbeQueue } from "./mcp-probe-runner.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("runProbeQueue", () => {
  test("never runs more than the limit at once and checks every id exactly once", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const settled: string[] = [];
    await runProbeQueue({
      ids: ["a", "b", "c", "d", "e"],
      limit: 2,
      signal: new AbortController().signal,
      onStart: () => void 0,
      onSettle: (id) => void settled.push(id),
      check: async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        seen.push(id);
        await tick();
        active -= 1;
      },
    });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(settled.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("an abort stops handing out work; checks already running still settle", async () => {
    const ctl = new AbortController();
    const started: string[] = [];
    const settled: string[] = [];
    await runProbeQueue({
      ids: ["a", "b", "c", "d"],
      limit: 2,
      signal: ctl.signal,
      onStart: (id) => void started.push(id),
      onSettle: (id) => void settled.push(id),
      check: async (id) => {
        if (id === "b") ctl.abort();
        await tick();
      },
    });
    expect(started).toEqual(["a", "b"]);
    expect(settled).toEqual(["a", "b"]);
  });

  test("a check that throws does not stop the others, and its settle still fires", async () => {
    const settled: string[] = [];
    await runProbeQueue({
      ids: ["a", "b", "c"],
      limit: 1,
      signal: new AbortController().signal,
      onStart: () => void 0,
      onSettle: (id) => void settled.push(id),
      check: async (id) => {
        if (id === "a") throw new Error("boom");
      },
    });
    expect(settled).toEqual(["a", "b", "c"]);
  });

  test("nothing to check resolves at once", async () => {
    await runProbeQueue({ ids: [], limit: 2, signal: new AbortController().signal, onStart: () => void 0, onSettle: () => void 0, check: async () => void 0 });
    expect(true).toBe(true);
  });
});
