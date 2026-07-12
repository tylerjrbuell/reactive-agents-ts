// P8 — streaming consumer (runStream / RunHandle): the UI-facing surface.
// Collect every event, then cross-check the completed event against the
// stream's own evidence.
import { ReactiveAgents } from "reactive-agents";
import { check, saveReport, QA_DIR, type CheckResult } from "./probe-harness.ts";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const OUT = join(QA_DIR, "p8-haiku.md");
rmSync(OUT, { force: true });
const started = Date.now();
const counts = new Map<string, number>();
let completed: Record<string, unknown> | null = null;
let crashed: string | undefined;
/** Tool lifecycle observed on the PUBLIC stream (not read off the receipt). */
const toolStarts: { toolName: string; callId: string }[] = [];
const toolDone: { toolName: string; callId: string }[] = [];

try {
  const agent = await ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: "gemma4", numCtx: 32768 })
    .withTools()
    .build();
  try {
    // density:"full" is what a UI consumer asks for. It is also the ONLY way to
    // see tool activity — and until 2026-07-12 it showed none, because the tool
    // events had no writer on the stream at all.
    const handle = agent.runStream(
      "Write a haiku about rivers to the file ./qa-out/p8-haiku.md, then confirm what you wrote.",
      { density: "full" },
    );
    for await (const ev of handle) {
      const tag = (ev as { _tag?: string; type?: string })._tag ?? (ev as { type?: string }).type ?? "unknown";
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      if (tag === "StreamCompleted") completed = ev as Record<string, unknown>;
      const e = ev as { toolName?: string; callId?: string };
      if (tag === "ToolCallStarted") toolStarts.push({ toolName: String(e.toolName), callId: String(e.callId) });
      if (tag === "ToolCallCompleted") toolDone.push({ toolName: String(e.toolName), callId: String(e.callId) });
    }
  } finally {
    await agent.dispose();
  }
} catch (e) {
  crashed = e instanceof Error ? `${e.message}` : String(e);
}

const output = (completed?.output ?? completed?.finalOutput ?? "") as string;
const receipt = completed?.receipt as { verdict?: string; toolsUsed?: string[] } | undefined;
const receiptTools = receipt?.toolsUsed ?? [];
const streamedTools = [...new Set(toolDone.map((t) => t.toolName))].sort();
const checks: CheckResult[] = [
  check("stream-emitted-events", [...counts.values()].reduce((a, b) => a + b, 0) > 1, JSON.stringify([...counts.entries()])),
  check("completed-event-present", completed !== null),
  check("completed-has-output", typeof output === "string" && output.trim().length > 0, `outputLen=${typeof output === "string" ? output.trim().length : "n/a"}`),
  check("completed-has-receipt", receipt !== undefined && typeof receipt.verdict === "string", `verdict=${receipt?.verdict}`),
  check("file-deliverable-on-disk", existsSync(OUT), OUT),
  // The gap this probe exposed: the receipt read the EventBus, the stream
  // didn't. A run could go tool-grounded while a stream consumer saw no tools.
  check("stream-emits-tool-events", toolStarts.length > 0 && toolDone.length > 0, `started=${toolStarts.length} completed=${toolDone.length}`),
  check(
    "stream-tool-events-pair",
    toolDone.length > 0 && toolDone.every((d) => toolStarts.some((s) => s.callId === d.callId)),
    `startIds=${JSON.stringify(toolStarts.map((t) => t.callId))} doneIds=${JSON.stringify(toolDone.map((t) => t.callId))}`,
  ),
  check(
    "stream-tools-agree-with-receipt",
    receiptTools.length > 0 && streamedTools.every((t) => receiptTools.includes(t)) && receiptTools.every((t) => streamedTools.includes(t)),
    `stream=${JSON.stringify(streamedTools)} receipt=${JSON.stringify([...receiptTools].sort())}`,
  ),
  ...(crashed ? [check("no-crash", false, crashed.slice(0, 200))] : []),
];
saveReport({
  probe: "p8-streaming",
  durationMs: Date.now() - started,
  ...(crashed ? { crashed } : {}),
  checks,
  failCount: checks.filter((c) => !c.pass).length,
  outputPreview: typeof output === "string" ? output.slice(0, 300) : "",
});
