// Run: bun test packages/runtime/tests/tool-risk-level-override-e2e.test.ts --timeout 20000
//
// `.withTools({ riskLevels })` reaches the embedded-call rule.
//
// The text tool-call parser binds a call EMBEDDED in prose/code
// (`const x = fileRead("/abs")`) only when the tool's riskLevel is "low"
// (packages/tools assistant-text-parser.ts, D7c). Built-in `file-read` ships at
// "medium", so by default the embedded call is refused. A user override to
// "low" must flow from the builder through the runtime's ToolService view into
// the kernel ToolSchema, so the same turn resolves to a file-read call AND that
// call executes: the file's marker reaches the run's observations.
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileRoot } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/index.js";
import type { ReactiveAgentBuilder } from "../src/index.js";

const MARKER = "RISK-OVERRIDE-PROBE-7f3a";
const root = mkdtempSync(join(tmpdir(), "ra-risk-override-"));
const FILE = join(root, "probe.txt");
writeFileSync(FILE, MARKER, "utf8");
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Turn = { readonly disposition: string; readonly callIds: readonly string[] };
type Step = {
  readonly type: string;
  readonly content?: string;
  readonly metadata?: { readonly assistantTurn?: Turn };
};

interface Outcome {
  readonly turn: Turn | undefined;
  /** Every observation step's content, joined: where a tool result lands. */
  readonly observations: string;
  readonly output: string;
  readonly success: boolean;
}

const runOnce = async (
  configure: (b: ReactiveAgentBuilder) => ReactiveAgentBuilder,
): Promise<Outcome> => {
  const agent = await configure(ReactiveAgents.create().withReasoning())
    .withTestScenario([
      { text: `I will read it:\n\n\`\`\`js\nconst x = fileRead(${JSON.stringify(FILE)})\n\`\`\`` },
      { text: "Done." },
    ])
    .withMaxIterations(2)
    .build();
  try {
    const r = await withFileRoot(root, () => agent.run(`Read ${FILE} and report its contents.`));
    const steps = (r.metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? [];
    return {
      turn: steps.find((s) => s.type === "thought")?.metadata?.assistantTurn,
      observations: steps
        .filter((s) => s.type === "observation")
        .map((s) => s.content ?? "")
        .join("\n"),
      output: String(r.output ?? ""),
      success: r.success,
    };
  } finally {
    await agent.dispose();
  }
};

describe(".withTools({ riskLevels }) — embedded-call rule", () => {
  it("refuses an embedded file-read by default (built-in level is medium)", async () => {
    const o = await runOnce((b) => b.withTools({ builtins: ["file-read"] }));
    expect(o.turn?.disposition).toBe("unresolved");
    expect(o.turn?.callIds).toEqual([]);
    // Refused means NOT executed: the file's marker never reaches the run.
    expect(o.observations).not.toContain(MARKER);
    expect(o.output).not.toContain(MARKER);
    // And the raw pseudo-call text is not delivered as a successful answer.
    expect(o.success && o.output.includes("fileRead(")).toBe(false);
  }, 20000);

  it("binds AND executes the embedded file-read when the user lowers its riskLevel", async () => {
    const o = await runOnce((b) =>
      b.withTools({ builtins: ["file-read"], riskLevels: { "file-read": "low" } }),
    );
    expect(o.turn?.callIds).toEqual(["pseudo_file-read_0"]);
    expect(o.turn?.disposition).not.toBe("unresolved");
    // Execution: the file-read handler ran and its result reached the run.
    expect(o.observations).toContain(MARKER);
  }, 20000);

  it("riskLevels maps merge across .withTools() calls", async () => {
    const o = await runOnce((b) =>
      b
        .withTools({ builtins: ["file-read"], riskLevels: { "file-read": "low" } })
        .withTools({ riskLevels: { "web-search": "high" } }),
    );
    expect(o.turn?.callIds).toEqual(["pseudo_file-read_0"]);
    expect(o.observations).toContain(MARKER);
  }, 20000);
});
