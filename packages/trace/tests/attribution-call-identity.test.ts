import { describe, it, expect } from "bun:test";
import type { Trace, TraceEvent } from "../src/index.js";
import { canonTool, gatherFacts, nativeCalls, argPath } from "../src/attribution-facts.js";
import { mk } from "./fixtures/mk-event.js";

// Call identity: a native call and the tool event that ran it are the same call
// when the tool name differs only by alias (`file_write` vs `file-write`) or the
// model path is a directory root (`.`) the tool resolved to the absolute task dir.
// Found by the 2026-11-13 local-model campaign (P2b): 4 false
// harness:tool-call-dropped verdicts on gemma4:12b. Synthetic traces only.

let seq = 0;
const at = () => ({ runId: "synth-identity", iter: 0, seq: seq++, timestamp: 1000 + seq });
const exchange = (toolCalls: { name: string; arguments: Record<string, unknown> }[]): TraceEvent =>
  mk({
    ...at(), kind: "llm-exchange", provider: "ollama", model: "m", requestKind: "stream", purpose: "think",
    systemPrompt: "s", messages: [{ role: "user", content: "go" }], toolSchemaNames: ["file-read", "file-write"],
    response: { content: "", stopReason: "tool_use", toolCalls },
  });
const toolRun = (toolName: string, args: Record<string, unknown>): TraceEvent[] => [
  mk({ ...at(), kind: "tool-call-start", toolName, args }),
  mk({ ...at(), kind: "tool-call-end", toolName, args, ok: true, result: "ok" }),
];
const fates = (events: TraceEvent[]) => nativeCalls(gatherFacts({ runId: "synth-identity", events } as Trace)).map((c) => c.fate);

describe("call identity in nativeCalls", () => {
  it("a model path of '.' matches the run the tool resolved to the absolute task dir", () => {
    const events = [exchange([{ name: "file-read", arguments: { path: "." } }]), ...toolRun("file-read", { path: "/w/.bench-run-1" })];
    expect(fates(events)).toEqual(["ran"]);
  });

  it("an aliased tool name (file_write) matches the registered file-write run", () => {
    const events = [exchange([{ name: "file_write", arguments: { path: "out.ts", content: "x" } }]), ...toolRun("file-write", { path: "/w/out.ts", content: "x" })];
    expect(fates(events)).toEqual(["ran"]);
  });

  it("a call with nothing following is still dropped", () => {
    expect(fates([exchange([{ name: "file_write", arguments: { path: "out.ts" } }])])).toEqual(["dropped"]);
  });

  it("canonTool and argPath normalize identity", () => {
    expect(canonTool("File_Write")).toBe("file-write");
    expect(argPath({ path: "." })).toBeUndefined();
    expect(argPath({ path: "./" })).toBeUndefined();
    expect(argPath({ path: "./a.txt" })).toBe("./a.txt");
  });
});
