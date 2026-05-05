# Reactive Intelligence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Reactive Controller (Phase 2), Local Learning Engine (Phase 3), and Telemetry Client (Phase 4) — turning the existing entropy sensor into an autonomous context tuning system that adapts in real-time, learns across runs, and contributes anonymous signal data to a cloud intelligence platform.

**Architecture:** The entropy sensor (Phase 1, shipped) scores each kernel iteration. The controller (Phase 2) acts on those scores — early-stopping, compressing context, or switching strategies. The learning engine (Phase 3) accumulates calibration data and synthesizes reusable skills. The telemetry client (Phase 4) sends anonymized run reports to `api.reactiveagents.dev`.

**Tech Stack:** Effect-TS services (Context.Tag + Layer.effect), bun:sqlite for calibration/bandit persistence, HMAC-SHA256 for telemetry signing. All code in `packages/reactive-intelligence/` with integration hooks in `packages/reasoning/` and `packages/runtime/`.

**Spec:** `docs/superpowers/specs/2026-03-14-reactive-intelligence-full-pipeline.md`

**Existing code:** Phase 1 Entropy Sensor is fully shipped — 5 sources, composite scorer, trajectory analysis, calibration store, model registry, EventBus integration, 60 tests. Controller and learning directories do not exist yet.

---

## File Structure

### New Files

```
packages/reactive-intelligence/src/
  controller/
    controller-service.ts        — ReactiveControllerService (Context.Tag + Layer.effect)
    early-stop.ts                — evaluateEarlyStop() — converging trajectory → signal kernel
    context-compressor.ts        — evaluateCompression() — high context pressure → compress sections
    strategy-switch.ts           — evaluateStrategySwitch() — flat trajectory → trigger switch
  learning/
    learning-engine.ts           — LearningEngineService (Context.Tag + Layer.effect)
    bandit-store.ts              — BanditStore — SQLite persistence for Beta(α,β) per arm/bucket
    bandit.ts                    — ThompsonSampling bandit — select/update prompt variants
    skill-synthesis.ts           — synthesizeSkill() — extract recipe from high-signal run
    task-classifier.ts           — classifyTaskCategory() — keyword heuristic, no LLM
  telemetry/
    telemetry-client.ts          — TelemetryClient — build RunReport, sign, POST
    install-id.ts                — getOrCreateInstallId() — ~/.reactive-agents/install-id
    signing.ts                   — signPayload() — HMAC-SHA256
    types.ts                     — RunReport, SkillFragment types

packages/reactive-intelligence/tests/
  controller/
    early-stop.test.ts
    context-compressor.test.ts
    strategy-switch.test.ts
    controller-service.test.ts
  learning/
    bandit.test.ts
    bandit-store.test.ts
    skill-synthesis.test.ts
    task-classifier.test.ts
    learning-engine.test.ts
  telemetry/
    telemetry-client.test.ts
    install-id.test.ts
    signing.test.ts
```

### Modified Files

```
packages/reactive-intelligence/src/types.ts          — add ReactiveControllerConfig, ReactiveDecision, RunReport types
packages/reactive-intelligence/src/events.ts          — add ReactiveDecision event payload
packages/reactive-intelligence/src/runtime.ts         — compose controller + learning + telemetry layers
packages/reactive-intelligence/src/index.ts           — export new services

packages/reasoning/src/strategies/shared/service-utils.ts  — add reactiveController to StrategyServices
packages/reasoning/src/strategies/shared/kernel-runner.ts  — add controller evaluation after entropy scoring

packages/runtime/src/builder.ts                       — update withReactiveIntelligence config (telemetry default true)
packages/runtime/src/execution-engine.ts              — wire learning engine post-run + telemetry on AgentCompleted
```

---

## Chunk 1: Reactive Controller (Phase 2)

### Task 1: Controller Types + Service Shell

**Files:**
- Modify: `packages/reactive-intelligence/src/types.ts`
- Create: `packages/reactive-intelligence/src/controller/controller-service.ts`
- Test: `packages/reactive-intelligence/tests/controller/controller-service.test.ts`

- [ ] **Step 1: Add ReactiveDecision type and ReactiveControllerConfig to types.ts**

Add after the existing `ReactiveIntelligenceConfig` type:

```typescript
export type ReactiveDecision =
  | { readonly decision: "early-stop"; readonly reason: string; readonly iterationsSaved: number }
  | { readonly decision: "compress"; readonly sections: readonly string[]; readonly estimatedSavings: number }
  | { readonly decision: "switch-strategy"; readonly from: string; readonly to: string; readonly reason: string };

export type ReactiveControllerConfig = {
  readonly earlyStop: boolean;
  readonly contextCompression: boolean;
  readonly strategySwitch: boolean;
  /** Number of consecutive converging iterations required before early-stop fires */
  readonly earlyStopConvergenceCount?: number;
  /** Number of consecutive flat iterations before strategy switch fires */
  readonly flatIterationsBeforeSwitch?: number;
  /** Context utilization threshold (0-1) above which compression triggers */
  readonly compressionThreshold?: number;
};
```

- [ ] **Step 2: Write failing test for ReactiveControllerService**

```typescript
// controller-service.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveControllerService } from "../src/controller/controller-service.js";

describe("ReactiveControllerService", () => {
  it("should return empty decisions when no triggers are met", async () => {
    const program = Effect.gen(function* () {
      const controller = yield* ReactiveControllerService;
      const decisions = yield* controller.evaluate({
        entropyHistory: [{ composite: 0.5, trajectory: { shape: "flat", derivative: 0, momentum: 0.5 } }],
        iteration: 1,
        maxIterations: 10,
        strategy: "reactive",
        calibration: { highEntropyThreshold: 0.8, convergenceThreshold: 0.3, calibrated: false, sampleCount: 0 },
        config: { earlyStop: true, contextCompression: true, strategySwitch: true },
        contextPressure: 0.3,
        behavioralLoopScore: 0,
      });
      expect(decisions).toEqual([]);
    });
    // Will fail until service is implemented
    await Effect.runPromise(program.pipe(Effect.provide(Layer.empty)));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/reactive-intelligence/tests/controller/controller-service.test.ts`
Expected: FAIL — service not found

- [ ] **Step 4: Implement ReactiveControllerService shell**

```typescript
// controller/controller-service.ts
import { Context, Effect, Layer } from "effect";
import type { ReactiveDecision, ReactiveControllerConfig, ModelCalibration } from "../types.js";

type ControllerEvalParams = {
  readonly entropyHistory: readonly { composite: number; trajectory: { shape: string; derivative: number; momentum: number } }[];
  readonly iteration: number;
  readonly maxIterations: number;
  readonly strategy: string;
  readonly calibration: { highEntropyThreshold: number; convergenceThreshold: number; calibrated: boolean; sampleCount: number };
  readonly config: ReactiveControllerConfig;
  readonly contextPressure: number;
  readonly behavioralLoopScore: number;
};

export class ReactiveControllerService extends Context.Tag("ReactiveControllerService")<
  ReactiveControllerService,
  {
    readonly evaluate: (params: ControllerEvalParams) => Effect.Effect<readonly ReactiveDecision[], never>;
  }
>() {}

export const ReactiveControllerServiceLive = (config: ReactiveControllerConfig): Layer.Layer<ReactiveControllerService> =>
  Layer.succeed(ReactiveControllerService, {
    evaluate: (params) => Effect.sync(() => {
      const decisions: ReactiveDecision[] = [];
      // Delegate to individual evaluators (Task 2, 3, 4)
      return decisions;
    }),
  });
```

- [ ] **Step 5: Update test with proper layer, run to verify it passes**

Run: `bun test packages/reactive-intelligence/tests/controller/controller-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/controller/ packages/reactive-intelligence/src/types.ts packages/reactive-intelligence/tests/controller/
git commit -m "feat(reactive-intelligence): add ReactiveControllerService shell + types"
```

---

### Task 2: Early-Stop Evaluator (2A)

**Files:**
- Create: `packages/reactive-intelligence/src/controller/early-stop.ts`
- Test: `packages/reactive-intelligence/tests/controller/early-stop.test.ts`
- Modify: `packages/reactive-intelligence/src/controller/controller-service.ts`

- [ ] **Step 1: Write failing tests for evaluateEarlyStop**

```typescript
// early-stop.test.ts
import { describe, it, expect } from "bun:test";
import { evaluateEarlyStop } from "../src/controller/early-stop.js";

describe("evaluateEarlyStop", () => {
  it("should NOT fire when trajectory is not converging", () => {
    const result = evaluateEarlyStop({
      entropyHistory: [
        { composite: 0.6, trajectory: { shape: "flat", derivative: 0, momentum: 0.6 } },
        { composite: 0.6, trajectory: { shape: "flat", derivative: 0, momentum: 0.6 } },
      ],
      convergenceThreshold: 0.3,
      convergenceCount: 2,
      iteration: 3,
      maxIterations: 10,
    });
    expect(result).toBeNull();
  });

  it("should fire when converging for convergenceCount consecutive iterations", () => {
    const result = evaluateEarlyStop({
      entropyHistory: [
        { composite: 0.5, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.5 } },
        { composite: 0.4, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.45 } },
        { composite: 0.3, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.38 } },
      ],
      convergenceThreshold: 0.3,
      convergenceCount: 2,
      iteration: 4,
      maxIterations: 10,
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("early-stop");
    expect(result!.iterationsSaved).toBe(6); // 10 - 4
  });

  it("should NOT fire on first iteration (too early)", () => {
    const result = evaluateEarlyStop({
      entropyHistory: [
        { composite: 0.2, trajectory: { shape: "converging", derivative: -0.2, momentum: 0.2 } },
      ],
      convergenceThreshold: 0.3,
      convergenceCount: 2,
      iteration: 1,
      maxIterations: 10,
    });
    expect(result).toBeNull();
  });

  it("should NOT fire when below minimum iteration threshold (iteration < 2)", () => {
    const result = evaluateEarlyStop({
      entropyHistory: [
        { composite: 0.3, trajectory: { shape: "converging", derivative: -0.15, momentum: 0.3 } },
        { composite: 0.2, trajectory: { shape: "converging", derivative: -0.1, momentum: 0.25 } },
      ],
      convergenceThreshold: 0.3,
      convergenceCount: 2,
      iteration: 1,
      maxIterations: 10,
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/reactive-intelligence/tests/controller/early-stop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement evaluateEarlyStop**

```typescript
// controller/early-stop.ts
import type { ReactiveDecision } from "../types.js";

type EarlyStopParams = {
  readonly entropyHistory: readonly { composite: number; trajectory: { shape: string; derivative: number; momentum: number } }[];
  readonly convergenceThreshold: number;
  readonly convergenceCount: number;
  readonly iteration: number;
  readonly maxIterations: number;
};

/**
 * Evaluate whether the agent should early-stop based on entropy trajectory.
 * Fires when the trajectory has been "converging" for convergenceCount consecutive
 * iterations and the latest composite is at or below the convergence threshold.
 * Returns null if no early-stop should occur.
 */
export function evaluateEarlyStop(params: EarlyStopParams): (ReactiveDecision & { decision: "early-stop" }) | null {
  const { entropyHistory, convergenceThreshold, convergenceCount, iteration, maxIterations } = params;

  // Need at least convergenceCount entries and must be past iteration 1
  if (entropyHistory.length < convergenceCount || iteration < 2) return null;

  // Check last N entries are all converging
  const recent = entropyHistory.slice(-convergenceCount);
  const allConverging = recent.every((e) => e.trajectory.shape === "converging");
  if (!allConverging) return null;

  // Check latest composite is at or below threshold
  const latest = entropyHistory[entropyHistory.length - 1]!;
  if (latest.composite > convergenceThreshold) return null;

  return {
    decision: "early-stop",
    reason: `Entropy converging for ${convergenceCount} iterations (composite: ${latest.composite.toFixed(3)}, threshold: ${convergenceThreshold})`,
    iterationsSaved: maxIterations - iteration,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/reactive-intelligence/tests/controller/early-stop.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Wire into ReactiveControllerService.evaluate()**

In `controller-service.ts`, import and call `evaluateEarlyStop` inside the `evaluate` method when `config.earlyStop` is true.

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/controller/early-stop.ts packages/reactive-intelligence/tests/controller/
git commit -m "feat(reactive-intelligence): implement early-stop controller (2A)"
```

---

### Task 3: Strategy Switch Evaluator (2D)

**Files:**
- Create: `packages/reactive-intelligence/src/controller/strategy-switch.ts`
- Test: `packages/reactive-intelligence/tests/controller/strategy-switch.test.ts`
- Modify: `packages/reactive-intelligence/src/controller/controller-service.ts`

- [ ] **Step 1: Write failing tests for evaluateStrategySwitch**

Tests should cover:
- Returns null when trajectory is not flat
- Returns null when loop score is below 0.7
- Returns null when fewer than 3 consecutive flat iterations
- Fires switch-strategy when flat for 3+ iterations AND loop score > 0.7
- Includes current strategy name in the `from` field

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/reactive-intelligence/tests/controller/strategy-switch.test.ts`

- [ ] **Step 3: Implement evaluateStrategySwitch**

Pure function: check last N entries for "flat" shape, check behavioral loop score > 0.7, return `ReactiveDecision` with `decision: "switch-strategy"` or null.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Wire into controller-service.ts when config.strategySwitch is true**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(reactive-intelligence): implement entropy-informed strategy switch (2D)"
```

---

### Task 4: Context Compression Evaluator (2C)

**Files:**
- Create: `packages/reactive-intelligence/src/controller/context-compressor.ts`
- Test: `packages/reactive-intelligence/tests/controller/context-compressor.test.ts`
- Modify: `packages/reactive-intelligence/src/controller/controller-service.ts`

- [ ] **Step 1: Write failing tests for evaluateCompression**

Tests should cover:
- Returns null when context pressure is below threshold (default 0.80)
- Fires compress when pressure > 0.80
- Lists sections to compress (oldest tool results first)
- Estimates token savings from compression
- Never marks "task" or "system-prompt" sections for compression

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement evaluateCompression**

Pure function: check `contextPressure > compressionThreshold`, identify low-signal sections by age (older tool results first), estimate savings (50% of old tool result tokens), return `ReactiveDecision` with `decision: "compress"` or null.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Wire into controller-service.ts when config.contextCompression is true**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(reactive-intelligence): implement context compression evaluator (2C)"
```

---

### Task 5: Wire Controller into Kernel Runner

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/service-utils.ts`
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts`
- Modify: `packages/reactive-intelligence/src/runtime.ts`
- Modify: `packages/reactive-intelligence/src/index.ts`
- Test: `packages/reactive-intelligence/tests/controller/controller-integration.test.ts`

- [ ] **Step 1: Add ReactiveControllerService to StrategyServices**

In `service-utils.ts`, add `reactiveController` as an optional service alongside `entropySensor`:

```typescript
reactiveController: MaybeService<ReactiveControllerInstance>;
```

Resolve via `Effect.serviceOption(ReactiveControllerService)` in `resolveStrategyServices`.

- [ ] **Step 2: Add controller evaluation in kernel-runner.ts**

After entropy scoring (line ~195), before the early-exit and loop detection sections, add:

```typescript
// ── Reactive Controller evaluation ──
if (services.reactiveController._tag === "Some" && entropyHistory.length > 0) {
  const decisions = yield* services.reactiveController.value.evaluate({
    entropyHistory,
    iteration: state.iteration,
    maxIterations: currentOptions.maxIterations,
    strategy: state.strategy,
    calibration: /* from entropy sensor */,
    config: /* from state.meta */,
    contextPressure: latestScore.sources.contextPressure,
    behavioralLoopScore: latestScore.sources.behavioral,
  });
  for (const decision of decisions) {
    // Publish ReactiveDecision event
    if (eventBus._tag === "Some") {
      yield* eventBus.value.publish({ _tag: "ReactiveDecision", taskId: state.taskId, iteration: state.iteration, ...decision });
    }
    // Execute decisions
    if (decision.decision === "early-stop") {
      (state.meta as any).earlyStopSignaled = true;
    }
    if (decision.decision === "switch-strategy") {
      // Trigger existing strategy switching mechanism
      loopMsg = `Entropy controller: ${decision.reason}`;
    }
  }
}
```

- [ ] **Step 3: Handle earlyStopSignaled in react-kernel.ts**

In the thought prompt construction section of `react-kernel.ts`, check `state.meta.earlyStopSignaled`. If true, append: `"\n\nYou have enough information to answer. Produce your FINAL ANSWER now — do not take another action."` to the thought prompt.

- [ ] **Step 4: Wire controller layer in runtime.ts**

In `createReactiveIntelligenceLayer()`, compose `ReactiveControllerServiceLive` when controller config is present.

- [ ] **Step 5: Export from index.ts**

- [ ] **Step 6: Write integration test verifying controller fires early-stop**

Create a test with a mock entropy history showing convergence, verify the controller produces an early-stop decision and the kernel state gets `earlyStopSignaled = true`.

- [ ] **Step 7: Run full test suite**

Run: `bun test`
Expected: All existing 2091 tests pass + new controller tests pass

- [ ] **Step 8: Build**

Run: `bun run build`
Expected: Clean build, no errors

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(reasoning): wire ReactiveController into kernel runner — early-stop, strategy switch, compression"
```

---

## Chunk 2: Local Learning Engine (Phase 3)

### Task 6: Task Classifier (Heuristic)

**Files:**
- Create: `packages/reactive-intelligence/src/learning/task-classifier.ts`
- Test: `packages/reactive-intelligence/tests/learning/task-classifier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("classifyTaskCategory", () => {
  it("should classify code-related tasks", () => {
    expect(classifyTaskCategory("Write a Python function that sorts a list")).toBe("code-generation");
    expect(classifyTaskCategory("Fix the bug in authentication")).toBe("code-generation");
  });
  it("should classify research tasks", () => {
    expect(classifyTaskCategory("Find information about climate change")).toBe("research");
    expect(classifyTaskCategory("Search for the latest AI papers")).toBe("research");
  });
  it("should classify data analysis tasks", () => {
    expect(classifyTaskCategory("Analyze the sales data and find trends")).toBe("data-analysis");
  });
  it("should classify communication tasks", () => {
    expect(classifyTaskCategory("Send a message to the team about the update")).toBe("communication");
    expect(classifyTaskCategory("Send a Signal message with the summary")).toBe("communication");
  });
  it("should classify multi-tool tasks", () => {
    expect(classifyTaskCategory("Fetch commits, summarize, and send a message")).toBe("multi-tool");
  });
  it("should default to general for ambiguous tasks", () => {
    expect(classifyTaskCategory("Hello")).toBe("general");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement classifyTaskCategory**

Pure keyword-matching function. Check for code keywords, research keywords, data keywords, communication keywords. Count multi-action verbs for "multi-tool". Default to "general".

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reactive-intelligence): add task category classifier (keyword heuristic)"
```

---

### Task 7: Bandit Store + Thompson Sampling

**Files:**
- Create: `packages/reactive-intelligence/src/learning/bandit-store.ts`
- Create: `packages/reactive-intelligence/src/learning/bandit.ts`
- Test: `packages/reactive-intelligence/tests/learning/bandit-store.test.ts`
- Test: `packages/reactive-intelligence/tests/learning/bandit.test.ts`

- [ ] **Step 1: Write failing tests for BanditStore**

Test SQLite CRUD: save arm stats, load arm stats, list arms for a context bucket.

- [ ] **Step 2: Implement BanditStore**

SQLite table: `bandit_arms(context_bucket TEXT, arm_id TEXT, alpha REAL, beta REAL, pulls INTEGER, updated_at TEXT, PRIMARY KEY(context_bucket, arm_id))`.

- [ ] **Step 3: Run tests to verify they pass**

- [ ] **Step 4: Write failing tests for Thompson Sampling bandit**

Tests: cold start returns uniform random, after 5 pulls returns Thompson-sampled arm, update() increments alpha on reward > 0.5 and beta otherwise.

- [ ] **Step 5: Implement bandit.ts**

`selectArm(bucket, arms, store)` — if pulls < 5 for all arms, uniform random. Otherwise, sample Beta(α, β) per arm, return highest.
`updateArm(bucket, armId, reward, store)` — increment α if reward > 0.5, else increment β.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(reactive-intelligence): implement Thompson Sampling bandit + SQLite store"
```

---

### Task 8: Skill Synthesis + Learning Engine Service

**Files:**
- Create: `packages/reactive-intelligence/src/learning/skill-synthesis.ts`
- Create: `packages/reactive-intelligence/src/learning/learning-engine.ts`
- Test: `packages/reactive-intelligence/tests/learning/skill-synthesis.test.ts`
- Test: `packages/reactive-intelligence/tests/learning/learning-engine.test.ts`

- [ ] **Step 1: Write failing tests for shouldSynthesizeSkill**

Tests: returns true when trajectory converging + outcome success + mean entropy below threshold. Returns false when any condition fails.

- [ ] **Step 2: Implement shouldSynthesizeSkill + extractSkillFragment**

`shouldSynthesizeSkill(entropyHistory, outcome, calibration)` — pure predicate.
`extractSkillFragment(config, entropyHistory)` — extracts the SkillFragment struct from runtime config.

- [ ] **Step 3: Run tests to verify they pass**

- [ ] **Step 4: Write failing test for LearningEngineService**

Test: after a successful run with converging entropy, the service calls calibration update and skill synthesis.

- [ ] **Step 5: Implement LearningEngineService**

Effect-TS service with `onRunCompleted(runData)` method. Internally: update calibration, update bandit arm with reward, check shouldSynthesizeSkill, extract skill fragment if yes.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Wire into runtime.ts and execution-engine.ts**

The learning engine fires on `AgentCompleted` event. In `execution-engine.ts`, after debrief synthesis, call `learningEngine.onRunCompleted()` if the service is available.

- [ ] **Step 8: Run full test suite + build**

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(reactive-intelligence): implement Learning Engine — calibration, bandit, skill synthesis"
```

---

## Chunk 3: Telemetry Client (Phase 4)

### Task 9: Install ID + Signing

**Files:**
- Create: `packages/reactive-intelligence/src/telemetry/install-id.ts`
- Create: `packages/reactive-intelligence/src/telemetry/signing.ts`
- Test: `packages/reactive-intelligence/tests/telemetry/install-id.test.ts`
- Test: `packages/reactive-intelligence/tests/telemetry/signing.test.ts`

- [ ] **Step 1: Write failing tests for getOrCreateInstallId**

Tests: creates file on first call, returns same ID on subsequent calls, creates directory if missing.

- [ ] **Step 2: Implement getOrCreateInstallId**

Read `~/.reactive-agents/install-id`. If exists, return contents. If not, generate UUIDv4, create directory + file, return it. All sync (fs operations).

- [ ] **Step 3: Run tests to verify they pass**

- [ ] **Step 4: Write failing tests for signPayload**

Tests: produces consistent HMAC for same input, produces different HMAC for different input, output is hex string.

- [ ] **Step 5: Implement signPayload**

```typescript
import { createHmac } from "crypto";
const SIGNING_KEY = "reactive-agents-v0.8.0"; // embedded, rotates with major versions
export function signPayload(body: string): string {
  return createHmac("sha256", SIGNING_KEY).update(body).digest("hex");
}
```

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(reactive-intelligence): add install-id generation + HMAC signing for telemetry"
```

---

### Task 10: Telemetry Client + RunReport Builder

**Files:**
- Create: `packages/reactive-intelligence/src/telemetry/types.ts`
- Create: `packages/reactive-intelligence/src/telemetry/telemetry-client.ts`
- Test: `packages/reactive-intelligence/tests/telemetry/telemetry-client.test.ts`
- Modify: `packages/reactive-intelligence/src/runtime.ts`
- Modify: `packages/reactive-intelligence/src/index.ts`
- Modify: `packages/runtime/src/execution-engine.ts`
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 1: Define RunReport and SkillFragment types in telemetry/types.ts**

Exact types from spec — all fields `readonly`.

- [ ] **Step 2: Write failing tests for buildRunReport**

Tests: builds correct RunReport from execution context data, attaches skill fragment only for high-signal runs, omits skill fragment for failed runs.

- [ ] **Step 3: Implement buildRunReport**

Pure function that takes execution context fields and returns a RunReport.

- [ ] **Step 4: Write failing tests for TelemetryClient.send()**

Tests: calls fetch with correct URL, headers (X-RA-Client-Version, X-RA-Client-Signature), body. Does not throw when fetch fails (fire-and-forget). Prints console notice on first call.

- [ ] **Step 5: Implement TelemetryClient**

```typescript
export class TelemetryClient {
  private noticePrinted = false;
  constructor(private endpoint: string) {}

  async send(report: RunReport): Promise<void> {
    if (!this.noticePrinted) {
      console.log("ℹ Reactive Intelligence telemetry enabled — anonymous entropy data helps improve the framework. Disable with { telemetry: false }");
      this.noticePrinted = true;
    }
    const body = JSON.stringify(report);
    const signature = signPayload(body);
    try {
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RA-Client-Version": VERSION,
          "X-RA-Client-Signature": signature,
        },
        body,
      }).catch(() => {}); // fire-and-forget, never block agent
    } catch { /* silent */ }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Wire into execution-engine.ts**

On `AgentCompleted` event, if reactive intelligence is enabled and `telemetry !== false`:
1. Build RunReport from execution context + entropy history + tool call log
2. Call `telemetryClient.send(report)` (non-blocking, no await)

- [ ] **Step 8: Update builder.ts**

Set `telemetry: true` as the default in `withReactiveIntelligence()` when no explicit value given. Set default endpoint to `https://api.reactiveagents.dev/v1/reports`.

- [ ] **Step 9: Export from runtime.ts and index.ts**

- [ ] **Step 10: Run full test suite + build**

Run: `bun test && bun run build`
Expected: All tests pass, clean build

- [ ] **Step 11: Commit**

```bash
git commit -m "feat(reactive-intelligence): implement telemetry client — RunReport, HMAC signing, fire-and-forget POST"
```

---

## Chunk 4: Integration + Validation

### Task 11: End-to-End Integration Test

**Files:**
- Create: `packages/reactive-intelligence/tests/integration/full-pipeline.test.ts`

- [ ] **Step 1: Write integration test**

Test with mock LLM that simulates a converging run:
1. Agent starts with `.withReactiveIntelligence({ controller: { earlyStop: true }, telemetry: false })`
2. Mock LLM produces 3 iterations of converging entropy
3. Verify: early-stop fires, ReactiveDecision event published, agent terminates early
4. Verify: calibration updated, learning engine records run data

- [ ] **Step 2: Run integration test**

- [ ] **Step 3: Write integration test for non-converging run**

Test that controller does NOT fire early-stop when entropy is flat, and does fire strategy-switch after 3 flat iterations with high loop score.

- [ ] **Step 4: Run full test suite + build**

Run: `bun test && bun run build`

- [ ] **Step 5: Commit**

```bash
git commit -m "test(reactive-intelligence): add full pipeline integration tests"
```

---

### Task 12: Documentation Updates

**Files:**
- Modify: `CLAUDE.md` — update project status, test counts, feature descriptions
- Modify: `FRAMEWORK_INDEX.md` — add controller + learning + telemetry to system map
- Modify: `.agents/skills/architecture-reference/SKILL.md` — add reactive controller to kernel architecture

- [ ] **Step 1: Update CLAUDE.md**

Add Reactive Intelligence Phase 2-4 to project status. Update test count.

- [ ] **Step 2: Update FRAMEWORK_INDEX.md**

Add controller, learning engine, and telemetry client to the Entropy Sensor System diagram. Add new files to the reactive-intelligence file listing.

- [ ] **Step 3: Update architecture-reference skill**

Add ReactiveControllerService to the kernel architecture section.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: update CLAUDE.md, FRAMEWORK_INDEX.md, architecture skill for Phases 2-4"
```

---

## Summary

| Chunk | Tasks | New Files | Tests |
|-------|-------|-----------|-------|
| 1: Reactive Controller | 1-5 | 4 source + 4 test | ~20 |
| 2: Learning Engine | 6-8 | 5 source + 5 test | ~25 |
| 3: Telemetry Client | 9-10 | 4 source + 3 test | ~15 |
| 4: Integration | 11-12 | 1 test + 3 doc updates | ~5 |
| **Total** | 12 tasks | 13 source + 13 test | **~65 new tests** |

**Estimated test count after completion:** 2,091 + ~65 = ~2,156 tests
