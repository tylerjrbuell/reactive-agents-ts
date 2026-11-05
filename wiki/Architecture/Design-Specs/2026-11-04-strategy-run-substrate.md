---
type: design-spec
status: active
created: 2026-11-04
tags: [reasoning, strategies, substrate, convergence, plan-8]
related:
  - "[[2026-05-24-strategy-composability-design]]"
  - "[[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]]"
  - "[[../../Planning/Implementation-Plans/2026-11-04-d9-plan-execute-shared-gate]]"
---

# Strategy run substrate: one trajectory, strategies as control flow only

## Why now: the May spec's own trigger fired

The 2026-05-24 composability spec chose bottom-up primitive extraction and deferred a shared strategy framework until "Outcome B: the 4-5 primitives all need the same trajectory accumulator (cost + messages + steps + passes), the same status dispatch model, the same hooks." It also set a stop condition for the bottom-up approach: if the migrating strategies do not thin by at least 30%, the wrong things are being extracted.

Both have happened (measured 2026-11-04):

- **Strategies grew, not thinned.** reflexion.ts 838 (2026-05-25) to 1198 LOC. tree-of-thought.ts 1113, adaptive.ts 845, blueprint.ts 787, code-action.ts 684. plan-execute.ts fell to 950 only by moving code into `plan-execute/*` submodules, not by sharing it.
- **Every harness fix is wired N times, and coverage drifts.** Counted per strategy file today:

| Concern | Strategies that handle it |
|---|---|
| Pause short-circuit (`kernelPause` + `finalizePausedStrategyResult`) | reflexion, tree-of-thought, plan-execute (own `pendingPause` path) |
| Ledger growth + announce (`growRunLedger` / `ledgerSinkTarget`) | reflexion, code-action (plan-execute via its own `ledgerRef`) |
| Run contract (`openStrategyContract`) | reflexion, plan-execute, blueprint, code-action |
| Delivery judgment at the terminal | reflexion, plan-execute (others via the mint fallback) |
| Token / cost / call accounting (`totalTokens +=`, `llmCalls +=`) | every strategy, by hand (reflexion 17 + 8 sites, plan-execute 23 + 11, ToT 14 + 13) |
| Plan checklist | plan-execute, blueprint |

D9 alone touched five strategy files to deliver one rule (judge every terminal against the contract). The checklist, the strategy-neutral stream, the envelope cap and honest-partial each needed per-strategy wiring plus a per-strategy integration test (`*-honest-partial.integration.test.ts` x6). This is the boundary-multiplicity disease of 09 §6, inside `strategies/`.

## The design

A strategy run is a **trajectory** (what has happened: steps, passes, spend, envelope, ledger, pause) plus **control flow** (what to do next). The substrate owns the trajectory. A strategy owns only its control flow. Control flow stays ordinary Effect code: no JSON specs, no state-machine DSL (the May spec's "never" stands).

```ts
// strategies/substrate/strategy-run.ts (no warden owner; reasoning package)
export const runStrategy = <A>(
  spec: { strategy: StrategyName; input: StrategyInputBase },
  body: (run: StrategyRun) => Effect.Effect<StrategyEnd, ExecutionError | StrategyPaused, LLMService | RunEnvelope>,
): Effect.Effect<JudgedReasoningResult, ExecutionError, LLMService | RunEnvelope>

interface StrategyRun {
  readonly contract: RunContract;            // opened once (openStrategyContract)
  readonly crossCutting: CrossCuttingInput;  // built once from input + envelope
  readonly capabilities: ToolCapabilitySnapshot;
  /** One kernel pass: accounts spend + calls, joins the envelope, grows and announces the ledger.
   *  A paused pass fails with StrategyPaused; runStrategy turns it into the paused terminal. */
  pass(kernel, input, opts): Effect<PassResult, StrategyPaused, LLMService>;
  /** One direct model call (plan, critique, score, classify): accounted the same way. */
  call(purpose, request): Effect<LLMResponse, ExecutionError, LLMService>;
  /** Strategy control notes: trace-only steps (never streamed as thinking). */
  note(tag, text): Effect<void>;
  /** Live plan rows (the shared plan checklist), when the strategy has a plan. */
  readonly plan: PlanChecklist;
  /** Snapshot for strategies that read their own trajectory (reflexion's worst-of envelope, budgets). */
  readonly snapshot: Effect<Trajectory>;
}

type StrategyEnd = {
  output: string; status: "completed" | "partial" | "failed";
  decision?: DeliverableDecision;   // from proposeStrategyExit when the strategy runs its own gate
  extraMetadata?: Record<string, unknown>;
};
```

`runStrategy` then does the one terminal every strategy shares: catch `StrategyPaused` to the paused result; otherwise `finalizeStrategyResult` with the accumulated trajectory, the contract, the ledger and `strategyDecision`. The delivery judgment, status cap, terminal decision trace and stream events happen once, there.

What each strategy keeps is its distinguishing control flow: reflexion's generate, critique, improve loop; ToT's expand, score, prune, then execute; plan-execute's plan, waves, reflect, refine; blueprint's plan, verify, worker, solve; adaptive's select and delegate; code-action's write, sandbox, verify loop.

## Invariants (the drift contract)

Pinned by one structural test over `strategies/*.ts` (the May spec's E2 pattern), each red-on-cut:

1. No strategy calls `runKernel` / `runPass` directly; kernel passes go through `run.pass`.
2. No strategy calls `finalizeStrategyResult` / `finalizePausedStrategyResult` / `growRunLedger`; the terminal and the ledger belong to `runStrategy`.
3. No `totalTokens +=` / `llmCalls +=` accumulators in strategy files.
4. Every multi-pass strategy pauses correctly by construction: one parameterized test runs each registered strategy against a scripted approval-gated tool and asserts the paused terminal.

Invariant 4 replaces the six `*-honest-partial.integration.test.ts` files with one parameterized suite over the strategy registry, so a new strategy is covered on registration.

## Migration (one strategy per commit, behavior-preserving)

The May spec's per-primitive gate applies: at least two consumers in the introducing change, unit tests on the primitive, the drift contract, a live probe.

- **S1: substrate + three consumers (shipped 2026-11-04).** `runStrategy` / `StrategyRun` with tree-of-thought, reactive and direct: the three files that carried a copy of the kernel-terminal relay. Gate met: their existing tests unchanged and green (reasoning 3733, runtime 2089), drift contract live over the migrated list (`tests/strategies/strategy-run.test.ts`, the list may only grow), pause short-circuit red-on-cut, live qwen3:4b probe (ToT and direct correct; H3 subset 6/8 on four default-path tasks). LOC: tree-of-thought 1113 to 906, reactive 481 to 408, direct 276 to 220 (-336); substrate +319. Named behavior changes, all toward the reactive rule: ToT and direct pick their output with `resolvePassOutput` (a continuation or unresolved-tool thought is no longer shipped) and now relay the signal tally, final-answer capture and scratchpad; ToT reports input/output token splits; direct and reactive end a paused pass through the paused terminal.
- **S1-fix: substrate hardening (advisor pre-review 2026-11-04, required before S1b).** The S1 shape was right for single-answer strategies but would contort for the rest. Changes: one accumulating ledger sink owned by the run and announced once (the last-pass `ledger()` is a fourth ledger source and is deleted); `Delegated` end for adaptive and `basedOn` on `Result` so the kernel relay is not re-done per strategy; envelope join and status cap owned by the substrate for every strategy (not a reflexion mode); relay keys reserved against `extraMetadata` overwrite; a collect mode for concurrent passes so a pause cannot drop siblings' steps and spend, plus a drift check against `catchAll`/`retry`/`orElse` around `run.pass`; `run.account` for 0-LLM work; `run.spend()` seeds kernel budget options; paused terminal carries `taskId`. Program: [[../../Planning/Implementation-Plans/2026-11-04-architecture-convergence-program]].
- **S1b: reflexion.** Its generate/improve passes and critique calls go through `run.pass` / `run.call`; its worst-of envelope and `growRunLedger` move onto the trajectory.
- **S2: plan-execute and blueprint.** The plan checklist moves onto `run.plan`. plan-execute's own `pendingPause`/`ledgerRef` paths are deleted.
- **S3: code-action and adaptive.** adaptive's relay (`relayedOutcome`, `terminalDecisionRecorded`) becomes `runStrategy` composing a child run, not a special mint field.
- **S4: reactive and direct** (single-pass; small), then the allow-list is empty and the honest-partial files collapse into the parameterized suite.
- **S5: verify.** Full H3 on two tiers (no-regression), LOC report, and amend this spec with outcomes.

Exit: zero allow-list entries; strategies thinned by at least 30% cumulative across the six multi-pass files (the May spec's own bar, 5577 LOC today); one parameterized pause/honest-partial suite; H3 pass within noise on both tiers.

## What this does not do

- No new public API and no strategy rename. `.withReasoning({ defaultStrategy })` and the registry are untouched.
- No change to the kernel loop (`runner.ts`, `iterate-pass.ts`). Composing the iterate pass as an operation list (Plan 8 D10) is a separate, later step that this makes cheaper: once strategies only call `run.pass`, the kernel's internals can change behind one call site.
- No behavior change except where a strategy is missing a shared concern today (pause, ledger, contract). Those become uniform, and each such change is named in its commit and pinned.
