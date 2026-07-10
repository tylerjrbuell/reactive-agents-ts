// Run: bun test packages/tools/test/file-read-errors.test.ts
//
// What a model saw when it read a file that wasn't there:
//
//     [Tool error: File read failed: Error: ENOENT: no such file or directory,
//      open '/tmp/.../fixtures/t2/rates.json']
//
// Two "Error:" prefixes (the handler interpolated an Error into a template),
// a raw errno, no statement of what the relative path resolved against, and no
// next step. Meanwhile `getRecoveryHint` — a function written to say exactly
// what to do next — fired only on the legacy text-parse path, so every model
// using native function calling (the default) never saw it.
//
// And the hint it WOULD have given was "→ Try a different path or verify the
// file exists." The model cannot verify that. There was no tool to look with.
//
// Three defects, one dead end. Fixed together, because a hint pointing at a
// tool that doesn't exist is worse than silence.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileReadHandler, withFileRoot } from "../src/skills/file-operations.js";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ra-readerr-"));
  writeFileSync(join(root, "orders.json"), '{"orders":[]}');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

// `withFileRoot` is AsyncLocalStorage — the Effect must be RUN inside the
// store, not merely constructed inside it.
const readFail = async (path: string): Promise<Error> => {
  try {
    await withFileRoot(root, () => Effect.runPromise(fileReadHandler({ path })));
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the read to fail");
};

describe("a missing file is not a transient fault", () => {
  it("ENOENT is NOT retried — it returns without burning the backoff", async () => {
    // The old handler tried 3× with 100ms + 200ms of sleep between. The answer
    // was identical each time. 300ms per miss, on the recovery path, for nothing.
    const t0 = performance.now();
    await readFail("./rates.json");
    const elapsed = performance.now() - t0;
    // The old code could not finish under 300ms. Generous ceiling; the point is
    // the sleeps are gone, not the exact number.
    expect(elapsed).toBeLessThan(250);
  });

  it("the read still succeeds for a file that exists", async () => {
    const out = await withFileRoot(root, () => Effect.runPromise(fileReadHandler({ path: "./orders.json" })));
    expect(out).toBe('{"orders":[]}');
  });
});

describe("the error tells the model where it was standing and what to do", () => {
  it("names the working root — a relative path is meaningless without it", async () => {
    // The model invented "./rates.json". Nothing in its context said what "."
    // was. That is unrecoverable by construction.
    const e = await readFail("./rates.json");
    expect(e.message).toContain(`working root: ${root}`);
  });

  it("does not double-prefix with 'Error:' from interpolating an Error", async () => {
    const e = await readFail("./rates.json");
    expect(e.message).not.toContain("Error: ENOENT");
    expect(e.message).toContain("ENOENT");
  });

  it("still identifies the failing tool", async () => {
    // Effect wraps the typed error in a FiberFailure, so match the rendered
    // text rather than reaching for a field that survives no boundary.
    const e = await readFail("./rates.json");
    expect(String(e)).toContain("File read failed");
  });
});

// ─── The hint, and the path it reaches the model on. ─────────────────────────

import { readFileSync } from "node:fs";

const toolExec = readFileSync(
  join(
    import.meta.dir,
    "../../reasoning/src/kernel/capabilities/act/tool-execution.ts",
  ),
  "utf8",
);

// The BEHAVIOUR of the hint — including that it never names an unexposed tool —
// is driven end-to-end in
// `packages/reasoning/tests/kernel/recovery-hint-availability.test.ts`.
// Here we only pin that the wiring exists at all, and that the dead advice is
// gone; a source-grep cannot tell you what a model receives.

describe("WIRING: the recovery hint reaches the native-FC path", () => {
  it("the native tool-error branch calls getRecoveryHint", () => {
    // It didn't. `executeNativeToolCall` returned a bare `[Tool error: ${msg}]`
    // while `getRecoveryHint` sat unused except on the legacy driver.
    const nativeBranch = toolExec.slice(toolExec.indexOf("export function executeNativeToolCall"));
    expect(nativeBranch).toMatch(/getRecoveryHint\(toolCall\.name, msg, config\?\.exposedToolNames\)/);
  });

  it("the hint reads the EXPOSED schema, never the registry", () => {
    // `toolService.listTools()` includes built-ins withheld from the LLM schema.
    // Keying off it named a tool the model could not call. `tool-observe` passes
    // `ctx.schemas` — the actual toolbox for the turn.
    const observe = readFileSync(
      join(import.meta.dir, "../../reasoning/src/kernel/capabilities/act/tool-observe.ts"),
      "utf8",
    );
    expect(observe).toMatch(/exposedToolNames: new Set\(\(ctx\.schemas \?\? \[\]\)\.map\(\(s\) => s\.name\)\)/);
    // No registry lookup in the CODE. The comment explaining why still names
    // `listTools`, so strip comment lines before asserting.
    const code = toolExec
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/toolService\.listTools\(/);
  });

  it("the old dead-end advice is gone", () => {
    // "Try a different path or verify the file exists" — with no way to verify.
    expect(toolExec).not.toMatch(/Try a different path or verify the file exists/);
  });

  it("the hint tells it to stop guessing", () => {
    expect(toolExec).toMatch(/Do not guess again/);
  });
});
