import { describe, it, expect } from "bun:test";
import {
  openSignal,
  markRendered,
  closeSignal,
  openSignals,
  tallySignals,
  contentHash,
} from "../../src/kernel/state/signal-ledger.js";

describe("signal-ledger (Task 2)", () => {
  it("open -> render -> close happy path", () => {
    const { ledger, signalId } = openSignal([], {
      signalKind: "redirect",
      origin: "arbitrator.ts:890",
      target: { tool: "file-write", policy: "denied-tool-retry" },
      iter: 3,
      content: "retry with corrected args",
    });
    expect(signalId).toBe("sig-3-1");
    const rendered = markRendered(ledger, signalId, 4);
    expect(rendered[0].state).toBe("rendered");
    expect(rendered[0].renderedIter).toBe(4);
    const closed = closeSignal(rendered, signalId, "remediated", { observedTool: "file-write" });
    expect(closed[0].state).toBe("closed");
    expect(closed[0].effect).toBe("remediated");
    expect(closed[0].observedTool).toBe("file-write");
  });

  it("two signals open concurrently keep distinct ids and no overwrite", () => {
    const a = openSignal([], { signalKind: "redirect", origin: "x:1", iter: 1, content: "a" });
    const b = openSignal(a.ledger, { signalKind: "nudge", origin: "y:2", iter: 1, content: "b" });
    expect(a.signalId).not.toBe(b.signalId);
    expect(b.ledger.length).toBe(2);
    expect(b.ledger[0].signalId).toBe(a.signalId);
    expect(b.ledger[1].signalId).toBe(b.signalId);
  });

  it("markRendered records the step count so classification can slice post-render steps", () => {
    const { ledger, signalId } = openSignal([], { signalKind: "k", origin: "o", iter: 1, content: "c" });
    expect(markRendered(ledger, signalId, 2, 7)[0]?.renderedStepCount).toBe(7);
  });
  it("markRendered is idempotent", () => {
    const { ledger, signalId } = openSignal([], { signalKind: "redirect", origin: "x:1", iter: 1, content: "a" });
    const r1 = markRendered(ledger, signalId, 2);
    const r2 = markRendered(r1, signalId, 99);
    expect(r2[0].renderedIter).toBe(2);
  });

  it("openSignals returns only non-closed entries", () => {
    const { ledger, signalId } = openSignal([], { signalKind: "redirect", origin: "x:1", iter: 1, content: "a" });
    const closed = closeSignal(ledger, signalId, "ignored");
    expect(openSignals(ledger).length).toBe(1);
    expect(openSignals(closed).length).toBe(0);
  });

  it("tallySignals counts unobserved for rendered-but-unclassified", () => {
    const { ledger, signalId } = openSignal([], { signalKind: "redirect", origin: "x:1", iter: 1, content: "a" });
    const rendered = markRendered(ledger, signalId, 2);
    const t = tallySignals(rendered);
    expect(t.opened).toBe(1);
    expect(t.rendered).toBe(1);
    expect(t.unobserved).toBe(1);
    expect(t.remediated).toBe(0);
  });

  it("closeSignal on unknown id is a no-op (no throw)", () => {
    const { ledger } = openSignal([], { signalKind: "redirect", origin: "x:1", iter: 1, content: "a" });
    const out = closeSignal(ledger, "sig-999", "remediated");
    expect(out.length).toBe(1);
    expect(out[0].state).toBe("open");
  });

  it("contentHash is stable and 8 hex chars", () => {
    const h = contentHash("retry with corrected args");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash("retry with corrected args")).toBe(h);
  });
});
