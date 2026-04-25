# North Star Test Gate — Design Spec

> **Status:** DRAFT. Awaiting user sign-off on schema, tolerance policy, scenario list, and tier-2 runner choice before any implementation work begins.
>
> **Author:** 2026-04-24 session. Advisor-reviewed.
>
> **Why this doc exists:** every wiring gap closed in the last session (G-1 silent `num_ctx`, G-3 dead semantic memory path, W13 convergence-only early-stop) surfaced against **real LLMs**, not against `withTestScenario` mocks. A test gate built entirely on mocks would mark them all green. The framework needs a **two-tier** baseline gate so regressions are caught both at the wiring layer (cheap, every PR) and the behavioral layer (real LLM, pre-release).

---

## 1. Problem statement

The repo today has 4,439 deterministic tests (unit + scattered integration) and a richer **but ungated** harness probe suite (`failure-corpus.ts`, `harness-probe.ts`). Neither produces a comparable artifact across releases. There is no answer to "are we getting better or worse since v0.10?"

This doc designs the answer: **three baseline JSON artifacts** that together form the North Star Test Gate. Two are new; one already exists.

| Artifact | Axis | Tier | Frequency | Cost |
|----------|------|------|-----------|------|
| `harness-reports/benchmarks/baseline-YYYY-MM-DD.json` | **Performance** | — | Pre-release (manual) | Free, fast |
| `harness-reports/integration-control-flow-baseline.json` | **Wiring correctness** | Tier 1 | Every PR (CI) | Free, <30s |
| `harness-reports/integration-behavior-baseline.json` | **Real-LLM behavior** | Tier 2 | Pre-release (manual) | Local Ollama, ~5 min |

Performance artifact already shipped (commit `122a4ea0`). The other two are the work this spec proposes.

---

## 2. Tier 1 — Control-Flow Baseline

### 2.1 Goal

Detect **wiring regressions** at PR time. A commit that breaks "tool result populates semantic memory" or "early-stop overflow fires near maxIterations" must turn the gate red within 30 seconds, with no API key, no Ollama, no flake.

### 2.2 Mechanism

Built on existing primitives (`packages/testing/src/harness/scenario.ts` — `runScenario` + `expectTrace`).

Each scenario:
1. Builds a `ReactiveAgent` via `withTestScenario([...turns])` so the LLM is replaced with a deterministic script.
2. Wires the framework subsystem under test (memory, RI, redaction, etc.) using public builder calls.
3. Runs `agent.run(task)` to completion.
4. Captures specific metrics from the trace + result into a `Tier1ScenarioOutcome`.

The runner produces a single `Tier1Baseline` JSON artifact. A bun:test file diffs current run against the committed baseline; mismatch fails CI.

### 2.3 JSON shape

```typescript
// harness-reports/integration-control-flow-baseline.json
interface Tier1Baseline {
  readonly schemaVersion: 1;
  readonly capturedAt: string;            // ISO timestamp; informational only
  readonly bunVersion: string;
  readonly scenarios: Record<string, Tier1ScenarioOutcome>;
}

interface Tier1ScenarioOutcome {
  /** Run shape — must match exactly across runs (mocked LLM is deterministic). */
  readonly status: "success" | "failure";
  readonly iterations: number;
  readonly terminatedBy: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";
  readonly goalAchieved: boolean | null;

  /** Sets, captured as sorted arrays so JSON diffs are stable. */
  readonly toolCallsObserved: readonly string[];           // unique tool names
  readonly interventionsDispatched: readonly string[];     // unique decision types
  readonly errorSwallowedSites: readonly string[];         // unique site strings
  readonly redactorsTriggered: readonly string[];          // unique redactor names

  /** Optional behavioral assertions specific to the scenario (≥0, captured for diff). */
  readonly customAssertions: Record<string, number | string | boolean>;
}
```

### 2.4 Tolerance — Tier 1 is **exact match**

Mocked LLM is deterministic. Any divergence between current run and baseline is either:
- An intentional behavioral change → baseline must be updated in the same PR
- A regression → fail CI

The gate test does a structural deep-equal on every field of every scenario. No fuzzy matching.

### 2.5 Baseline-update protocol

When an intentional change ships:
1. Developer runs `bun run integration:gate:update` locally.
2. The runner overwrites `integration-control-flow-baseline.json`.
3. The PR diff includes the baseline change. Reviewer must explicitly approve.
4. The PR commit message MUST contain `BASELINE-UPDATE:` followed by a one-line reason. A CI lint step rejects PRs that change the baseline without this trailer.

This makes baseline drift impossible-by-omission: every change is visible, named, and reviewed.

### 2.6 v0 scenario list — derived from marketed competencies (per `README.md`)

> **Excluded by design:** scenarios sourced from "what just shipped" (recency bias). Each entry below maps to a feature explicitly marketed in `README.md` Features section.

| Scenario ID | Marketed Competency | Asserts |
|-------------|---------------------|---------|
| `cf-01-strategy-react` | "5 reasoning strategies" | reactive strategy fires; `terminatedBy: "final_answer_tool"` |
| `cf-02-strategy-plan-execute` | "5 reasoning strategies" | plan-execute strategy fires; iterations > 1 |
| `cf-03-strategy-tot` | "5 reasoning strategies" | tree-of-thought strategy fires; multi-branch trace |
| `cf-04-strategy-reflexion` | "5 reasoning strategies" | reflexion strategy fires |
| `cf-05-strategy-adaptive` | "5 reasoning strategies + adaptive meta-strategy" | adaptive strategy selects an inner strategy |
| `cf-06-tool-call-roundtrip` | "Adaptive tool calling" | tool requested → executed → result observed |
| `cf-07-memory-recall` | "4-layer memory" | store → recall returns the stored value |
| `cf-08-memory-tool-to-semantic` | "4-layer memory" | tool result triggers `storeSemantic` (G-3 closed by 72c322bd) |
| `cf-09-early-stop-overflow` | "Reactive intelligence — early-stop" | iteration ≥ maxIter-2 triggers early-stop dispatch |
| `cf-10-stall-detect` | "Reactive intelligence — stall-detect" | flat low-entropy window triggers stall-detect |
| `cf-11-tool-failure-redirect` | "Reactive intelligence — tool-failure-redirect" | 2 consecutive tool failures dispatch redirect |
| `cf-12-result-goalAchieved` | "Result shape" | `terminatedBy=max_iterations` → `goalAchieved=false` |
| `cf-13-error-swallowed-emitted` | "ErrorSwallowed (P0 S0.2)" | forced site emits `ErrorSwallowed` with correct tag |
| `cf-14-redactor-applied` | "Default secrets redactor (P0 S0.3)" | secret in log message replaced by `[redacted-...]` |
| `cf-15-num-ctx-passed-to-ollama` | "Model-adaptive context" / G-1 | when `defaultNumCtx` set, Ollama request includes `options.num_ctx` |
| `cf-16-builder-fromConfig-roundtrip` | "Agent as Data" | `builder.toConfig() → fromConfig` is structurally identical |
| `cf-17-fallback-chain` | "Provider fallback chains" | fallback to second provider when first errors |
| `cf-18-streaming-abort` | "Streaming + AbortSignal" | aborted run emits `StreamCancelled` and stops |
| `cf-19-required-tools-guard` | "Required tools guard" | `withRequiredTools(['x'])` blocks final-answer until `x` called |
| `cf-20-cost-budget-enforced` | "Cost tracking — budget enforcement" | `withBudget(0)` halts before LLM call |

20 scenarios. Each <2 seconds. Total Tier 1 budget: **≤45 seconds wall clock**.

### 2.7 What Tier 1 does NOT detect

- LLM-quality regressions (a strategy starts producing garbage but still routes correctly)
- Probabilistic failure modes (rate-limit retries, load shedding)
- Real model truncation (G-1 was caught by the corpus, not by mocks)
- Performance regressions (covered by the perf baseline)

These are **Tier 2** territory.

---

## 3. Tier 2 — Real-LLM Behavioral Baseline

### 3.1 Goal

Detect **behavioral regressions** that only surface against real LLMs. Catches the class of bug where the wiring is correct but the model's interaction with the kernel changed enough to break a marketed promise.

### 3.2 Existing leverage

`failure-corpus.ts` already produces directly usable signal:
- Entropy AUC (this session: 1.000)
- Dispatch AUC (this session: 0.750 → 1.000 after IC-13)
- Per-scenario `result.success`, `iterations`, `interventionsDispatched`

`harness-probe.ts` runs a structured probe set against Ollama with deterministic-ish output (pinned model + temp=0 are close enough; small drift is expected).

The Tier 2 work is **wrapping** these existing scripts into a single artifact with a stable schema, **not** writing new corpus scenarios.

### 3.3 JSON shape

```typescript
// harness-reports/integration-behavior-baseline.json
interface Tier2Baseline {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly model: string;                    // pinned; e.g. "cogito:14b"
  readonly modelDigest?: string;             // optional Ollama digest if available
  readonly temperature: number;              // pinned; 0.0
  readonly numCtx: number;                   // pinned; 8192
  readonly aggregates: Tier2Aggregates;
  readonly scenarios: Record<string, Tier2ScenarioOutcome>;
}

interface Tier2Aggregates {
  /** Entropy AUC (fraction of failure runs whose maxEntropy exceeds every success run's maxEntropy). */
  readonly entropyAUC: number;
  /** Dispatch AUC (fraction of failure runs that dispatched any intervention). */
  readonly dispatchAUC: number;
  /** Fraction of failure-labeled scenarios where `result.goalAchieved === false`. */
  readonly goalAchievedRate: number;
  /** Fraction of all scenarios that returned `result.success: true`. */
  readonly successRate: number;
  /** Average wall-clock per scenario in seconds. */
  readonly avgDurationSec: number;
}

interface Tier2ScenarioOutcome {
  readonly label: "success" | "failure";
  readonly success: boolean;
  readonly goalAchieved: boolean | null;
  readonly iterations: number;
  readonly maxIterations: number;
  readonly terminatedBy: string;
  readonly maxEntropy: number;
  readonly interventionsDispatched: number;     // count, not list (too noisy across runs)
  readonly dispatchedTypes: readonly string[];   // sorted unique types
  readonly durationSec: number;
}
```

### 3.4 Tolerance — Tier 2 is **hard floors**

Real-LLM output drifts run-to-run even at temperature=0. Exact match would be perpetually flaky. The gate enforces aggregate floors only:

| Metric | Floor | Reasoning |
|--------|-------|-----------|
| `aggregates.entropyAUC` | `≥ 0.95` | We've achieved 1.000; allow 5% headroom for sampling noise |
| `aggregates.dispatchAUC` | `≥ 0.95` | Same. Below 0.95 means a wiring or threshold bug. |
| `aggregates.goalAchievedRate` | `≥ 0.50` | At least half of failure-labeled scenarios must correctly produce `goalAchieved: false` |
| `aggregates.successRate` | `≥ 0.40 AND ≤ 0.70` | Sanity bounds — too high means failure scenarios aren't failing; too low means success scenarios are broken |

Per-scenario assertions:
- For each `label: "success"` scenario: `iterations ≤ maxIterations` (no overruns ever)
- For each `label: "failure"` scenario: `interventionsDispatched ≥ 1` (something must fire)

No exact-value comparison on `iterations`, `maxEntropy`, etc. Those are captured for **trend analysis**, not gating.

### 3.5 Tier 2 runner choice

The advisor flagged this as the discriminating decision. Options:

**Option A — Manual pre-release ritual (RECOMMENDED for now)**
- Developer runs `bun run integration:gate:behavior` before tagging a release.
- Script writes today's dated baseline file (`integration-behavior-baseline-YYYY-MM-DD.json`).
- CI does NOT run Tier 2; instead, a CI lint step rejects releases where the most recent baseline file is older than 14 days.
- Pro: zero infra cost. Con: discipline required.

**Option B — Self-hosted Ollama runner (deferred)**
- Requires a always-on machine with a GPU.
- Most hobbyist projects don't have this.
- Con: maintenance burden.

**Option C — Cloud Anthropic gate via secrets**
- Use `claude-haiku-4-5` (cheapest frontier model) for Tier 2.
- Estimated cost: ~$0.50 per CI run.
- Pro: real LLM, hands-off. Con: ongoing cost; ties gate to one provider's behavior.

**Decision needed from user:** A, B, or C?

### 3.6 Tier 2 scenario list — initial set

Inherits from `failure-corpus.ts` (8 scenarios — 4 success-labeled, 4 failure-labeled) **plus** 4 new memory probes from existing `harness-probe.ts`:

| Scenario ID | From | Purpose |
|-------------|------|---------|
| `b-01-success-days-of-week` | failure-corpus | trivial recall, ≤2 iter, low entropy |
| `b-02-success-capital-france` | failure-corpus | single-fact, ≤2 iter |
| `b-03-success-rgb-colors` | failure-corpus | list-recall, ≤2 iter |
| `b-04-success-typescript-paradigm` | failure-corpus | technical recall, ≤4 iter |
| `b-05-failure-rate-limit-loop` | failure-corpus | tool always errors → expect early-stop, `goalAchieved=false` |
| `b-06-failure-save-loop` | failure-corpus | save tool fails → expect early-stop |
| `b-07-failure-verify-loop` | failure-corpus | verify tool fails → expect strategy-switch or early-stop |
| `b-08-failure-contradictory-data` | failure-corpus | sources disagree → expect dispatch |
| `b-09-memory-recall-invocation` | harness-probe | recall fires without explicit `recall: true` |
| `b-10-memory-retrieval-fidelity` | harness-probe | recalled content matches stored content |
| `b-11-memory-multi-observation-synthesis` | harness-probe | multi-step research uses memory across iters |
| `b-12-memory-context-pressure-degradation` | harness-probe | high-context task doesn't truncate critical facts |

12 scenarios total.

---

## 4. Cross-tier integration

### 4.1 Combined invocation

```bash
# Tier 1 — runs in CI on every PR, also locally as part of `bun test`
bun test packages/runtime/tests/integration/north-star-gate.test.ts

# Tier 2 — manual pre-release ritual (Option A) OR cron-driven (Option B/C)
bun run integration:gate:behavior          # captures fresh baseline
bun run integration:gate:behavior:check    # validates floors against latest baseline
```

### 4.2 Gate failure modes

| Failure | Tier | Likely cause |
|---------|------|--------------|
| `cf-08-memory-tool-to-semantic` regresses (no `storeSemantic` event) | 1 | `Effect.forkDaemon` wiring broken (G-3 reverted) |
| `cf-09-early-stop-overflow` regresses (no early-stop dispatch) | 1 | `evaluateEarlyStop` overflow branch removed (IC-13 reverted) |
| `cf-13-error-swallowed-emitted` regresses (no event) | 1 | EventBus wiring broken or `emitErrorSwallowed` site lost the `site:` literal |
| `aggregates.entropyAUC` drops to 0.92 | 2 | Entropy sensor calibration drifted; check `reactive-observer.ts` |
| `aggregates.dispatchAUC` drops to 0.85 | 2 | Threshold bug or evaluator regression |
| Single Tier 2 scenario shows `iterations > maxIterations` | 2 | W4 returning — kernel runner bypassed maxIter guard |

### 4.3 Reporting

When the gate fails, the test output includes:
1. The scenario ID(s) that failed
2. The metric name(s) that regressed
3. The expected baseline value vs. observed value
4. A pointer to the schema doc for context

No "find it yourself in the logs" failure modes.

---

## 5. Constraints already committed (per advisor)

1. **Tolerance policy** — Tier 1 exact match, Tier 2 hard floors only. (§2.4, §3.4)
2. **Baseline-update protocol** — `BASELINE-UPDATE:` commit-message trailer, CI lint enforces it. (§2.5)
3. **Scenarios from marketed competencies** — every scenario in §2.6 maps to a feature explicitly marketed in `README.md` Features. No recency-bias picks.
4. **Tier 2 runner verified** — open question (§3.5) requires user decision.

---

## 6. Implementation plan (PENDING user sign-off on this spec)

### Phase A — Tier 1 (estimated 2-3 sessions)

1. Define types (`Tier1Baseline`, `Tier1ScenarioOutcome`) in `packages/testing/src/gate/types.ts`.
2. Implement `runTier1Scenario(config) → Tier1ScenarioOutcome` in `packages/testing/src/gate/runner.ts`. Adapter over `runScenario`.
3. Implement 20 scenario configs in `packages/testing/src/gate/scenarios/cf-*.ts` — one file per scenario.
4. Implement gate test `packages/runtime/tests/integration/north-star-gate.test.ts` — runs all scenarios, deep-equals against committed baseline.
5. Capture initial baseline; commit alongside the test.
6. Add CI lint: any change to `integration-control-flow-baseline.json` requires `BASELINE-UPDATE:` trailer in the commit message.

### Phase B — Tier 2 (estimated 1-2 sessions)

1. Define types (`Tier2Baseline`, `Tier2Aggregates`, `Tier2ScenarioOutcome`).
2. Wrap `failure-corpus.ts` output to emit `Tier2Baseline` JSON.
3. Add 4 memory probes from `harness-probe.ts`.
4. Add `bun run integration:gate:behavior:check` script enforcing floors.
5. Capture initial baseline (manual run on developer machine).
6. Add staleness check — CI rejects release tags when latest baseline file is >14 days old.

### Phase C — wire to CI (1 session)

1. Add the gate test to `.github/workflows/ci.yml`.
2. Add the staleness check.
3. Document the workflow in `AGENTS.md`.

---

## 7. What this spec asks of the user

Three sign-offs before any code is written:

**1. Schema shape** (§2.3 and §3.3) — are `Tier1ScenarioOutcome` and `Tier2ScenarioOutcome` capturing the right metrics for your purposes? Anything missing? Anything redundant?

**2. Tier 2 runner choice** (§3.5) — Option A (manual pre-release), Option B (self-hosted), or Option C (cloud Anthropic)?

**3. Scenario list** (§2.6 and §3.6) — are 20 Tier 1 + 12 Tier 2 the right v0 set? Any scenario that's load-bearing for your use case but missing? Any that's noise and should be cut?

After sign-off, Phase A (Tier 1) starts in the next session with TDD discipline (RED test that asserts schema shape, GREEN runner, baseline captured, CI lint added).

---

## 8. Open questions / risks

| Risk | Mitigation |
|------|-----------|
| Mock LLM scenarios pass while real LLMs regress (the bug class advisor flagged) | Tier 2 catches this. Tier 1 is *necessary but not sufficient*. |
| Baseline files churn on every refactor | The `BASELINE-UPDATE:` trailer makes churn visible in PR review |
| Tier 2 scenarios become flaky as Ollama models update | Pin `modelDigest` field; recapture baseline after intentional model bump |
| Tier 1 budget creeps as scenarios are added | Hard cap: 60 seconds. Beyond that, scenarios must be Tier 2 instead |
| Two baselines confuse contributors | AGENTS.md + this spec are linked from CI failure messages |

---

_Next iteration of this doc happens after user sign-off on §7. No code shipped against this spec until that approval is in._
