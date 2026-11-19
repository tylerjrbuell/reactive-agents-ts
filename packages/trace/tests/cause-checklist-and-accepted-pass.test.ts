// Two instrument faults on Cortex reflexion runs (2026-11-19, gemini-3.5-flash):
//  1. `checklist-unresolved` (88c9957b7, outcome warn) lists advisory todo rows
//     that ended without evidence. The tool-protocol rule matched the bare word
//     "unresolved" and blamed the model's tool calling (01M7T8XTQEARASBWPNVYEEZJZ0).
//  2. A capped generate pass emits `terminal_decision status=failed`; reflexion's
//     critique then accepts the synthesized answer (ledger terminal verdict) and
//     the runtime ships the `partial` as success through its tolerance lane. The
//     failed decision is the pass's, not the run's: not a mislabel
//     (01M7T8TYQ8ZRZX1445590XMESP).
// Fixtures hold only the terminal events of the real traces; the answer text is redacted.
import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { analyzeCause, loadTrace } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

const fixture = (name: string): string => join(import.meta.dir, "fixtures", name);

describe("checklist-unresolved is advisory, not a tool-protocol failure", () => {
  it("01M7T8XT: a failed run whose only 'unresolved' guard is checklist-unresolved is not tool-protocol", async () => {
    const c = analyzeCause(await loadTrace(fixture("cortex-reflexion-checklist-unresolved.jsonl")));
    expect(c.cause).not.toBe("tool-protocol");
    expect(c.evidence.map((e) => e.detail).join("\n")).not.toContain("checklist-unresolved");
    expect(c).toMatchObject({ cause: "budget-cap", subCause: "cap-cutoff", outcomeStatus: "failure" });
  });

  it("a real unresolved tool-call terminal still reads as tool-protocol", () => {
    let seq = 0;
    const at = (iter: number) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
    const events: TraceEvent[] = [
      mk({ ...at(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} }),
      mk({ ...at(1), kind: "guard-fired", guard: "terminal_decision", outcome: "terminate", reason: "tool_call_unresolved", metadata: { terminatedBy: "tool_call_unresolved", status: "failed", authority: "guard:tool_call_unresolved" } }),
      mk({ ...at(0), kind: "guard-fired", guard: "checklist-unresolved", outcome: "warn", reason: "1 of 2 todo rows ended with no evidence", metadata: { unresolved: [], done: 1, total: 2 } }),
      mk({ ...at(-1), kind: "run-completed", status: "failure", terminatedBy: "tool_call_unresolved", totalTokens: 1, totalCostUsd: 0, durationMs: 1 }),
    ];
    const t: Trace = { runId: "r1", events };
    const c = analyzeCause(t);
    expect(c.cause).toBe("tool-protocol");
    expect(c.evidence.map((e) => e.detail).join("\n")).not.toContain("checklist-unresolved");
  });
});

describe("a strategy-accepted answer after a capped pass is not a terminal mislabel", () => {
  it("01M7T8TY: failed pass terminal + ledger acceptance + tolerated success is not terminal-mislabel", async () => {
    const c = analyzeCause(await loadTrace(fixture("cortex-reflexion-accepted-after-capped-pass.jsonl")));
    expect(c.cause).not.toBe("terminal-mislabel");
    expect(c.outcomeStatus).toBe("success");
  });

  it("without the ledger acceptance, the same failed terminal + success is still a mislabel", async () => {
    const t = await loadTrace(fixture("cortex-reflexion-accepted-after-capped-pass.jsonl"));
    const stripped: Trace = { ...t, events: t.events.filter((e) => e.kind !== "ledger-entry") };
    expect(analyzeCause(stripped).cause).toBe("terminal-mislabel");
  });

  it("without the runtime tolerance stamp, the acceptance alone does not excuse the contradiction", async () => {
    const t = await loadTrace(fixture("cortex-reflexion-accepted-after-capped-pass.jsonl"));
    const untolerated: Trace = {
      ...t,
      events: t.events.map((e) =>
        e.kind === "run-completed" && e.outcome !== undefined
          ? { ...e, outcome: { ...e.outcome, tolerated: false } }
          : e,
      ),
    };
    expect(analyzeCause(untolerated).cause).toBe("terminal-mislabel");
  });
});
