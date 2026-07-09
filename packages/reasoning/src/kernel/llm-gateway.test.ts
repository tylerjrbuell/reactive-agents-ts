import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestLLMService } from "@reactive-agents/llm-provider";
import {
  resolveOutputBudget,
  gatewayComplete,
  applyModelRouting,
  CurrentModelRouting,
  type GatewayRequest,
} from "./llm-gateway.js";
import type { ModelRoutingPool } from "./policy/purpose-routing.js";
import { THINKING_SAFE_MIN_TOKENS } from "./utils/stream-parser.js";

// Phase 1 gateway (2026-07-07). These pins encode the BEHAVIOR-IDENTICAL
// migration contract: every pre-gateway literal must resolve to the same
// number through the gateway. Change a pin only with bench evidence.

describe("resolveOutputBudget", () => {
  test("explicit budgetTokens wins over everything", () => {
    expect(
      resolveOutputBudget({ purpose: "think", budgetTokens: 2500, tier: "local", budgetClass: "generous" }),
    ).toBe(2500);
  });

  test("provider-default omits the budget entirely", () => {
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "provider-default" })).toBeUndefined();
  });

  test("think + tier reproduces the B2 tier table", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local" })).toBe(1200);
    expect(resolveOutputBudget({ purpose: "think", tier: "mid" })).toBe(2000);
    expect(resolveOutputBudget({ purpose: "think", tier: "large" })).toBe(3000);
    expect(resolveOutputBudget({ purpose: "think", tier: "frontier" })).toBe(4000);
    expect(resolveOutputBudget({ purpose: "think", tier: "unknown-tier" })).toBe(1500);
  });

  test("think + thinking model adds the B2 allowance", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local", thinkingModel: true })).toBe(7200);
    expect(resolveOutputBudget({ purpose: "think", tier: "mid", thinkingModel: true })).toBe(8000);
  });

  test("explicit budgetClass beats the tier-adaptive think path", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local", budgetClass: "standard" })).toBe(4096);
  });

  test("purpose defaults: plan/synthesize/extract → 4096, classify/verify → 2048", () => {
    expect(resolveOutputBudget({ purpose: "plan" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "synthesize" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "extract" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "classify" })).toBe(THINKING_SAFE_MIN_TOKENS);
    expect(resolveOutputBudget({ purpose: "verify" })).toBe(THINKING_SAFE_MIN_TOKENS);
  });

  test("class table: terse=2048, standard=4096, generous=8192", () => {
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "terse" })).toBe(2048);
    expect(resolveOutputBudget({ purpose: "classify", budgetClass: "standard" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous" })).toBe(8192);
  });

  test("think without tier falls back to the standard class (no tier info = no adaptivity)", () => {
    expect(resolveOutputBudget({ purpose: "think" })).toBe(4096);
  });
});

// E3 economize actuator — a non-`green` pace band downshifts NON-synthesis
// budgets (cap at standard=4096), never raises one, and NEVER touches synthesis.
// Absent / `green` band → byte-identical to the pins above.
describe("resolveOutputBudget — E3 economize downshift", () => {
  test("no paceBand → byte-identical to the base resolution", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "mid", thinkingModel: true })).toBe(8000);
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous" })).toBe(8192);
  });

  test("green band → no downshift (byte-identical)", () => {
    expect(
      resolveOutputBudget({ purpose: "think", tier: "mid", thinkingModel: true, paceBand: "green" }),
    ).toBe(8000);
  });

  test("economize band caps a big NON-synthesis budget at standard (4096)", () => {
    // thinking-model mid think = 8000 → capped to 4096.
    expect(
      resolveOutputBudget({ purpose: "think", tier: "mid", thinkingModel: true, paceBand: "economize" }),
    ).toBe(4096);
    // generous class gathering call (extract) = 8192 → 4096.
    expect(
      resolveOutputBudget({ purpose: "extract", budgetClass: "generous", paceBand: "economize" }),
    ).toBe(4096);
  });

  test("economize NEVER raises an already-small budget (monotone cap)", () => {
    // local think = 1200 stays 1200; verify terse = 2048 stays 2048.
    expect(
      resolveOutputBudget({ purpose: "think", tier: "local", paceBand: "economize" }),
    ).toBe(1200);
    expect(
      resolveOutputBudget({ purpose: "verify", paceBand: "triage" }),
    ).toBe(THINKING_SAFE_MIN_TOKENS);
  });

  test("triage / terminal bands ALSO downshift non-synthesis (economize-or-worse)", () => {
    expect(
      resolveOutputBudget({ purpose: "think", tier: "frontier", thinkingModel: true, paceBand: "triage" }),
    ).toBe(4096); // 10000 → 4096
    expect(
      resolveOutputBudget({ purpose: "extract", budgetClass: "generous", paceBand: "terminal" }),
    ).toBe(4096);
  });

  test("synthesis is NEVER downshifted, on any band", () => {
    expect(
      resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous", paceBand: "economize" }),
    ).toBe(8192);
    expect(
      resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous", paceBand: "triage" }),
    ).toBe(8192);
    expect(
      resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous", paceBand: "terminal" }),
    ).toBe(8192);
  });

  test("provider-default (unbounded) becomes bounded at 4096 under economize (still a conservation)", () => {
    expect(
      resolveOutputBudget({ purpose: "extract", budgetClass: "provider-default", paceBand: "economize" }),
    ).toBe(4096);
    // …but synthesis stays unbounded even under a band.
    expect(
      resolveOutputBudget({ purpose: "synthesize", budgetClass: "provider-default", paceBand: "economize" }),
    ).toBeUndefined();
  });
});

// G2 purpose→tier model routing (meta-loop Phase 6). `applyModelRouting` is the
// pure request-shaping core the gateway applies after reading the ambient pool.
// OFF (pool undefined) → byte-identical (request unchanged). ON → gathering→cheap,
// synthesis→strong. An explicit per-call model always wins.
describe("applyModelRouting — purpose→tier request shaping", () => {
  const POOL: ModelRoutingPool = { cheap: "cheap-model", strong: "strong-model" };
  const req: GatewayRequest = { messages: [] };

  test("routing OFF: request is returned unchanged (byte-identical)", () => {
    expect(applyModelRouting(req, "extract", undefined)).toBe(req);
    expect(applyModelRouting(req, "synthesize", undefined).model).toBeUndefined();
  });

  test("routing OFF preserves an explicit per-call model", () => {
    const pinned: GatewayRequest = { messages: [], model: "pinned" };
    expect(applyModelRouting(pinned, "extract", undefined).model).toBe("pinned");
  });

  test("routing ON: a gathering purpose routes to the cheap tier", () => {
    expect(applyModelRouting(req, "extract", POOL).model).toBe("cheap-model");
    expect(applyModelRouting(req, "classify", POOL).model).toBe("cheap-model");
  });

  test("routing ON: a synthesize purpose routes to the strong tier", () => {
    expect(applyModelRouting(req, "synthesize", POOL).model).toBe("strong-model");
    expect(applyModelRouting(req, "think", POOL).model).toBe("strong-model");
  });

  test("routing ON: an explicit per-call model still wins over the pool", () => {
    const pinned: GatewayRequest = { messages: [], model: "pinned" };
    expect(applyModelRouting(pinned, "extract", POOL).model).toBe("pinned");
  });
});

// End-to-end: gatewayComplete reads the ambient CurrentModelRouting FiberRef at
// request-build time. Proves the FiberRef read path executes (OFF and ON) using
// the real typed TestLLMService — no cast, no crash, success preserved.
describe("gatewayComplete — reads the ambient model-routing FiberRef", () => {
  const POOL: ModelRoutingPool = { cheap: "cheap-model", strong: "strong-model" };
  const llm = TestLLMService([{ text: "ok" }]);

  test("OFF (no FiberRef set): completes normally", async () => {
    const res = await Effect.runPromise(
      gatewayComplete(llm, { purpose: "extract" }, { messages: [] }),
    );
    expect(res.content).toBe("ok");
  });

  test("ON (FiberRef set): completes normally under the routing scope", async () => {
    const res = await Effect.runPromise(
      gatewayComplete(llm, { purpose: "extract" }, { messages: [] }).pipe(
        Effect.locally(CurrentModelRouting, POOL),
      ),
    );
    expect(res.content).toBe("ok");
  });
});
