// Run: bun test packages/tools/tests/execution/sandbox-lifecycle-seam.test.ts --timeout 15000
//
// Pure pins for the sandbox lifecycle seam — no Docker needed. The Docker-backed
// behavior (interrupt / timeout / reaper) is pinned in
// sandbox-lifecycle-docker.test.ts.
import { describe, test, expect } from "bun:test";
import { DEFAULT_DOCKER_CONFIG } from "../../src/execution/docker-sandbox.js";
import type { DockerSandboxConfig } from "../../src/execution/docker-sandbox.js";
import {
  DEFAULT_REAP_GRACE_MS,
  SANDBOX_DEADLINE_LABEL,
  SANDBOX_LABEL,
  SANDBOX_OWNER_LABEL,
  buildSandboxCreateArgs,
  parseSandboxListing,
  selectStaleSandboxes,
} from "../../src/execution/sandbox-lifecycle.js";

const spec = (config: Partial<DockerSandboxConfig> = {}) => ({
  name: "rax-sandbox-abc",
  image: "oven/bun:1-alpine",
  cmd: ["sh", "-c", "echo hi"],
  config: { ...DEFAULT_DOCKER_CONFIG, ...config },
  seccompPath: null,
  owner: "host:123",
  deadlineMs: 1_700_000_000_000,
});

/** Value following `flag` for every occurrence of `flag` in argv. */
const valuesOf = (argv: readonly string[], flag: string): string[] =>
  argv.flatMap((a, i) => (a === flag && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

describe("sandbox lifecycle seam — buildSandboxCreateArgs", () => {
  test("two-phase: builds `docker create`, never `docker run`", () => {
    const argv = buildSandboxCreateArgs(spec());
    expect(argv.slice(0, 2)).toEqual(["docker", "create"]);
    expect(argv).not.toContain("run");
  });

  test("labels: sandbox marker, owner and deadline are always present", () => {
    const labels = valuesOf(buildSandboxCreateArgs(spec()), "--label");
    expect(labels).toContain(`${SANDBOX_LABEL}=1`);
    expect(labels).toContain(`${SANDBOX_OWNER_LABEL}=host:123`);
    expect(labels).toContain(`${SANDBOX_DEADLINE_LABEL}=1700000000000`);
  });

  test("--rm cannot be dropped by a config spread (autoRemove: false is ignored)", () => {
    // Mirrors shell-execution's `{ timeoutMs, ...dockerEscalation.config }` spread.
    const escalationConfig: Partial<DockerSandboxConfig> = { autoRemove: false };
    const argv = buildSandboxCreateArgs(spec({ timeoutMs: 5_000, ...escalationConfig }));
    expect(argv).toContain("--rm");
  });

  test("image and command come last, after all flags", () => {
    const argv = buildSandboxCreateArgs(spec());
    expect(argv.slice(-4)).toEqual(["oven/bun:1-alpine", "sh", "-c", "echo hi"]);
  });

  test("hardening flags preserved", () => {
    const argv = buildSandboxCreateArgs({ ...spec(), seccompPath: "/x/seccomp.json" });
    expect(valuesOf(argv, "--cap-drop")).toEqual(["ALL"]);
    expect(valuesOf(argv, "--network")).toEqual(["none"]);
    expect(valuesOf(argv, "--user")).toEqual(["65534:65534"]);
    expect(valuesOf(argv, "--security-opt")).toContain("seccomp=/x/seccomp.json");
    expect(argv).toContain("--read-only");
  });
});

describe("sandbox lifecycle seam — reaper selection", () => {
  const now = 1_700_000_000_000;

  test("parses docker ps listing lines (id, state, deadline label)", () => {
    const parsed = parseSandboxListing(
      `aaa\texited\t${now}\nbbb\tRunning\t\nccc\tcreated\tnot-a-number\n\n`,
    );
    expect(parsed).toEqual([
      { id: "aaa", state: "exited", deadlineMs: now },
      { id: "bbb", state: "running", deadlineMs: undefined },
      { id: "ccc", state: "created", deadlineMs: undefined },
    ]);
  });

  test("exited and dead containers are stale regardless of deadline", () => {
    const stale = selectStaleSandboxes(
      [
        { id: "e", state: "exited", deadlineMs: now + 1_000_000 },
        { id: "d", state: "dead", deadlineMs: undefined },
      ],
      now,
    );
    expect(stale).toEqual(["e", "d"]);
  });

  test("a live run (created/running within deadline + grace) is never reaped", () => {
    const stale = selectStaleSandboxes(
      [
        { id: "c", state: "created", deadlineMs: now - DEFAULT_REAP_GRACE_MS + 1 },
        { id: "r", state: "running", deadlineMs: now + 30_000 },
      ],
      now,
    );
    expect(stale).toEqual([]);
  });

  test("created/running past deadline + grace is reaped (never-started leak)", () => {
    const stale = selectStaleSandboxes(
      [
        { id: "c", state: "created", deadlineMs: now - DEFAULT_REAP_GRACE_MS - 1 },
        { id: "r", state: "running", deadlineMs: now - DEFAULT_REAP_GRACE_MS - 1 },
      ],
      now,
    );
    expect(stale).toEqual(["c", "r"]);
  });

  test("non-exited container without a parseable deadline is left alone", () => {
    expect(selectStaleSandboxes([{ id: "x", state: "running", deadlineMs: undefined }], now)).toEqual([]);
  });

  test("containers already being removed are skipped", () => {
    expect(selectStaleSandboxes([{ id: "x", state: "removing", deadlineMs: 0 }], now)).toEqual([]);
  });
});
