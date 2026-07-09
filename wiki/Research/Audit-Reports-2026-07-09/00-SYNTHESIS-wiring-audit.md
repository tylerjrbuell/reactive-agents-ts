# Wiring Audit 2026-07-09 — "Built, Never Wired"

**Scope:** validate the meta-loop overhaul (Waves A–G), Phase 3.6 hotfixes, and the eval instrument against source. Method: trace every output field from write-site to read-site; classify each read as *behavior-changing*, *only-traced*, or *absent*. Docs, comments, and commit messages were treated as unreliable — every claim below is source- or execution-verified.

**HEAD at audit:** `fe193a2e` (local main, 131 commits ahead of origin).

---

## The disease

One failure mode explains nearly every finding: **a mechanism is built correctly, and then never wired to anything that can fail.**

It appears in three forms:

1. **Computed, never read** — a value is produced and no consumer exists.
2. **Read, never written** — a consumer queries a fact that nothing ever mints.
3. **Checked, never run** — an invariant script or gate exists but nothing executes it.

The overhaul added *checking machinery* faster than it added *places for the machinery to bite*.

---

## P0 — Declared `forbidden` tools are silently unenforced

`packages/core/src/contracts/task-contract.ts:33` documents a hard guarantee:

> `forbidden` — the tool MUST NOT be visible to the LLM.

`compileRunContract` turns it into `constraints.push({kind:"forbidden-tool", tool})` (`run-contract.ts:252`). **`RunContract.constraints` has zero non-test readers.** `tool-surface.ts` contains no `forbidden` / `deny` / `exclude` filter. `taskContract.tools` is read only twice — to extract `required` (`:186`) and to build the dead constraint (`:251`).

**Consequence:** `.withContract({tools:[{kind:"forbidden", name:"shell-execute"}]})` does nothing. The tool remains visible and callable. A user constraining an agent away from shell or file-write gets silent non-enforcement. Same for `constraints.output-format`.

**Verified by execution:** the compiled contract's `postConditions` + `requirements` never mention the forbidden tool.

---

## P0 — The lift gate's verdict is decided by sample count, not by effect

`gate.ts:80` `noisePp = significanceK * variance * 100`, but `runner.ts:933` stores `Math.sqrt(variance)` — the field named `variance` holds a **population standard deviation** (`types.ts:87` admits it in a doc-comment).

`maxOf` (`gate.ts:26`) is seeded at `0`. At `runs=1`, every cell's variance is exactly `0`.

Executed against the real `projectTierEvidence`/`evaluateLiftGate`, identical 4.0pp lift:

| cells | noise bar | `significant` | verdict |
|---|---|---|---|
| n=1 (variance 0) | **0pp** | true | **`default-on`** |
| n>1 Bernoulli (stddev 0.50) | **50pp** | false | **`opt-in`** |

The bar is a standard deviation, not a standard error: it collapses to 0 exactly when n is too small to estimate it, and never shrinks with n otherwise. **The gate rubber-stamps noise at n=1 and rejects real lift at n>1.** The repo's historical ablations ran `--runs 1`.

Compounding:
- `evaluateLiftGate` has **zero production callers** (only `tests/gate.test.ts`). It is dead code at runtime.
- `rax eval gate` needs a `SessionReport.json`, which only `--output` produces; without that flag **nothing is persisted** (`run.ts:284`).
- `inconclusive` is a data-integrity flag (`PreFlightViolation`), not a power flag. **"Underpowered" is indistinguishable from "no effect."**
- Every gate test hand-feeds the `variance` field (`tests/gate.test.ts:27`); every `default-on` test passes `variance: 0`. `aggregateRuns` — the producer that mislabels the field — is **never tested**. The bug lives exactly in the untested producer/consumer seam.

**ImprovementLedger receipt:** statuses are `adopted | opt-in | rejected`. Three entries ever; **zero `adopted`**; nothing since 2026-07-07, across the 50 commits of the overhaul.

---

## P1 — Six of eight enforcement scripts never execute

Program law (09-UNIFIED-PROGRAM §6): *"one owner module + one grep-able enforcement script. No script → not done."*

| script | invoked by |
|---|---|
| `check-run-assessment.sh` | ✅ a test spawns it |
| `check-termination-paths.sh` | ✅ `m9-termination-oracle.test.ts` |
| `check-run-contract.sh` | ❌ nothing |
| `check-ledger-writes.sh` | ❌ only *mentioned in a comment* (`emit.ts:109`) |
| `check-projection.sh` | ❌ nothing |
| `check-control-plane.sh` | ❌ nothing |
| `check-policy-compiler.sh` | ❌ nothing |
| `check-llm-gateway.sh` | ❌ only *mentioned in a comment* (`llm-gateway.ts:28`) |

No CI workflow runs any of them. `eval.yml` is `workflow_dispatch`-only and self-describes as *"Disabled auto-triggers (always failing)."*

**`check-policy-compiler.sh` is RED on main right now** — red since Phase 7 (`66c5d1b3`) landed, verified by checking out that commit. The law degraded from *"the script must pass"* to *"the script must exist."*

The violation it flags is real: `strategy-selection.ts:103` compiles the harness plan a **second time** at dispatch, from `classification.horizon`, while `runner.ts:395` compiles it at run-start from `runContract.horizon`. Two compiles, two horizon sources, one run. (Observed live: `rw-8` classifies `horizon=long` at dispatch → `plan-execute-reflect`.)

---

## P1 — Five ledger entry kinds are typed and queried but never minted

| kind | writers | readers |
|---|---|---|
| `requirement` | **0** | `assess.ts:207`, `standing-frame.ts:131` |
| `handoff` | **0** | `standing-frame.ts:123` |
| `contract-amended` | **0** | none |
| `checkpoint-marker` | **0** | none |
| `deliverable-commit` | **0** | none |

Consequences: assess's requirement-lifecycle path and the projector's satisfied-requirement filter read a permanently empty set (satisfaction only ever works via post-condition matching). The projector's **handoff section can never render** — so the "carried strategy-switch context reaches the model" feature is dormant. No mid-run contract amendment, no deliverable provenance, no ledger↔checkpoint correlation is ever recorded.

---

## P1 — The evidence ledger is still write-only *for the loop* (D1 not cured)

`verdict` entries are persisted at `arbitrator.ts:1335/1367` and `step-projection.ts:112`. The **only** ledger reader is `assess.ts:290`:

```ts
const hasTerminalVerdict = entriesOfKind(ledger, "verdict").some((v) => v.gate === "terminal");
```

It reads `.gate` and ignores `.verified`. Its sole output is `phase = "verify"` (`assess.ts:301`) — and the only behavioral consumers of `phase` are `guard-adapters.ts:85` (`"gather"`) and `:100` (`"synthesize"`). **`phase === "verify"` is consumed by nothing.**

So `VerdictEntry.verified / .reason / .terminatedBy / .unmet` are written and never read. Persisting the verdict buys receipts and traces, not decisions. D1's thesis — *evidence retained but unreadable* — survives the wave that was meant to cure it.

---

## P2 — Dead / inert surface (ranked)

1. `RunContract.constraints` — **dead** (see P0).
2. `RunContract.acceptance` (`{tiers, stakes}`) — compiled `run-contract.ts:275`, **no reader**. Stakes-tiered acceptance strictness never varies.
3. `TaskRequirement.weight` + the whole LLM-decomposition merge (`decomposeRequirements` / `mergeLlmRequirements` / `amendContract` / `withRequirements`) — **no production caller**. The contract is always the deterministic floor; partial-credit weighting is unused.
4. `ControlResolution.winner` and `.proposals` — **no reader**. **6 of 8 control emitters have zero production callers** (`proposeFromControllerVeto`, `proposeFromBudgetMonitor`, `proposeFromStallGuard`, `proposeFromGroundedTerminal`, `proposeFromErrorRecovery`, `proposeFromDispatcher`). Five of seven `ControlAction` values are never produced. In production the "unified control plane with a documented total order" is a two-way switch-vs-abstain arbiter behind the long-horizon flag.
5. `RunAssessment.pace.projectedCompletion`, `health.repeatWaste`, `health.contradictions`, `requirements.blocked` — **computed, no reader**. The `claim` → `contradictions` chain is inert past the trace.
6. `harness-plan` levers `scaffoldingLevel`, `verifierTier`, `budget.maxIterations`, `memoryPosture` — **no readers** (fixed sibling defect: `8002a709`). Only `guard.horizonProfile` is live.
7. `RunAssessment.deliverables.{produced,missing}` + `RunContract.deliverables` — **only-traced**; `computeDeliverableReport` is never invoked, so the "deliverable truth receipt" is trace-only.

**Systemic inertness:** the whole Assessment → (pace actuators / control emitters / harness recompile) chain is gated behind `horizon !== undefined` or `adaptiveHarness`. In the **default** configuration it is computed every iteration and changes nothing — the same "provable no-op" class as the fixed harness-plan LEAN defect, one layer up.

Healthy, default-on, genuinely behavior-changing (for contrast): `RunContract.postConditions` → terminal-gate check-2.5 (`arbitrator.ts:348`), and the projector's `priorContext` section → prompt.

---

## D1–D3 verdicts

| Disease | Verdict | Test pin |
|---|---|---|
| D1 verdict persistence | **partially cured** — persisted, never read back to change a decision | unit only (`emit.test.ts:39`) |
| D1 compaction honesty | **CURED** — `compaction.ts:150-165` enumerates dropped refs | ✅ `compaction.test.ts:143-166` |
| D2 shared currency | **partially cured** — assessment is parallel + opt-in; 9 private counters remain live | `check-run-assessment.test.ts` |
| D3 stall `verified:false` → `success` | **partially cured** — stall seam still emit-only (`stall-deliverable.ts:346/378`, unconditional `terminate()` at `:378`); the clean-success *flip* is prevented downstream by H5 (`runner.ts:1098`) | unit only (`verifier.test.ts:455`); **no 01KWZ811 seam regression test** |

---

## Missing tests (the pins to add)

1. **Producer/consumer seam:** run a real Bernoulli vector through `aggregateRuns` → `projectTierEvidence`; assert the noise floor **shrinks with n**. Fails today.
2. **n=1 degeneracy:** two single-run cells, tiny lift → must NOT be `default-on`. Today: bar 0 → `default-on`.
3. **Bernoulli detectability:** p≈0.6, n≥3, genuine ~15pp lift → must be detectable. Today: swallowed by the ~47pp bar.
4. **Underpowered ≠ no-effect:** the gate must expose a distinct power verdict.
5. **Gate is on-path:** assert a real session invokes `evaluateLiftGate`. Fails today (zero callers).
6. **Forbidden-tool enforcement:** a declared forbidden tool must not appear in the resolved tool surface. Fails today.
7. **Enforcement scripts run:** one test spawning all 8 `scripts/check-*.sh`. Would go red immediately (`check-policy-compiler.sh`).
8. **D3 seam regression:** end-to-end pin of the 01KWZ811 stack (`terminatedBy` passthrough → no clean-success flip; `onlyHarnessAuthorshipFailed` branch).
9. **Ledger read-back:** assert a `verdict` entry with `verified:false` changes some decision — or delete the unread payload fields.

---

## Recommended order

1. **Forbidden-tool enforcement** (P0, security-adjacent, small, user-visible).
2. **Gate: standard error + n-guard + on-path** (P0, unblocks every future default-on decision — nothing else can be validated until this works).
3. **Run the 8 enforcement scripts in CI / a test** (P1, cheap, permanently prevents recurrence; fix `check-policy-compiler.sh` red by resolving the double-compile).
4. **Mint `requirement` + `handoff` entries, or delete the kinds and their readers** (P1, closes D1's read-side and the dormant projector section).
5. **Decide the inert surface:** wire the plan levers / control emitters / acceptance policy, or delete them. Do this *after* (2), so the decision has evidence.

Items 1–3 are small and independently verifiable. Item 2 is the keystone: while the gate is broken, no "improvement" to this framework can be honestly claimed.
