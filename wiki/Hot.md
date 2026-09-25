---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-09-25
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## 2026-09-25 — P1 backlog bundle #225 closed locally

Executed `cli-example-builder-casts` (#225), commit `5ec4dd63`, locally merged to
`dev` as `6bf54034`. Grounding found 9 matching builder casts (issue said 8):
removed 3 from supported chains, deleted a stale `.withA2A()` capability probe,
and corrected the CLI's invalid Gemini provider value (`"google"` → `"gemini"`).
Five remaining casts probe APIs that are still absent. Build 38/38 and workspace
typecheck 68/68 pass. Full suite after local merge: 9,592 pass / 21 fail; one
extra workspace-order logger failure in untouched observability passed alone and
as a package; baseline reds are the 2 cast-ceiling checks and 18 Docker timeouts.
No PR/push: local `dev` is ahead 75 and behind 6 vs `origin/dev`; the remote
would include unrelated local history. #225 and tracker #229 are closed. Next
eligible P1 grounded candidate: #223 (kernel reasoning; route through the
kernel-warden contract before edits).

## 2026-09-23 — Judgment Phase D shipped: includeContext DX + 2 new shadow sites (completion, grounding)

Follow-up plan (`wiki/Planning/Implementation-Plans/2026-09-23-judgment-primitive-phase-d-leverage.md`)
executed via `superpowers:subagent-driven-development` in a worktree (`worktree-judgment-phase-d`,
branch not yet merged to `dev`). **Task 1:** `agent.judge({includeContext: true})` auto-folds recent
message history + tool observations into judgment state — additive, zero-cost when omitted (1 fix
round: untested observability signal, a `compressToolResult` reuse leaking kernel-only `recall(...)`
text into judgment prompts — both fixed). **Task 2:** new `completion-satisfied` shadow site wired
into `verifyAndEmit` (the shared terminal-verification funnel), keeping `arbitrate()`/`terminate.ts`
provably untouched — review clean, 0 fix rounds. **Task 3:** new `grounding-fabrication` shadow site,
extracted the inline containment check into a pure regression-pinned function, wired into 1 of 6
`assembleDeliverable` call sites (widening to the rest is a disclosed follow-up) — review clean, 0 fix
rounds. **Real exit-gate data for both new sites** (direct-call methodology against the real jev
backend, n=32 each, since Task 3's trigger condition is too rare to force reliably via live prompts):
completion 87.5% agreement (all disagreements ran the safe/stricter direction), grounding 90.6%
agreement (all disagreements were over-cautious false-positives-on-fabrication, zero real fabrications
missed). **No site inverted** — both stay shadow-only. Full data:
[[Research/Harness-Reports/2026-09-23-phase-d-completion-grounding-exit-gates]]. **Not yet merged to
`dev`** — final whole-branch review pending.

## 2026-09-23 — Judgment layer put to the test: methodology gate + all 4 shadow-site exit gates run

Real live-API measurement session (not fabricated). **Methodology gate** (`wiki/Research/Harness-Reports/2026-09-23-judgment-methodology-gate.md`):
jev beats the frozen-haiku LLM judge on a 16-case ground-truth set (100% vs 87.5% classification
accuracy, 2.3x faster) — confirms the `judgeEngine:"jev"` default. Caught + fixed a real measurement-
harness bug (input-keyed canned-SUT map collision) before trusting any result. **Shadow-site exit
gates** (`wiki/Research/Harness-Reports/2026-09-23-shadow-site-exit-gates.md`): task-comprehension
98.5% agreement (135 samples), complexity-routing 93.5% (31), strategy-selection 74.2% (31, jev
consistently picks MORE exploratory strategies — a real directional bias worth outcome-testing before
any inversion), autonomy-confidence 96% agreement / **6.7% false-auto-approval risk** (2/30
escalate-worthy scenarios) — confirms that site should stay shadow-only. **No site was inverted** —
all four still shadow/additive-only; the plan's exit gates now have real numbers instead of "NOT RUN."

## 2026-09-23 — TypeSafe/Jev judgment primitive, Phase C (runtime tier) shipped, committed on `dev`

`.withJudgment()` builder method + `agent.judge()` public primitive, plus per-site opt-ins: strategy
selection/complexity routing/task comprehension (shadow-only), guardrails judgment battery (additive,
opt-in), autonomy/approval confidence (shadow-only, highest blast radius, no invert path), tool-call
healing escalation (additive). Full plan: [[Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer]];
debrief: [[Research/Debriefs/2026-09-22-judgment-layer-phase-c-debrief]]. All committed on `dev`
(`d60ee70f`…latest, no co-author trailers). End-to-end smoke test (real builder→runtime→execution-
engine chain, not just unit mocks) confirms `agent.judge()` and the guardrails battery both wire
correctly through a real `run()`. Full-repo gate green (38/38 builds, 12/12 cross-cutting, 35/35
version-sync, docs build+sync+examples all clean). **Not yet released** — no PR, no tag. Every Step-4
exit gate (inverting a shadow into a real decision) remains open — needs real production shadow data.

## 2026-09-22 — TypeSafe/Jev judgment primitive, Phase A+B shipped (uncommitted on `dev`)

New `@reactive-agents/judgment` package (36→... packages) + `eval`/`judge-server` overhaul. Full plan:
[[Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer]]; debrief:
[[Research/Debriefs/2026-09-22-jev-judge-eval-overhaul-debrief]]. `eval` now scores 4 LLM-judged
dimensions via ONE batched Jev Score request per case by default (was 4x `parseFloat(...)||0.5` LLM
calls) — no behavior change without `.withJudgment()`/`TYPESAFE_API_KEY` wired. 280/280 tests pass
across 4 touched packages. **Not yet committed, no PR.** Next: Phase C (runtime `.withJudgment()` tier)
or Task 6 Step 5's methodology gate (real frozen-dataset study, not yet run).

## 2026-09-19 — surface-high-leverage-work skill + kernel-termination-regression bundle (PR #209)

New `surface-high-leverage-work` skill shipped (`.claude/skills/surface-high-leverage-work/`) — DISCOVER→SCAN→GROUND→SCORE→DEDUPE→FILE→BATCH→PRESENT loop, chains `codebase-health-sweep`/`architecture-audit` for fresh code discovery rather than only re-ranking trackers. 4 sweeps run same day; canonical record at `wiki/Planning/Recommended-Enhancements.md`. Filed #205 (Cloudflare Workers `createRequire` crash), #206 (no abstention synthesis on budget exhaustion — descoped from execution, needs its own design pass), #207 (North Star gate 14-scenario "regression").

`execute-backlog` ran on #207: bisected to `d43de304`, found it was a **stale baseline, not a kernel bug** — the gate's `iterations` metric falls back to counting `entropy-scored` trace events (`packages/testing/src/gate/runner.ts:65-74`); a prior double-scoring bug had inflated that count, and `d43de304` correctly fixed the double-scoring. Regenerated the baseline instead of touching kernel code. PR #209 (against `dev`), retro + `execute-backlog` self-amendment (root-cause-direction check) landed alongside.

## 2026-09-19 — `dev` staging branch introduced; local `main` divergence fixed

Local `main` had silently diverged from `origin/main` (80 local-only commits
vs 2 origin-only commits with matching messages but very different content —
looks like a prior automated release-flow reset rewrote `origin/main`,
consistent with the known [[feedback_push_main_before_tag]] pattern). Fixed:
created `dev` at the old local-`main` tip (`6a819582`, captures all 80
commits, pushed to `origin/dev`), then reset local `main` to `origin/main`
(local-only reset to an already-existing remote ref — no force-push, remote
untouched). **New workflow going forward:** land work on `dev`, not `main`;
`main` only moves via merging `dev` in at release time, immediately followed
by the tag. Canonical write-up: `AGENTS.md` §Release Workflow (Tag-Driven).
Also this session: fixed a TOML-escaping bug in PR #204's new
cloudflare-worker template and, via a live `wrangler dev` smoke test (not
just bundle dry-run), found+filed a real blocking bug in `runtime-shim` —
`createRequire(import.meta.url)` at module scope crashes on workerd for
every provider, not just the PR's OpenAI default (issue #205, sub-issue
of #59).

## 2026-09-15 — wire-or-delete hardening wave (9 tasks, `96f10a22..84d43fcf`)

Gate-clean on `wave/wire-or-delete-2026-09` (`84d43fcf`) — keyless-refusal
security fix, run-completed trace truth, strategy-switch ledger-drop fix, 3
dead flags deleted, wither-proof census gate, full suite 9294/9264 pass (1
known pre-existing `as-unknown-as` gap). **Now merges into `dev`, not
`main`, per the branch-topology fix above.** Debrief:
[[Research/Debriefs/2026-09-15-wire-or-delete-hardening-wave-debrief]].

## 2026-08-16 bundles (condensed)

- **Health sweep** — HS-224 grounding-guard marker leak fixed, 2 robustness fixes; a reported P0 was FALSE on repro. [[Research/Debriefs/2026-08-16-health-sweep-debrief]]
- **code-action-worker-interruption** — closed #35, sandbox Worker now stops on fiber interrupt. [[Research/Debriefs/2026-08-16-code-action-worker-interruption-execution-debrief]]
- **replay-determinism-revalidation** — closed #30 (already-shipped) + #53 (44 tests, 0 fail). [[Research/Debriefs/2026-08-16-replay-determinism-revalidation-execution-debrief]]
- **v0.15.0 release-prep + tools-result-handling** — fixed `t0-deterministic` regression (`c2418864`); shipped `bundle/tools-result-handling` (#47/#57/#58). [[Research/Debriefs/2026-08-16-tools-result-handling-execution-debrief]]

## Active program (2026-07-28)

**A-TIER GAP CLOSURE** — [[Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]].
Supersedes the simplification program as the WIP=1 item; the simplification
program's motivating figure (555–640% harness overhead) was **retracted** on
2026-07-28 because the instrument was broken (`2f97ca1e`).

**F10 RESOLVED (2026-08-26, `4f7c4bc0`, closed `89bb8a43`):**
[[Failure-Modes/RUNNING-CATALOGUE#F10]] — was the request prefix churning every
iteration so the prompt cache never hit. Root cause: per-iteration harness
guidance appended to the system-prompt string tail still invalidated the
cache (system precedes messages in Anthropic's cache hierarchy); guidance
now rides as a trailing user message instead. Live-Sonnet rebaseline confirms
nonzero `cacheRead` on every disclosure arm. Do not cite the old 41%-tokens/
17%-more-money figure as current.

**Do not cite** any token-overhead figure predating `2f97ca1e`.

**Measurement ladder:** deterministic replay → haiku → fast non-reasoning local
tool-callers. Promotion requires rungs 2 and 3 to agree in sign.

**External gate:** τ-bench (ratified 2026-07-28).

## What's Next

1. **Tag + ship wire-or-delete wave** — `wave/wire-or-delete-2026-09` is gate-clean at `84d43fcf`; merge to **`dev`** (not `main` — see 2026-09-19 branch-topology fix), then `dev` → `main` → tag when release-ready (`release:dry 0.16.1` clean).
2. **Wither batches 2-4** — Task 8's census left batches 2-4 as a disclosed backlog (queue produced by Task 8 Step 2); batch 1 (behavioral seams) shipped.
3. **`as-unknown-as` ceiling gap** — 79 actual sites vs ceiling 78, confirmed pre-existing (predates this wave); needs a future session to either remove a cast or deliberately ratchet the ceiling with justification.
4. **τ-bench environment bridge** — still tabled (owner decision, 2026-09-14), not touched by this wave.
5. **#39 per-entity requirements**, **#44 kernel→engine signal unification** — separate lift-gated items, untouched.
6. Bench P2 remainder (7 llm-judge → graded, re-baseline) + P3 `horizon:long` tasks; then #36 adaptive re-cut.

## Prior Sessions (compact pointers)

- **2026-07-05→12** — the harness root-cause fortnight: Arc 1, meta-loop, measurement rebuild, wiring audits ×4, probe fleet, receipt truth. Full map: the 07-12 snapshot above. Process lesson recorded there (§4): ~14% same-week rework, whack-a-mole before class-level prevention.
- **2026-07-02** — v0.13.0 RELEASED (35 pkgs); v0.13.5 + v0.13.6 followed 2026-07-05/06 (Groq+xAI, ui-core).
- **2026-07-01** — comprehensive framework review + v13 lift plan (superseded by 09-UNIFIED-PROGRAM).
- **Earlier** — see `git log -- wiki/Hot.md` and MEMORY-ARCHIVE.

## Authoritative Document Hierarchy

| Order | Doc | Role |
|---|---|---|
| 1 | `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` | Program sequencing + convergence rulings (CANONICAL) |
| 2 | `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` v6.0 | Product-arc content, exit gates, honest-claims law |
| 3 | `wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md` | Kernel architecture (RATIFIED 07-11) |
| 4 | `wiki/Planning/Implementation-Plans/2026-07-10-harness-root-cause-closure-program.md` | Ranked open backlog (active) |
| 5 | `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md` | Current empirical state |

`04-PROJECT-STATE.md` is deprecated as the empirical-state read (banner added 07-12). Conflict rule: lower defers upward; changing a higher doc is a ratification event.

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, demote prior to one-line pointers, update "What's Next." Keep under 120 lines.

**Last Updated:** 2026-09-19
**Current Phase:** `dev` staging branch live; wire-or-delete wave gate-clean, awaiting merge to `dev`

## 2026-08-18 (condensed)
Closed #155 (health/umbrella export surface, 2 real fixes), #61 (v0.11.0 tracker, stale), #188 (AgentStreamEvent — found+fixed a live 3-way divergence bug across react/svelte/vue), #184+#200 (kernel import cycles, `bunx madge --circular src/kernel`: 9→14→2→0 across the session). See `wiki/Research/Debriefs/2026-08-18-*-execution-debrief.md` for the four retros.
