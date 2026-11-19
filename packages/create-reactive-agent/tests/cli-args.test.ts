import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * An unknown --template / --provider / --pm used to fall back to the default
 * and exit 0 (`--template=nope` scaffolded "minimal"). The CLI now rejects it
 * with the valid list and writes nothing.
 */

const CLI = path.resolve(import.meta.dir, "../src/cli.ts");
let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "cra-cli-args-"));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: cwd },
    timeout: 20_000,
  });
}

describe("create-reactive-agent flag validation", () => {
  test("unknown --template exits 1 with the valid list and writes nothing", () => {
    const r = runCli(["bad-template", "--template=nope", "--yes"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Invalid template: nope");
    expect(r.stderr).toContain("minimal");
    expect(r.stderr).toContain("with-approval-gates");
    expect(existsSync(path.join(cwd, "bad-template"))).toBe(false);
  });

  test("unknown --provider exits 1 with the valid list", () => {
    const r = runCli(["bad-provider", "--provider", "foo", "--yes"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Invalid provider: foo");
    expect(r.stderr).toContain("anthropic, openai, google, groq, xai, ollama");
    expect(existsSync(path.join(cwd, "bad-provider"))).toBe(false);
  });

  test("unknown --pm exits 1", () => {
    const r = runCli(["bad-pm", "--pm=pip", "--yes"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Invalid pm: pip");
  });

  test("valid flags still scaffold and exit 0", () => {
    const r = runCli(["ok-project", "--template=minimal", "--provider=ollama", "--pm=bun", "--yes"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readdirSync(path.join(cwd, "ok-project"))).toContain("package.json");
  });
});
