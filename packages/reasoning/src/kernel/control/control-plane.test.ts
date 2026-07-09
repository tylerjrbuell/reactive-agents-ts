// Run: bun test packages/reasoning/src/kernel/control/control-plane.test.ts --timeout 15000
//
// F1 — Control Plane resolver. Pins the documented TOTAL ORDER and the P5 fix.

import { describe, it, expect } from "bun:test";
import {
  resolveControlPlane,
  type ControlAction,
  type ControlProposal,
} from "./control-plane.js";

function prop(action: ControlAction, source: string = action, confidence: ControlProposal["confidence"] = "high"): ControlProposal {
  return { source, action, reason: `${source}_${action}`, confidence };
}

describe("resolveControlPlane — total order", () => {
  it("empty proposal set resolves to continue", () => {
    const r = resolveControlPlane([]);
    expect(r.action).toBe("continue");
    expect(r.winner).toBeNull();
  });

  it("a single proposal wins", () => {
    expect(resolveControlPlane([prop("steer")]).action).toBe("steer");
    expect(resolveControlPlane([prop("redirect")]).action).toBe("redirect");
    expect(resolveControlPlane([prop("terminate")]).action).toBe("terminate");
  });

  it("follows the documented priority: veto > abstain > terminate > strategy-switch > redirect > steer > continue", () => {
    const order: ControlAction[] = [
      "veto",
      "abstain",
      "terminate",
      "strategy-switch",
      "redirect",
      "steer",
      "continue",
    ];
    // For every adjacent pair, the higher-priority action wins regardless of order.
    for (let i = 0; i < order.length - 1; i++) {
      const hi = order[i]!;
      const lo = order[i + 1]!;
      expect(resolveControlPlane([prop(hi), prop(lo)]).action).toBe(hi);
      expect(resolveControlPlane([prop(lo), prop(hi)]).action).toBe(hi);
    }
  });

  it("veto beats a success terminate (a proven-failing run is not reported as success)", () => {
    expect(resolveControlPlane([prop("terminate"), prop("veto")]).action).toBe("veto");
  });

  it("ties within an action break by confidence, then by input order", () => {
    const low = prop("redirect", "a", "low");
    const high = prop("redirect", "b", "high");
    expect(resolveControlPlane([low, high]).winner?.source).toBe("b");
    // equal confidence → earliest wins (stable)
    const first = prop("steer", "first", "medium");
    const second = prop("steer", "second", "medium");
    expect(resolveControlPlane([first, second]).winner?.source).toBe("first");
  });
});

describe("resolveControlPlane — P5 race regression (abstain > strategy-switch)", () => {
  it("when abstention AND strategy-switch both qualify in one iteration, the resolver picks abstain ONLY", () => {
    const abstain = prop("abstain", "forced-abstention");
    const strategySwitch = prop("strategy-switch", "loop-detector");

    // Order-independent: whichever is emitted first, abstain wins.
    const r1 = resolveControlPlane([strategySwitch, abstain]);
    expect(r1.action).toBe("abstain");
    expect(r1.winner?.source).toBe("forced-abstention");

    const r2 = resolveControlPlane([abstain, strategySwitch]);
    expect(r2.action).toBe("abstain");

    // Before F1 the switch seam ran first (in-loop) while abstention ran later
    // (post-loop), so BOTH effects could apply. A naive "first-emitter-wins" would
    // have taken the strategy-switch here; the total order guarantees abstain.
    const naiveFirstWins = [strategySwitch, abstain][0]!;
    expect(naiveFirstWins.action).toBe("strategy-switch"); // the pre-F1 hazard
    expect(r1.action).not.toBe("strategy-switch"); // fixed
  });

  it("both proposals are preserved on the resolution for the trace/diagnostics", () => {
    const r = resolveControlPlane([prop("strategy-switch"), prop("abstain")]);
    expect(r.proposals.map((p) => p.action).sort()).toEqual(["abstain", "strategy-switch"]);
  });
});
