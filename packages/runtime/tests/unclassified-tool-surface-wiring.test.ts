// Run: bun test packages/runtime/tests/unclassified-tool-surface-wiring.test.ts
//
// F6 wiring pin (2026-07-28). `tool-surface-heuristic.test.ts` pins the
// RESOLVER; this pins that the runtime actually feeds it. The two defects it
// covers both live at the runtime seam, not in the resolver:
//
//   1. `reasoning-think.ts` must pass `builtinFloorTools` SEPARATELY. It used to
//      union the `withTools({ builtins })` floor into `relevantTools`, which made
//      the kernel's `hasClassification` ("did a classifier speak?") true on a run
//      where none had — silently disabling the unclassified-run heuristic.
//   2. `think.ts` must pass `taskText`, or the heuristic has nothing to match.
//
// Cutting either one leaves the resolver unit tests fully green, which is
// exactly why this file exists: a mechanism is not wired until cutting the
// wiring fails a test.
//
// RED-ON-CUT (both verified):
//   - reasoning-think.ts: restore `relevantTools: [...classified, ...builtins]`
//     → hasClassification goes true → sql-query hidden → this fails.
//   - think.ts: drop `taskText: input.task` → heuristic gets nothing → fails.
//
// Deliberately uses the `test` provider: the point is the SURFACE the kernel
// computes before any model call, so no live model is needed and the cell is
// deterministic. Note the scenario needs NO leading classifier `json` turn —
// classification is opt-in as of 2026-07-28, so nothing consumes one.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { tool } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/builder.js";

const NOISE = [
  ["slack-post", "Post a message to a Slack channel"],
  ["geocode", "Convert a street address into latitude and longitude"],
  ["pager-alert", "Raise a PagerDuty alert for a service"],
] as const;

/** Visible tool names on the FIRST resolved surface of the run. */
async function firstVisibleSurface(): Promise<readonly string[]> {
  const dir = mkdtempSync(join(tmpdir(), "ra-f6-wire-"));
  try {
    const tools = [
      tool("sql-query", "Run a read-only SQL query against the analytics warehouse", {
        params: { input: { type: "string", required: true, description: "query" } },
        handler: () => "answer=42",
      }),
      ...NOISE.map(([n, d]) =>
        tool(n, d, {
          params: { input: { type: "string", required: true, description: "in" } },
          handler: () => "ok",
        }),
      ),
    ];
    const agent = await ReactiveAgents.create()
      .withName("f6-wiring")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "FINAL ANSWER: 42." }] as never)
      // `builtins` as an ARRAY is the consumer-intent floor — the exact shape
      // that used to be laundered through `relevantTools`.
      .withTools({ builtins: ["file-write"], tools } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .withTracing({ dir })
      .build();

    await agent.run(
      "Use the sql-query tool to run `SELECT answer FROM t` and tell me the value.",
    );
    await agent.dispose();

    for (const f of readdirSync(dir)) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { kind?: string; visible?: readonly string[] };
          if (e.kind === "tool-surface-resolved" && Array.isArray(e.visible)) return e.visible;
        } catch {
          /* skip malformed line */
        }
      }
    }
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the runtime feeds the kernel enough to resolve an unclassified surface", () => {
  it("a task-named custom tool is visible on the first surface, with no classifier", async () => {
    const visible = await firstVisibleSurface();

    // Guards against the whole assertion set passing on an empty trace.
    expect(visible.length).toBeGreaterThan(0);

    // The load-bearing one. Before the fix this was hidden — the run reached
    // sql-query only by spending an iteration on discover-tools.
    expect(visible).toContain("sql-query");

    // The floor survived the split (rw-9/rw-7, 2026-07-07).
    expect(visible).toContain("file-write");

    // And the surface is still a surface — a fix that simply stopped pruning
    // would satisfy everything above.
    expect(visible).not.toContain("geocode");
  }, 20000);
});

// Effect is imported for parity with the tool() handler typing used across the
// runtime tests; referenced here so the import is not stripped as unused.
void Effect;
