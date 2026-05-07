// Tests for the oracle-nudge Layer 1 builder.
//
// Validates that the builder preserves the empirically-validated Pivot B
// behavior: the "describe vs emit" example pair, and the escalation-on-
// final-attempt language. Pure-function tests; no kernel needed.

import { describe, it, expect } from "bun:test";
import { buildOracleNudge } from "../../../../src/kernel/capabilities/decide/oracle-nudge.js";

describe("buildOracleNudge — Layer 1 oracle nudge text builder", () => {
  it("emits the M3 'describe vs emit' example pair on every call", () => {
    const text = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 2 });
    expect(text).toContain("STOP describing what you would do");
    expect(text).toContain("emit a final-answer tool call");
    expect(text).toContain("❌ WRONG");
    expect(text).toContain("✅ RIGHT");
    expect(text).toContain("`output` parameter");
  });

  it("uses non-final escalation footer when more nudges remain", () => {
    // local-tier limit=2; nudgeCount=0 → next nudge is 1 → still room for 2
    const text = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 2 });
    expect(text).toContain("this signal will repeat one more time");
    expect(text).not.toContain("LAST chance");
  });

  it("uses LAST CHANCE footer when this is the final nudge", () => {
    // local-tier limit=2; nudgeCount=1 → next nudge is 2 → final
    const text = buildOracleNudge({ nudgeCount: 1, nudgeLimit: 2 });
    expect(text).toContain("LAST chance");
    expect(text).toContain("terminates with no output");
    expect(text).not.toContain("repeat one more time");
  });

  it("matches Pivot B local-tier behavior (limit=2, two nudges, second is final)", () => {
    const first = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 2 });
    const second = buildOracleNudge({ nudgeCount: 1, nudgeLimit: 2 });
    // Both contain the example pair (consistent shape across nudges).
    expect(first).toContain("STOP describing");
    expect(second).toContain("STOP describing");
    // First is non-final; second is final.
    expect(first).toContain("repeat one more time");
    expect(second).toContain("LAST chance");
  });

  it("frontier-tier limit=3 means nudges 1 and 2 are non-final, 3 is final", () => {
    const n1 = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 3 });
    const n2 = buildOracleNudge({ nudgeCount: 1, nudgeLimit: 3 });
    const n3 = buildOracleNudge({ nudgeCount: 2, nudgeLimit: 3 });
    expect(n1).toContain("repeat one more time");
    expect(n2).toContain("repeat one more time");
    expect(n3).toContain("LAST chance");
  });

  it("forwards future-context fields without breaking (outputFormat, hasRequiredTools)", () => {
    // These fields are accepted but currently informational only. Test
    // ensures the builder doesn't reject them and remains stable.
    const text = buildOracleNudge({
      nudgeCount: 0,
      nudgeLimit: 2,
      outputFormat: "markdown",
      hasRequiredTools: true,
    });
    expect(text).toContain("STOP describing");
    expect(text.length).toBeGreaterThan(100);
  });

  it("is a pure function — same input produces identical output", () => {
    const a = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 2 });
    const b = buildOracleNudge({ nudgeCount: 0, nudgeLimit: 2 });
    expect(a).toBe(b);
  });
});
