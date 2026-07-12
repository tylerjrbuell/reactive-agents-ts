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

try {
  const agent = await ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: "gemma4", numCtx: 32768 })
    .withTools()
    .build();
  try {
    const handle = agent.runStream(
      "Write a haiku about rivers to the file ./qa-out/p8-haiku.md, then confirm what you wrote.",
    );
    for await (const ev of handle) {
      const tag = (ev as { _tag?: string; type?: string })._tag ?? (ev as { type?: string }).type ?? "unknown";
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      if (tag === "StreamCompleted") completed = ev as Record<string, unknown>;
    }
  } finally {
    await agent.dispose();
  }
} catch (e) {
  crashed = e instanceof Error ? `${e.message}` : String(e);
}

const output = (completed?.output ?? completed?.finalOutput ?? "") as string;
const receipt = completed?.receipt as { verdict?: string } | undefined;
const checks: CheckResult[] = [
  check("stream-emitted-events", [...counts.values()].reduce((a, b) => a + b, 0) > 1, JSON.stringify([...counts.entries()])),
  check("completed-event-present", completed !== null),
  check("completed-has-output", typeof output === "string" && output.trim().length > 0, `outputLen=${typeof output === "string" ? output.trim().length : "n/a"}`),
  check("completed-has-receipt", receipt !== undefined && typeof receipt.verdict === "string", `verdict=${receipt?.verdict}`),
  check("file-deliverable-on-disk", existsSync(OUT), OUT),
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
