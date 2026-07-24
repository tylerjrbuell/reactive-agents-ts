// Run: bun test packages/reasoning/src/kernel/capabilities/act/approval-policy-stages.test.ts
//
// The approval policy crosses three boundaries (authored → configured →
// resolved) and used to be hand-declared at each of them, four copies in all.
// Adding block mode's `onApprove` had to touch every one; a site that misses a
// field silently drops it, which is precisely how `mode: "block"` shipped as a
// safety switch that gated nothing.
//
// These are COMPILE-TIME pins: the stages must stay STRUCTURALLY DERIVED from
// the one canonical shape, differing only where representation genuinely
// changes (`tools` Set↔array, `decide` Effect↔plain callback). Re-typing a
// stage by hand — even into something that happens to match today — breaks
// `Equal` here as soon as the shapes diverge by one field.
// `scripts/check-cross-cutting.sh` Check 6 guards the same invariant by grep.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  resolveBlockApproval,
  wrapApprovalDecider,
  type AuthoredApprovalPolicy,
  type ConfiguredApprovalPolicy,
  type ResolvedApprovalPolicy,
} from "./approval-gate.js";

type Assert<T extends true> = T;
/** Invariant (not merely bidirectionally-assignable) type equality. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Every member the two stages share — `mode`, `requireFor`, and anything added
// later — must be IDENTICAL, because the config stage is an Omit of the
// resolved one. A hand-written copy that forgets a future field fails here.
type _SharedMembersSurvive = Assert<
  Equal<
    Omit<ConfiguredApprovalPolicy, "tools" | "onApprove">,
    Omit<ResolvedApprovalPolicy, "tools" | "decide">
  >
>;

// The stages differ in exactly two keys, the two that change representation.
type _KeyParity = Assert<
  Equal<Exclude<keyof ResolvedApprovalPolicy, "decide">, Exclude<keyof ConfiguredApprovalPolicy, "onApprove">>
>;

// The public `.withApprovalPolicy()` argument is the config stage with every
// field optional — the builder resolves `mode` and folds `requiresApproval`
// tools into `tools`. Nothing authorable exists that the config stage lacks.
type _AuthoredIsOptionalConfigured = Assert<Equal<AuthoredApprovalPolicy, Partial<ConfiguredApprovalPolicy>>>;

describe("approval policy stage shapes", () => {
  it("carries an authored policy through config → resolved with its decision intact", async () => {
    // The behavioural half of the same claim: a policy authored on the public
    // surface survives both conversions and still decides the gate. If a stage
    // dropped `requireFor` or `onApprove`, the call below would stop being
    // gated (or stop being approved) rather than merely failing to typecheck.
    const seen: string[] = [];
    const authored: AuthoredApprovalPolicy = {
      mode: "block",
      requireFor: ({ toolName }) => toolName === "danger",
      onApprove: ({ toolName }) => {
        seen.push(toolName);
        return true;
      },
    };

    const configured: ConfiguredApprovalPolicy = { ...authored, mode: "block", tools: authored.tools ?? [] };
    const resolved: ResolvedApprovalPolicy = {
      mode: configured.mode,
      tools: new Set(configured.tools),
      requireFor: configured.requireFor,
      ...(configured.onApprove ? { decide: wrapApprovalDecider(configured.onApprove) } : {}),
    };

    const gated = await Effect.runPromise(resolveBlockApproval("danger", {}, resolved, { iteration: 0 }));
    expect(gated).toEqual({ gated: true, approved: true });
    expect(seen).toEqual(["danger"]);

    // A tool the predicate does not claim is never a gate at all.
    const ungated = await Effect.runPromise(resolveBlockApproval("safe", {}, resolved, { iteration: 0 }));
    expect(ungated).toEqual({ gated: false });
    expect(seen).toEqual(["danger"]);
  });
});
