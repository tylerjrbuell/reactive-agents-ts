import { describe, expect, test } from "bun:test";
import { buildRunTrees, exportFilename, exportUrl, traceUrl } from "./chat-export.js";

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const root = "ROOT";
const base = (runId: string, extra: Record<string, unknown> = {}) => ({ runId, rootRunId: root, timestamp: 1, seq: 0, ...extra });

const jsonl = [
  line(base(root, { kind: "run-started", iter: -1, task: "t", model: "m", provider: "p", config: {}, depth: 0 })),
  line(base(root, { kind: "llm-exchange", iter: 0, provider: "p", model: "m", requestKind: "stream", systemPrompt: "s", messages: [{ role: "user", content: "hi" }], toolSchemaNames: [], response: { content: "thinking", tokensIn: 10, tokensOut: 5, costUsd: 0.01, durationMs: 40 } })),
  line(base(root, { kind: "entropy-scored", iter: 0, composite: 0.3 })),
  line(base(root, { kind: "tool-call-start", iter: 0, toolName: "web-search", args: { q: "x" } })),
  line(base(root, { kind: "tool-call-end", iter: 0, toolName: "web-search", result: "hits", durationMs: 7, ok: true })),
  line(base("KID", { kind: "run-started", iter: -1, task: "sub", model: "m", provider: "p", config: {}, parentRunId: root, depth: 1 })),
  line(base("KID", { kind: "llm-exchange", iter: 0, provider: "p", model: "m", requestKind: "stream", systemPrompt: "", messages: [], toolSchemaNames: [], response: { content: "child thought", tokensIn: 1, tokensOut: 1 } })),
  line(base("KID", { kind: "run-completed", iter: -1, status: "success", output: "child done", totalTokens: 2, totalCostUsd: 0, durationMs: 5 })),
  "not json",
  line(base(root, { kind: "run-completed", iter: -1, status: "success", output: "the answer", totalTokens: 15, totalCostUsd: 0.01, durationMs: 90 })),
].join("\n");

describe("buildRunTrees", () => {
  const trees = buildRunTrees(jsonl);

  test("returns one root with the sub-agent run nested under its parent", () => {
    expect(trees).toHaveLength(1);
    expect(trees[0]!.runId).toBe(root);
    expect(trees[0]!.children.map((c) => [c.runId, c.depth, c.name])).toEqual([["KID", 1, "sub"]]);
  });

  test("an iteration becomes a TraceFrameCard frame with tool and tokens; the output becomes a final frame", () => {
    const frames = trees[0]!.frames;
    expect(frames[0]).toMatchObject({
      iteration: 0,
      llmThought: "thinking",
      tokensUsed: 15,
      durationMs: 40,
      estimatedCost: 0.01,
      entropy: 0.3,
      toolsThisStep: ["web-search"],
      toolName: "web-search",
      observation: "hits",
      model: "m",
    });
    expect(frames.at(-1)).toMatchObject({ kind: "final", thought: "the answer" });
    expect(trees[0]!.status).toBe("done");
  });

  test("a corrupt line is skipped; empty input yields no runs", () => {
    expect(buildRunTrees("")).toEqual([]);
    expect(buildRunTrees("garbage\n")).toEqual([]);
  });

  test("a failed run reports failed", () => {
    const t = buildRunTrees(line(base(root, { kind: "run-completed", iter: -1, status: "failure", error: "boom", totalTokens: 0, totalCostUsd: 0, durationMs: 1 })));
    expect(t[0]!.status).toBe("failed");
  });
});

describe("export helpers", () => {
  test("exportFilename slugs the name and appends the extension", () => {
    expect(exportFilename("My Chat: v2?", "md")).toBe("my-chat-v2.md");
    expect(exportFilename("", "jsonl")).toBe("chat.jsonl");
  });
  test("urls encode ids", () => {
    expect(exportUrl("http://s", "a/b", "json")).toBe("http://s/api/chat/sessions/a%2Fb/export?format=json");
    expect(traceUrl("http://s", "sid", 5)).toBe("http://s/api/chat/sessions/sid/turns/5/trace");
  });
});
