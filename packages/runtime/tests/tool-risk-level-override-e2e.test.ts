// Run: bun test packages/runtime/tests/tool-risk-level-override-e2e.test.ts --timeout 20000
//
// `.withTools({ riskLevels })` reaches the embedded-call rule.
//
// The text tool-call parser binds a call EMBEDDED in prose/code
// (`const x = fileRead("/abs")`) only when the tool's riskLevel is "low"
// (packages/tools assistant-text-parser.ts, D7c). Built-in `file-read` ships at
// "medium", so by default the embedded call is refused. A user override to
// "low" must flow from the builder through the runtime's ToolService view into
// the kernel ToolSchema, so the same turn resolves to a file-read call.
//
// What this pins: the kernel's assistant-turn annotation (the parser verdict)
// for a real built agent. It does NOT pin execution: the kernel's end_turn
// fast-path (reasoning dispatch-think-response.ts) completes the run on this
// reply before dispatching the resolved call — a reasoning-side gap reported
// with this change.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { ReactiveAgentBuilder } from "../src/index.js";

const FILE = "/abs/probe.txt";

type Turn = { readonly disposition: string; readonly callIds: readonly string[] };
type Step = {
  readonly type: string;
  readonly metadata?: { readonly assistantTurn?: Turn };
};

const firstTurn = async (
  configure: (b: ReactiveAgentBuilder) => ReactiveAgentBuilder,
): Promise<Turn | undefined> => {
  const agent = await configure(ReactiveAgents.create().withReasoning())
    .withTestScenario([
      { text: `I will read it:\n\n\`\`\`js\nconst x = fileRead(${JSON.stringify(FILE)})\n\`\`\`` },
      { text: "Done." },
    ])
    .withMaxIterations(2)
    .build();
  try {
    const r = await agent.run(`Read ${FILE} and report its contents.`);
    const steps = (r.metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? [];
    return steps.find((s) => s.type === "thought")?.metadata?.assistantTurn;
  } finally {
    await agent.dispose();
  }
};

describe(".withTools({ riskLevels }) — embedded-call rule", () => {
  it("refuses an embedded file-read by default (built-in level is medium)", async () => {
    const turn = await firstTurn((b) => b.withTools({ builtins: ["file-read"] }));
    expect(turn?.disposition).toBe("unresolved");
    expect(turn?.callIds).toEqual([]);
  }, 20000);

  it("binds the embedded file-read when the user lowers its riskLevel", async () => {
    const turn = await firstTurn((b) =>
      b.withTools({ builtins: ["file-read"], riskLevels: { "file-read": "low" } }),
    );
    expect(turn?.callIds).toEqual(["pseudo_file-read_0"]);
    expect(turn?.disposition).not.toBe("unresolved");
  }, 20000);

  it("riskLevels maps merge across .withTools() calls", async () => {
    const turn = await firstTurn((b) =>
      b
        .withTools({ builtins: ["file-read"], riskLevels: { "file-read": "low" } })
        .withTools({ riskLevels: { "web-search": "high" } }),
    );
    expect(turn?.callIds).toEqual(["pseudo_file-read_0"]);
  }, 20000);
});
