---
name: harness-improvement-loop
description: Agentic harness diagnostic + improvement loop. Probes the framework with real model runs, uses the rax-diagnose CLI to root-cause failures from structured trace data, ships ONE coordinated architectural fix, verifies via before/after diff, commits with empirical evidence. Use at the start of any harness improvement session — replaces ad-hoc grep + log-spelunking with a deterministic feedback loop.
user-invocable: true
---

# Harness Improvement Loop

## What this is

A tight feedback loop for fixing harness failure modes using the framework's own diagnostic tooling (`@reactive-agents/diagnose`). Optimized for short iteration cycles — minutes per pass, not days. Every change lands with an empirical before/after trace as evidence.

```
Probe → Diagnose → Hypothesize → Fix → Verify → Commit
  ↑                                              │
  └──────────────────────────────────────────────┘
                    iterate
```

This skill replaces the previous "wide-scan probe + giant report template" workflow. The diagnose CLI now does the heavy lifting that hand-rolled jq queries used to do.

## Prerequisites — the framework's diagnostic system

Tracing is **on by default** since Sprint 3.6. Every agent run writes a typed JSONL to `~/.reactive-agents/traces/<runId>.jsonl`. The `rax-diagnose` CLI is the primary inspection surface:

```bash
bun run rax:diagnose list                     # recent runs (most-recent first)
bun run rax:diagnose replay latest            # pretty timeline of the most recent run
bun run rax:diagnose replay <runId> --only=verifier-verdict,harness-signal-injected
bun run --silent rax:diagnose grep <runId> "<js-expr>" # JSONL filter — pipe to jq for further work
bun run rax:diagnose diff <runIdA> <runIdB>   # structural diff: stats, kinds, verdicts, final state
```

If you're going to remember one thing: **`rax:diagnose replay <runId> --only=kernel-state-snapshot,harness-signal-injected,verifier-verdict`** tells the failure narrative of any run at a glance.

### The eval system — primary probe + diagnosis substrate (2026-06, canonical)

Since the canonical evaluation system shipped (Phases 1–4b — see `wiki/Architecture/Design-Specs/2026-06-24-canonical-evaluation-system.md`), the **benchmark bench is the primary probe**, and it carries diagnosis + verdict + ledger inline. You no longer hand-roll a probe script for most sweeps:

- **Probe** = a 2-variant benchmark session (`bare-llm` vs `ra-full`) over real-world tasks, run cross-tier. `runSession` writes a `SessionReport` (per-cell scores, ablation `harnessLift`, per-run `RunDiagnosis`).
- **Diagnosis** = `RunDiagnosis` on every run (honesty label, failure modes, blind spots) — the "why" is attached to each score; aggregate across the report. Drill into a specific failing trace with `rax:diagnose` as before.
- **Verdict** = `rax eval gate --report <r.json> --baseline bare-llm --candidate ra-full` applies the project lift rule (≥3pp ∧ ≤15%tok ∧ ≥2 tiers) → `default-on | opt-in | reject`.
- **Ledger** = `--ledger <path>` records the weakness→hypothesis→verdict chain (`wiki/Research/Harness-Reports/improvement-ledger.json`); `rax eval ledger` lists it.

The old probe scripts (Phase 2) remain valid for targeting a single subsystem the bench tasks don't exercise, but the bench is the default for a weakness sweep.

---

## Amplified loop mechanics (2026-07-07 — use these, they are the fast path)

Session evidence: one un-aimed fix-verify cycle was costing GPU-hours. These four mechanics cut it to minutes-per-iteration:

1. **Start aimed — weakness queue.** Fold the latest report into ranked targets (each row: severity, failure modes, evidence, traceIds, and the exact probe command):
   ```bash
   bun run packages/benchmarks/src/weakness-queue.ts <report.json> [--variant ra-full] [--top 10]
   ```
2. **Verify narrow — one cell, not the matrix.** `--task` AND `--variant` compose; a fix iteration costs 1 variant × 1 task × 1 run:
   ```bash
   bun run packages/benchmarks/src/run.ts --session <s> --task rw-2 --variant ra-full --runs 1 --output /tmp/claude-1000/<fix>-verify.json
   ```
   ALWAYS pass `--output` — without it per-cell evidence (judge inputs, error causes) is unrecoverable after the run.
3. **Trust the clock again — timeouts hard-kill.** Cell timeouts abort the agent fiber via AbortSignal (runner.ts, 2026-07-07); zombie-fiber GPU contention no longer degrades later cells. If successful-cell durations climb monotonically across a session, that regression has returned — investigate before trusting aggregates.
4. **Judge recipe (memorize):** `JUDGE_LAYER=live JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini bun run packages/judge-server/src/index.ts` — **without JUDGE_LAYER=live a silent STUB scores 0.95 on everything.** Health-check with a REAL `/judge` POST (`/version` stays up when the LLM backend is dead). Error/timeout cells are never judged (`scoreErrorCell`) — evidence says the true cause.

**Ledger is not optional.** Every fix that touches harness behavior records weakness → hypothesis → verdict:
```bash
rax eval gate --report after.json --baseline bare-llm --candidate ra-full \
  --ledger wiki/Research/Harness-Reports/improvement-ledger.json \
  --weakness "<the failure mode>" --hypothesis "<the structural fix>"
```
A trace-level fix can be structurally correct yet reject on lift — record both facts.

---

## Phase 1 — Orient (5 minutes, do not skip)

Read these before forming hypotheses. Misdiagnosing happens when you reason about runtime behavior without knowing what the kernel is supposed to do.

### Code targets

| What | File |
|------|------|
| Kernel main loop | `packages/reasoning/src/kernel/loop/runner.ts` |
| Reasoning phases | `packages/reasoning/src/kernel/capabilities/{reason,act,verify,decide}/` |
| Verifier (output gate) | `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` |
| Strategy adapters | `packages/reasoning/src/strategies/` |
| Provider adapters (per-tier guidance) | `packages/llm-provider/src/adapters/` |
| Context profiles (per-tier knobs) | `packages/reasoning/src/context/context-profile.ts` |
| Diagnostic emit helpers | `packages/reasoning/src/kernel/utils/diagnostics.ts` |
| AGENTS.md root + memory | `AGENTS.md`, `~/.claude/projects/.../memory/MEMORY.md` |

### Wiki targets (knowledge graph queries)

The wiki is the single source of truth for prior diagnostic work. Before probing, query it.

**Use `claude-obsidian:wiki-query` (not raw grep)** — it reads the hot cache + index + drills into specific notes, surfacing semantic matches that grep misses. Falls back to grep only if wiki-query unavailable.

```
claude-obsidian:wiki-query "<symptom keywords> + <model tier> + <subsystem>"
```

Example queries that pay off:
- `wiki-query "verifier rejection cogito:14b retry context"` — finds M3 + related debriefs
- `wiki-query "tool name hallucination ollama native FC"` — finds healing pipeline (M4) work
- `wiki-query "harness signal redirect parroting"` — finds related FM-A patterns

| What | Path | Use for |
|------|------|---------|
| **Recent context** | `wiki/Hot.md` | Current focus, recent fixes |
| **Past harness reports** | `wiki/Research/Harness-Reports/` | Phase reports, baselines, diffs (this is where YOUR reports go) |
| **Failure mode catalog** | `wiki/Architecture/Specs/02-FAILURE-MODES.md` + `wiki/Failure-Modes/` | FM-A through FM-H taxonomy |
| **Mechanism validations** | `wiki/Experiments/M*.md` | M1-M13 spike reports — does failure relate to a known mechanism? |
| **Past debriefs** | `wiki/Research/Debriefs/` | What was already tried? |
| **Active issues** | `wiki/Issues/Running Issues Log.md` | Known blockers |
| **Decision context** | `wiki/Decisions/Decision Index.md` | Why current architecture exists |

**If wiki-query returns nothing relevant**, the failure pattern may be genuinely new. Consider `claude-obsidian:autoresearch "<topic>"` to ground your hypothesis in external research (papers, blog posts, GitHub issues) before guessing. The autoresearch result lands in `wiki/Research/<topic>/` for future agents.

Also check `git log --oneline -20` so you know what shipped recently and aren't reinventing a fix that was reverted last week.

**Record before proceeding:** which model tier you're targeting (local / mid / large / frontier), the maxIterations default, the verifier check list (`agent-took-action`, `synthesis-grounded`, etc.). You'll need these to evaluate what trace evidence actually means.

---

## Phase 2 — Probe (run a scenario, capture trace)

The probe is a small TypeScript script that exercises the harness via the public builder API. The point is to surface a failure mode in a real run, not to construct a synthetic test fixture.

### Primary probe — the eval bench (cross-tier weakness sweep)

For a broad weakness/failure-mode map, run a **2-variant cross-tier benchmark session** instead of a single probe script. One run surfaces harness lift, regressions, honesty, and failure modes across tiers.

**Setup (once):**

1. Start the frozen judge with a **NON-SUT** model (Rule 4 — judge ≠ any model under test):
   ```bash
   JUDGE_LAYER=live JUDGE_PROVIDER=ollama JUDGE_MODEL=gemma4:12b \
   JUDGE_MODEL_SHA=gemma4:12b JUDGE_CODE_SHA=dev PORT=8910 \
   bun run packages/judge-server/src/index.ts &
   # smoke: curl -s localhost:8910/version  then POST a /judge request
   ```
2. **Use CALIBRATED models only.** The bench's preflight honesty guard marks any model NOT in `STATIC_CAPABILITIES` (`packages/llm-provider/src/capability.ts`) as `inconclusive` (2048 fallback ctx) and **refuses to score it** — you get 0 measured cells, 0 dishonest numbers (guard working as designed). Calibrated local set (2026-06): `qwen3:14b`, `cogito:14b`, `qwen3.5:latest`, `gemma4:latest`; frontier models are calibrated. (To bench an uncalibrated model intentionally: `RA_BENCH_ALLOW_FALLBACK=1` — but scores are at fallback ctx, flagged, not representative. Better: add it to `STATIC_CAPABILITIES` with its real `numCtx`.)

**Run** a session (calibrated models, `bare-llm` + `ra-full` variants, `traceDir` set so `RunDiagnosis` is captured, **`runs≥3`** for the gate's variance/significance):
```bash
JUDGE_URL=http://127.0.0.1:8910 \
bun run apps/cli/src/index.ts bench --session <session> --output report.json
```
Or a one-off runner that builds the session inline via `runSession` + `getVariant("bare-llm")`/`getVariant("ra-full")` — **run it from inside the repo** so the `@reactive-agents/benchmarks` workspace import resolves (a script under `/tmp` will not).

`runs:1` makes the gate hair-trigger (variance 0 → any negative tier reads as a significant regression). Use **`runs≥3`** for an authoritative verdict.

### Legacy probes (single-subsystem targeting)

**Existing probes** (`.agents/skills/harness-improvement-loop/scripts/`):

| Script | Purpose |
|--------|---------|
| `task-quality-gate.ts` | 5 tasks (T1–T5) covering pure synthesis, single-tool, selective filter, multi-criteria, long-form. Strong general-purpose first probe. |
| `harness-probe.ts` | Wider 5-probe baseline (trivial-1step → termination-quality). Use when you don't know which subsystem is broken. |
| `harness-probe-wide.ts` | Wide-scan suite — only run when you need cross-strategy evidence. |

Pick one model and run it. Examples:

```bash
TASK_GATE_MODEL=cogito:latest bun .agents/skills/harness-improvement-loop/scripts/task-quality-gate.ts
PROBE_MODEL=qwen3:14b          bun .agents/skills/harness-improvement-loop/scripts/harness-probe.ts
```

The probe writes a JSON summary under `wiki/Research/Harness-Reports/`. Tracing is automatic — one `<runId>.jsonl` per task run lands in `~/.reactive-agents/traces/`.

**Adapting probes is expected, not an anti-pattern.** If the existing scripts don't exercise the failure mode you suspect, add a task or tweak `maxIterations` directly. Just commit the change with the run that justifies it.

---

## Phase 3 — Diagnose (use the trace, not the source)

This is the phase where the new tooling pays off. The trace JSONL has already captured every state transition, verifier verdict, harness signal, and (when wired) LLM exchange. You don't have to read kernel source to know what happened — read the trace.

### Eval-bench diagnosis — aggregate the SessionReport first

When the probe was an eval-bench run, the diagnosis is already in the report — aggregate it before drilling into individual traces:

- **Ablation** (`report.ablation[].harnessLift`): per (task × model) `ra-full − bare-llm`. Positive = harness helps; **negative = harness REGRESSES** (a prime root-cause target — e.g. an adversarial "nothing to optimize" task where ra-full over-engineers a false change).
- **Honesty** (`RunDiagnosis.honestyLabel` across runs): a high rate of `dishonest-success-suspected` / `claimed-success (unverified)` = models claiming success without verified deliverables — the dominant local-tier failure mode (≈95% of runs in the 2026-06 14b sweep).
- **Failure modes** (`RunDiagnosis.failureModes`): overlap-storm / nudge-loop / recall-loop / runaway-tokens / max-iter-no-progress, tallied across cells.
- **Token overhead**: `ra-full` mean tokens vs `bare-llm` — the harness tax (the 14b sweep saw +200–900%). A lift that fails the ≤15%tok gate is a real cost finding, not just a win.

THEN take a specific failing cell's `traceId` (from `RunScore.traceId`) and drill with `rax:diagnose replay` below.

### Default first move

```bash
bun run rax:diagnose list                                        # which runs are recent?
bun run rax:diagnose replay latest                               # full timeline
bun run rax:diagnose replay latest --only=kernel-state-snapshot,verifier-verdict,harness-signal-injected
```

The filtered replay surfaces three high-signal narratives:
- **kernel-state-snapshot per iteration** — step composition, status, output length
- **verifier-verdict** — every gate firing with check breakdown and reason
- **harness-signal-injected** — every harness-authored step with file:line origin

If the failure isn't obvious from those three event kinds, broaden:

```bash
bun run rax:diagnose replay latest --only=verifier-verdict,strategy-switched,intervention-dispatched,intervention-suppressed
```

### Structured queries — patterns that pay off

```bash
# Did the verifier reject any output, and why?
bun run --silent rax:diagnose grep latest "e.kind === 'verifier-verdict' && !e.verified"

# Which harness signals fired and from where?
bun run --silent rax:diagnose grep latest "e.kind === 'harness-signal-injected'" | jq -c '{iter, signalKind, origin, len: .contentLen}'

# Did the agent ever actually call a tool?
bun run --silent rax:diagnose grep latest "e.kind === 'kernel-state-snapshot' && e.toolsUsed.length > 0" | jq '.iter'

# What's the output trajectory across iterations?
bun run --silent rax:diagnose grep latest "e.kind === 'kernel-state-snapshot'" | jq -c '{iter, status, outputLen, terminatedBy}'

# Was strategy-switching responsible for failure?
bun run --silent rax:diagnose grep latest "e.kind === 'strategy-switched' || e.kind === 'intervention-dispatched'"
```

### Cross-run comparison

When you suspect a recent change broke something:

```bash
bun run rax:diagnose diff <good-runId> <bad-runId>
```

The diff prints a stat table (iterations, tool calls, verifier rejections, harness signals, tokens, duration) plus event-kind histogram and final-state comparison. Use it to confirm "did my change move the needle in the right direction" without eyeballing scoring functions that move slowly.

### What you're looking for

| Signature | Likely cause |
|-----------|--------------|
| `kernel-state-snapshot.toolsUsed = []` across all iterations + `verifier-verdict.checks[].name = "agent-took-action" passed=false` | Model never called any data tool — parrot/hallucination output suppressed by the verifier (working as designed). Investigate WHY model didn't call: prompt, schema, tier-specific FC issue. |
| Multiple `harness-signal-injected` with same `origin` and same content | Harness nudge is firing repeatedly without effect. Either the nudge is wrong, the model can't parse it, or the kernel control flow ignores model compliance. |
| `verifier-verdict.checks[].name = "synthesis-grounded" passed=false` | Output contains claims not present in tool observations — fabrication. |
| `kernel-state-snapshot.outputLen > 0` while `status="failed"` | Output ownership invariant broken — kernel is letting a populated state.output ride past a failure transition. |
| `intervention-suppressed` repeatedly with `reason="below-entropy-threshold"` on a stuck run | RI threshold too high for this model tier. |
| Final `kernel-state-snapshot.terminatedBy = "dispatcher-strategy-switch"` and the next strategy never recovers | Strategy-switching escape hatch isn't actually escaping — investigate the sub-strategy. |

### Anti-pattern to retire

The old jq cookbook (`jq 'select(.kind == "...")' .reactive-agents/traces/...`) is now redundant. Use `rax:diagnose grep` — it's faster to type and survives schema changes. If you find yourself reaching for raw jq against a `~/.reactive-agents/traces/*.jsonl`, ask whether `rax:diagnose replay --only=...` or a `grep` predicate would express it more cleanly.

---

## Phase 4 — Hypothesize (one structural change, not a band-aid)

Before writing any code, write down:

1. **The failure mode in one sentence.** "T2/T4/T5 ship harness-redirect text as the final answer."
2. **The mechanism.** "When the kernel terminates `dispatcher-strategy-switch` with `state.status=failed` but state.output is unset, reactive.ts's `lastThought ?? state.error ?? null` fallback grabs the parroted recovery nudge from a thought step and ships it."
3. **The structural fix candidate.** "Establish a kernel invariant: `status=failed → output=null` (no exceptions). Move the lastThought→state.output synthesis INTO the kernel before the verifier gate so the verifier always sees what the user will see."
4. **What you expect the after-trace to show.** "T2/T4/T5 → outputLen=0; T3/T5 → verifier-verdict.verified=false on agent-took-action; verifier-verdict event count goes up because the gate now fires on more terminations."

If you can't fill in (4), you don't have a falsifiable hypothesis yet — keep diagnosing.

**Call advisor() before committing to the fix** when the hypothesis is non-trivial. The advisor sees the full trace evidence; their independent reading often surfaces alternative root causes (H1 vs H2) that look the same in the immediate symptom.

### Anti-patterns at this phase

- "Add a guard in execution-engine.ts to filter the parroted text" — band-aid; the leak is the kernel's output ownership being unclear.
- "Bump the recovery nudge budget" — symptom-papering; doesn't address why the model parrots in the first place.
- "Disable strategy switching for this case" — disabling a feature to make a probe pass is reactive, not architectural.
- "Just delete the failing test" — never. Test failures are signal.

---

## Phase 5 — Fix (one coordinated change, then stop)

Make the minimum coordinated set of edits that implements the hypothesis. Don't fold in adjacent cleanups — those are a separate commit.

After editing, **rebuild every package whose dist a probe consumes**. The most painful diagnostic time-sink is "my edit isn't reaching the running code" because dist is stale:

```bash
cd packages/reasoning && bun run build
cd packages/runtime   && bun run build
cd packages/trace     && bun run build
cd packages/diagnose  && bun run build
```

(Or just `bun run build` from the root — the turbo cache makes it cheap when nothing changed.)

Then re-run the probe with the same model + scenario as Phase 2.

---

## Phase 6 — Verify (before/after, structurally)

Two checks every fix must pass before commit:

**(A) The targeted failure mode is gone, by trace evidence.** Use `rax:diagnose diff <before-runId> <after-runId>`. The diff should show:
- Verifier rejections moved in the predicted direction (more → fewer for a fix that actually solves the problem; more → more for a fix that exposes new issues that were being masked)
- Output length / status / terminatedBy on the final snapshot match the prediction in Phase 4 step (4)
- No unexpected new harness-signal kinds firing

**(B) Test suite is no worse than baseline.** Run `bun test` from the package whose source you edited. Tally failures vs the pre-edit baseline (often there are pre-existing failures unrelated to your change — record them with `git stash; bun test; git stash pop` if you're not sure). **Net new failures = blocker, not an excuse to commit.**

If a test that was passing now fails, three options in priority order:
1. The test reveals a real regression — fix the regression
2. The test was asserting a behavior the fix legitimately changes — update the test with a comment explaining why the new behavior is correct
3. (Rare) The test depends on something tangential to the fix — split the unrelated change out of this commit

**(C) For a harness-mechanism change: the fix passes the gate's lift rule.** Re-run the same cross-tier bench with the fix as the `ra-full` candidate (or a dedicated candidate `HarnessVariant`) and gate it:

```bash
rax eval gate --report after.json --baseline bare-llm --candidate ra-full \
  --ledger wiki/Research/Harness-Reports/improvement-ledger.json \
  --weakness "<the failure mode>" --hypothesis "<the structural fix>"
```

`default-on` (≥3pp ∧ ≤15%tok across ≥2 tiers) = the fix earns default-on; `opt-in` = positive but gated; `reject` = no lift or a tier regresses. The ledger records the verdict so the improvement chain is auditable (`rax eval ledger`). Note: a trace-level fix can be structurally *correct* yet `reject` on lift — both facts matter, and the ledger entry should say so.

### When to call advisor() again

Before declaring done. The advisor sees your full trace evidence, the diff, and the test results. They catch "your fix made the targeted thing better but broke something else" cases that aren't visible from inside the iteration.

---

## Phase 7 — Commit (evidence in the message, no co-authors)

Commit messages for harness fixes should answer:
1. What failure mode was observed (with empirical evidence: trace runId, verifier verdict, etc.)
2. What the mechanism was (root cause, not symptom)
3. What changed structurally (the invariant or contract being established)
4. Verification: before/after numbers + tests pass/fail counts

Template:

```
fix(<package>): <one-line summary of structural change>

Empirical: <model> × <probe> trace <before-runId> showed <symptom>.

Root cause: <mechanism — one paragraph max>.

Structural fix:
  1. <coordinated change 1>
  2. <coordinated change 2>
  ...

Verification:
  - Trace diff <before-runId> → <after-runId>: <key delta>
  - Tests: N ran, M fail (= baseline of M, zero new regressions)
  - Verifier behavior: <expected verdict change>

<Optional: what this DOESN'T fix and what's deferred>.
```

**Do not add `Co-Authored-By` lines.** This is in user memory.

---

## Anti-Patterns (carry-over from old skill — still valid)

- **Don't fill hypotheses from code reading alone.** Every claim about runtime behavior needs a trace event or test output backing it.
- **Don't fix while diagnosing.** Probe → diagnose → hypothesize THEN edit. Editing during diagnosis pollutes the symptom.
- **Don't accept "close enough" verification.** If the trace diff doesn't show the predicted shape, the fix probably doesn't do what you think — even if a probe score happens to improve.
- **Don't skip the orient phase on a session you're returning to.** Codebases drift; the file you remember may have moved.
- **Don't bypass the verifier or invariants to make a probe pass.** Disabling a guard to "see what happens" is a diagnostic move, not a fix.
- **Don't run multiple unrelated changes in the same fix commit.** Each commit should have ONE structural hypothesis attached.

---

## Reference — `rax:diagnose` command cookbook

```bash
# List recent runs (default trace dir is ~/.reactive-agents/traces)
bun run rax:diagnose list

# Pretty timeline with iteration grouping
bun run rax:diagnose replay latest
bun run rax:diagnose replay <runId>

# Filtered replay (most useful default for diagnosis)
bun run rax:diagnose replay latest --only=kernel-state-snapshot,verifier-verdict,harness-signal-injected

# Raw JSONL stream (for piping — note: use --silent to strip the bun wrapper line)
bun run --silent rax:diagnose replay latest --json | jq 'select(.iter > 5)'
bun run rax:diagnose replay latest --raw

# Predicate-based filter (e is the event)
bun run --silent rax:diagnose grep latest "e.kind === 'verifier-verdict' && !e.verified"
bun run --silent rax:diagnose grep latest "e.kind === 'harness-signal-injected' && e.signalKind === 'redirect'"
bun run --silent rax:diagnose grep latest "e.kind === 'kernel-state-snapshot' && e.outputLen > 0 && e.status === 'failed'"

# Two-trace structural diff
bun run rax:diagnose diff <runIdA> <runIdB>

# Help
bun run rax:diagnose --help
```

**Run-id resolution:** bare ULID (resolves under `~/.reactive-agents/traces/`), absolute path to a `.jsonl`, or the literal `latest`.

**Env switches:**
- `REACTIVE_AGENTS_TRACE=off` — disable trace recording for a run
- `REACTIVE_AGENTS_TRACE_DIR=<path>` — custom trace directory
- `DEBUG_VERIFIER=1` — also stream verifier verdicts to stderr (legacy; prefer the trace)

---

## Reference — diagnostic event types

The trace JSONL captures these structured events. Schema lives in `packages/trace/src/events.ts`:

| Kind | Captures | Useful for |
|------|----------|-----------|
| `run-started` / `run-completed` | Lifecycle endpoints | Total tokens, duration, status |
| `kernel-state-snapshot` | Per-iteration kernel state | Step composition, output length, tools used, terminatedBy |
| `verifier-verdict` | Verifier gate firings | Output rejection reasons (failed checks) |
| `guard-fired` | Guard/phase decisions | Which control-flow branch took the path (when wired) |
| `harness-signal-injected` | Harness-authored steps | File:line origin of nudges/redirects |
| `llm-exchange` | LLM round-trip | Prompt + response capture (when wired at provider level) |
| `entropy-scored` | Per-iteration entropy | Composite + per-source breakdown |
| `decision-evaluated` | RI controller decisions | Decision type + confidence |
| `intervention-dispatched` / `-suppressed` | Dispatcher activity | Which interventions fired vs were gated |
| `strategy-switched` | Strategy escapes | from/to/reason |
| `tool-call-start` / `-end` | Tool invocations | Per-call duration + ok/error |

`guard-fired` and `llm-exchange` are framework-ready (helpers exported from `@reactive-agents/reasoning`) but emit sites are not yet wired across all guards / providers. Wire as needed; this is non-blocking for most diagnoses.

---

## Deferred — when to revisit

These were scoped out of the skill rewrite to keep iteration fast. Add them when the cost of NOT having them shows up:

- **`rax:diagnose explain` (LLM-as-judge taxonomy)** — emits `{ legitimate | parrot-of-harness | fabrication | incomplete-honest | empty-but-failed }` plus root-cause hint. Add when hand-rolled `noFabrication` regex misses real fabrications (it has — see T4 in 2026-04-27 session).
- **Deterministic LLM replay fixtures (`record` / `replay-fixture`)** — record an LLM stream from a real failure, replay it deterministically against the kernel to test fixes. Add when probe variance becomes the bottleneck for regression confidence.
- **Step-type migration of remaining `makeStep("observation", ...)` sites in `think-guards.ts` and `think.ts`** — Sprint 3.4 Stage 2; 9 sites still inject harness messages as `type: "observation"`. Currently masked by `execution-engine.ts:3563` filter on `toolName === "system" || success === false`. Migrate when it stops being functionally equivalent.
- **Verifier-driven retry loop (Sprint 3.5 Stage 2/3)** — when verdict=false, inject the failed check's reason as a `harness_signal` and continue for one more iteration with that guidance. This is the highest-leverage next move for raising actual task success rates (the current architecture is honest about failure but doesn't help the agent recover).

---

## Pass cleanup (lighter than before)

Per session you'll accumulate JSONL traces and probe summaries. The diagnose CLI is happy with hundreds of files in `~/.reactive-agents/traces/`, but for archival hygiene:

```bash
# Keep last 50 traces; archive older
ls -t ~/.reactive-agents/traces/*.jsonl | tail -n +51 | xargs -I{} mv {} ~/.reactive-agents/traces/archive/ 2>/dev/null || true
```

`wiki/Research/Harness-Reports/` should keep the latest probe summary per model and the current improvement log. Older runs can move to `wiki/Research/Harness-Reports/_archive/`.

No formal "pass close-out" template anymore — the diagnostic evidence lives in the trace JSONL and the commit message. If you want a session log, write a single `wiki/Research/Harness-Reports/improvement-YYYY-MM-DD.md` with a paragraph per fix; don't reach for the heavy template.

### Cross-link findings to the wiki graph (high-leverage)

When a session yields a non-trivial finding, link it into the knowledge graph so future sessions discover it. **Use `claude-obsidian:save` to auto-structure with proper frontmatter and wikilinks** — much cleaner than hand-writing.

| Trigger | Action | Tool |
|---------|--------|------|
| **Significant fix shipped** | Write a debrief | `claude-obsidian:save` → `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md` |
| **New failure mode discovered** | Add FM page + update catalog | `claude-obsidian:save` → `wiki/Failure-Modes/FM-<X>-<name>.md`, then Edit `02-FAILURE-MODES.md` |
| **Mechanism behavior changed** | Update Experiment note | Edit `wiki/Experiments/M*.md` (use `claude-obsidian:obsidian-markdown` to validate OFM) |
| **Architectural decision** | Decision record + index | `claude-obsidian:save` → `wiki/Decisions/`, update `Decision Index.md` |
| **Active blocker** | Issue entry | Edit `wiki/Issues/Running Issues Log.md` |
| **External research** | Ingest with structure | `claude-obsidian:wiki-ingest` (use `defuddle` first if URL) |

Use Obsidian wikilinks (`[[Failure-Modes/FM-A Tool Engagement]]`) so the graph navigates correctly. The `obsidian-markdown` skill validates OFM correctness on writes.

**This is the payoff for the wiki consolidation:** every harness improvement loop pass enriches the project brain. Future agents (Claude/Cursor/Codex/etc.) discover prior diagnostic work via `wiki-query` instead of re-running it.

### Maintain the graph (every few sessions)

```
claude-obsidian:wiki-lint    # catches orphan reports, dead links, stale frontmatter
```

Run after a flurry of new reports/debriefs. Top-priority lint findings to fix immediately:
- Orphan harness reports (no inbound link from MOC or Index)
- Dead wikilinks in newly-written debriefs (typos in `[[wikilink]]`)
- Stale `status: active` plans that should be `completed`

Lower-priority lint findings can be batched into a "wiki hygiene" pass.

### Periodic rollup (monthly): `claude-obsidian:wiki-fold`

When `wiki/Research/Harness-Reports/` accumulates 30+ files, fold into meta-pages:
```
claude-obsidian:wiki-fold harness-reports
```
Produces `wiki/Research/Harness-Reports/_rollups/<period>.md` summaries while preserving originals. Speeds up future `wiki-query` calls.

---

## Summary — the loop in one screen

```
1. ORIENT       Read kernel + recent commits.
                → claude-obsidian:wiki-query "<symptom + tier + subsystem>"
                → If unfamiliar: claude-obsidian:autoresearch "<topic>"
2. PROBE        Primary: a 2-variant (bare-llm vs ra-full) cross-tier bench session,
                calibrated models, runs≥3, traceDir set, judge-server live (non-SUT).
                → rax bench --session <s> --output report.json   (SessionReport + RunDiagnosis)
                Legacy: a probe script for a single subsystem the tasks miss.
3. DIAGNOSE     bun run rax:diagnose replay latest --only=...
                bun run --silent rax:diagnose grep latest "<predicate>"
                Identify failure mode + mechanism from trace evidence.
4. HYPOTHESIZE  Write down: failure / mechanism / structural fix / expected after-state.
                Call advisor() if non-trivial. No band-aids.
5. FIX          One coordinated change. Rebuild affected packages.
6. VERIFY       Re-run same probe. bun run rax:diagnose diff <before> <after>.
                Harness change → rax eval gate (lift rule) + record to --ledger.
                bun test → no net new regressions. Call advisor() to confirm.
7. COMMIT       Evidence in the message. No Co-Authored-By.
                → claude-obsidian:save findings as debrief / FM / decision (if significant)
                → Update wiki/Issues/Running Issues Log.md if new blocker

PASS CLEANUP    claude-obsidian:wiki-lint (catch orphans, dead links)
                claude-obsidian:wiki-fold (monthly, when reports accumulate)

Repeat until hypothesis-list is exhausted or new evidence demands re-orienting.
```

## Quick Reference — claude-obsidian Skills in This Loop

| Phase | Skill | Why |
|-------|-------|-----|
| 1. Orient | `wiki-query` | Beats grep — reads hot cache + index, surfaces semantic matches |
| 1. Orient | `autoresearch` | When wiki has no prior context, ground hypothesis in external research |
| 1. Orient | `wiki` | Full vault structure check (rare, only after major restructure) |
| 7. Commit | `save` | Save debrief/FM/decision with proper frontmatter + wikilinks |
| 7. Commit | `obsidian-markdown` | Validate OFM correctness on any wiki edit |
| 7. Commit | `wiki-ingest` | Ingest external sources (papers, blog posts) cited in fix |
| Cleanup | `wiki-lint` | Catch orphan reports, dead wikilinks, stale frontmatter |
| Cleanup | `wiki-fold` | Roll up high-volume Harness-Reports/ into meta-pages |
| Visual | `canvas` | When investigating multi-mechanism interactions spatially |
| Pre-ingest | `defuddle` | Strip web clutter before `wiki-ingest` |
| Indexes | `obsidian-bases` | Create `.base` files for dynamic index views |

See [[wiki/Development/Wiki-Workflow|Wiki-Workflow.md]] for the canonical 4-step pattern (Orient → Capture → Persist → Maintain) used across all skills.
