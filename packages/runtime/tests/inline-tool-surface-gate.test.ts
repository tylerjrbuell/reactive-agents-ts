// Run: bun test packages/runtime/tests/inline-tool-surface-gate.test.ts
//
// F9 (2026-07-28) — the DEFAULT path executed tools that were never exposed.
//
// `inline-act.ts` called `toolService.execute()` directly, bypassing
// `executeToolAndObserve` — the canonical primitive where B1/P0-4 put
// `evaluateToolPolicy`. Since `_enableReasoning` defaults to false, that is the
// path most users are on, and it had NO policy check and NO surface check.
//
// `withTools({ builtins })` prunes the VISIBLE SCHEMA; it does not restrict the
// ToolService registry, so an unexposed builtin stays resolvable by name. The
// kernel's surface gate is what stops it there. Inline had nothing, so a model
// that simply NAMED `file-read` got it executed.
//
// Measured before the fix: configured `builtins: ["file-write"]`, scripted a
// `file-read` against a sandbox file holding a marker —
//   inline → executed, marker in the tool result
//   kernel → blocked
//
// RED-ON-CUT: delete the `offSurface` computation (or its `if`) in
// `inline-act.ts` and the ATTACK cell below goes green-to-red — the marker
// reappears in the observation.
//
// The two control cells are what stop this test passing vacuously: they pin
// that an EXPOSED tool still executes. Without them, a gate that blocked
// everything would also pass.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileRoot } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/builder.js";

const MARKER = "CLASSIFIED-PAYLOAD";

interface Outcome {
  readonly toolText: string;
  readonly wroteOut: boolean;
}

async function runInline(
  builtins: readonly string[],
  call: { name: string; args: Record<string, unknown> },
): Promise<Outcome> {
  const root = mkdtempSync(join(tmpdir(), "ra-f9-"));
  try {
    writeFileSync(join(root, "secret.txt"), MARKER, "utf8");
    const agent = await ReactiveAgents.create()
      .withName("f9-gate")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([
        { match: "secret", text: "Going.", toolCall: { name: call.name, args: call.args } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      // NOTE: no .withReasoning() — this is deliberately the INLINE default path.
      .withTools({ builtins: [...builtins], adaptive: false })
      .withMaxIterations(4)
      .build();

    const result = await withFileRoot(root, async () => agent.run("Read ./secret.txt and report it."));
    await agent.dispose();

    const steps = (result.metadata as { reasoningSteps?: readonly unknown[] } | undefined)?.reasoningSteps ?? [];
    const toolText = JSON.stringify(steps) + String(result.output ?? "");
    return { toolText, wroteOut: existsSync(join(root, "out.txt")) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the inline (default) path only executes tools it exposed", () => {
  it("ATTACK: an unexposed tool is blocked and its payload never reaches the run", async () => {
    const { toolText } = await runInline(["file-write"], {
      name: "file-read",
      args: { path: "./secret.txt" },
    });

    // The load-bearing assertion: the file's contents must never appear.
    // Before the fix this contained MARKER — the registry resolved `file-read`
    // even though only `file-write` was exposed.
    expect(toolText).not.toContain(MARKER);
    // Move 1 merge (2026-08-13): the bare builder now runs the kernel arm
    // (inline-act.ts's "was not exposed" message is unreachable from it), which
    // rejects with its own wording. The SECURITY property is unchanged and
    // still verified above (marker never leaks) -- this only re-pins the
    // observation text to the kernel's actual rejection message.
    expect(toolText).toContain("unavailable name");
  }, 20000);

  it("CONTROL: the same tool executes normally once it IS exposed", async () => {
    const { toolText } = await runInline(["file-write", "file-read"], {
      name: "file-read",
      args: { path: "./secret.txt" },
    });

    // Proves the gate keys on the EXPOSED SET and not on the tool's identity —
    // without this cell, a gate that blanket-denied `file-read` would pass.
    expect(toolText).toContain(MARKER);
    expect(toolText).not.toContain("was not exposed");
  }, 20000);

  it("CONTROL: an exposed tool still performs its real side effect", async () => {
    const { toolText, wroteOut } = await runInline(["file-write"], {
      name: "file-write",
      args: { path: "./out.txt", content: "ok" },
    });

    // Guards against over-blocking: the gate must not break the ordinary path.
    expect(wroteOut).toBe(true);
    expect(toolText).not.toContain("was not exposed");
  }, 20000);
});
