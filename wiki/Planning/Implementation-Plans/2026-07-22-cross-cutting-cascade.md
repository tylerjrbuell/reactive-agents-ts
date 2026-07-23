# Cross-Cutting Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-cutting harness concerns (fabricationGuard, grounding, stallPolicy, taskContract, HITL rails) cascade to all 8 strategies by construction — via one ambient `RunEnvelope` service plus a branded, judgment-bearing terminal mint — so a strategy can never silently drop a concern it never carries.

**Architecture:** Judgment/repair split per the design spec (`wiki/Architecture/Design-Specs/2026-07-22-cross-cutting-cascade-design.md`). **Judgment** is hard-enforced at the terminal: `ReasoningResult` becomes a branded type whose only mint is an Effect-ful `finalizeStrategyResult` requiring `RunEnvelope` in its R channel — compile-total over every return path. **Repair** is soft-read (`Effect.serviceOption`) at the seams (`runKernel`, `executeToolAndObserve`) — a path missing repair degrades to more-expensive, never to unsafe, because the terminal still judges it. Boundary 3 (`TaskResult.metadata`) gets a typed extension slot instead of hand-enumeration.

**Tech Stack:** Effect-TS (Context.Tag services, R-channel requirements, Schema), Bun test runner, turbo.

## Global Constraints

- Strict TypeScript. **No `any`**, no `as any` casts — `unknown` + guards or proper types (`feedback_clean_types`).
- Every `bun test` invocation uses `--timeout 15000` (agent-tdd).
- CI parity: tests use the `test` provider only; **no API keys, no Ollama** may be required (`feedback_ci_parity_no_keys_no_ollama`).
- **No `Co-Authored-By` trailers in commits** (repo rule; overrides harness default).
- Red-on-cut: every behavioral gate ships with a test that goes red when the wiring is cut.
- Verification: `bunx turbo run build --force` THEN `bunx turbo run typecheck --force` (stale dist masks errors). `tsc --noEmit` alone is NOT authoritative (`feedback_typecheck_vs_build`).
- Workspace packages run from `src/` under Bun — no rebuild needed for probes/tests.
- Commit after every green task. Conventional-commit style, message explains WHY.
- The lift rule does NOT gate this work: all four withers are opt-in; honoring them is a bug fix (spec §8). No bench campaign required.

**Execution order note:** Tasks 1→6 are strictly ordered (each compiles only atop the previous). Tasks 7, 8, 9 are independent of each other but require Task 6. Task 10 is last.

---

### Task 1: `RunEnvelope` service + `buildRunEnvelope` + test layer

**Files:**
- Create: `packages/reasoning/src/kernel/envelope/run-envelope.ts`
- Create: `packages/reasoning/src/kernel/envelope/run-envelope.test.ts`
- Modify: `packages/reasoning/src/index.ts` (export block)

**Interfaces:**
- Produces: `RunEnvelope` (Context.Tag), `RunEnvelopeData` (`{policy, rails}`), `buildRunEnvelope(opts)`, `emptyRunEnvelope`, `provideTestEnvelope(effect, data?)` — consumed by every later task.

- [ ] **Step 1: Write the failing test**

```ts
// packages/reasoning/src/kernel/envelope/run-envelope.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
} from "./run-envelope.js";

describe("RunEnvelope — the run-wide cross-cutting carrier", () => {
  it("buildRunEnvelope splits fields into policy (judgment) and rails (repair)", () => {
    const env = buildRunEnvelope({
      fabricationGuard: "block",
      grounding: { mode: "block" },
      stallPolicy: { maxIgnoredNudges: 2 },
      approvalPolicy: { mode: "always", tools: new Set(["file-write"]), requireFor: undefined },
    });
    expect(env.policy.fabricationGuard).toBe("block");
    expect(env.policy.grounding?.mode).toBe("block");
    expect(env.rails.stallPolicy?.maxIgnoredNudges).toBe(2);
    expect(env.rails.approvalPolicy?.mode).toBe("always");
  });

  it("emptyRunEnvelope has no policy and no rails (zero-config = zero behavior change)", () => {
    expect(emptyRunEnvelope.policy).toEqual({});
    expect(emptyRunEnvelope.rails).toEqual({});
  });

  it("provideTestEnvelope makes the service readable in an effect", async () => {
    const read = Effect.gen(function* () {
      const env = yield* RunEnvelope;
      return env.policy.fabricationGuard;
    });
    const result = await Effect.runPromise(
      provideTestEnvelope(read, buildRunEnvelope({ fabricationGuard: "warn" })),
    );
    expect(result).toBe("warn");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test src/kernel/envelope/run-envelope.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module './run-envelope.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/reasoning/src/kernel/envelope/run-envelope.ts
//
// RunEnvelope — the ONE run-wide carrier for cross-cutting harness concerns.
//
// Design: wiki/Architecture/Design-Specs/2026-07-22-cross-cutting-cascade-design.md
// Defect class this closes: a run-wide field threaded by hand through 8 strategy
// input interfaces is silently dropped wherever an interface omits it (HITL
// bypass fe5dc93b; grounding/fabricationGuard/stallPolicy discarded on 5 of 8
// strategies, measured 2026-07-22). Strategies never carry these fields again —
// they cannot drop what they never carry.
//
// ONE service, TWO named sub-records (spec §9 ruling — a split into two
// services reinvents the drop at the join):
//   policy — judgment inputs, read at the terminal mint (finalizeStrategyResult)
//   rails  — repair inputs, soft-read at the seams (runKernel, tool-observe)
import { Context, Effect } from "effect";
import type { TaskContract } from "@reactive-agents/core";
import type { KernelInput, GroundingConfig, StallPolicy } from "../state/kernel-state.js";
import type { FabricationGuardMode } from "../capabilities/verify/evidence-grounding.js";

export interface RunEnvelopePolicy {
  /** Declared TaskContract (.withContract) — judged contract-vs-ledger at the terminal. */
  readonly taskContract?: TaskContract;
  /** Fabrication-guard mode (.withFabricationGuard). Judged at the terminal; also read by kernel verify. */
  readonly fabricationGuard?: FabricationGuardMode;
  /** Numeric evidence-grounding config (.withGrounding). Judgment side; redirect half lives in rails-consuming loop. */
  readonly grounding?: GroundingConfig;
}

export interface RunEnvelopeRails {
  /** Stall/no-progress policy (.withStallPolicy) — mid-run steering, loop-scoped. */
  readonly stallPolicy?: StallPolicy;
  /** Durable HITL (Phase D): approval-gate policy. Repair: must pause BEFORE the tool runs. */
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  /** Durable HITL (Phase D): human's approve/deny decision on a resumed run. */
  readonly approvalDecision?: KernelInput["approvalDecision"];
  /** Agentic-UI interaction rail: human's response to a paused request_user_input. */
  readonly interactionResponse?: KernelInput["interactionResponse"];
}

export interface RunEnvelopeData {
  readonly policy: RunEnvelopePolicy;
  readonly rails: RunEnvelopeRails;
}

export class RunEnvelope extends Context.Tag("RunEnvelope")<RunEnvelope, RunEnvelopeData>() {}

/** Flat construction options — what the runtime config actually holds. */
export interface BuildRunEnvelopeOptions {
  readonly taskContract?: TaskContract;
  readonly fabricationGuard?: FabricationGuardMode;
  readonly grounding?: GroundingConfig;
  readonly stallPolicy?: StallPolicy;
  readonly approvalPolicy?: KernelInput["approvalPolicy"];
  readonly approvalDecision?: KernelInput["approvalDecision"];
  readonly interactionResponse?: KernelInput["interactionResponse"];
}

export function buildRunEnvelope(opts: BuildRunEnvelopeOptions = {}): RunEnvelopeData {
  return {
    policy: {
      ...(opts.taskContract !== undefined ? { taskContract: opts.taskContract } : {}),
      ...(opts.fabricationGuard !== undefined ? { fabricationGuard: opts.fabricationGuard } : {}),
      ...(opts.grounding !== undefined ? { grounding: opts.grounding } : {}),
    },
    rails: {
      ...(opts.stallPolicy !== undefined ? { stallPolicy: opts.stallPolicy } : {}),
      ...(opts.approvalPolicy !== undefined ? { approvalPolicy: opts.approvalPolicy } : {}),
      ...(opts.approvalDecision !== undefined ? { approvalDecision: opts.approvalDecision } : {}),
      ...(opts.interactionResponse !== undefined
        ? { interactionResponse: opts.interactionResponse }
        : {}),
    },
  };
}

/** The no-config envelope: every field absent. Zero behavior change by construction. */
export const emptyRunEnvelope: RunEnvelopeData = { policy: {}, rails: {} };

/**
 * Test helper — the ONLY sanctioned provision site outside
 * `reasoning-service.ts` (enforced by scripts/check-cross-cutting.sh).
 */
export function provideTestEnvelope<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  data: RunEnvelopeData = emptyRunEnvelope,
): Effect.Effect<A, E, Exclude<R, RunEnvelope>> {
  return Effect.provideService(effect, RunEnvelope, data);
}
```

- [ ] **Step 4: Export from the package index**

In `packages/reasoning/src/index.ts`, add alongside the existing kernel exports:

```ts
export {
  RunEnvelope,
  buildRunEnvelope,
  emptyRunEnvelope,
  provideTestEnvelope,
} from "./kernel/envelope/run-envelope.js";
export type {
  RunEnvelopeData,
  RunEnvelopePolicy,
  RunEnvelopeRails,
  BuildRunEnvelopeOptions,
} from "./kernel/envelope/run-envelope.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/reasoning && bun test src/kernel/envelope/run-envelope.test.ts --timeout 15000`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/envelope/ packages/reasoning/src/index.ts
git commit -m "feat(reasoning): RunEnvelope — one run-wide carrier for cross-cutting concerns

First component of the cross-cutting cascade (design spec 2026-07-22).
One service, two named sub-records: policy (judgment inputs, read at the
terminal mint) and rails (repair inputs, soft-read at the seams). Strategies
will never carry these fields again — they cannot drop what they never carry."
```

---

### Task 2: Plumb the R channel — provision in `reasoning-service`, construction in `reasoning-think`

Zero behavior change. After this task the envelope is provided on every strategy execution, but nothing reads it yet.

**Files:**
- Modify: `packages/reasoning/src/services/strategy-registry.ts` (StrategyFn type, ~line 94-98)
- Modify: `packages/reasoning/src/services/reasoning-service.ts` (execute params + dispatch)
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` (~line 333-341 region)
- Test: `packages/reasoning/src/services/reasoning-service-envelope.test.ts` (create)

**Interfaces:**
- Consumes: `RunEnvelope`, `buildRunEnvelope`, `emptyRunEnvelope` (Task 1).
- Produces: `StrategyFn` R channel = `LLMService | RunEnvelope`; `ReasoningService.execute` accepts optional `envelope?: RunEnvelopeData` and provides it (defaulting to `emptyRunEnvelope`); `reasoning-think.ts` builds the envelope from config. Later tasks rely on: **every strategy effect runs with `RunEnvelope` provided.**

- [ ] **Step 1: Write the failing test**

```ts
// packages/reasoning/src/services/reasoning-service-envelope.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { RunEnvelope, buildRunEnvelope } from "../kernel/envelope/run-envelope.js";
import { StrategyRegistry } from "./strategy-registry.js";
import type { StrategyFn } from "./strategy-registry.js";
// Use the package's existing test harness for constructing a ReasoningService
// with the test LLM provider. Mirror the setup used by the sibling
// reasoning-service tests in packages/reasoning/tests/ — the only new element
// is the probe strategy below.

describe("ReasoningService provides RunEnvelope to strategy effects", () => {
  it("a probe strategy can read the envelope the caller passed to execute()", async () => {
    // Probe strategy: returns the fabricationGuard it observes via the service.
    const probe: StrategyFn = () =>
      Effect.gen(function* () {
        const env = yield* RunEnvelope;
        return {
          strategy: "reactive",
          steps: [],
          output: env.policy.fabricationGuard ?? "none",
          metadata: {
            duration: 0, tokensUsed: 0, cost: 0, stepsCount: 0, confidence: 1,
          },
          status: "completed",
        } as const;
      });
    // Register the probe under a test name, call service.execute with
    // envelope: buildRunEnvelope({ fabricationGuard: "warn" }), assert
    // result.output === "warn". Build the service via the same Layer
    // composition the sibling tests use (test provider, real registry).
    // ... (mirror sibling test harness setup verbatim)
  });
});
```

(The implementer copies the exact Layer scaffolding from the nearest existing `reasoning-service` test in `packages/reasoning/tests/` — the assertion above is the contract.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/reasoning && bun test src/services/reasoning-service-envelope.test.ts --timeout 15000`
Expected: FAIL — compile error: `RunEnvelope` not in `StrategyFn`'s R channel / `envelope` not a known execute param.

- [ ] **Step 3: Widen `StrategyFn`'s R channel**

In `packages/reasoning/src/services/strategy-registry.ts` (~line 94):

```ts
import type { RunEnvelope } from "../kernel/envelope/run-envelope.js";
// ...
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
>;
```

Widening R is compile-safe: existing strategies simply don't use the extra service yet.

- [ ] **Step 4: Accept + provide the envelope in `reasoning-service.ts`**

Add to the `execute` params interface:

```ts
/** Run-wide cross-cutting envelope (cascade design 2026-07-22). Absent ⇒ emptyRunEnvelope. */
readonly envelope?: RunEnvelopeData;
```

At the dispatch site where the strategy function is invoked (the point where `execute` runs the `StrategyFn` returned by `StrategyRegistry.get`), wrap the strategy effect:

```ts
import { RunEnvelope, emptyRunEnvelope } from "../kernel/envelope/run-envelope.js";
import type { RunEnvelopeData } from "../kernel/envelope/run-envelope.js";
// ...
// THE single production provision site (gate-enforced by check-cross-cutting.sh).
const provided = Effect.provideService(
  strategyFn(strategyParams),
  RunEnvelope,
  params.envelope ?? emptyRunEnvelope,
);
```

- [ ] **Step 5: Build the envelope in `reasoning-think.ts`**

In `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts`, next to the existing per-field forwards (~line 333-341), add to the execute request — WITHOUT yet removing the old per-field forwards (they die in Task 6):

```ts
import { buildRunEnvelope } from "@reactive-agents/reasoning";
// ...
envelope: buildRunEnvelope({
  taskContract: config.taskContract,
  fabricationGuard: config.fabricationGuard,
  grounding: config.grounding,
  stallPolicy: config.stallPolicy,
  approvalPolicy: config.approvalPolicy
    ? {
        mode: config.approvalPolicy.mode,
        tools: new Set(config.approvalPolicy.tools),
        requireFor: config.approvalPolicy.requireFor,
      }
    : undefined,
  approvalDecision,
  interactionResponse,
}),
```

- [ ] **Step 6: Run the new test + both packages' suites**

Run: `cd packages/reasoning && bun test src/services/reasoning-service-envelope.test.ts --timeout 15000` → PASS
Run: `cd packages/reasoning && bun test --timeout 15000` → no new failures
Run: `cd packages/runtime && bun test --timeout 15000` → no new failures

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/services/ packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts
git commit -m "feat(reasoning): provide RunEnvelope on every strategy execution

StrategyFn's R channel now carries RunEnvelope; reasoning-service is the
single production provision site; reasoning-think builds the envelope from
config alongside the legacy per-field forwards (which a later task deletes).
Zero behavior change — nothing reads the envelope yet."
```

---

### Task 3: Branded `JudgedReasoningResult` + `finalizeStrategyResult` mint (judgment inert)

**Files:**
- Create: `packages/reasoning/src/kernel/capabilities/sense/finalize-result.ts`
- Create: `packages/reasoning/src/kernel/capabilities/sense/finalize-result.test.ts`
- Modify: `packages/reasoning/src/types/reasoning.ts` (add optional `verdict` to `ReasoningMetadataSchema`)
- Modify: `packages/reasoning/src/index.ts` (exports)

**Interfaces:**
- Consumes: `buildStrategyResult(params)` from `kernel/capabilities/sense/step-utils.ts:202` (existing, stays exported until Task 5); `RunEnvelope` (Task 1).
- Produces:
  - `JudgedReasoningResult` = `ReasoningResult & { readonly [Judged]: true }` (brand symbol NOT exported)
  - `finalizeStrategyResult(params: Parameters<typeof buildStrategyResult>[0] & FinalizeExtras): Effect.Effect<JudgedReasoningResult, never, RunEnvelope>`
  - `FinalizeExtras = { requiredTools?: readonly string[]; runLedger?: RunLedger; repairCapabilities?: { perIteration: boolean } }`
  - `__unsafeBrandJudgedForTest(r: ReasoningResult): JudgedReasoningResult` exported ONLY from the test-support module
- Task 4 migrates all strategies onto `finalizeStrategyResult`; Task 5 flips `StrategyFn` to require `JudgedReasoningResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/reasoning/src/kernel/capabilities/sense/finalize-result.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { finalizeStrategyResult } from "./finalize-result.js";
import type { JudgedReasoningResult } from "./finalize-result.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../envelope/run-envelope.js";
import type { ReasoningResult } from "../../../types/index.js";

const baseParams = {
  strategy: "reactive" as const,
  steps: [],
  output: "The answer is 42.",
  status: "completed" as const,
  start: 0,
  totalTokens: 10,
  totalCost: 0,
};

describe("finalizeStrategyResult — the only mint of a judged result", () => {
  it("produces a result identical to buildStrategyResult's shape, plus a verdict record", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    expect(r.status).toBe("completed");
    expect(r.output).toBe("The answer is 42.");
    // Judgment is INERT in this task: computed + recorded, never enforced.
    expect(r.metadata.verdict).toBeDefined();
    expect(r.metadata.verdict?.enforced).toBe(false);
  });

  it("a JudgedReasoningResult is assignable to ReasoningResult (consumers unchanged)", async () => {
    const r: JudgedReasoningResult = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    const plain: ReasoningResult = r; // must compile
    expect(plain.strategy).toBe("reactive");
  });

  it("witness: a plain ReasoningResult is NOT a JudgedReasoningResult", () => {
    const plain: ReasoningResult = {
      strategy: "reactive",
      steps: [],
      output: "x",
      metadata: { duration: 0, tokensUsed: 0, cost: 0, stepsCount: 0, confidence: 1 },
      status: "completed",
    };
    // @ts-expect-error — the brand is unexported; only finalizeStrategyResult mints it.
    const judged: JudgedReasoningResult = plain;
    expect(judged).toBeDefined(); // runtime no-op; the assertion is the compile error above
  });

  it("records the declared repair gap when the strategy reports no per-iteration repair", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({ ...baseParams, repairCapabilities: { perIteration: false } }),
        buildRunEnvelope({ fabricationGuard: "block" }),
      ),
    );
    expect(r.metadata.verdict?.repairGaps).toEqual(["per-iteration"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/reasoning && bun test src/kernel/capabilities/sense/finalize-result.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `verdict` to `ReasoningMetadataSchema`**

In `packages/reasoning/src/types/reasoning.ts`, inside the `ReasoningMetadataSchema` struct:

```ts
/**
 * Terminal judgment record (cross-cutting cascade, 2026-07-22). Computed by
 * finalizeStrategyResult on EVERY result. `enforced: false` ⇒ informational
 * (no wither configured, or judgment found nothing). Enforcement flips
 * status/output at the mint — never anywhere else.
 */
verdict: Schema.optional(
  Schema.Struct({
    /** Did judgment alter the result (status flip / output replacement)? */
    enforced: Schema.Boolean,
    /** Grounding verdict against required tools, when requiredTools were declared. */
    groundedOnRequired: Schema.optional(Schema.Boolean),
    /** Contract requirement outcomes, when a taskContract was declared. */
    contractSatisfied: Schema.optional(Schema.Boolean),
    /** Names of judgment checks that failed (empty ⇒ clean). */
    failed: Schema.Array(Schema.String),
    /** Declared repair gaps for this strategy (e.g. "per-iteration"). */
    repairGaps: Schema.optional(Schema.Array(Schema.String)),
  }),
),
```

- [ ] **Step 4: Write `finalize-result.ts`**

```ts
// packages/reasoning/src/kernel/capabilities/sense/finalize-result.ts
//
// The ONLY mint of a JudgedReasoningResult (cascade design §4.2).
//
// "Un-bypassable" is a compiler fact, not a grep-gate promise: the brand
// symbol is module-private, so every strategy exit — early returns, catch
// paths, pause paths — must cross this function or fail to typecheck once
// StrategyFn requires JudgedReasoningResult (Task 5).
//
// Judgment here is INERT in Task 3 (computed + recorded, enforced:false).
// Task 8 adds enforcement for opt-in withers.
import { Effect } from "effect";
import type { ReasoningResult } from "../../../types/index.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { RunEnvelope } from "../../envelope/run-envelope.js";
import { buildStrategyResult } from "./step-utils.js";
import { hasSuccessfulRequiredToolCall } from "../../loop/runner-helpers/grounded-terminal.js";

declare const Judged: unique symbol;
export type JudgedReasoningResult = ReasoningResult & { readonly [Judged]: true };

export interface FinalizeExtras {
  /** Required tools for the grounding verdict (strategy already holds these). */
  readonly requiredTools?: readonly string[];
  /** Run ledger for contract-vs-evidence judgment (universal since Wave C.1). */
  readonly runLedger?: RunLedger;
  /** Repair capabilities this strategy actually has. Absent ⇒ full per-iteration repair. */
  readonly repairCapabilities?: { readonly perIteration: boolean };
}

type BuildParams = Parameters<typeof buildStrategyResult>[0];

export function finalizeStrategyResult(
  params: BuildParams & FinalizeExtras,
): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> {
  return Effect.gen(function* () {
    const envelope = yield* RunEnvelope;
    const base = buildStrategyResult(params);

    const failed: string[] = [];
    let groundedOnRequired: boolean | undefined;
    if (params.requiredTools && params.requiredTools.length > 0) {
      groundedOnRequired = hasSuccessfulRequiredToolCall(params.steps, params.requiredTools);
      if (!groundedOnRequired && envelope.policy.fabricationGuard !== undefined) {
        failed.push("grounding-on-required");
      }
    }

    const repairGaps =
      params.repairCapabilities && !params.repairCapabilities.perIteration
        ? ["per-iteration"]
        : undefined;

    const verdict = {
      enforced: false, // Task 8 flips this for opt-in withers
      ...(groundedOnRequired !== undefined ? { groundedOnRequired } : {}),
      failed,
      ...(repairGaps ? { repairGaps } : {}),
    };

    const judged: ReasoningResult = {
      ...base,
      metadata: { ...base.metadata, verdict },
    };
    // The single sanctioned brand cast in the codebase (module-private symbol).
    return judged as JudgedReasoningResult;
  });
}

/** TEST-ONLY escape hatch for fixtures that need a judged result without a mint run. */
export function __unsafeBrandJudgedForTest(r: ReasoningResult): JudgedReasoningResult {
  return r as JudgedReasoningResult;
}
```

Export from `packages/reasoning/src/index.ts`:

```ts
export { finalizeStrategyResult } from "./kernel/capabilities/sense/finalize-result.js";
export type { JudgedReasoningResult, FinalizeExtras } from "./kernel/capabilities/sense/finalize-result.js";
```

**`__unsafeBrandJudgedForTest` is deliberately NOT exported from the package index** (corrected 2026-07-22 after Task 3 review). It stays exported from `finalize-result.ts` so in-package tests can import it by module path. Exporting it from the index ships a zero-cast brand-forger to npm consumers, which defeats the mint's entire guarantee — any strategy author blocked by the Task 5 type flip could import it and erase the compile error.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/reasoning && bun test src/kernel/capabilities/sense/finalize-result.test.ts --timeout 15000`
Expected: PASS (4 tests). Also run `bunx tsc --noEmit -p packages/reasoning` to confirm the `@ts-expect-error` witness holds (a stray error here means the brand leaks).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/sense/finalize-result.* packages/reasoning/src/types/reasoning.ts packages/reasoning/src/index.ts
git commit -m "feat(reasoning): branded JudgedReasoningResult + finalizeStrategyResult mint

Judgment computed and recorded (enforced:false) on every result; the brand
symbol is module-private so the mint is the only constructor once StrategyFn
flips. Same move as ValidatedObservation's _validated discriminator."
```

---

### Task 4: Migrate all 8 strategies onto `finalizeStrategyResult`

Mechanical, three commits (one per family). Every call site of `buildStrategyResult(...)` inside `packages/reasoning/src/strategies/` becomes `yield* finalizeStrategyResult(...)` with the strategy's `requiredTools`, `runLedger` (already computed since Wave C.1), and `repairCapabilities` passed.

**Files:**
- Modify (4a): `strategies/reactive.ts`, `strategies/direct.ts`, `strategies/adaptive.ts`
- Modify (4b): `strategies/reflexion.ts`, `strategies/tree-of-thought.ts`
- Modify (4c): `strategies/plan-execute.ts`, `strategies/blueprint.ts`, `strategies/code-action.ts`
- Tests: the existing `strategies/*honest-partial.integration.test.ts` family pins result shape per strategy — they are the regression net; extend each with one verdict assertion.

**Interfaces:**
- Consumes: `finalizeStrategyResult` (Task 3). All strategies run with `RunEnvelope` provided (Task 2).
- Produces: every strategy return path yields a `JudgedReasoningResult` (still typed `ReasoningResult` until Task 5 flips `StrategyFn`).

Per-strategy rules:

1. Replace every `return buildStrategyResult({...})` / `const result = buildStrategyResult({...})` with `yield* finalizeStrategyResult({...})` (all strategy bodies are already `Effect.gen`).
2. Pass `requiredTools: input.requiredTools ?? []` and the strategy's existing `runLedger` value (the same one it forwards via `extraMetadata.runLedger`).
3. `repairCapabilities`: `{ perIteration: true }` for reactive/direct/adaptive/reflexion/tree-of-thought/blueprint (kernel-pass execution); `{ perIteration: false }` for plan-execute and code-action (spec §3.4 — coarse phase loops only).
4. `adaptive` and `blueprint` paths that `return executeReactive(input)` verbatim need NO change — the delegate's own mint judges them.
5. Pause/failure exits that use `pausedStrategyResult` or hand-assembled failure results: route through `finalizeStrategyResult` with the same params (it forwards pause rails via `buildStrategyResult`'s existing `kernelMeta`/`pause` handling).

- [ ] **Step 1 (4a): Migrate reactive + direct + adaptive; extend their integration tests**

Add to `strategies/honest-partial.integration.test.ts` (reactive's) — and analogously for each family member:

```ts
it("every result carries a terminal verdict record (cascade mint)", async () => {
  // reuse the file's existing run helper/fixture
  const result = await runScenario(/* existing fixture */);
  expect(result.metadata.verdict).toBeDefined();
  expect(result.metadata.verdict?.enforced).toBe(false);
});
```

- [ ] **Step 2 (4a): Run + commit**

Run: `cd packages/reasoning && bun test tests/ src/ --timeout 15000` → no new failures
```bash
git add packages/reasoning/src/strategies/reactive.ts packages/reasoning/src/strategies/direct.ts packages/reasoning/src/strategies/adaptive.ts packages/reasoning/src/strategies/*honest-partial*
git commit -m "refactor(reasoning): reactive/direct/adaptive mint results via finalizeStrategyResult"
```

- [ ] **Step 3 (4b): Migrate reflexion + tree-of-thought (multi-pass: ONLY the terminal result mints; intermediate pass results are internal and unchanged). Run + commit as 4a.**

- [ ] **Step 4 (4c): Migrate plan-execute + blueprint + code-action with `repairCapabilities: { perIteration: false }` for plan-execute/code-action. Run + commit as 4a.**

---

### Task 5: Flip `StrategyFn` — compile-total judgment; delete the dropped fields

The keystone. After this task a strategy that skips the mint, or re-declares a cross-cutting field, does not compile.

**Files:**
- Modify: `packages/reasoning/src/services/strategy-registry.ts` (StrategyFn return type + delete params)
- Modify: `packages/reasoning/src/services/reasoning-service.ts` (execute params — delete forwarded fields)
- Modify: `packages/reasoning/src/kernel/state/build-kernel-input.ts` (delete `StrategyHitlRails`; shrink `CrossCuttingInput`)
- Modify: all 8 `strategies/*.ts` input interfaces (delete fields)
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` (delete legacy per-field forwards from Task 2 Step 5's "old forwards")
- Modify: `packages/reasoning/src/kernel/capabilities/sense/step-utils.ts` (unexport `buildStrategyResult` from the package surface: remove from `index.ts`; keep module-internal export for `finalize-result.ts`)

**Interfaces:**
- Consumes: Tasks 2-4 complete.
- Produces: `StrategyFn` returns `Effect<JudgedReasoningResult, ExecutionError | IterationLimitError, LLMService | RunEnvelope>`. Strategy inputs no longer declare: `approvalPolicy`, `approvalDecision`, `interactionResponse`, `grounding`, `fabricationGuard`, `stallPolicy`, `taskContract`. `CrossCuttingInput` drops the same seven. **Deletion rule (`feedback_boundary_first_and_wave_hygiene`): before deleting each field, run a sole-caller grep** (`grep -rn "<field>" packages/reasoning/src packages/runtime/src`) and migrate any surviving reader to the envelope.

- [ ] **Step 1: Flip the return type**

```ts
// strategy-registry.ts
import type { JudgedReasoningResult } from "../kernel/capabilities/sense/finalize-result.js";
// ...
}) => Effect.Effect<
  JudgedReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
>;
```

- [ ] **Step 2: Compile — let the compiler enumerate every unmigrated exit**

Run: `bunx tsc --noEmit -p packages/reasoning`
Expected: errors ONLY at strategy return paths still yielding plain `ReasoningResult` (any Task 4 misses). Fix each by routing through the mint. Zero errors ⇒ Task 4 was complete.

- [ ] **Step 3: Delete the seven fields**

Order: strategy input interfaces → `StrategyFn` params → `reasoning-service.ts` execute params → `CrossCuttingInput`/`StrategyHitlRails` → `reasoning-think.ts` legacy forwards. Sole-caller grep before each. Kernel-internal readers (`runner.ts`, `verifier.ts`, `act.ts`) keep reading `KernelInput` fields — those are fed by Task 6's envelope merge, NOT deleted.

`KernelInput` itself KEEPS the fields (the kernel is the consumer); what dies is the strategy-level threading. **Sequencing guard:** the `fe5dc93b` HITL regression tests cover reflexion/ToT/plan-execute — their coverage must not go red between Task 5 and Task 6. So in this task, every strategy that currently threads any of the seven fields into a kernel pass (`reactive.ts` literal; `reflexion.ts`/`tree-of-thought.ts` `CrossCuttingInput` bundles) sources them from the envelope INTERIM (same pattern below, adapted per file); Task 6 deletes these interim reads when `runKernel` merges the envelope itself. Reactive's interim block:

```ts
// reactive.ts — interim until Task 6 (then this block is deleted too):
const envelope = yield* RunEnvelope;
const kernelInput: KernelInput = {
  // ... existing per-pass fields ...
  grounding: envelope.policy.grounding,
  fabricationGuard: envelope.policy.fabricationGuard,
  stallPolicy: envelope.rails.stallPolicy,
  taskContract: envelope.policy.taskContract,
  approvalPolicy: envelope.rails.approvalPolicy,
  approvalDecision: envelope.rails.approvalDecision,
  interactionResponse: envelope.rails.interactionResponse,
};
```

- [ ] **Step 4: Full verification**

Run: `bunx turbo run build --force` then `bunx turbo run typecheck --force` → green
Run: `cd packages/reasoning && bun test --timeout 15000` and `cd packages/runtime && bun test --timeout 15000` → no new failures. HITL tests (the `fe5dc93b` regression family) MUST still pass — they now exercise the envelope path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(reasoning)!: strategies neither carry nor forward cross-cutting fields

StrategyFn now returns the branded JudgedReasoningResult — a strategy exit
that skips the terminal mint is a compile error, and the seven cross-cutting
fields (HITL rails + four withers) are deleted from every strategy input,
StrategyFn, and the execute params. The envelope is the only carrier.
A strategy cannot drop what it never carries."
```

---

### Task 6: `runKernel` merges the envelope (repair parity) + red-on-cut wither tests

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` (where `effectiveInput` is established)
- Modify: `packages/reasoning/src/strategies/reactive.ts` (delete the Task 5 interim envelope block)
- Create: `packages/reasoning/tests/strategies/cross-cutting-cascade.test.ts`

**Interfaces:**
- Consumes: `RunEnvelope` (soft — `Effect.serviceOption`), Tasks 1-5.
- Produces: every `runKernel` call — from ANY strategy, including reflexion/ToT/direct which never threaded these fields — honors the envelope's withers. Explicit `KernelInput` fields win over envelope (precedence pins existing per-pass overrides).

- [ ] **Step 1: Write the failing red-on-cut test**

```ts
// packages/reasoning/tests/strategies/cross-cutting-cascade.test.ts
//
// THE cascade regression net. Each case: run a NON-reactive strategy with a
// wither set via the envelope (test provider, no keys) and pin that behavior
// changes. Before this work, all of these were silently ignored (measured
// 2026-07-22: reactive.ts was the only strategy reading them).
import { describe, it, expect } from "bun:test";
// harness: reuse the Layer scaffolding from tests/strategies/kernel/output-quality-gate.test.ts
// (test provider, deterministic scripted responses).

describe("cross-cutting cascade — withers reach every strategy via RunEnvelope", () => {
  // Strategy sample: direct (never threaded anything), reflexion (partial
  // CrossCuttingInput), plan-execute (own orchestration). reactive is the
  // behavior-preservation control.
  for (const strategy of ["direct", "reflexion", "plan-execute-reflect", "reactive"] as const) {
    it(`${strategy}: stallPolicy from the envelope reaches the kernel loop`, async () => {
      // Arrange a scripted run that stalls (test provider emits N identical
      // thought-only turns). With envelope stallPolicy {maxIgnoredNudges: 1}
      // the run must terminate earlier than the default policy's budget.
      // Assert on iteration count difference between envelope-set and empty-envelope runs.
    });
    it(`${strategy}: result verdict records groundedOnRequired=false on an ungrounded run`, async () => {
      // requiredTools: ["file-read"]; scripted run never calls it; assert
      // result.metadata.verdict.groundedOnRequired === false.
    });
  }
});
```

(Implementer fills the scripted-provider fixtures mirroring `output-quality-gate.test.ts`; the assertions above are the contract. These tests must FAIL if `runKernel`'s envelope merge is commented out — verify by cutting once before finishing.)

- [ ] **Step 2: Run to verify the stall cases fail** (verdict cases pass already via Task 3)

- [ ] **Step 3: Implement the merge in `runner.ts`**

At the point where `effectiveInput` is derived from the caller's `KernelInput`:

```ts
import { Effect, Option } from "effect";
import { RunEnvelope } from "../envelope/run-envelope.js";
// ...
// Cross-cutting cascade (2026-07-22): the envelope is the run-wide source for
// wither config. SOFT read (serviceOption) by design — repair degrades
// gracefully; judgment at the mint is the hard guarantee. Explicit input
// fields win (per-pass overrides stay possible).
const envOpt = yield* Effect.serviceOption(RunEnvelope);
const env = Option.getOrUndefined(envOpt);
const effectiveInput = {
  ...input,
  grounding: input.grounding ?? env?.policy.grounding,
  fabricationGuard: input.fabricationGuard ?? env?.policy.fabricationGuard,
  stallPolicy: input.stallPolicy ?? env?.rails.stallPolicy,
  taskContract: input.taskContract ?? env?.policy.taskContract,
  approvalPolicy: input.approvalPolicy ?? env?.rails.approvalPolicy,
  approvalDecision: input.approvalDecision ?? env?.rails.approvalDecision,
  interactionResponse: input.interactionResponse ?? env?.rails.interactionResponse,
};
```

Then delete reactive.ts's interim block from Task 5 Step 3 (sole-caller grep first).

- [ ] **Step 4: Run the cascade test + red-on-cut check**

Run: `cd packages/reasoning && bun test tests/strategies/cross-cutting-cascade.test.ts --timeout 15000` → PASS.
Cut check: comment out the merge lines in `runner.ts`, re-run → stall cases MUST fail. Restore.

- [ ] **Step 5: Full suites + commit**

```bash
git add packages/reasoning/src/kernel/loop/runner.ts packages/reasoning/src/strategies/reactive.ts packages/reasoning/tests/strategies/cross-cutting-cascade.test.ts
git commit -m "feat(reasoning): runKernel merges RunEnvelope withers — repair reaches every kernel strategy

Soft read by design: repair degrades gracefully, the terminal mint is the
hard guarantee. Red-on-cut pinned: cutting the merge fails the cascade suite."
```

---

### Task 7: Tool seam reads the envelope (approval/policy on non-kernel tool paths)

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts` (`executeToolAndObserve`, line 232; `evaluateToolPolicy` line 213 stays pure)
- Test: extend `packages/reasoning/src/strategies/tool-policy-ledger-boundary.mutation.test.ts`

**Interfaces:**
- Consumes: `RunEnvelope` soft-read.
- Produces: `executeToolAndObserve` consults `envelope.policy.taskContract`'s forbidden tools when the caller passes no explicit policy — closing the gap where a non-kernel tool path (plan-execute `tool_call` leaves, blueprint worker) forgets to thread the deny-list. Explicit `config`/`ctx` policy wins.

- [ ] **Step 1: Write the failing test** — a `tool_call` dispatch through `executeToolAndObserve` with NO explicit policy but an envelope carrying `taskContract: { tools: { forbidden: ["shell-execute"] } }` must be rejected (same rejection shape `evaluateToolPolicy` produces today).
- [ ] **Step 2: Verify it fails** (tool executes today).
- [ ] **Step 3: Implement** — inside `executeToolAndObserve`'s `Effect.gen`, soft-read the envelope; when the caller supplied no policy, derive one from `envelope.policy.taskContract` via the same helper `code-action.ts` uses (`forbiddenToolsFromContract` pattern at `code-action.ts:133`); pass to the existing `evaluateToolPolicy` gate.
- [ ] **Step 4: Red-on-cut** — cut the envelope read, test fails. Restore.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reasoning): tool seam derives policy from the envelope contract when unthreaded"
```

---

### Task 8: Enforcement for opt-in withers at the mint (judgment goes live)

Spec §8: the lift rule does not apply — opt-in guards are a bug fix. No configured wither ⇒ `enforced:false`, zero change.

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/sense/finalize-result.ts`
- Modify: `packages/reasoning/src/kernel/capabilities/sense/finalize-result.test.ts`
- Modify: `packages/reasoning/tests/strategies/cross-cutting-cascade.test.ts` (per-strategy enforcement cases)

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces: with `fabricationGuard: "block"` and a failed grounding verdict, the mint flips `status → "failed"`, replaces `output` with the honest abstention sentinel text (the exact strings pinned in `packages/core/tests/contracts/deliverable.test.ts:142-147` — reuse `deliverableToContent(sentinelDeliverable("no_substantive_output"))`), sets `verdict.enforced = true`, and sets `error` to the failed check list. `"warn"` mode records, never flips. Contract judgment: when `envelope.policy.taskContract` is set, evaluate compiled requirements (`compileRunContract` at `kernel/contract/run-contract.ts:168`) against `params.runLedger` evidence; unmet ⇒ `verdict.contractSatisfied = false` (+ enforcement only under `fabricationGuard: "block"`; the contract wither alone stays informational in this task — flip criteria are the guard's, unchanged from `verifier.ts` semantics).

- [ ] **Step 1: Write failing tests** — four cases in `finalize-result.test.ts`:

```ts
it("block-mode guard + ungrounded run ⇒ status failed, honest sentinel output, enforced:true", async () => {
  const r = await Effect.runPromise(
    provideTestEnvelope(
      finalizeStrategyResult({
        ...baseParams,
        requiredTools: ["file-read"],
        steps: [], // no successful file-read step
      }),
      buildRunEnvelope({ fabricationGuard: "block" }),
    ),
  );
  expect(r.status).toBe("failed");
  expect(r.metadata.verdict?.enforced).toBe(true);
  expect(String(r.output)).toContain("Could not complete the task");
  expect(String(r.output)).not.toBe("Task complete.");
});
it("warn-mode guard + ungrounded run ⇒ status unchanged, verdict records the failure", /* ... */);
it("no wither configured ⇒ enforced:false and result untouched (zero-config invariant)", /* ... */);
it("grounded run + block guard ⇒ untouched", /* ... */);
```

- [ ] **Step 2: Verify they fail** (Task 3's inert mint never flips).
- [ ] **Step 3: Implement enforcement in the mint** (status flip + sentinel output + `enforced:true`, `"block"` only).
- [ ] **Step 4: Per-strategy enforcement cases in the cascade suite** — `direct` and `plan-execute-reflect` with `fabricationGuard:"block"` on a scripted ungrounded run now FAIL the run honestly (these are the two that silently "succeeded" before).
- [ ] **Step 5: Mechanism verification on the live probe (optional, zero API tokens):** `cd packages/benchmarks && timeout 590 bun run src/run.ts --session long-horizon-arm --task ab-trap-5 --provider ollama --model qwen3.5:latest --runs 3 --output /tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/86351379-7521-4fbe-8e23-4dcd339d7bc9/scratchpad/cascade-probe.json` — foreground, per `feedback_bench_foreground_not_bg`. Confirm abstention still fires (mechanism check, NOT a lift claim).
- [ ] **Step 6: Full suites + commit**

```bash
git commit -m "feat(reasoning): terminal judgment enforces opt-in withers at the mint

fabricationGuard block-mode now flips ungrounded runs to an honest failure on
ALL 8 strategies. Opt-in ⇒ bug fix, not a default-on change: no lift gate
required (spec §8). Zero-config runs are byte-identical."
```

---

### Task 9: Boundary 3 — typed metadata extension slot

**Files:**
- Modify: `packages/core/src/types/result.ts` (`ResultMetadataSchema`)
- Modify: `packages/reasoning/src/types/reasoning.ts` (`ReasoningMetadataSchema`)
- Modify: `packages/runtime/src/execution-engine.ts` (~line 1295-1335 literal)
- Test: `packages/runtime/tests/` — new `metadata-extension-slot.test.ts` beside the existing engine tests

**Interfaces:**
- Produces: `ResultMetadataSchema` + `ReasoningMetadataSchema` each gain
  `extensions: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))` —
  a NAMESPACED, typed pass-through slot. The engine literal forwards `rr.metadata.extensions`
  verbatim into `metadata.extensions`. Existing top-level internal forwards
  (`reasoningSteps`, `receiptToolCalls`, `runLedger`, `verdict`) stay enumerated —
  they are consumed by name; the slot is for FUTURE fields, which now arrive with
  no engine edit and no top-level leak.

- [ ] **Step 1: Failing test** — a strategy result carrying `metadata.extensions: { myNewSignal: 42 }` must surface `taskResult.metadata.extensions.myNewSignal === 42` through `ExecutionEngine` with no engine change beyond this task's; and a top-level unknown key on `rr.metadata` must NOT leak.
- [ ] **Step 2: Verify fails.**
- [ ] **Step 3: Implement** — add the schema field in both packages; in the engine literal add exactly one forward:

```ts
// Cross-cutting cascade Task 9: the typed extension slot. Future
// strategy-contributed fields ride here — no more per-field enumeration
// (DEBT-REGISTER §3 row closed). Top-level keys still never pass untyped.
...(rr?.metadata?.extensions !== undefined ? { extensions: rr.metadata.extensions } : {}),
```

Also add `verdict` to the enumerated forwards (it must reach `TaskResult` for receipts):

```ts
...(rr?.metadata?.verdict !== undefined ? { verdict: rr.metadata.verdict } : {}),
```

(with matching optional `verdict` field added to `ResultMetadataSchema`, typed identically to Task 3's).

- [ ] **Step 4: Pass + full runtime suite + commit**

```bash
git commit -m "feat(core,runtime): typed metadata extension slot — DEBT-REGISTER §3 row closed

New strategy-contributed metadata rides a namespaced, schema-typed slot and
reaches TaskResult with no engine literal edit; internal top-level keys still
cannot leak. Neither allow-list (silent loss) nor deny-list (silent leak)."
```

---

### Task 10: The gate script, CI wiring, docs + register + memory sync

**Files:**
- Create: `scripts/check-cross-cutting.sh`
- Modify: wherever `scripts/check-ledger-writes.sh` is wired (same job/step — locate with `grep -rn "check-ledger-writes" package.json .github/ scripts/`) — add the new script beside it
- Modify: `wiki/Architecture/DEBT-REGISTER.md` (close the §3 metadata row; add outcome line for the wither-drop defect)
- Modify: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` §7 status board (one line: cascade shipped, C3 terminal judgment live)
- Modify: `.agents/MEMORY.md` + Claude memory (`feedback_agents_memory_sync`)

**Interfaces:** none — enforcement + record.

- [ ] **Step 1: Write the gate script**

```bash
#!/usr/bin/env bash
# scripts/check-cross-cutting.sh — the cascade's grep gate (design spec §4.4).
# A strategy that re-declares an envelope field, a raw KernelInput literal
# outside the assembly module, or a second envelope provision site fails CI.
set -euo pipefail
cd "$(dirname "$0")/.."
FAIL=0

# 1. Strategy input interfaces must not re-declare envelope fields.
DECLS=$(grep -rnE "readonly (approvalPolicy|approvalDecision|interactionResponse|fabricationGuard|stallPolicy|grounding|taskContract)\??:" \
  packages/reasoning/src/strategies --include='*.ts' \
  | grep -v '\.test\.ts' || true)
if [ -n "$DECLS" ]; then
  echo "FAIL: strategy files re-declare cross-cutting fields (the envelope is the only carrier):"
  echo "$DECLS"; FAIL=1
fi

# 2. No raw KernelInput literals outside the canonical assembly + reference strategies.
LITERALS=$(grep -rnE "const [a-zA-Z]+: KernelInput = \{" \
  packages/reasoning/src --include='*.ts' \
  | grep -v '\.test\.ts' \
  | grep -v 'kernel/state/build-kernel-input.ts' \
  | grep -v 'strategies/reactive.ts' \
  | grep -v 'strategies/direct.ts' || true)
if [ -n "$LITERALS" ]; then
  echo "FAIL: raw KernelInput literal outside the sanctioned sites:"
  echo "$LITERALS"; FAIL=1
fi

# 3. Exactly one production provision site for RunEnvelope.
PROVIDES=$(grep -rn "provideService(.*RunEnvelope\|RunEnvelope.of(" \
  packages --include='*.ts' \
  | grep -v '\.test\.ts' | grep -v '__tests__' | grep -v 'tests/' \
  | grep -v 'kernel/envelope/run-envelope.ts' \
  | grep -v 'services/reasoning-service.ts' || true)
if [ -n "$PROVIDES" ]; then
  echo "FAIL: RunEnvelope provided outside the single sanctioned production site:"
  echo "$PROVIDES"; FAIL=1
fi

exit $FAIL
```

- [ ] **Step 2: Prove the gate red-on-cut** — temporarily re-add `readonly fabricationGuard?: FabricationGuardMode;` to `strategies/direct.ts`, run the script, expect non-zero exit + message. Revert.
- [ ] **Step 3: Wire beside `check-ledger-writes.sh`** in the same CI/package.json step (the wire-and-verify rule: something must RUN the script — cutting the wiring must fail a check, so add the script to the same gate job and confirm the job lists it).
- [ ] **Step 4: Docs + register + memory sync** — DEBT-REGISTER: close §3 metadata row with commit hash; 09 §7: one status line; `.agents/MEMORY.md` + Claude project memory: one entry — defect class, fix shape (branded mint + envelope), gate name.
- [ ] **Step 5: Final full verification**

Run: `bunx turbo run build --force && bunx turbo run typecheck --force` → green
Run: `bun test --timeout 15000` at repo root (or per-package for the three touched packages) → suite green
Run: `bash scripts/check-cross-cutting.sh && bash scripts/check-ledger-writes.sh` → both exit 0

- [ ] **Step 6: Commit**

```bash
git add scripts/check-cross-cutting.sh wiki/ .agents/MEMORY.md <ci-wiring-file>
git commit -m "chore(gates): check-cross-cutting.sh wired into CI + register/docs sync

No fix is done without a gate (09 §6). The script fails on: a strategy
re-declaring an envelope field, a raw KernelInput literal outside sanctioned
sites, or a second RunEnvelope provision site. Proven red-on-cut before wiring."
```

---

## Success criteria (from the spec, verbatim mapping)

| Spec §10 criterion | Where proven |
|---|---|
| 1. New concern = envelope + one seam, zero strategy files | Tasks 6-7 land wither cascade with strategy edits limited to field DELETION + mint adoption |
| 2. Four withers change behavior on all 8 strategies (or declared gap) | Task 6 (kernel), Task 8 (enforcement), declared gaps via `repairCapabilities` (Tasks 3-4) |
| 3. Result outside the mint = compile error | Task 3 witness test + Task 5 flip |
| 4. Gate in CI, red-on-cut proven | Task 10 |
| 5. Typed metadata slot; no loss, no leak | Task 9 |
| 6. build+typecheck+suite green | every task's verify step; final sweep Task 10 Step 5 |
