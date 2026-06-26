import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateVerdict } from "../src/gate/types.ts";
import {
  emptyLedger,
  formatLedger,
  loadLedger,
  recordGateOutcome,
  saveLedger,
  type RecordGateParams,
} from "../src/ledger.ts";

function verdict(decision: GateVerdict["decision"], liftPp: number): GateVerdict {
  return {
    decision,
    perTier: [],
    aggregate: { liftPp, tokenOverheadPct: 2, tiersCovered: 2 },
    partial: false,
    rationale: `${decision} · ${liftPp}pp`,
    baselineVariantId: "bare-llm",
    candidateVariantId: "ra-full",
  };
}

function params(decision: GateVerdict["decision"], liftPp: number): RecordGateParams {
  return {
    id: "entry-1",
    createdAt: "2026-06-25T00:00:00.000Z",
    weakness: "tool-result truncated",
    hypothesis: "raise ctx-budget on attend",
    metric: "accuracy",
    verdict: verdict(decision, liftPp),
  };
}

describe("recordGateOutcome", () => {
  it("maps default-on → adopted and pins a regression-baseline", () => {
    const l = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    expect(l.entries.length).toBe(1);
    expect(l.entries[0]!.status).toBe("adopted");
    expect(l.entries[0]!.regressionBaseline).toBeDefined();
    expect(l.entries[0]!.regressionBaseline!.liftPp).toBe(4.5);
    expect(l.entries[0]!.regressionBaseline!.metric).toBe("accuracy");
  });

  it("maps opt-in → opt-in and still pins a baseline (positive lift)", () => {
    const l = recordGateOutcome(emptyLedger(), params("opt-in", 1.5));
    expect(l.entries[0]!.status).toBe("opt-in");
    expect(l.entries[0]!.regressionBaseline).toBeDefined();
  });

  it("maps reject → rejected and pins NO baseline", () => {
    const l = recordGateOutcome(emptyLedger(), params("reject", -3));
    expect(l.entries[0]!.status).toBe("rejected");
    expect(l.entries[0]!.regressionBaseline).toBeUndefined();
  });

  it("does not pin a baseline when lift is not positive even if non-reject", () => {
    const l = recordGateOutcome(emptyLedger(), params("opt-in", 0));
    expect(l.entries[0]!.regressionBaseline).toBeUndefined();
  });

  it("appends immutably (does not mutate the input ledger)", () => {
    const base = emptyLedger();
    const l = recordGateOutcome(base, params("default-on", 4));
    expect(base.entries.length).toBe(0);
    expect(l.entries.length).toBe(1);
  });

  it("carries the optional weaknessRef cross-reference when provided", () => {
    const l = recordGateOutcome(emptyLedger(), { ...params("default-on", 4), weaknessRef: "w1-text-fc" });
    expect(l.entries[0]!.weaknessRef).toBe("w1-text-fc");
  });
});

describe("formatLedger", () => {
  it("renders entry status, decision, lift, and ids", () => {
    const l = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    const out = formatLedger(l);
    expect(out).toContain("adopted");
    expect(out).toContain("ra-full");
    expect(out).toContain("4.5");
  });

  it("renders an empty-ledger message", () => {
    expect(formatLedger(emptyLedger())).toContain("no entries");
  });
});

describe("loadLedger / saveLedger", () => {
  it("returns an empty ledger when the file is missing", async () => {
    const l = await loadLedger(join(tmpdir(), "no-such-ledger-xyz-123.json"));
    expect(l.entries.length).toBe(0);
    expect(l.version).toBeGreaterThan(0);
  });

  it("round-trips a saved ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-"));
    const path = join(dir, "improvement-ledger.json");
    const saved = recordGateOutcome(emptyLedger(), params("default-on", 4.5));
    await saveLedger(path, saved);
    const loaded = await loadLedger(path);
    expect(loaded.entries.length).toBe(1);
    expect(loaded.entries[0]!.status).toBe("adopted");
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty ledger on malformed JSON (never throws)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-bad-"));
    const path = join(dir, "bad.json");
    await writeFile(path, "{not valid json", "utf8");
    const l = await loadLedger(path);
    expect(l.entries.length).toBe(0);
    expect(l.version).toBeGreaterThan(0);
    await rm(dir, { recursive: true, force: true });
  });
});
