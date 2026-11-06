// Run: bun test packages/tools/tests/execution/sandbox-lifecycle-docker.test.ts --timeout 90000
//
// Sandbox container lifecycle against a REAL Docker daemon: no rax-sandbox
// container may outlive its tool call (interrupt, timeout), and the reaper
// removes stale labeled leftovers while never touching unlabeled containers.
// Skips when Docker is unavailable (CI has no Docker).
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Fiber } from "effect";
import { spawn } from "@reactive-agents/runtime-shim";
import { makeDockerSandbox } from "../../src/execution/docker-sandbox.js";
import { shellExecuteHandler, codeExecuteHandler } from "../../src/index.js";
import {
  SANDBOX_LABEL,
  SANDBOX_DEADLINE_LABEL,
  reapStaleSandboxes,
} from "../../src/execution/sandbox-lifecycle.js";

const sandbox = makeDockerSandbox();
let dockerUp = false;

/** Containers this file created directly; removed in afterAll as a safety net. */
const createdHere: string[] = [];

const docker = async (args: readonly string[]): Promise<{ code: number; out: string }> => {
  const proc = spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout as ReadableStream).text();
  const code = await proc.exited;
  return { code, out: out.trim() };
};

/** Names of every container (any state) whose name starts with rax-sandbox-. */
const sandboxNames = async (): Promise<Set<string>> => {
  const r = await docker(["ps", "-a", "--filter", "name=rax-sandbox-", "--format", "{{.Names}}"]);
  return new Set(r.out.split("\n").filter((n) => n.length > 0));
};

const exists = async (name: string): Promise<boolean> =>
  (await docker(["container", "inspect", name])).code === 0;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `pred` holds or `ms` elapses. */
const eventually = async (pred: () => Promise<boolean>, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await delay(250);
  }
  return pred();
};

beforeAll(async () => {
  dockerUp = await Effect.runPromise(sandbox.available());
});

afterAll(async () => {
  for (const name of createdHere) await docker(["rm", "-f", name]);
});

describe("sandbox lifecycle — real container", () => {
  test("interrupting the effect mid-run leaves no sandbox container behind", async () => {
    if (!dockerUp) return; // skip: no Docker
    const before = await sandboxNames();
    const fiber = Effect.runFork(sandbox.executeShell("sleep 25"));
    // Wait until the container is actually running.
    const started = await eventually(async () => {
      const now = await sandboxNames();
      return [...now].some((n) => !before.has(n));
    }, 20_000);
    expect(started).toBe(true);
    const ours = [...(await sandboxNames())].filter((n) => !before.has(n));

    await Effect.runPromise(Fiber.interrupt(fiber));

    // Cleanup must run as part of interruption — well before the 25s sleep or
    // the 30s sandbox timeout could remove it.
    const gone = await eventually(async () => {
      for (const n of ours) if (await exists(n)) return false;
      return true;
    }, 8_000);
    expect(gone).toBe(true);
  }, 60000);

  test.each([
    ["shell-execute", () => shellExecuteHandler({ sandbox: "docker", additionalCommands: ["sleep"] })({ command: "sleep 25" })],
    ["code-execute", () => codeExecuteHandler({ sandbox: "docker" })({ code: "await Bun.sleep(25000)" })],
  ] as const)("cancelling a %s tool call reaches and removes its container", async (_name, call) => {
    if (!dockerUp) return;
    const before = await sandboxNames();
    const fiber = Effect.runFork(call());
    const started = await eventually(
      async () => [...(await sandboxNames())].some((n) => !before.has(n)),
      20_000,
    );
    expect(started).toBe(true);
    const ours = [...(await sandboxNames())].filter((n) => !before.has(n));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const gone = await eventually(async () => {
      for (const n of ours) if (await exists(n)) return false;
      return true;
    }, 8_000);
    expect(gone).toBe(true);
  }, 60000);

  test("a timed-out run leaves no sandbox container behind", async () => {
    if (!dockerUp) return;
    const before = await sandboxNames();
    const exit = await Effect.runPromiseExit(
      sandbox.executeShell("sleep 20", { timeoutMs: 1_500 }),
    );
    expect(exit._tag).toBe("Failure");
    const after = await sandboxNames();
    expect([...after].filter((n) => !before.has(n))).toEqual([]);
  }, 60000);

  test("every sandbox container carries the rax.sandbox label", async () => {
    if (!dockerUp) return;
    // A run that inspects its own labels is impossible from inside; instead
    // catch it in flight.
    const before = await sandboxNames();
    const fiber = Effect.runFork(sandbox.executeShell("sleep 15"));
    await eventually(async () => [...(await sandboxNames())].some((n) => !before.has(n)), 20_000);
    const ours = [...(await sandboxNames())].filter((n) => !before.has(n));
    expect(ours.length).toBe(1);
    const label = await docker([
      "inspect", "--format", `{{index .Config.Labels "${SANDBOX_LABEL}"}}`, ours[0]!,
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(label.out).toBe("1");
  }, 60000);

  test("reaper removes an exited labeled container and never touches an unlabeled one", async () => {
    if (!dockerUp) return;
    const suffix = `${process.pid}-${Date.now()}`;
    const stale = `rax-sandbox-test-stale-${suffix}`;
    const foreign = `rax-sandbox-test-foreign-${suffix}`;
    createdHere.push(stale, foreign);

    // A fake prior run: labeled, already exited, deadline long passed.
    const mk = await docker([
      "run", "--name", stale,
      "--label", `${SANDBOX_LABEL}=1`,
      "--label", `${SANDBOX_DEADLINE_LABEL}=${Date.now() - 600_000}`,
      "oven/bun:1-alpine", "true",
    ]);
    expect(mk.code).toBe(0);
    // An unlabeled exited container (stands in for the user's own containers).
    const mkForeign = await docker(["run", "--name", foreign, "oven/bun:1-alpine", "true"]);
    expect(mkForeign.code).toBe(0);

    const result = await Effect.runPromise(reapStaleSandboxes());
    expect(result.removed.length).toBeGreaterThanOrEqual(1);
    expect(await exists(stale)).toBe(false);
    expect(await exists(foreign)).toBe(true);
  }, 60000);
});
