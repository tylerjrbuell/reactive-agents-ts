// Run: bun run repo test packages/benchmarks/tests/sim/cli.test.ts
// Phase Z CLI: exit codes and output. Zero tokens.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { main } from "./cli.js";

let out: string[] = [];
let err: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  out = [];
  err = [];
  logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("bench:sim CLI", () => {
  // The exit-1-on-HURTS branch (`cells.some(hurts)`) has no registered cell to drive it since the
  // 2026-11-18 kernel fixes cleared every deterministic HURTS; matrix.test.ts pins the verdict itself.
  it("exit 0 with the fixed lean gate: prose- and filename-named inputs are both NEUTRAL", async () => {
    const code = await main(["--mechanism", "leanFinalTurn", "--shapes", "unread-input-prose,unread-input-filename"]);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("deterministic");
    expect(text).toMatch(/unread-input-prose\s+leanFinalTurn\s+NEUTRAL/);
    expect(text).toMatch(/unread-input-filename\s+leanFinalTurn\s+NEUTRAL/);
  }, 30000);

  it("exit 0 when nothing is hurt", async () => {
    expect(await main(["--mechanism", "parallelToolHint", "--shapes", "iteration-cap-sequential"])).toBe(0);
    expect(out.join("\n")).toMatch(/iteration-cap-sequential\s+parallelToolHint\s+HELPS/);
  }, 30000);

  it("--seeds N runs the stochastic tier and labels it advisory and uncalibrated", async () => {
    expect(await main(["--mechanism", "parallelToolHint", "--shapes", "iteration-cap-sequential", "--seeds", "8"])).toBe(0);
    expect(out.join("\n")).toContain("uncalibrated");
    expect(out.join("\n")).toContain("advisory");
  }, 30000);

  it("--sweep prints a verdict per compliance level and exits 0 (advisory)", async () => {
    expect(await main(["--mechanism", "parallelToolHint", "--shapes", "iteration-cap-sequential", "--sweep", "--seeds", "4"])).toBe(0);
    expect(out.join("\n")).toContain("c=0:");
    expect(out.join("\n")).toContain("c=1:");
  }, 60000);

  it("bad input exits 2 with the valid names", async () => {
    expect(await main(["--mechanism", "nope"])).toBe(2);
    expect(err.join("\n")).toContain("leanFinalTurn");
    expect(await main([])).toBe(2);
    expect(await main(["--mechanism", "leanFinalTurn", "--shapes", "zzz"])).toBe(2);
    expect(await main(["--mechanism", "leanFinalTurn", "--seeds", "0"])).toBe(2);
    expect(await main(["--mechanism", "leanFinalTurn", "--tier", "zzz"])).toBe(2);
  });
});
