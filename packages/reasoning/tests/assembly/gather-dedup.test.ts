import { describe, it, expect } from "bun:test";
import {
  normalizeArgsHash,
  isGatheringTool,
  buildGatherIndex,
  detectDuplicateGathers,
  dedupSignalEntries,
  buildDedupNudge,
} from "../../src/assembly/gather-dedup.js";
import { appendEntries, type RunLedger, type LedgerEntryInput } from "../../src/kernel/ledger/run-ledger.js";

const led = (entries: LedgerEntryInput[]): RunLedger => appendEntries(undefined, entries);

/** A prior successful gather: invocation + result sharing a toolCallId. */
function priorGather(
  toolName: string,
  args: Record<string, unknown>,
  callId: string,
  storedKey?: string,
): LedgerEntryInput[] {
  return [
    { kind: "tool-invocation", iteration: 1, toolName, args, toolCallId: callId },
    {
      kind: "tool-result",
      iteration: 1,
      toolName,
      toolCallId: callId,
      success: true,
      preview: "...",
      ...(storedKey ? { storedKey } : {}),
    },
  ];
}

describe("gather-dedup - argument normalization", () => {
  it("hashes independent of key order", () => {
    expect(normalizeArgsHash({ a: 1, b: 2 })).toBe(normalizeArgsHash({ b: 2, a: 1 }));
  });
  it("distinguishes different args", () => {
    expect(normalizeArgsHash({ q: "cats" })).not.toBe(normalizeArgsHash({ q: "dogs" }));
  });
  it("handles nested objects deterministically", () => {
    expect(normalizeArgsHash({ x: { a: 1, b: 2 } })).toBe(normalizeArgsHash({ x: { b: 2, a: 1 } }));
  });
});

describe("gather-dedup - gathering-tool classification", () => {
  it("read-only tools are gathering", () => {
    for (const t of ["web-search", "http-client", "fetch", "browse", "file-read", "list_commits"])
      expect(isGatheringTool(t)).toBe(true);
  });
  it("side-effecting tools are NOT gathering", () => {
    for (const t of ["write-result-to-file", "send_email", "code-execute", "http-post", "create_pr"])
      expect(isGatheringTool(t)).toBe(false);
  });
});

describe("gather-dedup - duplicate detection over the ledger (audit 03-F6)", () => {
  it("flags a repeated (tool, args) gather and carries the prior ref", () => {
    const ledger = led(priorGather("web-search", { q: "cats" }, "c1", "_tool_result_1"));
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { q: "cats" }, toolCallId: "c2" },
    ]);
    expect(dups.length).toBe(1);
    expect(dups[0]!.toolName).toBe("web-search");
    expect(dups[0]!.priorRef).toBe("_tool_result_1");
  });

  it("is order-invariant on args", () => {
    const ledger = led(priorGather("web-search", { a: 1, b: 2 }, "c1", "_tool_result_1"));
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { b: 2, a: 1 }, toolCallId: "c2" },
    ]);
    expect(dups.length).toBe(1);
  });

  it("does NOT flag a distinct call (different args)", () => {
    const ledger = led(priorGather("web-search", { q: "cats" }, "c1", "_tool_result_1"));
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { q: "dogs" }, toolCallId: "c2" },
    ]);
    expect(dups.length).toBe(0);
  });

  it("does NOT flag a side-effecting tool even when repeated", () => {
    const ledger = led(priorGather("write-result-to-file", { path: "out.md" }, "c1"));
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "write-result-to-file", args: { path: "out.md" }, toolCallId: "c2" },
    ]);
    expect(dups.length).toBe(0);
  });

  it("does NOT flag against a FAILED prior gather", () => {
    const ledger = led([
      { kind: "tool-invocation", iteration: 1, toolName: "web-search", args: { q: "x" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "web-search", toolCallId: "c1", success: false, preview: "err" },
    ]);
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { q: "x" }, toolCallId: "c2" },
    ]);
    expect(dups.length).toBe(0);
  });

  it("reports each duplicate key once even if repeated twice this round", () => {
    const ledger = led(priorGather("web-search", { q: "x" }, "c1", "_tool_result_1"));
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { q: "x" }, toolCallId: "c2" },
      { toolName: "web-search", args: { q: "x" }, toolCallId: "c3" },
    ]);
    expect(dups.length).toBe(1);
  });

  it("index keeps the FIRST occurrence's ref", () => {
    const ledger = led([
      ...priorGather("web-search", { q: "x" }, "c1", "_tool_result_1"),
      ...priorGather("web-search", { q: "x" }, "c2", "_tool_result_5"),
    ]);
    expect(buildGatherIndex(ledger).size).toBe(1);
    const dups = detectDuplicateGathers(ledger, [
      { toolName: "web-search", args: { q: "x" }, toolCallId: "c3" },
    ]);
    expect(dups[0]!.priorRef).toBe("_tool_result_1");
  });
});

describe("gather-dedup - ledger flags + advisory nudge", () => {
  it("emits a harness-signal entry per duplicate", () => {
    const dups = [{ toolName: "web-search", argsHash: "abc123", priorRef: "_tool_result_1" }];
    const entries = dedupSignalEntries(dups, 5);
    expect(entries.length).toBe(1);
    expect(entries[0]!.kind).toBe("harness-signal");
    expect((entries[0] as { signal: string }).signal).toBe("gather-dedup");
    expect((entries[0] as { detail: string }).detail).toContain("_tool_result_1");
  });

  it("nudge hands back the prior ref via the ONE recall grammar", () => {
    const nudge = buildDedupNudge([{ toolName: "web-search", argsHash: "abc", priorRef: "_tool_result_1" }]);
    expect(nudge).toContain('recall("_tool_result_1", full: true)');
  });

  it("nudge is null when nothing is flagged (byte-identical default path)", () => {
    expect(buildDedupNudge([])).toBeNull();
  });
});
