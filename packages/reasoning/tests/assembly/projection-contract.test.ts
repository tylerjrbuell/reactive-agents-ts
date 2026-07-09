import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import type { RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import type { RunContract } from "../../src/kernel/contract/run-contract.js";

const cap = resolveCapability({ window: 1000, outputBudget: 2000, dialect: "native-fc", tier: "local" });

// ── Switch-blindness: the D1 witness (kills audit 03-F5) ─────────────────────

describe("Projector — switch-blindness (handoff renders from the ledger)", () => {
  const ledger: RunLedger = [
    {
      seq: 0,
      iteration: 4,
      kind: "handoff",
      from: "reactive",
      to: "reflexion",
      summary: "Strategy Switch Handoff (switch #1):\nKey observations:\ncrawl found the sentinel token ZEBRA-9",
    },
  ];

  it("BEFORE (no ledger): the post-switch handoff summary is ABSENT from the window", () => {
    const log = new EventLog().append({ kind: "goal", text: "continue the task" });
    const { request } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] } });
    expect(request.systemPrompt).not.toContain("ZEBRA-9");
  });

  it("AFTER (ledger carries the handoff): the summary is PRESENT in the window", () => {
    const log = new EventLog().append({ kind: "goal", text: "continue the task" });
    const { request } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] }, ledger });
    expect(request.systemPrompt).toContain("crawl found the sentinel token ZEBRA-9");
    expect(request.systemPrompt).toContain("reactive → reflexion");
  });
});

// ── Reachability: no orphaned evidence ───────────────────────────────────────

describe("Projector — reachability (every ledger evidence entry reachable via a ref)", () => {
  it("every overflowing tool-result's storedKey is reachable from the rendered window", () => {
    const prev = process.env.RA_TOOL_RESULT_BUDGET_CHARS;
    process.env.RA_TOOL_RESULT_BUDGET_CHARS = "200";
    try {
      const store = new ResultStore();
      let log = new EventLog().append({ kind: "goal", text: "gather many facts" });
      const ledger: Array<RunLedger[number]> = [];
      const evidence: Array<{ key: string; sentinel: string }> = [];
      for (let i = 1; i <= 4; i++) {
        const key = `_tool_result_${i}`;
        const sentinel = `SENTINEL-${i}-QUOKKA`;
        const big = Array.from({ length: 40 }, (_, j) => ({ n: j, note: `${sentinel} fact ${i}.${j} ${"y".repeat(30)}` }));
        store.putWithRef(key, "web-search", big);
        log = log
          .append({ kind: "tool_called", tool: "web-search", callId: `c${i}`, args: { q: `q${i}` } })
          .append({ kind: "tool_result", callId: `c${i}`, ref: key, shape: "Array(40)" });
        // The ledger's record of the SAME evidence (C1 tool-result entry).
        ledger.push({ seq: i - 1, iteration: i, kind: "tool-result", toolName: "web-search", toolCallId: `c${i}`, success: true, preview: "…", storedKey: key });
        evidence.push({ key, sentinel });
      }
      const { request, trace } = project({ log, capability: cap, store, persona: { system: "Agent" }, tools: { schemas: [] }, ledger });
      const window = [request.systemPrompt, ...request.messages.map((m) => (typeof m.content === "string" ? m.content : ""))].join("\n");
      // No orphaned evidence: every ledger evidence entry is reachable from the
      // rendered window — either via a resolvable ref (result_ref / recall — both
      // land in projection.refs) OR its content is rendered inline.
      for (const { key, sentinel } of evidence) {
        const reachableByRef = trace.projection!.refs.includes(key);
        const reachableInline = window.includes(sentinel);
        expect(reachableByRef || reachableInline).toBe(true);
      }
      // The refs the projector reports must all actually resolve to a ledger
      // evidence storedKey (no phantom refs) — traceability's dual.
      const ledgerKeys = new Set(evidence.map((e) => e.key));
      for (const ref of trace.projection!.refs) {
        expect(ledgerKeys.has(ref)).toBe(true);
      }
    } finally {
      if (prev === undefined) delete process.env.RA_TOOL_RESULT_BUDGET_CHARS;
      else process.env.RA_TOOL_RESULT_BUDGET_CHARS = prev;
    }
  });
});

// ── Traceability: every rendered section carries provenance ──────────────────

describe("Projector — traceability (projection-rendered provenance)", () => {
  const contract: RunContract = {
    requirements: [{ id: "r1", kind: "question-answered", spec: { description: "Answer Q1", acceptance: "checker" }, weight: 1 }],
    deliverables: [],
    constraints: [],
    horizon: "long",
    acceptance: { tiers: ["checker"], stakes: "standard" },
    postConditions: [],
  };
  const ledger: RunLedger = [
    { seq: 0, iteration: 1, kind: "handoff", from: "reactive", to: "plan-execute", summary: "handoff body" },
  ];

  it("emits a projection trace whose sections all have non-negative chars + resolvable refs", () => {
    const log = new EventLog().append({ kind: "goal", text: "do the thing" });
    const { trace } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] }, contract, ledger });
    const p = trace.projection!;
    expect(p).toBeDefined();
    expect(p.sections.length).toBeGreaterThan(0);
    for (const s of p.sections) expect(s.chars).toBeGreaterThanOrEqual(0);
    // The handoff section's ref points back to the ledger handoff entry (seq 0).
    const handoff = p.sections.find((s) => s.name === "handoff");
    expect(handoff!.refs).toEqual(["ledger://handoff/0"]);
    expect(p.chars).toBeGreaterThan(0);
    expect(p.droppedRefs).toEqual([]);
  });
});
