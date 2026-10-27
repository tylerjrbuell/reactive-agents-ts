import { describe, it, expect } from "bun:test";
import type { Trace, TraceEvent } from "@reactive-agents/trace";
import { detectSignalGaps } from "../src/lib/signal-gap-detector.js";
import { renderSignalGaps } from "../src/commands/signals.js";

const runId = "r1";
const base = (seq: number) => ({ runId, iter: 1, seq, timestamp: 1000 + seq });
const injected = (seq: number, signalId: string): TraceEvent =>
  ({ ...base(seq), kind: "harness-signal-injected", signalId, signalKind: "redirect", origin: "t", content: "c" }) as unknown as TraceEvent;
const rendered = (seq: number, signalId: string): TraceEvent =>
  ({ ...base(seq), kind: "signal-rendered", signalId, renderedInIter: 1, renderedSection: "guidance" }) as unknown as TraceEvent;
const effect = (seq: number, signalId: string, response: string): TraceEvent =>
  ({ ...base(seq), kind: "signal-effect", signalId, response, detail: "d" }) as unknown as TraceEvent;
const trace = (events: TraceEvent[]): Trace => ({ runId, events }) as unknown as Trace;

describe("detectSignalGaps", () => {
  it("flags unrendered, unobserved, ignored, contradicted — and not remediated", () => {
    const findings = detectSignalGaps(
      trace([
        injected(0, "a"), // never rendered
        injected(1, "b"), rendered(2, "b"), // rendered, no effect
        injected(3, "c"), rendered(4, "c"), effect(5, "c", "ignored"),
        injected(6, "d"), rendered(7, "d"), effect(8, "d", "contradicted"),
        injected(9, "e"), rendered(10, "e"), effect(11, "e", "remediated"),
      ]),
    );
    expect(findings.map((f) => `${f.signalId}:${f.kind}`)).toEqual([
      "a:unrendered",
      "b:unobserved",
      "c:ignored",
      "d:contradicted",
    ]);
  });

  it("renders a clean report when there are no gaps", () => {
    expect(renderSignalGaps([])).toContain("No signal gaps");
    expect(renderSignalGaps([{ signalId: "a", kind: "unrendered" }])).toContain("a");
  });
});
