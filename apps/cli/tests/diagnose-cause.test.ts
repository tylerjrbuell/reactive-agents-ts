import { describe, test, expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnose } from "../src/commands/diagnose.js";

const capture = async (argv: string[]): Promise<string> => {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  try {
    await runDiagnose(argv);
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
};

describe("rax diagnose cause", () => {
  test("help lists the cause subcommand", async () => {
    expect(await capture(["--help"])).toContain("cause <runId|path>");
  });

  test("cause --all <dir> --json delegates to cohort mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rax-cause-"));
    try {
      writeFileSync(join(dir, "empty.jsonl"), "");
      const out = JSON.parse(await capture(["cause", "--all", dir, "--json"])) as { dirs: string[]; tally: { total: number } };
      expect(out.dirs).toEqual([dir]);
      expect(out.tally.total).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cause without a target throws a usage error", async () => {
    await expect(runDiagnose(["cause"])).rejects.toThrow(/cause requires a runId or path/);
  });
});
