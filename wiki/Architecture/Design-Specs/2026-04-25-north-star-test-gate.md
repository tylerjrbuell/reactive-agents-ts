# North Star Test Gate — Design Spec

> **Status:** APPROVED 2026-04-24. User sign-off:
>   - Schema (§2.3, §3.3) — accepted as drafted, sensible/useful fields only
>   - Tier 2 runner (§3.5) — **Option B (self-hosted Ollama on developer GPU machine)**
>   - Scenario list — **PRUNED**: only failure-mode regression scenarios; drop generic competency coverage. Each scenario must map to a specific weakness ID (W#) or gap (G#/IC#/S0.#) the gate is designed to catch.
>   - **Design principle (added 2026-04-24):** the gate must be **extensible** — adding a new scenario is a single-file drop-in, never a registry edit — and designed for **self-improvement iteration sessions** so the harness-improvement-loop can self-heal (auto-update baselines with audit trail) and self-maintain (track per-scenario value, surface candidates for retirement or reinforcement).
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

### 2.6 v0 scenario list — failure-mode regressions only

> **Pruning rule (per user 2026-04-24):** every scenario must map to a documented weakness ID (W#) or architectural gap (G#/IC#/S0.#). Generic competency coverage (e.g., "all 5 strategies fire") is excluded — those belong in unit tests, not the gate. The gate exists to catch the **specific failures** that have surfaced or could plausibly surface, not to inventory features.

| Scenario ID | Targeted Failure | Regression Triggered When |
|-------------|------------------|---------------------------|
| `cf-01-iteration-counter-off-by-one` | **W6 / IC-16** (`completedIteration` off-by-one in `reactive-observer.ts`) | Single-step task reports `iterations === 1`, not 2 |
| `cf-02-early-stop-overflow-fires` | **W4 / W13 / IC-13** (early-stop never dispatched in failure loops) | Forced near-`maxIterations` run dispatches `early-stop` |
| `cf-03-early-stop-respects-convergence` | **IC-13 ordering regression** (overflow before convergence is wrong) | Converging trace produces `reason: "Entropy converging…"`, not overflow reason |
| `cf-04-goal-achieved-from-final-answer` | **W11 / IC-17** (`result.success` always true masks failures) | `terminatedBy: "final_answer_tool"` → `goalAchieved === true` |
| `cf-05-goal-achieved-from-overflow` | **W11 / IC-17** | `terminatedBy: "max_iterations"` → `goalAchieved === false` |
| `cf-06-goal-achieved-null-on-end-turn` | **W11 / IC-17** | `terminatedBy: "end_turn"` → `goalAchieved === null` (ambiguity preserved) |
| `cf-07-tool-result-emits-semantic-store` | **G-3 / IC-15** (tool observations dead-end at scratchpad) | Successful tool execution causes `storeSemantic` to fire (forked, non-blocking) |
| `cf-08-memory-recall-roundtrip` | **W7 / W8** (model fails to invoke recall; recalled content corrupted) | Stored fact retrievable via `recall(key)` round-trip |
| `cf-09-num-ctx-on-ollama-request` | **G-1** (silent 2048-token truncation) | `defaultNumCtx: 8192` configured → Ollama request includes `options.num_ctx: 8192` |
| `cf-10-error-swallowed-event-emitted` | **S0.2** (silent `catchAll(() => Effect.void)` sites) | Forced throw at instrumented site emits `ErrorSwallowed` with correct `site` literal |
| `cf-11-redactor-strips-secrets-from-logs` | **S0.3** (secrets leak through structured logger) | `info("token: ghp_…")` stored as `[redacted-github-token]` in `getLogs()` |
| `cf-12-redactor-strips-from-metadata` | **S0.3 metadata path** | `info("…", { token: "ghp_…" })` → redacted in metadata |
| `cf-13-no-advisory-only-dispatches` | **Principle 11** (4 removed evaluators must stay removed) | None of `prompt-switch`/`memory-boost`/`skill-reinject`/`human-escalate` ever appear in `recentDecisions` |
| `cf-14-stall-detect-fires-on-flat-entropy` | **W2** (loop detector reset by ICS) | Flat low-entropy window across N iters dispatches `stall-detect` |
| `cf-15-tool-failure-redirect-fires` | **Tool-failure-redirect intervention regression** | 2+ consecutive same-tool failures dispatch `tool-failure-redirect` |
| `cf-16-max-iterations-honored` | **W4** (`withReasoning({ maxIterations })` silently dropped) | Configured `maxIterations: N` → kernel cannot exceed N outer iterations |
| `cf-17-known-swallow-sites-format` | **S0.2 wiring drift** (sites renamed silently) | All `emitErrorSwallowed` site strings in production code follow `<package>/<path>:<line\|anchor>` shape |

17 scenarios. Each ≤2 seconds. Total Tier 1 budget: **≤40 seconds wall clock**.

**Each scenario file is structured as a regression test for a specific commit:**
- Header comment names the failure ID it protects (`W6`, `G-1`, `IC-13`, etc.)
- Header comment names the commit that closed the gap (`72c322bd`, `838fb721`, etc.)
- If a future change reverts the protection, the scenario fails with a message pointing to which weakness has returned.

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

**Option B — Self-hosted Ollama runner (CHOSEN)**

User-confirmed 2026-04-24: developer machine has an Ollama-capable GPU. Tier 2 runs against that machine.

Implementation:
- A `bun run integration:gate:behavior` script runs locally against `cogito:14b` at temp=0, num_ctx=8192. Script writes `harness-reports/integration-behavior-baseline-YYYY-MM-DD.json`.
- A `bun run integration:gate:behavior:check` script reads the most recent dated baseline and asserts the §3.4 hard floors. Exits non-zero on regression.
- A CI lint step rejects release tags where the most recent baseline file is older than 14 days, ensuring the ritual is performed before each release rather than skipped silently.
- Optional future: GitHub Actions self-hosted runner registered against the same GPU machine, so Tier 2 can run on a `behavior-gate.yml` workflow triggered by `release/*` branch pushes. Out of scope for v0.

### 3.6 Tier 2 scenario list — failure-mode-targeted only

Inherits the **4 failure-labeled scenarios** from `failure-corpus.ts` and the **4 memory probes** from `harness-probe.ts`. Success-labeled scenarios from the corpus are kept ONLY because they're needed as the AUC denominator (you can't compute "fraction of failure runs whose entropy exceeds every success run's entropy" without a success class). They're not assertion targets in their own right.

| Scenario ID | Targeted Failure | Triggered When |
|-------------|------------------|----------------|
| `b-01-rate-limit-loop` (failure) | **W4 / W13 / IC-13** under real LLM | Persistent rate-limit errors → `early-stop` dispatched, `iterations ≤ maxIterations`, `goalAchieved === false` |
| `b-02-save-loop` (failure) | **W14** dispatch threshold + W4 | Save fails → `interventionsDispatched ≥ 1`, `goalAchieved === false` |
| `b-03-verify-loop` (failure) | **Strategy-switch evaluator regression** | Verify fails → either `switch-strategy` or `early-stop` dispatched |
| `b-04-contradictory-data` (failure) | **Dispatcher under behavioral entropy** | Source disagreement → ≥1 intervention dispatched |
| `b-05-success-trivial-recall` (success, AUC denominator) | **W6 / IC-16 under real LLM** | "What is the capital of France?" → `iterations ≤ 2`, `maxEntropy ≤ 0.20` |
| `b-06-success-list-recall` (success, AUC denominator) | **W6 / IC-16** for list-shaped output | "List 3 RGB colors" → `iterations ≤ 2` |
| `b-07-success-technical-recall` (success, AUC denominator) | **W8** task-intent under real LLM | TypeScript paradigm question → `iterations ≤ 4` |
| `b-08-success-days-of-week` (success, AUC denominator) | Lowest-noise success anchor | "Days of the week" → `iterations === 1` ideally, `≤ 2` floor |
| `b-09-memory-recall-invocation` (failure-mode probe) | **W7** model fails to invoke recall | Stored fact → next agent run retrieves it without explicit `recall: true` flag |
| `b-10-memory-retrieval-fidelity` (failure-mode probe) | **W7 / W8** recalled content corruption | Recalled content's relevant facts match stored facts (substring assertion) |
| `b-11-memory-multi-observation-synthesis` (failure-mode probe) | **G-3 under real LLM** | Multi-step research consults semantic memory across iterations, output references multi-source synthesis |
| `b-12-memory-context-pressure-degradation` (failure-mode probe) | **G-1 under real LLM** | High-context task with `defaultNumCtx: 8192` doesn't truncate critical facts in the output |

12 scenarios. Each with explicit failure-ID provenance. Success scenarios serve dual purpose: anchor the AUC denominator AND regression-test the "trivial task ≤ N iters" promise.

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

## 6.5 Extensibility & self-improvement architecture (added 2026-04-24)

The gate must serve harness-improvement-loop sessions as a **living quality surface**, not as static fence. Three architectural commitments make that possible:

### 6.5.1 Single-file scenario drop-in

Every scenario is a self-contained module exporting a `ScenarioModule`:

```typescript
// packages/testing/src/gate/scenarios/cf-01-iteration-off-by-one.ts
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-01-iteration-off-by-one",
  targetedWeakness: "W6",            // map to harness-reports/loop-state.json weakness ID
  closingCommit: "0c79a350",          // commit that closed the gap; gate fails point here
  description: "Single-step task reports iterations === 1, not 2. Protects IC-16.",
  config: { /* runScenario config */ },
  customAssertions: (result) => ({ /* optional scenario-specific metrics */ }),
};
```

The runner auto-discovers files matching `scenarios/cf-*.ts` and `scenarios/b-*.ts` via filesystem glob. **No central registry to edit.** A new scenario is a one-file PR. A retired scenario is one-file delete.

### 6.5.2 Self-healing baseline updates

When a scenario's expected outcome changes intentionally (e.g., a refactor that legitimately reduces an iteration count from 3 to 2), the gate offers a guided path rather than just failing:

1. **Failure message names the change**: which scenarios diverged, what fields changed, which weakness ID the scenario protects, and the closing commit.
2. **`bun run gate:update`** regenerates the baseline. The script *prompts the user* for a `BASELINE-UPDATE:` reason and writes it as a git note attached to the new baseline commit.
3. **Audit trail per scenario**: each `Tier1ScenarioOutcome` carries `lastUpdatedCommit` and `lastUpdatedReason` so a later session can answer "when and why did this scenario's expected output last change?" without spelunking git log.
4. **CI lint enforces the trailer**: PRs that change the baseline file without `BASELINE-UPDATE:` in the commit message fail.

### 6.5.3 Self-maintenance via scenario health tracking

A sidecar file tracks per-scenario value over time:

```typescript
// harness-reports/integration-control-flow-scenario-health.json
interface ScenarioHealth {
  readonly schemaVersion: 1;
  readonly scenarios: Record<string, {
    readonly executions: number;
    readonly lastExecutedAt: string;
    readonly regressionsCaught: number;        // increments every time the gate fails on this scenario
    readonly lastRegressionAt: string | null;
    readonly baselineUpdatedAt: string;
    readonly baselineUpdateCount: number;       // intentional updates (high churn = hot scenario)
  }>;
}
```

Harness-improvement-loop sessions (`/skill:harness-improvement-loop`) read this file to:
- **Surface stale scenarios** ("haven't caught a regression in 90+ days; consider retiring or reinforcing")
- **Surface high-churn scenarios** ("baseline updated 5 times this month; the underlying behavior is unstable")
- **Surface uncovered weaknesses** (cross-reference `loop-state.json` weaknesses against `targetedWeakness` field; gaps suggest new scenarios needed)

The gate runner increments `executions` every run and `regressionsCaught` whenever a scenario fails. Health updates are committed alongside baseline updates.

### 6.5.4 CLI surface

```bash
bun run gate:check              # run all tier-1 scenarios, diff against baseline (used by `bun test`)
bun run gate:update             # regenerate baseline (interactive: prompts for reason)
bun run gate:explain <id>       # dump trace + outcome for one scenario, useful for debugging
bun run gate:health             # print scenario-health table, sorted by stale → fresh
bun run gate:behavior           # tier-2 (real LLM, Option B); writes dated baseline
bun run gate:behavior:check     # tier-2 floor enforcement against latest baseline
```

### 6.5.5 What this means for harness-improvement-loop integration

A future iteration session reads:
- `loop-state.json` weaknesses (current) ↔ `scenario-health.json` `targetedWeakness` (covered)
- Surfaces gaps: `W17` exists in loop-state but no `cf-*.ts` scenario targets it → recommend adding one
- Surfaces redundancy: 3 scenarios target `W6` with no recent regressions caught → consider consolidating

This makes the gate **co-evolve** with the harness's understanding of what can fail. The loop continuously refines the gate; the gate continuously protects the loop's prior wins.

---

## 7. Sign-off received 2026-04-24

- **Schema** (§2.3 / §3.3) — accepted. Use sensible / useful fields only.
- **Tier 2 runner** (§3.5) — Option B (self-hosted Ollama on developer GPU machine).
- **Scenario list** — pruned per user direction: every scenario must target a specific documented failure mode. §2.6 trimmed from 20 generic competency scenarios to 17 failure-mode regressions; §3.6 reframed so each scenario lists its targeted weakness ID.

Phase A implementation starts in the next session.

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
