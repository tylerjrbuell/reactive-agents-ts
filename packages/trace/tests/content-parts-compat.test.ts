// Run: bun test packages/trace/tests/content-parts-compat.test.ts --timeout 15000
//
// Plan 9 Phase 4 stage F: `llm-exchange` messages may carry an optional
// `parts` summary ({type, media_type, bytes, sha256}, never bytes), and the
// kernel records stubbed parts as `content-part-degraded`. The law:
//   1. a trace recorded before `parts` existed still loads unchanged
//      (REQUIRED_FIELDS_BY_KIND for llm-exchange did not grow);
//   2. toTraceEvent carries `parts` through and maps ContentPartDegraded;
//   3. a JSONL file mixing old and new lines loads every event;
//   4. requestView reads message text through contentText.
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ContentPartSummary } from "@reactive-agents/core";
import { isTraceEvent } from "../src/events.js";
import type { LLMExchangeEvent } from "../src/events.js";
import { toTraceEvent } from "../src/normalize.js";
import { loadTrace } from "../src/index.js";
import { requestView } from "../src/attribution-facts.js";

const dir = mkdtempSync(join(tmpdir(), "trace-parts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SUMMARY: ContentPartSummary = { type: "image", media_type: "image/png", bytes: 204800, sha256: "ab".repeat(32) };

/** An llm-exchange line exactly as recorded before stage F (no `parts`). */
const OLD_EXCHANGE = {
  kind: "llm-exchange",
  runId: "r1",
  timestamp: 1000,
  iter: 0,
  seq: 1,
  provider: "ollama",
  model: "qwen3:4b",
  requestKind: "stream",
  systemPrompt: "sys",
  messages: [{ role: "user", content: "hi" }],
  toolSchemaNames: [],
  response: { content: "Sure" },
};

describe("stage F: llm-exchange parts summary and content-part-degraded", () => {
  it("an old-format exchange (no parts) and a new one (with parts) both pass isTraceEvent", () => {
    expect(isTraceEvent(OLD_EXCHANGE)).toBe(true);
    expect(
      isTraceEvent({ ...OLD_EXCHANGE, messages: [{ role: "user", content: "[image:image/png:abababababab]", parts: [SUMMARY] }] }),
    ).toBe(true);
  });

  it("toTraceEvent carries message parts through verbatim", () => {
    const raw: AgentEvent = {
      _tag: "LLMExchangeEmitted",
      taskId: "r1",
      timestamp: 1000,
      iteration: 0,
      provider: "ollama",
      model: "qwen3:4b",
      requestKind: "stream",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "look", parts: [SUMMARY] }, { role: "assistant", content: "ok" }],
      toolSchemaNames: [],
      response: { content: "Sure" },
    };
    const ev = toTraceEvent(raw, 4) as LLMExchangeEvent;
    expect(ev.messages[0]!.parts).toEqual([SUMMARY]);
    expect(ev.messages[1]!.parts).toBeUndefined();
    expect(isTraceEvent(ev)).toBe(true);
  });

  it("ContentPartDegraded maps to a valid content-part-degraded event; missing fields are rejected", () => {
    const raw: AgentEvent = {
      _tag: "ContentPartDegraded",
      taskId: "r1",
      iteration: 2,
      part: SUMMARY,
      role: "tool",
      reason: "tool results carry text only",
      timestamp: 2000,
    };
    const ev = toTraceEvent(raw, 9);
    expect(ev).toEqual({
      kind: "content-part-degraded",
      runId: "r1",
      timestamp: 2000,
      iter: 2,
      seq: 9,
      part: SUMMARY,
      role: "tool",
      reason: "tool results carry text only",
    });
    expect(isTraceEvent(ev)).toBe(true);
    const { reason: _r, ...noReason } = ev as Record<string, unknown>;
    expect(isTraceEvent(noReason)).toBe(false);
  });

  it("loadTrace reads a JSONL file mixing pre-stage-F and stage-F lines", async () => {
    const path = join(dir, "mixed.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify(OLD_EXCHANGE),
        JSON.stringify({ ...OLD_EXCHANGE, seq: 2, messages: [{ role: "user", content: "x", parts: [SUMMARY] }] }),
        JSON.stringify({ kind: "content-part-degraded", runId: "r1", timestamp: 1003, iter: 0, seq: 3, part: SUMMARY, role: "tool", reason: "tool results carry text only" }),
      ].join("\n"),
    );
    const t = await loadTrace(path);
    expect(t.events.map((e) => e.kind)).toEqual(["llm-exchange", "llm-exchange", "content-part-degraded"]);
  });

  it("requestView joins system prompt and message text unchanged", () => {
    const view = requestView(OLD_EXCHANGE as LLMExchangeEvent);
    expect(view.text).toBe("sys\nhi");
    expect(view.clipped).toBe(false);
  });
});
