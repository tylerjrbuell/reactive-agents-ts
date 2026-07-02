// Run: bun test packages/tools/tests/execution/docker-shell.test.ts --timeout 90000
//
// F1b — opt-in Docker isolation for shell execution. These exercise a REAL
// container, so they skip when Docker is unavailable (e.g. CI). The shell image
// is pulled on first run; give them a generous timeout.
import { describe, test, expect, beforeAll } from "bun:test";
import { Effect } from "effect";
import { makeDockerSandbox } from "../../src/execution/docker-sandbox.js";
import { shellExecuteHandler, codeExecuteHandler } from "../../src/index.js";

const sandbox = makeDockerSandbox();
let dockerUp = false;
beforeAll(async () => {
  dockerUp = await Effect.runPromise(sandbox.available());
});

const runShell = (cmd: string) => Effect.runPromise(sandbox.executeShell(cmd));

describe("F1b — docker executeShell (real container)", () => {
  test("runs a command inside a container and returns stdout", async () => {
    if (!dockerUp) return; // skip: no Docker
    const r = await runShell("echo sandboxed-ok");
    expect(r.output).toContain("sandboxed-ok");
    expect(r.exitCode).toBe(0);
  }, 90000);

  test("gives a writable ephemeral /work tmpfs", async () => {
    if (!dockerUp) return;
    const r = await runShell("echo made-in-container > out.txt && cat out.txt && pwd");
    expect(r.output).toContain("made-in-container");
    expect(r.output).toContain("/work");
    expect(r.exitCode).toBe(0);
  }, 90000);

  test("has no network (--network none)", async () => {
    if (!dockerUp) return;
    const r = await runShell("wget -T2 -qO- http://example.com/ || echo NET-BLOCKED");
    expect(r.output).toContain("NET-BLOCKED");
  }, 90000);

  test("does not mount any host filesystem into /work", async () => {
    if (!dockerUp) return;
    // Fresh tmpfs — /work starts empty, proving no host dir is exposed here.
    const r = await runShell("ls -A /work | wc -l");
    expect(r.output.trim()).toBe("0");
    expect(r.exitCode).toBe(0);
  }, 90000);
});

describe("F1b — shell-execute sandbox:'docker' opt-in", () => {
  test("runs an allowed command through the container", async () => {
    if (!dockerUp) return;
    const handler = shellExecuteHandler({ sandbox: "docker" });
    const r = (await Effect.runPromise(
      handler({ command: "echo containerized" }) as Effect.Effect<
        { executed: boolean; output?: string; dockerSandboxed?: boolean },
        unknown
      >,
    ));
    expect(r.executed).toBe(true);
    expect(r.output).toContain("containerized");
    expect(r.dockerSandboxed).toBe(true);
  }, 90000);

  test("still enforces the input filters before the container (F1a)", async () => {
    if (!dockerUp) return;
    const handler = shellExecuteHandler({ sandbox: "docker" });
    // Process substitution is refused by the input policy regardless of substrate.
    const r = (await Effect.runPromise(
      handler({ command: "cat <(id)" }) as Effect.Effect<{ executed: boolean }, unknown>,
    ));
    expect(r.executed).toBe(false);
  }, 90000);
});

describe("F1b — code-execute RA_SANDBOX=docker opt-in", () => {
  test("runs code inside a container and returns the result", async () => {
    if (!dockerUp) return;
    const prior = process.env.RA_SANDBOX;
    process.env.RA_SANDBOX = "docker";
    try {
      const r = (await Effect.runPromise(
        codeExecuteHandler({ code: "return 6 * 7;" }) as Effect.Effect<
          { executed: boolean; result?: unknown },
          unknown
        >,
      ));
      expect(r.executed).toBe(true);
      expect(r.result).toBe(42);
    } finally {
      if (prior === undefined) delete process.env.RA_SANDBOX;
      else process.env.RA_SANDBOX = prior;
    }
  }, 90000);
});
