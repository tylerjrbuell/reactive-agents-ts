---
type: implementation-plan
status: active
created: 2026-10-12
tags: [local-models, slm, kernel, control-plane, capability, harness-boost, reliability, dx, lift-gated]
evidence: [[Research/Harness-Reports/2026-10-12-live-probe-audit-results]]
---

# Local-Tier Reliability & Control-Plane Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (per task; each task routes to its domain warden with a MissionBrief per the Team-Ownership Dev Contract) or executing-plans. Steps use `- [ ]`. **No behavioral task ships without its Lift Protocol result recorded in a Harness-Report.** Deterministic tasks ship with a red-on-cut pin.

**Goal:** Make the harness's *actuators* as good as its *sensors* — measured, per wave, on real local models — so complex multi-step agent tasks become reliably achievable on all model tiers, especially SLMs/local, and every enforcement/quality claim is backed by machinery.

**Architecture:** One capability arbiter (registry → per-model probe → calibration posterior) becomes the single routing truth for tier, tool-calling strategy, guard budgets, and context math. The meta-loop's already-computed signals (assess() evidenceDelta, outstanding requirements, pace band) gain default-on consumers. Terminal honesty and enforcement get boundary-level prevention (config census + e2e scenarios), not per-site patches. Existing seams are reused — `assess()`, F10 volatile tail, `growRunLedger`, arbitrator terminal gate, compose hooks, EvalStore pattern, wither-census, HealingPipeline, rescueFromThinking — and parallel stacks are collapsed, never forked.

**Tech Stack:** Bun ≥1.1, Effect-TS ^3.10, bun:test, tsup/turbo, Ollama local fleet on the dev box (qwen3:4b, qwen3.5, qwen3:14b, llama3.2, llama3.1, granite4, cogito 3b/8b/14b, gemma4:e4b, deepseek-r1:14b, phi4-mini-reasoning, gpt-oss), `rax` CLI + `rax diagnose`.

**Spec/evidence:** [[Research/Harness-Reports/2026-10-12-live-probe-audit-results]] (live-verified verdict table for every finding) · Stage-B design: `wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md` · Kernel architecture (RATIFIED): `wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md` · Sequencing authority: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`.

**Shipped substrate (as of 2026-10-12):** `#206` exhausted-run abstention + `f56f2df5` give-up honesty gate are live on `dev` — the worked deterministic halves of law #5 / 4.7 / 5.2. Remaining waves close the *class*, not these sites.

## Global Constraints

- Measurement ladder: deterministic replay → haiku → fast local tool-caller; **default-on promotion needs rungs 2+3 agreeing in sign** (Hot.md).
- **Verified-defect fixes ship on defect-elimination proof** (the live signature goes to 0 on the pinned fixture panel); **new mechanisms ship on the lift rule** (≥2 tiers, ≥3pp, ≤15% token overhead, ablation-warden gate). Everything else stays shadow/flagged with a sink.
- **Red-on-cut** for every task (Corrective Doctrine #1): a scenario that goes red when the wiring is severed. Seam tests must set values production can actually reach (the `241e7efe` lesson).
- Wire-or-delete: a task that orphans a field deletes it in the same commit or names the consumer + test.
- Honesty law: docs/README claims updated in the same commit as the status change; no claim leads its DEBT-REGISTER PROVEN row.
- One concern per commit; one changeset per wave; no AI co-author trailers; scoped tests with `--timeout`; live Ollama cases behind `REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS=1` with the `abstention-synthesis-206.test.ts` auto-skip pattern; `Bun.serve` mocks torn down (`.stop(true)`).
- `bun run typecheck` 68/68 + touched-package suites green per task; `bun run build` 38/38 at wave close.
- **Concurrent-work guard:** a parallel session is actively landing related fixes on this branch (`f56f2df5` give-up honesty gate; the 4.7 progress-arbiter below). Before editing any kernel/runtime file: `git log --oneline -5` + re-read the target region; if a neighbor session owns the region, rebase the task on their shipped shape instead of duplicating (one mechanism per job — DRY across sessions too).
- **Design law #5 — ONE progress arbiter (added 2026-10-12 by parallel planning session; folded in after rewrite-clobber):** a single predicate classifies every step/observation/output as **SUBSTANTIVE** vs **NON-PROGRESS** (framework helper, no-op, or give-up/non-answer), and *every* "did we progress / did we succeed" consumer must derive from it: loop-detector patterns (a)-(e), `assess()` `evidenceDelta`, pace banding, groundedness/delivery, terminal honesty, receipt verdict. Mirrors design law #1 (one capability arbiter) for the progress dimension. This is the actual root, stated once; 4.7 is its implementation task.

## Lift Protocol (feedback loop — applies to every ⚡ task)

**Traces rotate out of `~/.reactive-agents/traces` within minutes** (observed live: the motivating false-success trace vanished mid-planning, and a re-run of the same prompt produced a `loop_graceful` *failure* instead of the original 10-iteration *success* — same defect family, different sampling). Therefore pinning happens in Task 0, and:

1. **Pre-fix capture:** scenario run N=5 (temperature 0) with `REACTIVE_AGENTS_TRACE_DIR=<fixtures dir>` → commit traces + MANIFEST row (model, prompt, expected defect signature) under `wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-results/fixtures/`.
2. **Post-fix capture:** same script/model/seed → `rax diagnose diff pre post` + scenario re-run.
3. **Verdict row** in `wiki/Research/Harness-Reports/2026-10-12-program-scoreboard.md` (the single program-wide table): success rate | tokens/run | llmCalls/run | iterations-to-first-acting | false-success count | empty-content-iteration rate | schema-tokens/req | classify-calls/req. Regression >10% on any control metric blocks the wave.
4. **Cut-test:** sever the wiring → scenario red. Both directions verified before commit.

## Review Focus

Input/condition classes no happy-path test covers — each line's pin is added to the owning task:

1. **Thinking models with empty visible content** (answer lives in the thinking channel; live: 1,213 thinking chars vs 2 content chars) → Task 1.3 test: rescue fires from forwarded thinking.
2. **Unknown/uncalibrated models must never be routed to text-parse** (false-negative capability strands a capable model; the `482c11e4` divergence class) → Task 3.1 mutation-pin: native driver is the fallback for unknown.
3. **Decimal-size model names** (`"qwen3:1.7b"` → regex `/(\d+)b/` matches "7b") → Task 2.1 classification matrix includes decimals, `:latest` tags, unknowns.
4. **`success:true` tool results that add no evidence** ("No tools registered.") → Task 4.1 pin: pattern (e) fires on the S1 fixture shape (varied args, all "successful").
5. **Delegated-partial laundering** (child partial, parent `completed`) and **fresh child budget pools resurrecting #231** → Tasks 5.3/5.4 pins (worst-of join; meter propagation test).
6. **Head-truncation on "in-budget" prompts** (Ollama truncates the system prompt at real num_ctx while the chars/4 estimate thinks it fits) → Task 2.5 pin: overflow guard fires before truncation; assert system-prompt head survives.

---

## Task 0: Baseline capture + lift harness (prerequisite; zero framework change)

**Warden:** parent (harness infra). **Depends:** nothing. **Blocks:** every ⚡ task.

**Files:** Create `scripts/lift/bench.ts` (scenario runner), `wiki/Research/Harness-Reports/2026-10-12-program-scoreboard.md` (init + baseline columns), `wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-results/fixtures/MANIFEST.md`; reuse `scripts/probe-2-thinking-loss.ts`, `scripts/probe-3-context-math.ts`, `scripts/probe-4-wander-repro.ts` (created during verification — relocate into `scripts/lift/`).

**Produces (Interfaces):** `runScenario({arm, runIndex, temperature:0, traceDir}) → RunMetrics` per-run + CLI arm/n loop (amended at Task 0 ship — per-run return enables crash-safe incremental capture; see scripts/lift/bench.ts) with per-run metric extraction from trace JSONL (`assessment.evidenceDelta`, `llm-exchange` content/toolCalls/usage, `guard-fired`, `decision-evaluated`, `run-completed`); MANIFEST schema: `scenario | model | runId | date | defect signature counts`.

- [x] 0.1 Implement `scripts/lift/bench.ts` + metric extractor (parses trace events by kind; no framework imports beyond the public builder).
- [x] 0.2 Define the four canonical scenarios (temp 0):
      **S1 thrash** — no tools registered, task "Send a slack message to #general saying 'Hello team'" (qwen3.5 + qwen3:4b). Signature: evidenceDelta=0 every assessment, loop-detector silent, early-stop or loop_graceful.
      **S2 thinking-starve** — arithmetic word problem sized so thinking ≫ visible content (qwen3:4b). Signature: empty-content think iterations, `providerThinking`-rescue miss.
      **S3 multi-step file task** — read 2 small input files → transform → write 3-section report; builtins `file` toolset; 8K num_ctx (qwen3:4b, llama3.2). Signature: schema tokens ≈ 4-5K/req, false-success possible, outstanding-never-satisfied loop.
      **S4 no-FC loop** — builtin `file` toolset against a model whose template probe reports no tool emission (verify candidate via `/api/show` on llama3.1/phi4-mini first; SLM-fallback arm). Signature: markup emitted, nothing acts, maxIterations burn.
- [x] 0.3 Capture S1-S3 N=5 each into fixtures/ + MANIFEST; probe-2/probe-3 outputs recorded as unit-style fixture rows.
- [x] 0.4 Rung-2 (BLOCKED: Anthropic credit; one-command rerun documented in scoreboard) (haiku) equivalents of S1/S3 via existing bench harness (`getVariant("ra-full")`), stored alongside.
- [x] 0.5 Initialize scoreboard with baseline values; declare measurement freeze (Doctrine #4) in Hot.md; commit `test(lift): baseline fixtures + scoreboard for reliability program`.

**Gate:** scoreboard has baseline values for every ⚡ metric column; S1 fixture replays deterministically via the replay lane.

---

## Wave 0 — Front-door truth (DX; zero coupling; ~1 day; parallel-safe with all waves)

**Warden:** runtime-warden + parent (create-reactive-agent).

- [x] W0.1 **Scaffold version:** read own package.json version (precedent: `cli.ts:32-40`) instead of `RA_VERSION_FALLBACK="^0.14.0"` (`packages/create-reactive-agent/src/templates/shared.ts:10`); add stamp-check to `scripts/release.ts` so drift is a release error. Test: `packages/create-reactive-agent/tests/scaffold-version.test.ts` (generated package.json dep range === own version).
- [x] W0.2 **Scaffold `.env`:** template start script → `tsx --env-file=.env src/index.ts`; missing-file path prints the instructive error, not a crash wall. Test: generated script text + smoke run keyless → expected named error.
- [x] W0.3 **Implicit-test-provider warning:** builder tracks `_providerExplicit`; when provider resolves to `test` without an explicit call, `build()` logs a prominent warning ("agent will return canned output and report success without calling a model"). Explicit `.withProvider("test")` stays silent. Test: `packages/runtime/tests/builder-test-provider-warning.test.ts` both directions.
- [x] W0.4 **Kernel surface export:** `makeKernel`, `Phase`, `Guard`, `KernelState`, `KernelContext`, `MetaToolHandler` from `packages/reasoning/src/index.ts` (only `reactKernel`/`executeReActKernel` at :441 today); rewrite `apps/docs/src/content/docs/concepts/composable-kernel.md` with published-package imports (kill repo-relative paths, remove its `docs-skip-typecheck` markers).
- [x] W0.5 **Result→trace linkage:** `result.metadata.tracePath` + `runId` set at the finalize seam (precedent: `harnessAuthoredOutput` on `AgentResultMetadata`, HEAD `edc8362f`). Test: run → file exists → `rax diagnose replay <tracePath>` exits 0. (This is also the Lift Protocol's plumbing.)
- [x] W0.6 **Scaffolder unification:** `rax init` (`apps/cli/src/commands/init.ts`) delegates to the `create-reactive-agent` template engine; duplicate template tree deleted.
- [x] W0.7 **Docs-consistency tests:** strategy-count assertion (README/docs vs `StrategyRegistry` bootstrap — the 8/7/5 contradiction class); one documented `AgentResult` decision procedure over success/status/terminatedBy/goalAchieved/receipt.verdict in `your-first-agent` + builder-api (throw-vs-return asymmetry `reactive-agent.ts:1185-1210` documented honestly; unification deferred to a breaking wave, cross-referenced here); README `effect` peer-dependency wording corrected.
- [x] W0.8 **Replay-as-CI surfaced:** "Deterministic testing" section in `cookbook/testing-agents.md` — recordRun → fixture → `makeReplayLLMLayer` → bun test, with the temperature-0/pin caveats from the Lift Protocol; re-badge `snapshot-replay.mdx` when the cookbook's own test passes against it.

**Gate:** keyless CI job: scaffold into tmp, assert version match + `--env-file` + warning fires; docs examples compile; commit + changeset `patch`.

---

## Wave 1 — The thinking channel (⚡; largest per-run SLM quality win; 2-3 days)

**Warden:** provider-warden (1.1-1.2) + kernel-warden (1.3-1.4). **Depends:** Task 0.

**Root cause (live-verified):** `StreamEvent` has no thinking variant (`llm-provider/src/types.ts:981-1035`); `local.ts` stream loop forwards only content+tool_calls (`:782-830`); `think.ts` builds `thoughtResponse` from stream accumulators WITHOUT thinking (`:1248-1255`) → `providerThinking` (`:1329`) always undefined → `rescueFromThinking` (`:1332-1337`) starving. complete() already extracts thinking (`local.ts:522-610`, `types.ts:929-930`) — the fix is symmetry, not invention.

- [ ] 1.1 **Wire protocol:** add `{type:"thinking_delta", thinking:string}` + `thinking?: string` on `content_complete` to the ONE union. Consumers: `think.ts` accumulator; ui-core/react/svelte/vue stream mapping — extend or explicitly drop with recorded reason (the #188 three-way divergence is the cautionary precedent; add a parity test across the three bindings).
- [ ] 1.2 **Provider forwarding:** `local.ts` stream loop reads `chunk.message.thinking` in the same accumulation pass as content (no second loop); audit the other thinking-capable adapters (anthropic thinking blocks) to route through the same event. New emitter: none — reuse existing chunk-iteration seams.
- [ ] 1.3 **Kernel consumption:** `thoughtResponse.thinking` populated → existing `providerThinking`/rescue/`lastThinking` FA-check paths activate with zero new parsing logic. Review Focus #1 pin: canned empty-content + thinking-with-final-answer → rescued thought == answer; no-thinking regression arm byte-identical.
- [ ] 1.4 **Forensics:** thinking length + capped preview on `llm-exchange` trace event so `rax diagnose replay` shows what the model actually produced. No ledger/stream payload growth (cap = existing compaction constants).
- [ ] 1.5 **Probe cell + lift:** cut 1.2 → S2 arm red (empty-content rate above pinned ceiling). S2 before/after: empty-content-iteration rate → ~0; FM-A1 describe-vs-emit family rungs 2+3. Records: scoreboard row, Hot.md note "#38 thought-continuity unblocked (was void on local by construction)".

**Changeset:** `patch`. **Rollback:** union additive — consumers tolerate absence; no data migration.

## Wave 2 — One capability arbiter; small-context math (⚡; 3-4 days)

**Warden:** provider-warden (registry/probe/counter) + kernel-warden (profile→assembly). **Depends:** Task 0; W1 co-lands `supportsThinking` derivation.

**Root causes (live-verified):** regex tiering → `qwen3:1.7b`→mid ("7b" match), every Ollama ≥4B → mid; registry already declares `tier:"local"` for qwen3:4b (`capability.ts:516-530`) and is consulted by nobody (`builder.ts:2625` uses the regex). `tokenizerFamily` is zero-consumer registry data → chars/4 undercounts JSON BPE ~35% → "in-budget" prompts overflow num_ctx → Ollama head-truncates the system prompt. Measured FC wire array (opt-in builtins): 11,838 chars ≈ 4,000 corrected tokens ≈ 49% of an 8K window, 80% descriptions; `toolSchemaDetail` strips prompt text only (`think.ts:845-852`), never the array (`think.ts:980-1000`). D-2026-07-30-H inversion: `local.toolResultMaxChars 4000 > mid 1200`.

- [ ] 2.1 **Registry-first tiering:** `resolveProfileWithWindow` consults the Capability registry (static table → probe → calibration posterior), name-regex ONLY on registry miss (marked provisional). **Delete the ollama size-regex branch** (`profile-resolver.ts:91-104`) — the 7b bug dies by removal. One classifier (Review Focus #3 matrix: decimals, `:latest`, unknown fallback).
- [ ] 2.2 **Probe-derived ladder:** extend the existing `/api/show` probe path (`local.ts:226-255` pattern) to capture `parameter_size` + tool-template emission + thinking support into Capability; tier from measured size; budgets **monotone in tier** (D-2026-07-30-H → RESOLVED; choose local ≤ mid and document). No new band count beyond evidence (YAGNI).
- [ ] 2.3 **Tokenizer-aware estimation:** ONE `estimateTokenCount` (`token-counter.ts:7-19`) gains a family correction factor (per-family factors MEASURED in Task 0.3 against real `prompt_eval_count`s from this box's streams — seed llama-family ≈ 1.35, gemma/qwen2.5 measured same pass; stored beside calibrations). All budget consumers inherit at existing call sites (they already share this helper — DRY).
- [ ] 2.4 **FC payload honesty:** `toolSchemaDetail:"names-and-types"` applied to the wire array at `think.ts:980` (drop description strings; keep name/type/required/enum). Extend the existing prompt-text stripper's semantics; do not fork a second stripper. Review Focus / red-on-cut: local arm payload ≥3× smaller; frontier arm unchanged.
- [ ] 2.5 **Head-truncation guard:** preflight assembled-prompt corrected tokens + outputBudget ≤ num_ctx; on overflow shrink the tool surface first (drop least-relevant schemas using the classifier's existing relevance ranking at the `tool-surface-resolved` seam), then history. Review Focus #6 pin: system prompt head survives an engineered 8K-overflow scenario. Emits a harness-signal + ledger fact (observable, not magic).
- [ ] 2.6 **Classifier skip honesty:** `classifierReliability:"low"` must actually skip the extra `purpose:"classify"` round-trip (live trace: fired on local anyway — the documented skip is unenforced). Pin: classify-calls/req metric in scoreboard drops 1 on low-reliability local arms.
- [ ] 2.7 **Census + register:** every touched field PROVEN (mutation-cut) or deleted; unreachable CONTEXT_PROFILES fields removed; DEBT-REGISTER rows (D-…-H RESOLVED; D-…-I stays opt-in — measured reload penalty stands, do not flip).

**Lift:** S3 before/after — schema-tokens/req, head-truncation incidents (0), llmCalls/run (−classify), tokens/run. **Changeset:** `minor`.

## Wave 3 — Degraded tool-call spectrum, Stage B (⚡; the identity thesis; 4-6 days)

**Warden:** provider-warden (claim/probe/store) + kernel-warden (think/act transition). **Depends:** W2 (arbiter is the routing input). Implement the existing spec (`2026-06-03-tool-calling-driver-redesign.md`) — do not redesign it.

**Root cause (code-admits):** `select-driver.ts:25-32` — "text-parse is a not-yet-completed path… think.ts has no transition… extractCalls is unreachable"; `local.ts:1150` hardcodes `supportsToolCalling:true` for every Ollama model; the box's own calibration files measure `toolCallDialect:"none"` for qwen3:4b/qwen3:14b — inert data with "NO behavioral effect" per its own comment (`capability.ts:501-505`). No-FC models get native-FC treatment and burn maxIterations. The thesis "the harness compensates for model weakness" is one transition away from reachable.

- [ ] 3.1 **Derived capability claim:** `supportsToolCalling` = chat template emits tool tokens (probe from 2.2) ∧ dialect posterior — replacing the constant. Land the **deferred CalibrationStore write-through** (probe results persist per model; the process-Map cache in `local-probe.ts:17-25` dies). Review Focus #2 mutation-pin: unknown/uncalibrated → native driver + healing cascade, NEVER text-parse stranding.
- [ ] 3.2 **think→acting transition:** in text-parse mode, parse the dialect's markup (the `TextParseDriver`'s existing 3-tier XML/JSON/pseudo-code cascade), map to tool-calls, transition `status:"acting"`; calls then flow through the SAME guard chain, policy choke point, healing pipeline, and ledger seam as native FC (`act.ts`'s text-parse `extractCalls` finally reached; `growRunLedger` unchanged). No second dispatch path (DRY).
- [ ] 3.3 **Dialect live:** `selectToolCallingDriver(dialect, supports)` consumes the previously-dead `_dialect` param (Stage-B design's stated end state); meta-tool sentinels stay in the array for text-parse runs (the native-FC control-plane invariant at `think.ts:944-957` already exempts text-parse — verify, don't re-fork).
- [ ] 3.4 **Healing integration:** text-parsed calls route through HealingPipeline (param coercion/aliases) before acting — same pipeline native calls use; ExperienceStore write-through already loops experience back.
- [ ] 3.5 **Shadow-first rollout + lift:** ship behind `REACTIVE_AGENTS_TEXT_PARSE=shadow` (parse, record parse-diff trace event, do not act) → S4 fixtures measure would-have-executed rate; promote parse→act only when rungs 2+3 agree (haiku with FC disabled + real no-FC local). S4 before/after: iterations-to-first-acting 0→>0, maxIterations-burn arms complete. Red-on-cut: sever the transition → S4 arm red.
- [ ] 3.6 **Honesty sync:** README "adaptive tool calling… automatically, per model, per session" gets TRUE only at promotion; until then the claim is scoped in the same commit as the flag.

**Changeset:** `minor`. **Risk:** dialect misrouting → mitigated by 3.1's fail-safe pin + shadow stage.

## Wave 4 — Wandering detection + control-plane reconciliation, default-on (⚡; 4-5 days)

**Warden:** kernel-warden. **Depends:** W1 (thinking fixes "thinking-only" misreads), W2 (tier thresholds honest).

**Root causes (live-verified):** loop-detector patterns are byte-identical-repeat (a) and same-name/no-success (d) (`loop-detector.ts:60-130`) — the dominant pathology (varied args, `success:true`, zero new evidence) trips neither; the captured S1 run thrashed `discover-tools` 5× with "No tools registered" while `evidenceDelta:0` on ALL 10 assessment events, band `"green"` (pace keys off token volume, not evidence), and the one strategy-switch that fired misdiagnosed it ("thinking steps with no tool calls"). `dispatcher-early-stop` fired with `confidence:0` while status `acting`, short-circuiting the terminal gate (`arbitrator.ts:187-189`), and shipped the last thought as the answer. The actuation half of the meta-loop sits behind `.withLongHorizon()` whose ablation was INCONCLUSIVE (n=1) — `guard-adapters.ts:18-21`, `pace-actions.ts:39/81/103`, `iterate-pass.ts:1131/1287/1534`, `standing-frame.ts:79` (`showOutstanding:false`), while assessment computed the right diagnosis every iteration and nothing consumed it.

- [ ] 4.0 **Refactor-first (enables 4.1-4.7):** `iterate-pass.ts` — replace the 1,734-line function's mutable carrier + 19 manual `sync()` sites with typed per-branch delta returns (or generator return-protocol; single writer). Byte-identical behavior, pinned by existing loop tests + golden traces. This is the 07-31 audit P1-4 debt; landing 4.1-4.7 on it pays the fragility tax once, not five times.
- [ ] 4.1 **Pattern (e) — evidence staleness:** N consecutive iterations with `assess()` `evidenceDelta == 0` (already computed, deterministic, zero LLM cost) → fires regardless of tool variety/args; consumed through the control plane, not ad-hoc counter patches. Also fix pace banding: `band:"green"` impossible while `evidenceDelta==0 ∧ requirementsOutstanding>0` (band from evidence, not token volume). Review Focus #4 pin replays the S1 fixture shape. This fills `cf-TODO-w2` (loop-detect resets).
- [ ] 4.2 **Split the long-horizon opt-in:** reconciliation arm (evidence-delta counter resets, synthesize-phase stand-down, control-plane precedence ordering — sequences actions that fire anyway; behavior-ordering, not tuning) promoted default-on; threshold-scaling arm (maxSameTool/pace bands) stays opt-in pending the lift rule. Separate bench arms per half — this is how the inconclusive ablation gets settled instead of re-litigated. `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` seam (`guard-adapters.ts:36`) is the existing pattern to follow.
- [ ] 4.3 **Early-stop through the terminal gate:** `controller-early-stop` intent routed through `evaluateTerminalGate` like every other exit (vocabulary already supports it, `iterate-pass.ts:997-1010`); a flat-trajectory verdict at `confidence:0` may not preempt contract coverage with status `acting`. Fix `iter:-1` labeling on strategy-switch events while in-file (trace-hygiene).
- [ ] 4.4 **Outstanding recitation default-on:** when a compiled RunContract exists (every run by default, `runner.ts:486-525`), render `assessment.requirements.outstanding` into the F10 volatile tail (`DEFAULT_PROFILE.showOutstanding` true-when-contract; cache-safe tail channel, dedupe, token caps all exist — content only, ≤N items + "(+K more)" precedent from compaction stubs). Review Focus: guard against tail-bloat regression via scoreboard tokens/run control column.
- [ ] 4.5 **Deterministic escalation:** strategy-switch default = fixed ladder (reactive→plan-execute-reflect→reflexion) with ZERO extra LLM call; `strategy-evaluator`'s round-trip stays only for multi-candidate configs; populate `availableStrategies` for all kernel strategies (currently reactive-only hardcode, `strategies/reactive.ts:283`; others default `[]` → evaluator short-circuits dead). Handoff reason carries the actual pattern id (the live misdiagnosis must not recur); `keyObservations` widened from last-5 to requirement-relevant slice.

- [ ] 4.6 **Meta/pseudo-tool non-progress class (evidenceDelta half):** `assess()` evidenceDelta currently keys on (tool, normalized-args) identity — extend so success-shaped results from **harness/meta tools that produce no task evidence** (`discover-tools` → "No tools registered.", repeated `final-answer`/`recall` no-ops, pseudo-progression) do NOT credit evidenceDelta. This is the precise reason the S1 live trace stayed `evidenceDelta:0` while 5 tool calls "succeeded" — pattern (e) must not be defeated by meta-no-op credits. Consumes the law-#5 arbiter predicate from 4.7 (one arbiter, not two scorers).

- [ ] 4.7 **ONE progress arbiter (root fix, not a pattern patch):** the loop detector counts a `META_TOOL` call as progress, contradicting `META_TOOLS`' own contract. Implement the law-#5 predicate (`SUBSTANTIVE` vs `NON-PROGRESS`) as one framework helper and route through it: patterns (a)/(c)/(d) (and 4.1's new (e)). Enumerated sibling failure modes the single seam must cover — so this cannot degrade into a `discover-tools`-only patch:
      1. meta/pseudo-tool thrash counted as progress (the live S1 trace);
      2. a "successful" no-op counted as grounded evidence (groundedness / delivery / receipt verdict);
      3. a give-up answer counted as delivered (terminal honesty — composes with the shipped `f56f2df5` give-up gate and #206, which are the worked substrate here);
      4. reworded repeats defeating byte-equality thought dedup;
      5. delegated children laundering a partial into a completed parent (ties to 5.3 `joinEnvelopes`).
      Explicit coupling to 4.1: *"4.1 detects the thrash from `evidenceDelta`; 4.7 removes the structural reason the byte-shape guards are blind to it. Ship BOTH; 4.1 alone leaves (a)-(d) blind, 4.7 alone leaves pace banding green."*

**Lift:** S1/S3 — iterations-to-first-acting, false-exit rate, tokens/run on thrash arms; rung 2+3 for the reconciliation-arm default flip. **Wave 4 gate, 4.7 red-on-cut arm:** N same-name meta-tool actions (`success:true`, varied args, interleaved thoughts) must trip (c)/(d); severing the arbiter wiring turns this red; and the **false-positive guard** — the same shape using a *substantive* tool that returns new evidence must NOT trip. **Changeset:** `minor`.

## Wave 5 — Terminal honesty + delegation composition (⚡; 3-4 days)

**Warden:** kernel-warden (arbitration/verify) + runtime-warden (delegation seams). **Depends:** 4.3.

**Root causes (live-verified):** the captured run finished `verifier-verdict verified:true "final-answer: 10 checks passed"` + `run-completed status:"success"` while `requirementsOutstanding:1`, `deliverablesProduced:0`, and the output text itself says "I'm unable to send a Slack message." Terminal checks are anti-parrot/non-empty, not contract-coverage. Delegation: child honesty is contained (partial child flips `success:false`) but NOT composed — `SubAgentResult` (`agent-tool-adapter.ts:143-166`) carries no completionStatus/outstandingCriteria; no `joinEnvelopes` worst-of over children; nesting off by default (`sub-agent-executor.ts:491-498`); budget propagation happens by FiberRef accident, contradicted by its own comment (`run-budget-arm.ts:12` "sub-agents get their own") and unpinned.

- [ ] 5.1 **Contract coverage into the verdict:** outstanding requirements (assessment already partitions every iteration) wired into the arbitrator as a terminal check: `requirementsOutstanding > 0 ∧ status ≠ abstention` caps the claim at `partial` — reusing the existing envelope law + worst-of join, not a new scorer. The S1/S3 false-success fixtures become North Star gate scenarios (flip success→partial, red-on-cut). **Rebase note:** `f56f2df5` already shipped an advisory give-up gate at the terminal mint (phrasing + harness-forced-terminal + no grounded evidence → abstained, live-verified 4/4 on qwen3:4b) — 5.1 adds the DETERMINISTIC contract-coverage arm on top; verify the two compose (give-up gate stays the phrasing net; contract coverage becomes the evidence net; shared seam = terminal mint, one ordering, one test per arm).
- [ ] 5.2 **Completion-satisfied inversion path:** the Phase-D shadow site (87.5% agreement, all disagreements stricter) is the first inversion CANDIDATE after 7.1's sink accumulates real traffic — this task only wires the ledger-side plumbing (verdict reasons reference the judgment entry when present). **Deterministic half SHIPPED** (`#206` exhausted-run abstention + `f56f2df5` give-up honesty gate): those two are now the worked substrate for law-#5 / 4.7 / 5.2 — the remaining waves close the *class* across all consumers, not these two sites. Honest-claims law: judgment generalization is not inverted on this plan's authority alone.
- [ ] 5.3 **Delegation composition:** `SubAgentResult` gains envelope fields (precedent: `childRunLedger` pass-through carrier); parent terminal applies `joinEnvelopes` worst-of over children (partial child caps `completed` parent claim — Review Focus #5); nesting depth default ≥2 under the existing recursion cap, documented.
- [ ] 5.4 **Budget inheritance pinned:** integration test — parent `.withBudget({tokenLimit})` + scripted delegation → child spend lands in the parent meter, child halts at the parent boundary; `run-budget-arm.ts:12` comment corrected to the real invariant; killswitch/harness pipeline propagation to child kernels asserted or the gap disclosed in the same commit.
- [ ] 5.5 **Strategy-tier honesty:** plan-execute per-step sub-kernel budget derived from `runMaxIterations/planLength` (floor 5) instead of literal 3 (`plan-execute.ts:10-11`); code-action's bespoke loop gets the terminate-gateway + required-tools post-check as the minimum (full kernel-hosting is a separate design pass — non-goal); docs + builder-api state the reliability tiers honestly (users selecting plan-execute *for* multi-step tasks must see what each step gets).

**Lift:** S3 false-success count → 0 on pinned arms; delegation arms' double-spend incidents → 0. **Changeset:** `minor`.

## Wave 6 — Enforcement truth (parallel track; 3-4 days; different wardens)

**Owners:** gateway + parent (6.1), guardrails/tools (6.2), compose (6.3), runtime/docs (6.4-6.7). Independent of W3-W5; run in parallel from day 1.

- [ ] 6.1 **Gateway `requireApprovalFor` wire-or-delete:** zero consumers today (`gateway/src/types.ts:111` + two mirrors); route into the child-run `approvalPolicy` the kernel gate already honors (`kernel/capabilities/act/approval-gate.ts`). Red-on-cut scenario: gated tool in chat mode pauses, non-gated runs. Same class as the 9-day-dead behavioral contracts — the TEST is the fix, the wire is the formality.
- [ ] 6.2 **Output screening wired:** `GuardrailService.checkOutput` called on final output at the engine post-arm site (where behavioral contracts already check, `execution-engine.ts:1040` neighborhood); injection-scan hook on tool-result content at the `compressToolResult`/observation choke point (one seam, both consumers); fail-open vs fail-closed decided explicitly + event emitted either way (current `guardrail.ts:33-40` fails open silently).
- [ ] 6.3 **Compose completeness:** one `runPhaseHooks(...,"verify",...)` call site so verify-phase killswitches can fire (builder already confesses they can't, `builder.ts:1786-1791`); e2e builder→kernel proof per shipped killswitch (`.compose(timeoutAfter(...))` → assert `terminatedBy`) — census batch-2 priority, moves `.withHarness()` off SILENT; single shared `computeBudgetSignal` collapsing compose-vs-withBudget cost semantics (0.000001-estimate vs `estimatedCost` divergence); `timeoutAfter`/`watchdog` made wall-clock-real at the run seam (`Effect.timeout` at execute + watchdog reset on llm-exchange events, not only after-act), or documented as iteration-granular with a pointer to `.withLlmTimeout()`.
- [ ] 6.4 **Config-field census (boundary-level prevention):** extend the wither-census pattern (`wither-census.test.ts` — 85 withers PROVEN/SILENT) to PUBLIC CONFIG SCHEMAS: every field needs a named non-test consumer or an allowlist entry with justification + issue link. Known first casualties: 6.1's approvals, `verifierTier` (→7.4 decision), plan-execute `patchStrategy` dead config, `RunLedger` dead kinds if any remain. This kills the silent-enforcement bug CLASS instead of the third instance (Doctrine #2).
- [ ] 6.5 **Memory posture truth (decision task, one line of code either way):** `_enableMemory=false` vs `builder.ts:936-942` + `registry.ts:136` claiming default-on. Options: (a) fix claims to "stateless unless opted in" + promote `HarnessProfile.intelligent()` as the documented recommended path in quickstart; (b) default-on `:memory:` light-sqlite (GH #122 migration history says they backed this out — do NOT silently re-default; this is owner-decision territory, escalate if (b) preferred). Ship (a) by default within 6.5 unless owner says otherwise.
- [ ] 6.6 **Interaction island:** 5 autonomy modes unreachable from public API (P0-6 removed the wither; nothing re-wired). Wire a thin `.withAutonomy(mode)` on top of the EXISTING kernel approval gate (not the old layer-merge trap), or doc-scope + flag the package "direct use only" in README + package table. Decision inside task: wire is preferred (differentiated human-in-the-loop is a market gap); ablation-warden gate applies if it becomes a new mechanism.
- [ ] 6.7 **Observe island + identity honesty:** `.withOpenInference({endpoint})` builder seam composing the existing `OpenInferenceTracerLayer` (one glue + one behavioral span-export test) — cheap table-stakes interop; identity package: dormant marker in AGENTS.md layer table + README (or defer full `AuditLogger` wiring to a future wave — honesty label is the must).

**Gate:** each wiring = red-on-cut scenario; census ceiling ratchet (only decreases); **Changeset:** `patch`/`minor` per item.

## Wave 7 — Close the flywheels (measurement → behavior; 4-6 days; last)

**Owners:** judgment/eval (7.1-7.2), benchmarks (7.3), verification (7.4). **Depends:** W4-5 shipped (there is finally stable behavior to measure).

- [ ] 7.1 **JudgmentShadow sink + auto-shadow mode:** EvalStore-shaped SQLite recorder consuming the 6 existing shadow-site events (no new emitters); shadow mode auto-enables with a cheap local backend (System One/Ollama — merged, shipped) INDEPENDENT of user `.withJudgment()` (current default-off means sites sample nothing); agreement analytics query per site against recorded ground-truth protocol (the n=30-32 gate methodology from 2026-09-23, now automated). THEN invert task-comprehension (98.5%) behind ablation-warden + rung agreement; inverted decisions append judgment ledger entries (auditable, replayable — the unique-value differentiator, no other TS harness does this).
- [ ] 7.2 **CI evidence lanes:** root-cause + re-enable `eval.yml` ("always failing" — likely the same keyless-CI wall as regression-gate; if secrets needed, use repo vars + nightly), scheduled nightly regression-gate, τ-bench on a schedule (loader/adapter/pass-k exist unscheduled), implement the remaining `cf-TODO` scenario (ToT call-inflation; 4.1 shipped the loop-detect one). Feed deltas into capability-registry `liftEvidence` fields (schema exists: `registry.ts:62-72`) — future default-on promotions read measurements, not probe-campaign folklore.
- [ ] 7.3 **Rung-3 standing panel:** bench session auto-detects pulled Ollama models via tags API (keyless-safe skip, the `abstention-synthesis-206` pattern) and includes the fast-tool-caller panel where reachable; ship ≥5 calibration runs per shipped SLM prior (current priors n=1-3 across 8 models); probe-cache persistence from 3.1 feeds the posterior.
- [ ] 7.4 **Verification collapse + verifierTier decision:** wire `verification`'s pure-compute Tier-1 (entropy/NLI) as an ADDITIONAL CHECK inside the kernel's terminal gate (shadow → enforce per lift rule) — kills the two-verifier drift class by making the package serve the one gate rather than a parallel stack; `verifierTier` ladder gets its one consumer (policy actuation: deepen verification on amber/red band) or is deleted — decide on 7.2 evidence. Update features docs to ONE verification story either way.

**Gate:** first measured inversion ships with before/after outcome delta; eval CI green on main; scoreboard fully post-fixed. **Changeset:** `minor`.

---

## Coverage matrix (audit finding → task)

| Finding (live-verified) | Task |
|---|---|
| Thinking dropped on stream; rescue starving | 1.1-1.5 ⚡ |
| qwen3:1.7b→mid regex bug; two tier classifiers | 2.1-2.2 |
| tokenizerFamily unconsumed; head-truncation | 2.3, 2.5 |
| FC wire array ignores toolSchemaDetail (49% of 8K) | 2.4 |
| local>mid tool-result budget inversion (D-…-H) | 2.2 |
| classifier skip unenforced (extra call/run) | 2.6 |
| Text-parse unreachable; dialect "none" inert; hardcoded supportsToolCalling | 3.1-3.6 ⚡ |
| Probe cache not persisted (CalibrationStore deferred) | 3.1 |
| Wandering (success-shaped) undetected; band green | 4.1 |
| Meta-tool "success" crediting no evidence (progress-arbiter class) | 4.6 + 4.7 (law #5; deterministic substrate shipped: #206, `f56f2df5`) |
| Long-horizon control dark by default; arm-split | 4.2 |
| dispatcher-early-stop bypasses gate mid-acting | 4.3 |
| Outstanding never recited (showOutstanding:false) | 4.4 |
| Switch pays LLM call, fails closed; reactive-only strategies | 4.5 |
| iterate-pass 1734-line mutable carrier | 4.0 |
| False success vs outstanding requirements | 5.1 (advisory-half shipped by `f56f2df5`; 5.1 = deterministic contract-coverage arm) |
| Delegation partial-laundering; depth-1 default | 5.3 |
| Sub-agent budget accidental + comment lies | 5.4 |
| code-action/plan-execute reliability tier | 5.5 |
| Gateway requireApprovalFor dead | 6.1 |
| checkOutput/tool-result screening never called | 6.2 |
| compose verify-phase dead; killswitch e2e SILENT; cost divergence; advisory timeouts | 6.3 |
| Silent-enforcement CLASS (boundary prevention) | 6.4 |
| Memory "default-on" doc lie | 6.5 |
| Interaction orphaned (5 autonomy modes unreachable) | 6.6 |
| Observe island; identity honesty label | 6.7 |
| Judgment shadow sites sample nothing | 7.1 |
| Eval CI disabled; τ-bench unscheduled; cf-TODO | 7.2 |
| SLM bench panel; priors n=1-3 | 7.3 |
| Verification island / verifierTier zero-dispatch | 7.4 |
| Scaffold ^0.14 pin / .env / test-provider fake / makeKernel / tracePath / scaffolder split / strategy-count docs / replay buried / result-field soup | W0.1-W0.8 |

## Sequencing (operation order)

```
Task 0 (baselines — BEFORE anything)
Wave 0 ──────────────┐ (day 1, parallel-safe)
Wave 1 (thinking) ───┤
Wave 2 (arbiter) ────┼── W2 after/with W1 (supportsThinking feeds W3)
Wave 3 (Stage B) ←───┘  needs 2 (routing input)
Wave 4 (wander/ctrl) ←─ needs 1,2; 4.0 refactor first
Wave 5 (terminal/deleg) ←─ needs 4.3
Wave 6 (enforcement) ←─ parallel from day 1 (ownward-disjoint packages)
Wave 7 (flywheels) ←─ needs 4-5 shipped (measure fixed behavior)
```

Impact-per-effort ordering rationale: W1 = per-run quality on the largest local class (thinking models) for ~3 days; W2 = makes every downstream local-tier knob honest (also unblocks W3); W3 = capability unlock with no TS competitor (harness lifts no-FC models); W4/W5 = the verified live failure chain (thrash → false exit → false success) closed at root; W6 = trust (enforcement claims become real + class-level prevention); W7 = compounding (learning/eval/judgment loops finally steer behavior). Total ~25-30 focused days across wardens.

## Close-out checklist (program level)

- [ ] Scoreboard fully populated pre/post; every ⚡ verdict row exists with defect/lift evidence + cut-test note.
- [ ] DEBT-REGISTER: D-…-H RESOLVED; text-parse Stage-B row CLOSED; new rows for 2.6/4.x/5.x/6.x verdicts.
- [ ] Hot.md + Log.md updated per wave; debrief per wave family in `wiki/Research/Debriefs/`; warden log blocks per task.
- [ ] README/docs claims match shipped truth (adaptive tool calling, verification, autonomy, memory posture, replay stability).
- [ ] Changesets added per wave; release-dry clean; tag candidate `v0.18.0` (minor bumps for W1-W5, W7).
- [ ] `bun test` full suite green (allowing pre-existing Docker-timeout flakes documented at wave close); metrics-cache bumped via the documented flow.

## Explicit non-goals (tracked elsewhere)

- Proactive mid-window compaction redesign (Wave-5 bench item; 2.3/2.5 make thresholds honest first).
- code-action full kernel-hosting (design pass 5.5-minimum shipped here).
- `numCtxPolicy` default flip (measured reload penalty stands: 33-49s/switch).
- Agent-orchestration product work (a2a/channels maturity), UI bindings beyond 1.1 parity, new providers.
