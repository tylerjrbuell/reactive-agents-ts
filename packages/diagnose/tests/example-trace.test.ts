// Run: bun test packages/diagnose/tests/example-trace.test.ts --timeout 15000
//
// `examples/failed-run.jsonl` ships in the npm package so a reader can try
// `rax-diagnose cause` with no API key, no Ollama and no run of their own. It
// is a real recorded run (qwen2.5-coder:14b via Ollama, 2026-10-15, copied
// unmodified from wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-
// results/fixtures/post-w3-refix/01M4ZTZAAEMD217GE6Z8SM2A4W.jsonl). The README
// quotes this output; if the classifier changes, update the README too.
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCause, attributeFailure, loadTrace } from "@reactive-agents/trace";

const pkgDir = join(import.meta.dir, "..");
const sample = join(pkgDir, "examples", "failed-run.jsonl");

describe("examples/failed-run.jsonl — keyless try-it sample", () => {
  it("names a decisive cause and blames the harness", async () => {
    const trace = await loadTrace(sample);
    expect(analyzeCause(trace)).toMatchObject({ cause: "never-engaged", confidence: "decisive", outcomeStatus: "failure" });
    expect(attributeFailure(trace)).toMatchObject({
      verdict: "harness",
      reason: "harness:contradictory-guidance",
      confidence: "decisive",
    });
  });

  it("the CLI prints the cause from a relative path with no keys and no trace dir", () => {
    // Empty HOME: no ~/.reactive-agents/traces and no .env keys reach the CLI.
    const home = mkdtempSync(join(tmpdir(), "diagnose-example-home-"));
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home };
    const res = spawnSync(process.execPath, ["src/cli.ts", "cause", "examples/failed-run.jsonl"], { cwd: pkgDir, env, encoding: "utf8" });
    rmSync(home, { recursive: true, force: true });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("cause=never-engaged confidence=decisive status=failure");
    expect(res.stdout).toContain("attribution harness (harness:contradictory-guidance) confidence=decisive");
  });

  it("is small and carries no secrets or home paths", () => {
    expect(statSync(sample).size).toBeLessThan(200_000);
    const text = readFileSync(sample, "utf8");
    expect(text).not.toMatch(/\/home\/|\/Users\/|sk-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{10,}|api[_-]?key/i);
  });

  it("ships in the npm tarball", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("examples");
  });
});
