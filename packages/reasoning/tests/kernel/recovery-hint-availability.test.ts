// Run: bun test packages/reasoning/tests/kernel/recovery-hint-availability.test.ts
//
// A tool error is one of only THREE channels that can reach the model's context
// (goal, tool_result, and a one-turn Guidance tail). Everything else the harness
// computes — pace, entropy, the ledger, verifier verdicts — writes to
// `state.steps` and can only gate control flow. So the text of a failed
// tool_result is one of the few places the harness can actually make a model
// smarter mid-run. It said this:
//
//     [Tool error: File read failed: Error: ENOENT: no such file or directory,
//      open '/tmp/.../rates.json']
//
// `getRecoveryHint` existed to say what to do next, and fired only on the legacy
// text-parse driver. Native function calling — the default for every capable
// model — never saw it.
//
// Wiring it exposed a second, sharper bug. The ENOENT hint named
// `list-directory`. MEASURED 2026-07-09: claude-haiku-4-5, toolbox
// {file-read, file-write}, hit ENOENT, obeyed the hint, and got back
// "Tool call used unavailable name(s): list-directory" — again and again, to
// max_iterations, writing nothing. The vague hint it replaced was better.
//
// A hint that names an absent tool is a harness bug. So the hint reads the
// toolbox, on the error path only.

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { executeNativeToolCall } from "../../src/kernel/capabilities/act/tool-execution.js";
import type { ToolServiceInstance } from "../../src/kernel/state/kernel-state.js";

const ENOENT = "File read failed: ENOENT: no such file or directory, open './rates.json' (working root: /tmp/x)";

/**
 * A tool service whose `file-read` always fails. Note `listTools` returns the
 * FULL registry — including list-directory — exactly as the real service does.
 * The hint must NOT trust this; it must trust `exposedToolNames`.
 */
const failingService = (): ToolServiceInstance => ({
  execute: (_input) => Effect.fail(new Error(ENOENT)),
  getTool: (_name) => Effect.succeed({ parameters: [{ name: "path", type: "string", required: true }] }),
  listTools: () => Effect.succeed([{ name: "file-read" }, { name: "file-write" }, { name: "list-directory" }]),
});

/** `exposed` is the LLM schema for this turn — what the model can actually call. */
const readMissing = (exposed?: readonly string[]) =>
  Effect.runPromise(
    executeNativeToolCall(
      failingService(),
      { id: "c1", name: "file-read", arguments: { path: "./rates.json" } },
      "agent-1",
      "session-1",
      exposed === undefined ? {} : { exposedToolNames: new Set(exposed) },
    ),
  );

describe("the ENOENT hint reaches the native-FC path at all", () => {
  it("the failed tool_result now carries a recovery hint, not a bare errno", async () => {
    const r = await readMissing(["file-read", "file-write", "list-directory"]);
    expect(r.success).toBe(false);
    expect(r.content).toContain("→");
  });

  it("the error text itself still reaches the model", async () => {
    const r = await readMissing(["file-read"]);
    expect(r.content).toContain("ENOENT");
  });
});

describe("the hint names list-directory ONLY when the agent has it", () => {
  it("WITH list-directory: names it, and forbids another guess", async () => {
    const r = await readMissing(["file-read", "file-write", "list-directory"]);
    expect(r.content).toContain('list-directory({"path": "."})');
    expect(r.content).toContain("Do not guess again");
  });

  it("WITHOUT list-directory: never names it — this is the max_iterations bug", async () => {
    // The whole point. Naming an absent tool sent a real run into a retry loop
    // it could not escape.
    const r = await readMissing(["file-read", "file-write"]);
    expect(r.content).not.toContain("list-directory");
  });

  it("WITHOUT it: still tells the model the path is hopeless, so it stops retrying", async () => {
    const r = await readMissing(["file-read", "file-write"]);
    expect(r.content).toContain("the same path will fail again");
  });

  it("an empty toolbox degrades to the tool-free wording, never a crash", async () => {
    const r = await readMissing([]);
    expect(r.success).toBe(false);
    expect(r.content).not.toContain("list-directory");
  });

  it("REGISTERED-but-not-exposed is the trap: the registry lists it, the schema does not", async () => {
    // `listTools()` returns list-directory here (as the real service does — it is
    // registered), but `withTools({builtins:[...]})` withheld it from the schema.
    // Keying the hint off the registry is what produced the max_iterations run.
    const r = await readMissing(["file-read", "file-write"]);
    expect(r.content).not.toContain("list-directory");
  });

  it("no exposed set supplied ⇒ never name a tool (cannot prove it is callable)", async () => {
    const r = await readMissing(undefined);
    expect(r.content).not.toContain("list-directory");
    expect(r.content).toContain("the same path will fail again");
  });
});

describe("non-file tools keep their own hints", () => {
  it("a timeout on web-search is not told to list a directory", async () => {
    const service: ToolServiceInstance = {
      execute: (_input) => Effect.fail(new Error("Request timed out after 30s")),
      getTool: (_name) => Effect.succeed({ parameters: [] }),
      listTools: () => Effect.succeed([{ name: "list-directory" }, { name: "web-search" }]),
    };
    const r = await Effect.runPromise(
      executeNativeToolCall(
        service,
        { id: "c1", name: "web-search", arguments: { q: "x" } },
        "a",
        "s",
        { exposedToolNames: new Set(["web-search", "list-directory"]) },
      ),
    );
    expect(r.content).not.toContain("list-directory");
    expect(r.content).toContain("timed out");
  });
});
