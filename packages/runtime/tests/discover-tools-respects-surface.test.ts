// Run: bun test packages/runtime/tests/discover-tools-respects-surface.test.ts
//
// F9/F3 (2026-07-28) — `discover-tools` listed the FULL registry, not the
// configured surface, so it handed the model tools the caller never exposed.
//
// Built-ins are registered in ToolService unconditionally (so discovery can
// surface them) and filtered out of the LLM schema unless opted in via
// `withTools({ builtins: [...] })`. But the kernel wires discover-tools with
// `catalog = input.allToolSchemas`, and the engine builds that as
// `[...initialToolSchemas]` — a snapshot taken BEFORE the builtins opt-in
// filter runs (execution-engine.ts:757). So a run configured with exactly one
// builtin could discover, and then call, all ten.
//
// That is a least-privilege break, not a cost issue: vision pillar #1 is
// Control, and `builtins: ["file-write"]` reading as "also file-read,
// code-execute, git-cli…" is a sandboxing surprise. It is also why F9's arm
// study was void — varying `.withReasoning()` silently varied the tool surface.
//
// RED-ON-CUT: restore `catalog: input.allToolSchemas ?? []` in
// tool-capabilities.ts (instead of the exposure-filtered catalog) and the
// ATTACK cell goes green-to-red — the marker reappears.
//
// The two control cells are what stop this passing vacuously. Discovery must
// still WORK: a tool that was legitimately registered but pruned from the
// visible surface has to remain discoverable, or this "fix" would just delete
// the escape hatch that lazy disclosure depends on.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileRoot, tool } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/builder.js";

const MARKER = "CLASSIFIED-PAYLOAD";

interface Outcome {
  readonly text: string;
  readonly discovery: string;
}

/**
 * Drives a kernel run that calls `discover-tools` and then attempts `call`.
 * Returns the whole step record plus the discovery listing specifically.
 */
async function run(
  builtins: readonly string[],
  call: { name: string; args: Record<string, unknown> },
  extraTools: readonly ReturnType<typeof tool>[] = [],
): Promise<Outcome> {
  const root = mkdtempSync(join(tmpdir(), "ra-f9b-"));
  try {
    writeFileSync(join(root, "secret.txt"), MARKER, "utf8");
    const agent = await ReactiveAgents.create()
      .withName("f9b-discovery")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([
        { text: "Looking for a tool.", toolCall: { name: "discover-tools", args: {} } },
        { text: "Using it.", toolCall: { name: call.name, args: call.args } },
        { text: "FINAL ANSWER: done." },
      ] as never)
      .withTools({ builtins: [...builtins], tools: [...extraTools], adaptive: false } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(5)
      .build();

    const result = await withFileRoot(root, async () =>
      agent.run("Read ./secret.txt and report it."),
    );
    await agent.dispose();

    const steps = (result.metadata as { reasoningSteps?: readonly unknown[] } | undefined)
      ?.reasoningSteps ?? [];
    const text = JSON.stringify(steps) + String(result.output ?? "");
    // The discovery listing is the OBSERVATION of the discover-tools call. The
    // tool name lives in step.metadata, not on the step, so match the listing's
    // own header rather than a field that is not there.
    const discovery = (steps as readonly { type?: string; content?: string }[])
      .filter((s) => s.type === "observation" && (s.content ?? "").includes("tools available"))
      .map((s) => s.content ?? "")
      .join("\n");
    return { text, discovery };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("discover-tools cannot exceed the configured tool surface", () => {
  it("ATTACK: a builtin that was never opted in is neither listed nor callable", async () => {
    const { text, discovery } = await run(["file-write"], {
      name: "file-read",
      args: { path: "./secret.txt" },
    });

    // Listing it at all is the leak — it advertises capability the caller
    // withheld, and the model will act on the advertisement.
    expect(discovery).not.toContain("file-read");

    // The load-bearing assertion: the withheld tool's payload must never land.
    expect(text).not.toContain(MARKER);
  }, 20000);

  it("CONTROL: an opted-in builtin is still discoverable and callable", async () => {
    const { text, discovery } = await run(["file-write", "file-read"], {
      name: "file-read",
      args: { path: "./secret.txt" },
    });

    // Proves the filter keys on the CONFIGURED SET, not on the tool's identity.
    expect(discovery).toContain("file-read");
    expect(text).toContain(MARKER);
  }, 20000);

  it("CONTROL: a registered custom tool stays discoverable when pruned from view", async () => {
    const probe = tool("sql-query", "Run a read-only SQL query against the warehouse", {
      params: { input: { type: "string", required: true, description: "query" } },
      handler: () => "answer=42",
    });
    const { discovery } = await run(
      ["file-write"],
      { name: "sql-query", args: { input: "SELECT 1" } },
      [probe],
    );

    // This is the escape hatch lazy disclosure depends on. If the fix were
    // "filter discovery down to the visible set", this cell goes red — and
    // discover-tools would be pointless, since the visible set is exactly what
    // the model can already see.
    expect(discovery).toContain("sql-query");
  }, 20000);
});
