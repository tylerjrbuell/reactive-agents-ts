// Run: bun test packages/reasoning/tests/kernel/reason/parser-hint-binding.test.ts --timeout 15000
//
// Plan 9 live H3 finding: 6/20 cogito runs ended at the unresolved-tool-call
// guard because the kernel handed the text parser hints with only
// `paramNames`. A lone positional (`fileRead("/abs", "utf-8")`, bash-fence
// `file-read /abs`) binds only to a tool's single REQUIRED param, and
// file-read declares two params (path, encoding) — without `requiredParams`
// the positional could not bind to `path`. An embedded call (assignment)
// additionally needs `riskLevel: "low"` to execute. These pins drive the real
// kernel boundary (`resolveAssistantTurn`) with the real resolver.
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { NativeFCStrategy } from "@reactive-agents/tools";
import { resolveAssistantTurn, toolHintOf } from "../../../src/kernel/capabilities/reason/assistant-turn.js";
import type { ToolSchema } from "../../../src/kernel/capabilities/attend/tool-formatting.js";

const FILE_READ: ToolSchema = {
  name: "file-read",
  description: "Read a file",
  riskLevel: "low",
  parameters: [
    { name: "path", type: "string", description: "path", required: true },
    { name: "encoding", type: "string", description: "encoding", required: false },
  ],
};

const resolve = (thought: string) =>
  Effect.runPromise(
    resolveAssistantTurn({
      resolver: new NativeFCStrategy(),
      nativeCalls: [],
      content: thought,
      stopReason: "end_turn",
      surface: [FILE_READ],
      thought,
    }),
  );

const callsOf = async (thought: string) => {
  const turn = await resolve(thought);
  const result = turn.resolution?.result;
  return result?._tag === "tool_calls" ? result.calls.map((c) => ({ name: c.name, args: c.arguments })) : [];
};

describe("kernel parser hints — requiredParams + riskLevel", () => {
  test("toolHintOf forwards required params and risk level", () => {
    expect(toolHintOf(FILE_READ)).toEqual({
      name: "file-read",
      paramNames: ["path", "encoding"],
      requiredParams: ["path"],
      riskLevel: "low",
    });
  });

  test("no required params and no risk level => the old hint shape (parser fallback preserved)", () => {
    const hint = toolHintOf({
      name: "ping",
      description: "p",
      parameters: [{ name: "host", type: "string" }],
    });
    expect(hint).toEqual({ name: "ping", paramNames: ["host"] });
  });

  // The two-positional variant (`fileRead("/abs/a.txt", "utf-8")`) is refused
  // by packages/tools `parseCallArgs` ("more than one positional argument")
  // regardless of hints — a tools-side parser gap, tracked separately.
  test("`const x = fileRead(\"/abs/a.txt\")` (embedded, low risk) resolves to file-read {path}", async () => {
    const calls = await callsOf('I will read it:\n\n```js\nconst x = fileRead("/abs/a.txt")\n```');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("file-read");
    expect((calls[0]?.args as Record<string, unknown>).path).toBe("/abs/a.txt");
  });

  test("bash fence `file-read /abs/a.txt` resolves to file-read {path}", async () => {
    const calls = await callsOf("Reading the file:\n\n```bash\nfile-read /abs/a.txt\n```");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("file-read");
    expect((calls[0]?.args as Record<string, unknown>).path).toBe("/abs/a.txt");
  });
});
