// Run: bun test packages/reasoning/tests/kernel/verify/seam-measurement-conversion.test.ts --timeout 20000
//
// Ablation 2026-11-10 (stable-tool-list, mimo@8k umami-explore): a tool
// reported `totaltime: 611400` seconds, and the fabrication guard rejected the
// CORRECT conversions "10,190 minutes" and "169.8 hours" as fabricated
// measurements. Wrong conversions in the same ablation ("167 hours",
// "172 hours", "172.6 hours") must still be caught.
import { describe, expect, it } from "bun:test";
import { detectFabricatedMeasurement } from "../../../src/kernel/capabilities/verify/evidence-grounding.js";
import {
  isDerivedMeasurement,
  roundingTolerance,
} from "../../../src/kernel/capabilities/verify/measurement-conversion.js";

const STATS = '{"pageviews":12480,"visitors":3912,"visits":5207,"bounces":2290,"totaltime":611400}';

const answer = (line: string) =>
  `## Overall stats (all time)\n- **Pageviews:** 12,480\n- **Visits:** 5,207\n- **Total time on site:** ${line}\n`;

describe("seam-measurement-conversion: a correct conversion of a tool value is not fabricated", () => {
  it("accepts correct time conversions of the observed 611,400 s (trace shapes)", () => {
    for (const line of [
      "611,400 seconds ≈ 10,190 minutes ≈ 169.8 hours",
      "611,400 seconds (~170 hours)",
      "about 169.8 hours of total time",
      "10,190 min of total time",
    ]) {
      const r = detectFabricatedMeasurement(answer(line), STATS);
      expect({ line, ok: r.ok }).toEqual({ line, ok: true });
    }
  });

  it("still flags an incorrect conversion of the same value", () => {
    for (const [line, phrase] of [
      ["611,400 seconds (~167 hours)", "167 hours"],
      ["611,400 seconds (~172 hours)", "172 hours"],
      ["611,400 seconds (~172.6 hours)", "172.6 hours"],
    ] as const) {
      const r = detectFabricatedMeasurement(answer(line), STATS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.violations.join(" ")).toContain(phrase);
    }
  });

  it("accepts a per-visit rate derived from two values the answer reports (611,400 s / 5,207 visits)", () => {
    const out = `${answer("611,400 seconds")}That is about **117 seconds of time per visit**.`;
    expect(detectFabricatedMeasurement(out, STATS).ok).toBe(true);
  });

  it("a two-value derivation needs both operands cited in the answer AND produced by a tool", () => {
    // Same 117 s, but the answer never reports the visits count: no derivation.
    const out = "Total time on site is 611,400 seconds, about 117 seconds per visit.";
    expect(detectFabricatedMeasurement(out, STATS).ok).toBe(false);
  });

  it("accepts a percent change computed from two measured timings, flags a wrong one", () => {
    const evidence = "baseline: 150 ms\noptimized: 90 ms";
    expect(detectFabricatedMeasurement("It went from 150 ms to 90 ms, a 40% reduction.", evidence).ok).toBe(true);
    expect(detectFabricatedMeasurement("It went from 150 ms to 90 ms, a 45% reduction.", evidence).ok).toBe(false);
  });

  it("the W2 invented benchmark (no tool numbers) is still rejected", () => {
    const out = "Original: 10,000 elements took approximately 150 ms. Optimized: now 90 ms — a 40% reduction.";
    expect(detectFabricatedMeasurement(out, "the mergeSort source code, O(n log n)").ok).toBe(false);
  });

  it("a hedged per-visit rate may differ by one last-digit unit (~118 s for 117.4)", () => {
    const out = `${answer("611,400 s")}That is **~118 seconds of time per visit**.`;
    expect(detectFabricatedMeasurement(out, STATS).ok).toBe(true);
    // Unhedged, 118 is outside the rounding of 117.4.
    expect(detectFabricatedMeasurement(`${answer("611,400 s")}That is 118 seconds of time per visit.`, STATS).ok).toBe(false);
  });

  it("short and abbreviated units count: s, h, hr, hrs, min, d", () => {
    expect(detectFabricatedMeasurement(answer("611,400 s (169.8 h)"), STATS).ok).toBe(true);
    expect(detectFabricatedMeasurement(`${answer("611,400 s")}About 117 s of time per visit.`, STATS).ok).toBe(true);
    for (const [line, phrase] of [
      ["611,400 s (172.6 h)", "172.6 h"],
      ["611,400 s (172.6h)", "172.6h"],
      ["611,400 s (~172 hrs)", "172 hrs"],
      ["611,400 s (≈7.4 days)", "7.4 days"],
      ["611,400 s (7.4 d)", "7.4 d"],
    ] as const) {
      const r = detectFabricatedMeasurement(answer(line), STATS);
      expect({ line, ok: r.ok }).toEqual({ line, ok: false });
      if (!r.ok) expect(r.violations.join(" ")).toContain(phrase);
    }
  });

  it("a one-letter unit needs a space or a decimal: '1990s' is not a duration", () => {
    expect(detectFabricatedMeasurement("The 1990s took a long time to end.", STATS).ok).toBe(true);
  });

  it("audit 2026-11-10 misses are caught (recorded answer shapes)", () => {
    const visitsAnd = (tail: string) =>
      `## Overall stats\n- **Visits:** 5,207\n- **Visitors:** 3,912\n- **Total time on site:** 611,400 s\n${tail}\n`;
    for (const [out, phrase] of [
      // A tool field echoed as context ("totaltime" has no word break before "time").
      ["```\nvisits       5,207\ntotaltime   611,400 s ≈ 167 hours\n```", "167 hours"],
      ["| Total time on site | 1,019 min (611,400 s) |", "1,019 min"],
      [visitsAnd("Average session length ≈ 117.4 min, average pages per visit ≈ 2.4."), "117.4 min"],
      // The decimal point in "11.7" is not a sentence break.
      [visitsAnd("That's roughly **2.0 pageviews per visit** and **~11.7 minutes of time per visitor**."), "11.7 minutes"],
    ] as const) {
      const r = detectFabricatedMeasurement(out, `${STATS}\n{"window":7,"rank":1}`);
      expect({ out, ok: r.ok }).toEqual({ out, ok: false });
      if (!r.ok) expect(r.violations.join(" ")).toContain(phrase);
    }
  });

  it("a time rate needs a time-valued numerator: '~172 hours' is not 690 / 4", () => {
    // Recorded shape: the answer also reports 690 and 4, and 690 / 4 = 172.5
    // grounded the wrong conversion of 611,400 s (169.8 hours).
    const evidence = `${STATS}\n{"url":"/docs/api","pageviews":690,"days":4}`;
    const out = `${answer("611,400 seconds (~172 hours)")}- \`/docs/api\` — **690** pageviews over 4 days\n`;
    const r = detectFabricatedMeasurement(out, evidence);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toContain("172 hours");
  });

  it("a window, not a measurement: 'Realtime pageviews (last 30 min)'", () => {
    expect(detectFabricatedMeasurement("- **Realtime pageviews** (last 30 min)", STATS).ok).toBe(true);
  });

  it("rounding tolerance is half a unit of the claim's last printed digit", () => {
    expect(roundingTolerance("169.8")).toBeCloseTo(0.05, 6);
    expect(roundingTolerance("10,190")).toBeCloseTo(0.5, 6);
    const hours = { tag: "time", seconds: 3600 } as const;
    expect(isDerivedMeasurement({ value: 169.8, raw: "169.8", kind: hours }, new Set([611400]), [])).toBe(true);
    expect(isDerivedMeasurement({ value: 169.9, raw: "169.9", kind: hours }, new Set([611400]), [])).toBe(false);
  });
});
