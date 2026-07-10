// Run: bun test packages/trace/tests/wire-visibility-retention.test.ts
//
// The 2026-07-10 wire audit needed a hand-rolled logging proxy to see three
// defects (empty assistant prose, 67% meta-tool schema share, a hidden
// extraction call) — even though `llm-exchange` events had RECORDED all the
// evidence. The observability system captured; no report asked. And the trace
// dir itself had grown to 113,824 files / 670 MB because nothing ever deleted
// anything: an observability store nobody can list is not observable.
//
// Two closures pinned here: analyzeWire (the questions get asked on every
// run) and pruneTraceDir-at-init (the store stays listable).

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { analyzeWire } from "../src/analyze.js";
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder.js";
import type { LLMExchangeEvent } from "../src/events.js";

const exchange = (over: Partial<LLMExchangeEvent>): LLMExchangeEvent =>
  ({
    kind: "llm-exchange",
    runId: "r1",
    timestamp: 0,
    iter: 0,
    seq: 0,
    provider: "test",
    model: "test",
    requestKind: "complete",
    systemPrompt: "sys",
    messages: [],
    toolSchemaNames: [],
    response: { content: "" },
    ...over,
  }) as LLMExchangeEvent;

describe("analyzeWire — the questions the proxy had to answer by hand", () => {
  it("flags a run whose assistant turns carry no prose (thought continuity OFF)", () => {
    const w = analyzeWire([
      exchange({
        messages: [
          { role: "user", content: "goal" },
          { role: "assistant", content: "[tool_use:file-read]" },
          { role: "tool", content: "{}" },
          { role: "assistant", content: "[tool_use:file-read][tool_use:file-write]" },
        ],
      }),
    ])!;
    expect(w.assistantTurns).toBe(2);
    expect(w.assistantProseChars).toBe(0);
    expect(w.flags.some((f) => f.includes("never re-reads"))).toBe(true);
  });

  it("counts real prose and does NOT flag when the model sees its reasoning", () => {
    const w = analyzeWire([
      exchange({
        messages: [
          { role: "assistant", content: "I found the rate in config.json.[tool_use:file-write]" },
          { role: "assistant", content: "Summing completed orders next." },
        ],
      }),
    ])!;
    expect(w.assistantProseChars).toBeGreaterThan(40);
    expect(w.flags.some((f) => f.includes("never re-reads"))).toBe(false);
  });

  it("flags a heavy schema tax (the 67% meta-tool surface)", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const w = analyzeWire([
      exchange({ toolSchemaNames: names }),
      exchange({ toolSchemaNames: names }),
    ])!;
    expect(w.avgToolSchemasPerRequest).toBe(9);
    expect(w.flags.some((f) => f.includes("schema tax"))).toBe(true);
  });

  it("no exchanges → undefined, so the report shows a blind spot, not fake zeros", () => {
    expect(analyzeWire([])).toBeUndefined();
  });
});

describe("trace retention — the store stays listable", () => {
  // Valid ULID chars only (no I, L, O, U) — run files are ULID-named and the
  // pruner keys the run-file rules on that shape.
  const ulid = (i: number) => `01ARZ3NDEKTSV4RRFFQ69G5FA${String.fromCharCode(65 + i)}.jsonl`;

  it("prunes ULID run files beyond RA_TRACE_MAX_FILES at layer init, newest kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-trace-ret-"));
    // 6 run files with distinct mtimes, oldest first.
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
      const name = ulid(i);
      names.push(name);
      const p = join(dir, name);
      writeFileSync(p, "{}\n");
      const t = new Date(Date.now() - (6 - i) * 60_000);
      utimesSync(p, t, t);
    }
    process.env.RA_TRACE_MAX_FILES = "3";
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TraceRecorderService; // forces layer init (which forks the prune)
        }).pipe(Effect.provide(TraceRecorderServiceLive({ dir }))),
      );
      // The prune is a forked daemon; give it a beat.
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      delete process.env.RA_TRACE_MAX_FILES;
    }
    const left = readdirSync(dir).sort();
    expect(left.length).toBe(3);
    expect(left).toEqual([names[3]!, names[4]!, names[5]!].sort());
  });

  it("caps EVERY catch-all by size, not just llm-direct — appended-forever files never age out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-trace-catchall-"));
    // structured-output.jsonl hit 3.5 MB in one day (2026-07-10); its mtime is
    // always fresh, so age/count pruning never fires — only the size cap can.
    writeFileSync(join(dir, "structured-output.jsonl"), "x".repeat(26 * 1024 * 1024));
    writeFileSync(join(dir, "classify-tool-relevance.jsonl"), "{}\n");
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TraceRecorderService;
      }).pipe(Effect.provide(TraceRecorderServiceLive({ dir }))),
    );
    await new Promise((r) => setTimeout(r, 300));
    const left = readdirSync(dir).sort();
    expect(left).toEqual(["classify-tool-relevance.jsonl"]);
  });

  it("an oversized llm-direct.jsonl is dropped; a small one survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-trace-direct-"));
    writeFileSync(join(dir, "llm-direct.jsonl"), "x".repeat(26 * 1024 * 1024));
    writeFileSync(join(dir, "keep.jsonl"), "{}\n");
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TraceRecorderService;
      }).pipe(Effect.provide(TraceRecorderServiceLive({ dir }))),
    );
    await new Promise((r) => setTimeout(r, 300));
    const left = readdirSync(dir).sort();
    expect(left).toEqual(["keep.jsonl"]);
  });

  it("memory-only recorder (dir null) never touches the filesystem", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const rec = yield* TraceRecorderService;
        yield* rec.emit(exchange({}));
        const snap = yield* rec.snapshot("r1");
        expect(snap.length).toBe(1);
      }).pipe(Effect.provide(TraceRecorderServiceLive({ dir: null }))),
    );
  });
});
