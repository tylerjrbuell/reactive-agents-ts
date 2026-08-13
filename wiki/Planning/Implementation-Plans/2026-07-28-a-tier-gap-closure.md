> **SUPERSEDED 2026-08-12 — absorbed into [[2026-08-12-agentic-overhaul-program|The Agentic Overhaul Program]].**
> This plan is retained for provenance only. Do not execute from it; its content,
> including any still-open items, is carried in that program's failure-mode register.
> Three plans each declared themselves the sole active program — that is why one
> running plan now replaces them.

# A-Tier Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps that keep this harness at B tier — an unverified cost baseline, a prompt cache that never hits, and no external benchmark — and record the findings in the wiki truth documents so no future claim rests on retracted numbers.

**Architecture:** Three independent gaps, sequenced so the cheap ones de-risk the expensive ones. Phase 0 syncs the truth docs (zero cost, unblocks honest claims). Phase 1 proves the machinery deterministically over the replay lane at zero tokens. Phase 2 makes the request prefix cache-stable by moving volatile content to the message tail and freezing the tool surface behind an opt-in flag. Phase 3 measures on a ladder — deterministic → haiku → fast local tool-callers — and lets the §6 lift rule decide the default. Phase 4 adds the external credibility gate (τ-bench).

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun 1.3.10, turbo. `@reactive-agents/reasoning` (kernel + assembly), `@reactive-agents/llm-provider` (Anthropic caching), `@reactive-agents/benchmarks` (ablation harnesses), `@reactive-agents/replay` (deterministic tier-1 lane).

## Global Constraints

- **No `Co-Authored-By` trailers in any commit.** They surface publicly on the GitHub contributors page.
- **Strict TypeScript. No `any` casts.** Use `unknown` + narrowing guards or a real type.
- **All plans/specs/debriefs go to `wiki/`, never `docs/`.** `docs/` was eliminated in the May 2026 consolidation.
- **Do NOT write a fourth north-star document.** Amend `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` in place.
- **Live-model bench cells run FOREGROUND with `timeout N` where N ≤ 590.** Background bench tasks get SIGKILLed silently.
- **`--output` is required on every bench invocation** or nothing persists.
- **Bench accuracy cells are Bernoulli.** 5 tasks × n≤5 carries ~13pp standard error; gaps below 26pp are noise. Never read a finding off the summary table alone.
- **Never change bench scoring mid-run.**
- **Probes write to a temp root, never the repo working tree.**
- **CI has no API keys and no Ollama.** Verify CI-parity by moving `.env` aside before declaring green.
- **RTK is banned** (silently truncates output). Use native `git`/`grep`/`find`.
- **Every new default-on mechanism needs a grep-able enforcement script.** No script → not done.
- Lift rule (09 §6): **≥3pp accuracy lift AND ≤15% token overhead**, cross-tier, to earn default-on. Otherwise opt-in. Otherwise delete.

---

## Background: what is actually broken

Three findings from the 2026-07-28 session, all measured, none yet recorded in the truth docs.

**1. The token accounting bug invalidated every prior baseline.** Anthropic's `usage.input_tokens` counts only the *uncached remainder*; the cached prefix arrives as `cache_read_input_tokens` / `cache_creation_input_tokens`. Both provider paths reported the remainder as `inputTokens`/`totalTokens` while computing cost off the correct total. So the better a run cached, the cheaper it appeared. Fixed in `2f97ca1e` via `totalInputTokens()` in `packages/llm-provider/src/providers/anthropic.ts:56`. **Consequence: the "harness costs 555–640% vs bare LLM" figure in 09 §7 is unverified.** It may be better or worse; it is not known.

**2. The prompt cache never hits on the default kernel path.** Measured on haiku with corrected accounting:

| arm | tokens | cost | cacheRead |
|---|---|---|---|
| inline | 14,008 | $0.01530 | 0 |
| prune-only | 39,174 | $0.04518 | 0 |
| prune+discover | 41,555 | $0.04766 | 0 |
| no-prune | 66,719 | **$0.03871** | 40,277 |

Lazy tool disclosure wins 41% of raw tokens and **loses 17% of the money**. Root cause is positional: Anthropic's cache prefix orders `tools` → `system` → `messages`. Per-iteration mutation of the `tools` field is at position zero, so it invalidates all three `cache_control` breakpoints every iteration.

`packages/reasoning/src/assembly/stages/system-prompt.ts` compounds it — line 87 puts `Remaining steps:` and line 75-86 puts the standing frame *inside* the cached system block. Volatile content at the front of the prefix.

**3. `discover-tools` was never called.** Zero invocations across every arm above. F3's premise ("the kernel spends model calls discovering tools the inline path simply uses") does not reproduce on the measured shape. It costs ~6% for a schema nobody uses.

### One correction to carry forward

An earlier framing of this work called for a "logit masking layer" for tool availability, citing the industry rule *"tool availability is controlled via logit masking rather than list insertion and removal."* **The Anthropic API does not expose per-tool logit masking.** `tool_choice` supports only `auto` / `any` / `tool(name)` / `none`. Harnesses that mask do so because they control their own decoding stack; we do not. Building a masking abstraction over an API that cannot mask is exactly the over-engineering this program exists to stop.

The mechanism actually available to us is **enforcement by rejection**: keep the schema in the list, and return a corrective `tool_result` when a withheld tool is called. That is Task 9. `tool_choice` is noted as a future candidate for the required-tools gate only, and is deliberately **not** in this plan.

---

## File Structure

**Phase 0 — truth documents (modify only):**
- `wiki/Failure-Modes/RUNNING-CATALOGUE.md` — F3 premise retracted, F9 closed, F10 added
- `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` — §7 amendment block
- `wiki/Architecture/DEBT-REGISTER.md` — invalidated-baseline + cache-prefix entries
- `wiki/Hot.md` — current-state pointer

**Phase 1 — deterministic proof:**
- Modify `packages/benchmarks/src/replay-record.ts:32` — add a plan-bearing `GoldenScenario`; the four existing goldens never populate `goal_state.remaining` or render a standing frame, so they cannot detect a regression in where volatile content sits
- Create `packages/benchmarks/golden/planned-tool-loop.jsonl` + `.expect.json` (generated by the recorder, committed)
- Create `packages/reasoning/tests/assembly/volatile-placement.test.ts` — pins WHERE volatile content lands (red-on-cut for Task 8)
- Modify `packages/benchmarks/src/replay-ablate-sweep.ts:43` — sweep the three flags split out of `RA_LAZY_TOOLS`

**Phase 2 — cache-aware prefix:**
- Create `packages/reasoning/src/assembly/stages/volatile-tail.ts` — the one place that decides what is volatile and puts it in the message tail
- Modify `packages/reasoning/src/assembly/stages/system-prompt.ts:75-90` — stop emitting volatile sections
- Modify `packages/reasoning/src/assembly/project.ts:67-73` — insert the stage
- Modify `packages/reasoning/src/harness-flags.ts` — add `stableToolSurfaceEnabled()`
- Modify `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts:248` — honour the stable mode
- Create `packages/reasoning/tests/kernel/stable-tool-surface.test.ts`
- Modify `packages/benchmarks/src/disclosure-ablation.ts` — add the `stable-surface` arm, an output path, and the cache manipulation check
- Create `scripts/check-volatile-placement.sh` — grep-able gate

**No `withheld-tool-rejection.ts`.** An earlier draft created one. It is not needed: stable mode removes only contract-denied and gate-blocked tools, and both already have enforcement paths. Adding a second rejection mechanism for a case the first already covers would be exactly the over-engineering this program exists to stop.

**Phase 3 — measurement (create):**
- `wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.json`
- `wiki/Research/Harness-Reports/2026-07-28-rung3-qwen35.json`, `-granite4.json`
- `wiki/Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline.md`

**Phase 4 — external gate:**
- Create `packages/benchmarks/src/tau-bench/` — adapter, task loader, pass^k scorer

---

## Phase 0 — Truth sync and streamline

Zero live spend. Do this first: every later claim depends on the record being honest about what was retracted.

### Task 1: Record the F3 retraction, F9 closure, and the new F10 in the running catalogue

**Files:**
- Modify: `wiki/Failure-Modes/RUNNING-CATALOGUE.md` (F3 section at line 287; add F10 after the F9 section at line 318)

**Interfaces:**
- Consumes: nothing.
- Produces: the F10 identifier `F10 — the request prefix churns, so the cache never hits`, referenced by Tasks 2, 3, 8, 9, 10.

- [ ] **Step 1: Read the current F3 and F9 sections**

Run: `sed -n '287,347p' wiki/Failure-Modes/RUNNING-CATALOGUE.md`

- [ ] **Step 2: Rewrite the F3 heading and body**

Replace the `## F3 — \`discover-tools\` burn is kernel-only` heading with:

```markdown
## F3 — `discover-tools` burn ⚠️ PREMISE DOES NOT REPRODUCE (2026-07-28)

**Original claim.** The kernel spends model calls discovering tools that the
inline path simply uses.

**Measured.** `discover-tools` was called **zero times in every arm** of the
disclosure ablation (`packages/benchmarks/src/disclosure-ablation.ts`, haiku,
4 arms). The premise as stated does not reproduce on this task shape.

**What is true instead, and it is smaller.** The `discover-tools` schema rides
every prompt whether or not it is ever called, for a measured ~6% cost
(prune+discover $0.04766 vs prune-only $0.04518). That is a schema-weight cost,
not a model-call cost — a different defect, an order of magnitude less severe
than the one filed.

**Why this could not be measured before.** `RA_LAZY_TOOLS` gated three
independent mechanisms at three sites, two of them in opposite directions, so
"pruning on, discovery off" was inexpressible. Split in `2f97ca1e`; the arm now
exists as `RA_TOOL_DISCOVERY=0`.

**Status.** Downgraded from a cost defect to a schema-weight question, folded
into [[#F10]]. Do not cite the original framing.
```

- [ ] **Step 3: Mark F9 fixed**

Change the F9 heading to append the fix commits:

```markdown
## F9 — The kernel silently widens the tool surface beyond what was configured ✅ FIXED (`9d1252d3`, `2f97ca1e`)
```

Append to the end of the F9 section:

```markdown
**Fixed.** Two halves. The engine half (`9d1252d3`) — `execution-engine.ts` now
hands the kernel `exposedToolSchemas` (the post-`builtins`, post-forbidden,
post-allowlist set) instead of `initialToolSchemas`. The capability half
(`2f97ca1e`) — `discover-tools` now builds its catalogue from the permitted
surface, so it can no longer advertise "10 tools available (now callable)" under
`builtins: ["file-write"]` and then successfully execute a withheld `file-read`.

**Pinned by** `packages/runtime/tests/discover-tools-respects-surface.test.ts`
(3 cells, red-on-cut verified).
```

- [ ] **Step 4: Add F10 after the F9 section**

```markdown
## F10 — The request prefix churns, so the prompt cache never hits *(new, 2026-07-28)*

**Severity: highest open item.** It is a pure cost defect with no accuracy risk,
and it inverts the sign of the harness's flagship token optimisation.

**Measured** (haiku, corrected accounting, `disclosure-ablation`):

| arm | tokens | cost | cacheRead |
|---|---|---|---|
| inline | 14,008 | $0.01530 | 0 |
| prune-only | 39,174 | $0.04518 | 0 |
| prune+discover | 41,555 | $0.04766 | 0 |
| no-prune | 66,719 | **$0.03871** | 40,277 |

Lazy tool disclosure saves **41% of raw tokens** and costs **17% more money**.

**Mechanism.** Anthropic caches by exact prefix, ordered `tools` → `system` →
`messages`. Three `cache_control` breakpoints are set correctly
(`anthropic.ts:117` last tool_result, `:147` last tool, `:189` system). They
never hit on the default path because per-iteration lazy disclosure mutates the
`tools` array — position zero of the prefix — invalidating all three every turn.

**Compounding, in the system block itself.** `assembly/stages/system-prompt.ts`
puts the standing frame (`:75-86`) and `Remaining steps:` (`:87`) *inside* the
cached system prompt. Volatile per-iteration content at the front of the prefix.
This is backwards on two axes at once: it breaks the cache, and it puts the
recitation target in the low-attention middle of the context rather than the
tail where leading harnesses put it.

**Caveat the fix must respect.** `no-prune` already achieves cacheRead>0 on the
measured task, which had no plan and no standing frame — i.e. its system prompt
happened to be stable anyway. The prediction that moving volatile content to the
tail *extends* caching to plan-bearing tasks is **untested**, and the golden
corpus cannot currently test it (no golden populates `goal_state.remaining`).
Task 5 of the gap-closure plan exists to build that golden first.

**Fix plan.** [[../Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]]
Phase 2. Enforcement is by rejection, not by list mutation — the Anthropic API
exposes no per-tool logit masking, so the industry "masking" rule cannot be
applied literally here.

**Status.** OPEN.
```

- [ ] **Step 5: Add the instrument note to the method section**

Append to `## Method note` (line 366):

```markdown
**Fifth consecutive session in which the instrument, not the system, was the bug**
(2026-07-28). `usage.input_tokens` on Anthropic counts only the uncached
remainder. Both provider paths reported it as the total while computing cost off
the real total, so the better a run cached, the cheaper it looked. This inverted
a finding that was one commit from publication: lazy disclosure appeared to cost
2.2× when it in fact saves 41% of tokens. Caught by an impossibility check —
`in=6` for a call carrying ten tool schemas cannot be true. Fixed `2f97ca1e`;
pinned by `packages/llm-provider/tests/cached-input-tokens-are-counted.test.ts`.

**Every token-overhead number in this repository predating `2f97ca1e` is
unverified**, including the 555–640% harness-cost figure in 09 §7.
```

- [ ] **Step 6: Commit**

```bash
git add wiki/Failure-Modes/RUNNING-CATALOGUE.md
git commit -m "docs(failure-modes): F3 premise retracted, F9 closed, F10 cache-prefix churn filed

F3 as filed does not reproduce — discover-tools was called zero times in every
arm. What survives is a ~6% schema-weight cost, folded into F10.

F9 closed on both halves (engine surface + discovery catalogue), pinned
red-on-cut.

F10 is new and is the highest open item: the request prefix churns every
iteration, so all three cache_control breakpoints miss. Lazy disclosure saves
41% of tokens and costs 17% more money.

Method note records the fifth consecutive instrument-not-system bug and marks
every pre-2f97ca1e token figure unverified."
```

---

### Task 2: Amend 09-UNIFIED-PROGRAM with the A-tier program

**Files:**
- Modify: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md:92-122` (the §7 amendment block)

**Interfaces:**
- Consumes: the F10 identifier from Task 1.
- Produces: the sequencing authority every later task answers to. No new north-star document — this is an in-place amendment, per the standing constraint.

- [ ] **Step 1: Read the existing §7 amendment**

Run: `sed -n '92,124p' wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`

- [ ] **Step 2: Insert a new amendment block immediately after the `## 7. Status board` heading, above the existing 2026-07-27 block**

```markdown
> **AMENDED 2026-07-28 — the simplification program's motivating number is
> RETRACTED, and the active program is A-TIER GAP CLOSURE.** Plan:
> [[../../Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]].
>
> **What changed.** The 2026-07-27 amendment below rests on "the full harness
> costs 555–640% more tokens than a bare LLM." That figure was computed with a
> broken instrument. Anthropic's `usage.input_tokens` counts only the uncached
> remainder of a prompt; both provider paths reported it as the total while
> computing cost off the real total (fixed `2f97ca1e`). **Every token-overhead
> measurement in this repository predating that commit is unverified.** The
> harness may cost more or less than stated. It is not known.
>
> **What does NOT change.** The lift rule (§6) stands. The tier-1 replay lane
> stands and is now the FIRST rung of the measurement ladder, not an
> alternative to it. "0 of 6 lift measurements cleared the bar" stands — that
> was an accuracy finding, unaffected by token accounting. The suspension of
> "next = Wave C consumers / Arc 2" stands.
>
> **What is added — the A-tier bar.** Three gates, none of them features:
> 1. **One mechanism clears the lift rule.** Six attempts, zero passes. The
>    best candidate is [[F10]] (cache-aware prefix), because it is a COST win
>    with no accuracy risk — the cheapest possible way to clear a bar that has
>    never been cleared.
> 2. **An external, third-party benchmark.** Self-built benches are internal
>    tooling and cannot carry a public claim. Target ratified 2026-07-28:
>    **τ-bench** — tool-calling agent tasks with a pass^k metric, which matches
>    the pass^8 reliability framing this document already uses.
> 3. **Every default-on mechanism independently ablatable, with a gate.** The
>    `harness-flags.ts` split started this. A mechanism that cannot be turned
>    off alone cannot be shown to earn its place.
>
> **The measurement ladder (ratified by owner, 2026-07-28).** Rung 1:
> deterministic replay over the golden corpus — prove the machinery does what it
> should, at zero tokens. Rung 2: haiku composite — fast, cheap, directional.
> Rung 3: fast local tool-calling models, non-reasoning (thinking models are
> excluded — their variance swamps a cost signal). Cross-tier promotion decisions
> require rungs 2 and 3 to agree in SIGN.
>
> **Consequence for the record.** Do not cite 555–640% anywhere. The corrected
> composite re-baseline is Phase 3 of the plan; until it lands, the honest
> statement is "harness overhead is being re-measured after an instrument fault."
```

- [ ] **Step 3: Verify no fourth north-star document was created**

Run: `ls wiki/Architecture/Specs/ | grep -c "NORTH-STAR\|UNIFIED"`
Expected: `2` (08-AGENTIC-OS-NORTH-STAR.md and 09-UNIFIED-PROGRAM.md — unchanged count)

- [ ] **Step 4: Commit**

```bash
git add wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md
git commit -m "docs(09): retract the 555-640% figure, ratify the A-tier bar and measurement ladder

The simplification program's motivating number was computed with the broken
token accounting fixed in 2f97ca1e. Retracted, not revised — the true value is
unknown until the corrected composite runs.

Adds the three A-tier gates (one mechanism clears the lift rule; an external
benchmark; full ablatability) and the owner-ratified measurement ladder
(deterministic replay, then haiku, then fast non-reasoning local tool-callers).

Amendment in place per the standing constraint against a fourth north-star doc."
```

---

### Task 3: File the invalidated-baseline and cache-prefix debt

**Files:**
- Modify: `wiki/Architecture/DEBT-REGISTER.md` (append to §5, latent correctness bugs, line 242)

**Interfaces:**
- Consumes: F10 from Task 1, the amendment from Task 2.
- Produces: register entries `D-2026-07-28-A` and `D-2026-07-28-B`, cited by Task 10's gate.

- [ ] **Step 1: Append two entries to §5**

```markdown
### D-2026-07-28-A — every pre-`2f97ca1e` token figure is unverified

**Class:** instrument fault, already fixed; the DEBT is the contaminated record.

Anthropic `usage.input_tokens` counts only the uncached remainder. Both provider
paths reported it as `inputTokens`/`totalTokens` while computing `estimatedCost`
off the correct total, so cost was right and tokens were wrong, and the error
scaled with cache effectiveness.

**Blast radius:** every token-overhead comparison in `wiki/Research/`, the
555–640% figure in 09 §7 (retracted 2026-07-28), and any arm-vs-arm token delta
where the arms cached differently. Cost figures are unaffected.

**Discharge:** the corrected composite re-baseline (gap-closure plan Phase 3).
Until then, no document may cite a pre-`2f97ca1e` token overhead.

**Gate:** `packages/llm-provider/tests/cached-input-tokens-are-counted.test.ts`
(4 cells, red-on-cut) prevents recurrence.

### D-2026-07-28-B — the request prefix churns, so the cache never hits

See [[../Failure-Modes/RUNNING-CATALOGUE#F10]]. Per-iteration mutation of the
`tools` array sits at position zero of Anthropic's cache prefix and invalidates
all three `cache_control` breakpoints every turn; the system prompt compounds it
by carrying the standing frame and `Remaining steps:` inside the cached block.

**Measured:** cacheRead=0 on the default kernel path; the non-pruning arm costs
17% LESS money despite 1.7× the tokens.

**Discharge:** gap-closure plan Phase 2, promoted to default only if it clears
the §6 lift rule on rungs 2 and 3 of the ladder.

**Gate:** `scripts/check-volatile-placement.sh` (Task 10).
```

- [ ] **Step 2: Commit**

```bash
git add wiki/Architecture/DEBT-REGISTER.md
git commit -m "docs(debt): file the invalidated token baselines and the cache-prefix churn

D-2026-07-28-A records that the instrument fault contaminated the measurement
record, not just one number, and bars citing any pre-2f97ca1e token overhead
until the corrected composite lands.

D-2026-07-28-B is the cache-prefix defect with its discharge condition and gate."
```

---

### Task 4: Streamline the working tree

**Files:**
- Modify: `wiki/Hot.md`
- Resolve: 4 modified + 3 untracked paths reported by `git status`

**Interfaces:**
- Consumes: Tasks 1-3 committed.
- Produces: a clean tree, so Phase 1's golden-corpus work starts from a known state.

⚠️ **Do not `rm -rf` any untracked directory.** Inspect each untracked path and either commit it or move it aside. Git cannot recover untracked content.

- [ ] **Step 1: Inspect every untracked and modified path**

```bash
git status --short
git diff --stat
wc -l wiki/Research/Harness-Reports/local-models-narrow-qwen3-4b-2026-07-26*.json
```

- [ ] **Step 2: Commit the harness-report artifacts, which are evidence**

```bash
git add wiki/Research/Harness-Reports/local-models-narrow-qwen3-4b-2026-07-26.json \
        wiki/Research/Harness-Reports/local-models-narrow-qwen3-4b-2026-07-26-TIMEOUT-EVIDENCE.json \
        wiki/Research/Harness-Reports/integration-control-flow-scenario-health.json \
        .agents/skills/harness-improvement-loop/scripts/local-bench-narrow-2026-07-26.ts
git commit -m "chore(evidence): persist the 2026-07-26 narrow local-model bench artifacts

Bench receipts are evidence and belong in the record. The TIMEOUT-EVIDENCE file
documents which qwen3-4b cells did not complete, which is exactly the kind of
omission a summary table hides."
```

- [ ] **Step 3: Review the remaining modified files individually**

```bash
git diff .superpowers/sdd/progress.md .superpowers/sdd/task-10-report.md apps/docs/src/data/github-stats.json
```

`github-stats.json` is generated — check whether it is gitignored upstream; if it regenerates on every build, add it to `.gitignore` rather than committing churn. The `.superpowers/sdd/` files are session scratch from an earlier task; commit them only if they record a decision, otherwise `git checkout --` them.

- [ ] **Step 4: Update Hot.md to point at the active program**

Replace the current-state section of `wiki/Hot.md` with:

```markdown
## Active program (2026-07-28)

**A-TIER GAP CLOSURE** — [[Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]].
Supersedes the simplification program as the WIP=1 item; the simplification
program's motivating figure (555–640% harness overhead) was **retracted** on
2026-07-28 because the instrument was broken (`2f97ca1e`).

**Highest open defect:** [[Failure-Modes/RUNNING-CATALOGUE#F10]] — the request
prefix churns every iteration, so the prompt cache never hits. Lazy tool
disclosure saves 41% of tokens and costs 17% MORE money.

**Do not cite** any token-overhead figure predating `2f97ca1e`.

**Measurement ladder:** deterministic replay → haiku → fast non-reasoning local
tool-callers. Promotion requires rungs 2 and 3 to agree in sign.

**External gate:** τ-bench (ratified 2026-07-28).
```

- [ ] **Step 5: Verify the tree is clean and commit**

```bash
git status --short
git add wiki/Hot.md && git commit -m "docs(hot): A-tier gap closure is the active program"
```

Expected: `git status --short` prints nothing.

---

## Phase 1 — Prove the machinery deterministically (zero tokens)

Rung 1 of the ladder. Nothing here spends a token. The point is to prove the
harness does what it should *before* paying a model to tell us.

### Task 5: Build a plan-bearing golden

**Files:**
- Create: `packages/benchmarks/golden/planned-tool-loop.jsonl`
- Create: `packages/benchmarks/golden/planned-tool-loop.expect.json`
- Modify: `packages/benchmarks/tests/replay-golden.test.ts`

**Interfaces:**
- Consumes: `makeReplayAgent` from `packages/benchmarks/src/replay-agent.ts`, `loadRecordedRun` and `replay` from `@reactive-agents/replay`.
- Produces: the golden name `planned-tool-loop`, consumed by Tasks 6, 7 and 10.

**Why this task exists.** The four existing goldens (`abstain`, `answer-only`,
`terse-tool-loop`, `tool-write`) never populate `goal_state.remaining` and never
render a standing frame. So none of them can detect a change in where volatile
content sits — the exact regression Task 8 risks. Without this golden, Task 6's
test would pass vacuously.

- [ ] **Step 1: Confirm the existing goldens do not exercise the volatile path**

```bash
grep -l "goal_state\|remaining" packages/benchmarks/golden/*.jsonl || echo "CONFIRMED: no golden carries goal_state"
```

Expected: `CONFIRMED: no golden carries goal_state`. If any golden does carry it, read that golden and reuse it instead of creating a new one — do not duplicate coverage.

- [ ] **Step 2: Add a `GoldenScenario` — the recorder has NO CLI flags**

**Verified 2026-07-28: `replay-record.ts` takes no arguments.** It iterates a hardcoded `const SCENARIOS: readonly GoldenScenario[]` at `:32` and records each one against the scripted test provider. A golden is *authored* as an array entry, not captured from a live run. Add a fifth entry after `tool-write` (`:46-62`):

```typescript
  {
    // F10: the only golden that populates `goal_state.remaining` and renders a
    // standing frame. Without it, nothing in the corpus can detect a change in
    // WHERE volatile content sits, so the volatile-placement gate would be
    // guarding a case no golden exercises.
    sidecar: {
      name: "planned-tool-loop",
      task: "Read ./input.txt, then write the line count to ./count.txt and report the number.",
      strategy: "plan-execute",
      builtins: ["file-read", "file-write"],
      // Static required list, for the SAME reason tool-write carries one: it
      // suppresses the tool-relevance classifier, whose prompt contains the task
      // text and would otherwise consume this scenario's match-guarded toolCall
      // turns, and its quota forces both tools to fire before the terminal.
      requiredTools: ["file-read", "file-write"],
      maxIterations: 6,
      toolMode: "live",
      fileRoot: GOLDEN_FILE_ROOT,
      expectOutputIncludes: ["2"],
      expectToolsUsed: ["file-read", "file-write"],
    },
    scenario: [
      { text: "I need to read the file first, then count and write." },
      { toolCall: { name: "file-read", args: { path: "./input.txt" } }, match: /input\.txt/ },
      { toolCall: { name: "file-write", args: { path: "./count.txt", content: "2" } }, match: /count/ },
      { text: "FINAL ANSWER: 2" },
    ],
  },
```

Read the `GoldenScenario` type and the existing `tool-write` entry in full before writing this — mirror its field names and its `scenario` turn shape exactly rather than trusting the sketch. `GOLDEN_FILE_ROOT` is already imported in that file.

- [ ] **Step 3: Record**

```bash
timeout 300 bun run packages/benchmarks/src/replay-record.ts
```

This re-records **every** golden. Check `git diff --stat packages/benchmarks/golden/` afterwards: only `planned-tool-loop.*` should be new, and **the other four must be unchanged**. If an existing golden's bytes moved, something non-deterministic leaked into the recorder — stop and find it before continuing, because every downstream verdict in this plan is built on that corpus.

- [ ] **Step 4: Assert the recording actually contains a plan**

```bash
grep -c "goal_state" packages/benchmarks/golden/planned-tool-loop.jsonl
```

Expected: `≥1`. **If this is 0 the golden is useless — do not proceed.** The likely cause is that `plan-execute` did not emit a `goal_state` event on a task this short; lengthen the task until it decomposes. A golden that does not carry the state under test is worse than no golden, because it produces a green test that proves nothing — this repo has already shipped one regression cell that survived its own red-on-cut for exactly this reason.

- [ ] **Step 5: Run the golden suite**

Run: `bun test packages/benchmarks/tests/replay-golden.test.ts --timeout 30000`
Expected: PASS. If the test enumerates goldens from a hardcoded list rather than by globbing the directory, add `planned-tool-loop` to it.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/golden/planned-tool-loop.jsonl \
        packages/benchmarks/golden/planned-tool-loop.expect.json \
        packages/benchmarks/tests/replay-golden.test.ts
git commit -m "test(golden): add a plan-bearing golden so volatile placement is testable

The four existing goldens never populate goal_state.remaining and never render a
standing frame, so none of them can detect a change in where volatile content
sits in the request. Any test written against them would pass vacuously.

planned-tool-loop forces a decomposed task through plan-execute so the standing
frame and Remaining steps are both live in the recording."
```

---

### Task 6: Pin where volatile content sits

**Files:**
- Create: `packages/reasoning/tests/assembly/volatile-placement.test.ts`

**Interfaces:**
- Consumes: `project` and `AssemblyInput` from `packages/reasoning/src/assembly/project.ts`.
- Produces: the red-on-cut gate that Task 8 must turn green. This test is written to FAIL against current `main`.

**This is the TDD anchor for Phase 2.** Write it now, watch it fail, and let Task 8 make it pass.

- [ ] **Step 1: Write the failing test**

```typescript
// Run: bun test packages/reasoning/tests/assembly/volatile-placement.test.ts
//
// F10 — the request prefix churns, so the prompt cache never hits.
//
// Anthropic caches by exact prefix, ordered `tools` -> `system` -> `messages`.
// Anything that changes between iterations must live AFTER the last cache
// breakpoint, i.e. in the message tail. `Remaining steps:` and the standing
// frame change every iteration and currently live inside the system prompt, so
// they invalidate the system breakpoint (and everything after it) every turn.
//
// This also fixes attention placement: leading harnesses re-state the plan at
// the END of context to bias attention toward the goal. Ours sat in the middle.
//
// RED-ON-CUT: revert `volatileTailStage` and the first two cells fail.
import { describe, it, expect } from "bun:test";
import { project, type AssemblyInput } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

/**
 * `EventLog.append` is PERSISTENT — it returns a new log rather than mutating
 * (`event-log.ts:23`). Discarding the return value silently produces an empty
 * log, and every assertion below would then pass vacuously.
 */
const CAPABILITY = resolveCapability({
  window: 200_000,
  outputBudget: 4096,
  dialect: "native-fc",
  tier: "frontier",
});

/** An assembly input carrying BOTH volatile sources: a plan and prior context. */
function plannedInput(remaining: readonly string[]): AssemblyInput {
  const log = new EventLog()
    .append({ kind: "goal", text: "Count the lines in ./input.txt and write the count." })
    .append({ kind: "goal_state", remaining });
  return {
    log,
    capability: CAPABILITY,
    store: new ResultStore(),
    persona: { system: "You are a careful assistant." },
    priorContext: "Earlier pass selected the two-step approach.",
    tools: {
      schemas: [
        { name: "file-read", description: "Read a file", parameters: [] },
        { name: "file-write", description: "Write a file", parameters: [] },
      ],
    },
  };
}

/** Concatenated text of every message, in order. */
function messageText(messages: readonly unknown[]): string {
  return messages
    .map((m) => {
      const rec = m as { content?: unknown };
      if (typeof rec.content === "string") return rec.content;
      if (Array.isArray(rec.content)) {
        return rec.content
          .map((b) => (b as { text?: string }).text ?? "")
          .join("\n");
      }
      return "";
    })
    .join("\n");
}

describe("volatile content lives in the message tail, not the cached prefix", () => {
  it("keeps the per-iteration plan OUT of the system prompt", () => {
    const { request } = project(plannedInput(["read the file", "write the count"]));

    // The load-bearing assertion. This string inside `systemPrompt` is what
    // invalidates the system cache breakpoint on every iteration.
    expect(request.systemPrompt).not.toContain("Remaining steps:");
  });

  it("keeps the standing frame OUT of the system prompt", () => {
    const { request } = project(plannedInput(["read the file"]));

    // priorContext is rendered by the standing frame and changes across passes.
    expect(request.systemPrompt).not.toContain("Earlier pass selected");
  });

  it("still DELIVERS the plan to the model, in the tail", () => {
    // Moving volatile content must not DROP it. The strategy-switch handoff
    // regression (H1) was exactly this: composed but never rendered, so the
    // model restarted blind after every switch.
    const { request } = project(plannedInput(["read the file", "write the count"]));
    const tail = messageText(request.messages);

    expect(tail).toContain("read the file");
    expect(tail).toContain("Earlier pass selected");
  });

  it("holds the system prompt BYTE-STABLE across iterations that differ only in plan state", () => {
    // The whole point: two iterations of the same run, different remaining
    // steps, must produce an identical cacheable prefix.
    const a = project(plannedInput(["read the file", "write the count"]));
    const b = project(plannedInput(["write the count"]));

    expect(a.request.systemPrompt).toBe(b.request.systemPrompt);
  });

  it("leaves a run with no plan and no frame byte-identical to before", () => {
    // Back-compat: the common no-plan case must not change at all, or this
    // 'fix' silently re-scales every historical baseline.
    const bare: AssemblyInput = {
      log: new EventLog().append({ kind: "goal", text: "What is 2+2?" }),
      capability: CAPABILITY,
      store: new ResultStore(),
      persona: { system: "You are a careful assistant." },
      tools: { schemas: [] },
    };

    const before = project(bare);
    expect(before.request.systemPrompt).toContain("What is 2+2?");
    expect(before.request.systemPrompt).not.toContain("Remaining steps:");
    // No volatile content means volatileTailStage appends nothing at all.
    expect(before.request.messages.length).toBe(
      project(bare).request.messages.length,
    );
  });
});
```

- [ ] **Step 2: Run it and verify it fails for the RIGHT reason**

Run: `bun test packages/reasoning/tests/assembly/volatile-placement.test.ts`

Expected: cells 1, 2 and 4 FAIL. Cell 1 must fail with the received string *containing* `Remaining steps:` — not with a constructor or import error. **If it fails to construct `EventLog`/`ResultStore`/`resolveCapability`, fix the fixture first.** A test that fails for the wrong reason proves nothing, and this repo has already shipped one regression cell that survived its own red-on-cut because a guard rescued it.

- [ ] **Step 3: Verify cell 3 and cell 5 PASS today**

Cell 3 (plan reaches the model) and cell 5 (no-plan back-compat) must be green on current `main` — they describe behaviour that already holds and must keep holding. If either is red now, the fixture is wrong.

- [ ] **Step 4: Commit the failing test**

```bash
git add packages/reasoning/tests/assembly/volatile-placement.test.ts
git commit -m "test(assembly): pin volatile content OUT of the cached prefix (F10, red)

Committed RED on purpose — cells 1, 2 and 4 fail against main and are the TDD
anchor for the volatile-tail stage.

Cells 3 and 5 pass today and guard the two ways this fix could go wrong: dropping
the plan entirely (the H1 strategy-switch regression, composed-but-never-rendered)
and perturbing the no-plan case that every historical baseline was measured on."
```

---

### Task 7: Sweep the new flags for inertness

**Files:**
- Modify: `packages/benchmarks/src/replay-ablate-sweep.ts:43-59` (the `BEHAVIOURAL` table)
- Create: `wiki/Research/Harness-Reports/2026-07-28-rung1-flag-inertness.md`

**Interfaces:**
- Consumes: the golden corpus including `planned-tool-loop` from Task 5.
- Produces: a live/inert verdict per flag, feeding the "lift evidence" column of Task 15's audit.

**Corrected scope (verified 2026-07-28).** An earlier draft of this task called for `bare`/`lean`/`full` *composite* arms here. **The sweep does not support composites.** It is a single-flag inertness detector: `runOne(flag, value)` at `:78` shells `replay-ablate.ts` with exactly one `<flag> <value>` pair, or `--baseline`. Composite arms already exist where they belong — in the live `disclosure-ablation` (Task 10), which can actually price them.

Forcing composites in here would mean rewriting the worker's argument protocol to serve one task. That is the over-engineering this program exists to stop. **What this instrument is genuinely good at is the thing 09 §7 asks for**: telling us which flags do nothing at all, so they can be demoted or deleted *without* spending a live arm.

**Scope limit.** Replay measures **control flow, not accuracy and not cost.** It cannot re-baseline the retracted token figure — that is rungs 2 and 3. Do not report a green sweep as a lift result.

- [ ] **Step 1: Note which of our flags are already covered**

`BEHAVIOURAL` (`:43`) already carries `["RA_LAZY_TOOLS", "0"]`. It does **not** carry the two flags split out of it in `2f97ca1e`, nor the one added in Task 9 — so the split that made F3 measurable is itself unmeasured.

- [ ] **Step 2: Add the three missing flags**

```typescript
  // Split out of RA_LAZY_TOOLS in 2f97ca1e. Until now the compound flag was
  // swept and its three constituents were not, so "RA_LAZY_TOOLS is live" said
  // nothing about WHICH of the three mechanisms was doing the work.
  ["RA_TOOL_DISCOVERY", "0"], // !== "0" — default ON, so "0" is the ablation
  ["RA_VERBOSE_RULES", "1"], // === "1" — default OFF, so "1" is the ablation
  // F10, added in Task 9. Default OFF, so "1" is the ablation.
  ["RA_STABLE_TOOL_SURFACE", "1"],
```

Note the direction of each toggle. The file's own header warns that a wrong toggle "produces a confident, silent false INERT, which is exactly the evidence someone would later use to delete a working mechanism" — check each against its resolver in `harness-flags.ts` before adding the row.

- [ ] **Step 3: Run the sweep**

```bash
timeout 590 bun run packages/benchmarks/src/replay-ablate-sweep.ts \
  2>&1 | tee wiki/Research/Harness-Reports/2026-07-28-rung1-flag-inertness.md
```

Zero tokens, no provider, no keys. The worker has a 120s per-flag timeout (`:80`); with ~17 flags this can approach the outer limit, so run it foreground and do not background it.

- [ ] **Step 4: Check the baseline line FIRST**

The sweep prints `baseline: N/M goldens match` and exits 1 if the baseline is not clean. **If the baseline is dirty, every verdict below it is unattributable** — divergence could not be assigned to a flag rather than to noise. Fix the baseline before reading anything else. Adding `planned-tool-loop` in Task 5 is the most likely cause of a newly-dirty baseline; if so, that golden is non-deterministic and must be fixed or dropped.

- [ ] **Step 5: Record the verdicts**

Three outcomes, and the distinction matters:
- **live** — the flag changed control flow on at least one golden. It is doing something; whether that something *helps* still needs a live arm.
- **inert** — the flag ran and changed nothing across the corpus. Per 09 §7's pre-filter, demote or delete **without** spending a live arm.
- **untestable** — the corpus cannot exercise it. Record it in the `UNTESTABLE` table with the reason, never in `inert`. The file's own comment is right that *"the code never ran"* and *"the code ran and did nothing"* are different findings and only the second justifies deletion.

Expect `RA_STABLE_TOOL_SURFACE` to report **live** (it changes the visible tool set, which changes the prompt) but note plainly in the report that replay cannot tell you whether that change is an improvement.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/replay-ablate-sweep.ts \
        wiki/Research/Harness-Reports/2026-07-28-rung1-flag-inertness.md
git commit -m "bench(replay): sweep the three flags split out of RA_LAZY_TOOLS

Rung 1 of the measurement ladder — zero tokens, no provider.

RA_LAZY_TOOLS was swept as a compound flag while its three constituents were
not, so a 'live' verdict never said WHICH mechanism was doing the work. Adds
RA_TOOL_DISCOVERY, RA_VERBOSE_RULES and RA_STABLE_TOOL_SURFACE.

Scope limit recorded: replay measures control flow, not accuracy and not cost.
It cannot re-baseline the retracted token-overhead figure, and a live verdict
here is not a lift result."
```

---

## Phase 2 — Cache-aware prefix

### Task 8: Move volatile content to the message tail

**Files:**
- Create: `packages/reasoning/src/assembly/stages/volatile-tail.ts`
- Modify: `packages/reasoning/src/assembly/stages/system-prompt.ts:75-90`
- Modify: `packages/reasoning/src/assembly/project.ts:67-73`

**Interfaces:**
- Consumes: `AssemblyCtx` from `packages/reasoning/src/assembly/project.ts:52`, `renderStandingFrame` and `StandingFrameSection` from `packages/reasoning/src/assembly/standing-frame.ts`, `pushStage` from `../trace.js`.
- Produces: `volatileTailStage: (c: AssemblyCtx) => AssemblyCtx`, added to `STAGES` after `compactHistoryStage` and before `finalizeStage`. `AssemblyCtx.standingSections` keeps its existing meaning and is still read by `finalizeStage` for the projection trace — do not change its type.

- [ ] **Step 1: Create the volatile-tail stage**

```typescript
import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
import { renderStandingFrame, type StandingFrameSection } from "../standing-frame.js";

/**
 * F10 — put per-iteration content where it cannot break the cache.
 *
 * Anthropic caches by exact prefix, ordered `tools` -> `system` -> `messages`.
 * Content that changes between iterations therefore has exactly one safe home:
 * after the last cache breakpoint, in the message tail. The standing frame and
 * the remaining-steps list both change every iteration and both used to live
 * inside the system prompt, which invalidated the system breakpoint — and every
 * breakpoint after it — on every single turn. Measured cacheRead was 0 on the
 * default kernel path.
 *
 * This placement is also what leading harnesses do for a second, independent
 * reason: re-stating the plan at the END of the context biases attention toward
 * the goal, where the middle of a long context is where instructions go to die.
 * One move, two defects.
 *
 * Rendering is IDENTICAL to what systemPromptStage used to emit — same
 * `renderStandingFrame` call, same `Remaining steps:` line, same order. Only the
 * destination changed. A run with neither a frame nor a plan appends nothing and
 * is byte-identical to the pre-F10 behaviour.
 */
export const volatileTailStage = (c: AssemblyCtx): AssemblyCtx => {
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const frame = renderStandingFrame({
    priorContext: c.priorContext,
    ledger: c.ledger,
    contract: c.contract,
    assessment: c.assessment,
    longHorizon: c.longHorizon,
  });

  const parts: string[] = [];
  const standingSections: StandingFrameSection[] = [];
  for (const s of frame.sections) {
    parts.push(s.text);
    standingSections.push(s);
  }
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);

  // Nothing volatile this iteration — leave the request untouched so the
  // no-plan case stays byte-identical to every historical baseline.
  if (parts.length === 0) {
    return {
      ...c,
      standingSections,
      trace: pushStage(c.trace, "volatileTail", "none"),
    };
  }

  const text = parts.join("\n");
  const messages = appendToTail(c.messages, text);

  return {
    ...c,
    messages,
    standingSections,
    trace: pushStage(
      c.trace,
      "volatileTail",
      `${standingSections.length} frame section(s) + ${remaining.length} remaining`,
    ),
  };
};

/**
 * Append volatile text to the end of the message list.
 *
 * Merges into the trailing message when that message is already a user turn,
 * rather than appending a second consecutive user message. Two reasons: some
 * providers reject or silently coalesce consecutive same-role turns, and a
 * trailing `tool_result` message is a user turn whose content is a block array,
 * so pushing one more text block onto it is the natural shape. Only when the
 * tail is an assistant turn (or the list is empty) is a new user message added.
 */
function appendToTail(
  messages: AssemblyCtx["messages"],
  text: string,
): AssemblyCtx["messages"] {
  const list = [...messages] as Array<{ role: string; content: unknown }>;
  const last = list[list.length - 1];

  if (last && last.role === "user") {
    if (typeof last.content === "string") {
      list[list.length - 1] = { ...last, content: `${last.content}\n\n${text}` };
      return list as AssemblyCtx["messages"];
    }
    if (Array.isArray(last.content)) {
      list[list.length - 1] = {
        ...last,
        content: [...last.content, { type: "text", text }],
      };
      return list as AssemblyCtx["messages"];
    }
  }

  list.push({ role: "user", content: text });
  return list as AssemblyCtx["messages"];
}
```

- [ ] **Step 2: Remove the volatile emission from systemPromptStage**

In `packages/reasoning/src/assembly/stages/system-prompt.ts`, delete lines 75-87 (the `renderStandingFrame` call, the `standingSections` loop that pushes into `parts`, and the `Remaining steps:` push) and delete the now-unused `remaining` binding on line 55. Replace the deleted block with this comment so the next reader does not put it back:

```typescript
  // F10: the standing frame and `Remaining steps:` used to be pushed here.
  // They change every iteration, and everything in this string is inside
  // Anthropic's cached system block, so emitting them here invalidated the
  // system cache breakpoint (and both breakpoints after it) on every turn —
  // measured cacheRead 0 on the default kernel path. They now render in
  // `volatile-tail.ts`, after the last breakpoint. Do not move them back.
  // Gate: scripts/check-volatile-placement.sh
```

Then update the trace string on line 99 to drop `${frameNote}`, and remove the now-unused `renderStandingFrame` / `StandingFrameSection` imports on line 6 and the `frameNote`/`standingSections` locals. Leave the `standingSections` field on the returned context — `volatileTailStage` now populates it and `finalizeStage` still reads it.

- [ ] **Step 3: Wire the stage into the pipeline**

In `packages/reasoning/src/assembly/project.ts`:

```typescript
import { volatileTailStage } from "./stages/volatile-tail.js";

const STAGES = [
  systemPromptStage,
  selectToolsStage,
  projectResultsStage,
  compactHistoryStage,
  // F10: volatile content goes AFTER history compaction (so it is never
  // compacted away) and BEFORE finalize (which reads standingSections for the
  // projection trace).
  volatileTailStage,
  finalizeStage,
];
```

- [ ] **Step 4: Run the pinning test**

Run: `bun test packages/reasoning/tests/assembly/volatile-placement.test.ts`
Expected: all 5 cells PASS.

- [ ] **Step 5: Run the assembly golden-trace test to see what moved**

Run: `bun test packages/reasoning/tests/assembly/golden-trace.test.ts`

This will likely FAIL — the trace now carries a `volatileTail` stage. Read the diff and confirm it shows only the stage addition and the section relocation. **If the goal text, the persona, or the tool reference moved, stop — that is a real regression, not a golden update.** Update the golden only after confirming the diff is exactly the intended move.

- [ ] **Step 6: Run the full reasoning and runtime suites**

```bash
bun test packages/reasoning packages/runtime 2>&1 | tail -20
```

Expected: 1 pre-existing failure (`as-unknown-as` ceiling, which fails on a clean tree). Any other failure is yours.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/assembly/stages/volatile-tail.ts \
        packages/reasoning/src/assembly/stages/system-prompt.ts \
        packages/reasoning/src/assembly/project.ts
git commit -m "fix(assembly): move per-iteration content out of the cached prefix (F10)

Anthropic caches by exact prefix, ordered tools -> system -> messages. The
standing frame and 'Remaining steps:' change every iteration and were rendered
inside the system prompt, so they invalidated the system cache breakpoint and
both breakpoints after it on every single turn. Measured cacheRead was 0 on the
default kernel path.

They now render in volatileTailStage, after the last breakpoint. Rendering is
identical -- same renderStandingFrame call, same line format, same order. Only
the destination changed, and a run with neither frame nor plan appends nothing
and stays byte-identical.

Second, independent benefit: re-stating the plan at the END of context is where
leading harnesses put it, because the middle of a long context is where
instructions get ignored. One move, two defects.

Pinned by volatile-placement.test.ts, red-on-cut on cells 1, 2 and 4."
```

---

### Task 9: Stable tool surface, enforced by rejection

**Files:**
- Modify: `packages/reasoning/src/harness-flags.ts`
- Modify: `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts`
- Create: `packages/reasoning/tests/kernel/stable-tool-surface.test.ts`

**Interfaces:**
- Consumes: `resolveToolSurface` and its inputs object in `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts`; `lazyDisclosureEnabled` from `harness-flags.ts`.
- Produces: `stableToolSurfaceEnabled(): boolean` exported from `harness-flags.ts`, re-exported from `packages/reasoning/src/index.ts` alongside the existing three flags at line 455.

**Opt-in only.** This does NOT flip a default. `no-prune` costing 17% less money is one haiku measurement on one task shape; the lift rule decides the default in Task 13, not this task.

- [ ] **Step 1: Add the flag**

Append to `packages/reasoning/src/harness-flags.ts`:

```typescript
/**
 * Stable tool surface — the FC `tools` array and the in-prompt tool reference
 * both stay fixed for the whole run instead of being narrowed per iteration.
 *
 * Default OFF. `RA_STABLE_TOOL_SURFACE=1` turns it on.
 *
 * WHY IT EXISTS. Anthropic caches by exact prefix and `tools` is position zero
 * of that prefix, so per-iteration narrowing invalidates every cache breakpoint
 * on every turn. Measured on haiku: the pruning arm spends 39,174 tokens for
 * $0.04518 with cacheRead 0; the non-pruning arm spends 66,719 tokens for
 * $0.03871 with cacheRead 40,277. Pruning wins 41% of tokens and loses 17% of
 * the money.
 *
 * WHY IT IS NOT THE DEFAULT. That is one measurement, one tier, one task shape.
 * Promotion goes through the 09 §6 lift rule on rungs 2 and 3 of the ladder.
 *
 * NOTE ON "LOGIT MASKING". The industry rule is that tool availability should be
 * controlled by masking rather than list mutation. The Anthropic API exposes no
 * per-tool masking — `tool_choice` is auto/any/tool(name)/none only — so that
 * rule cannot be applied literally here. Availability is instead enforced at
 * execution: the schema stays in the list and a call to a withheld tool returns
 * a corrective observation. Building a masking abstraction over an API that
 * cannot mask would be the over-engineering this program exists to stop.
 */
export function stableToolSurfaceEnabled(): boolean {
  return readFlag("RA_STABLE_TOOL_SURFACE") === "1";
}
```

- [ ] **Step 2: Export it**

Add `stableToolSurfaceEnabled,` to the export block in `packages/reasoning/src/index.ts` at line 455, next to `lazyDisclosureEnabled`.

- [ ] **Step 3: Honour the flag in the resolver**

In `packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts`, at the top of `resolveToolSurface`, short-circuit to the full permitted surface when stable mode is on. Keep the deny-list and the gate-block list applied — those are correctness, not disclosure:

```typescript
  // F10 stable mode: the visible set is the full permitted surface for the whole
  // run, so the FC `tools` array is byte-stable across iterations and the cache
  // prefix survives. Denied and gate-blocked tools are STILL removed — those are
  // correctness constraints, not attention management, and a contract deny-list
  // that leaked under a caching flag would be a security defect.
  //
  // Placed AFTER the `augmented` / `permitted` computation (which applies the
  // contract deny-list to the schema universe) and BEFORE the pressure gate and
  // Stage 2 pruning, so deny still beats everything by construction.
  if (stableToolSurfaceEnabled()) {
    const blocked = new Set(inputs.gateBlockedTools);
    const stableVisible = augmented.filter((ts) => !blocked.has(ts.name));
    return {
      universe: augmented,
      visible: stableVisible,
      callable: stableVisible,
      reasons: new Map(stableVisible.map((ts) => [ts.name, "stable-surface"])),
    };
  }
```

**Verified against the real signature (2026-07-28).** `resolveToolSurface(inputs: ToolSurfaceInputs): ResolvedToolSurface` at `tool-surface.ts:248`. The deny-list field is `inputs.forbiddenTools` (already folded into the local `permitted()` helper and therefore into `augmented`), **not** `deniedToolNames`. The schema set is `inputs.augmented`, **not** `effectiveSchemas` — that is a local computed further down. The return type is `{ universe, visible, callable, reasons }` at `:199-219`; there is **no** `pruned` field.

- [ ] **Step 4: Write the test**

```typescript
// Run: bun test packages/reasoning/tests/kernel/stable-tool-surface.test.ts
//
// RED-ON-CUT: delete the stable-mode short-circuit in resolveToolSurface and
// cells 1 and 3 fail.
import { describe, it, expect, afterEach } from "bun:test";
import { resolveToolSurface } from "../../src/kernel/capabilities/reason/tool-surface.js";

import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

const schema = (name: string, description: string): ToolSchema => ({
  name,
  description,
  parameters: [],
});

const SCHEMAS: readonly ToolSchema[] = [
  schema("file-read", "Read a file"),
  schema("file-write", "Write a file"),
  schema("web-search", "Search the web"),
  schema("code-execute", "Run code"),
];

const FINAL_ANSWER = schema("final-answer", "Give the final answer");

/**
 * A full `ToolSurfaceInputs`. Every required field is present — the interface
 * has 13 of them (`tool-surface.ts:152-167`) and omitting one produces a type
 * error, not a default.
 *
 * `pruneMinTools: 15` mirrors the kernel's `PRUNE_MIN_TOOLS` (`think.ts`), and
 * with only 4 schemas the classification prune is BELOW that floor — which is
 * why cell 4 asserts on the disclosure prune rather than the classifier one.
 */
function inputs(over: Partial<Parameters<typeof resolveToolSurface>[0]> = {}) {
  return {
    augmented: SCHEMAS,
    finalAnswerSchema: FINAL_ANSWER,
    lazyMode: true,
    pressureCritical: false,
    hasClassification: false,
    requiredTools: [],
    relevantTools: [],
    allowedTools: [],
    toolsUsed: [],
    discovered: [],
    gateBlockedTools: [],
    missingRequiredTools: [],
    pruneMinTools: 15,
    ...over,
  };
}

afterEach(() => {
  delete process.env.RA_STABLE_TOOL_SURFACE;
});

describe("stable tool surface", () => {
  it("shows every permitted tool regardless of classification", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(
      inputs({ hasClassification: true, relevantTools: ["file-read"], taskText: "read a file" }),
    );
    // A classifier verdict must not shrink the surface in stable mode -- that
    // shrinkage is exactly what breaks the cache prefix.
    expect(out.visible.map((t) => t.name).sort()).toEqual([
      "code-execute",
      "file-read",
      "file-write",
      "web-search",
    ]);
  });

  it("STILL removes contract-forbidden tools -- deny is correctness, not disclosure", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(inputs({ forbiddenTools: ["code-execute"] }));
    // forbiddenTools is applied by `permitted()` into `augmented` BEFORE the
    // stable-mode short-circuit, so deny beats the caching flag by construction.
    expect(out.visible.map((t) => t.name)).not.toContain("code-execute");
    expect(out.universe.map((t) => t.name)).not.toContain("code-execute");
  });

  it("STILL removes gate-blocked tools", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const out = resolveToolSurface(inputs({ gateBlockedTools: ["web-search"] }));
    expect(out.visible.map((t) => t.name)).not.toContain("web-search");
  });

  it("is byte-stable across iterations that differ only in what was used", () => {
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const iter1 = resolveToolSurface(inputs({ toolsUsed: [] }));
    const iter2 = resolveToolSurface(inputs({ toolsUsed: ["file-read"] }));

    // The whole point: the FC tools array must not change between turns.
    expect(JSON.stringify(iter1.visible)).toBe(JSON.stringify(iter2.visible));
  });

  it("leaves the default path untouched when the flag is off", () => {
    const out = resolveToolSurface(
      inputs({ hasClassification: true, relevantTools: ["file-read"], taskText: "read a file" }),
    );
    // Default behaviour must be byte-identical -- every historical baseline was
    // measured on it. Under lazy mode with a classification naming one tool, the
    // visible set is narrower than the universe.
    expect(out.visible.length).toBeLessThan(SCHEMAS.length);
  });
});
```

**Verified against the real interface (2026-07-28).** `ToolSurfaceInputs` at `tool-surface.ts:152-196` requires all 13 non-optional fields above; `forbiddenTools`, `catalog`, `taskText` and `floorTools` are the optional ones. Cell 4 relies on the never-prune-to-meta-only guard *not* rescuing the pruned set — if it passes trivially, raise the schema count above `pruneMinTools` and re-check, per the floor-regression trap that already produced one vacuously-green cell in this repo.

- [ ] **Step 5: Run the test**

Run: `bun test packages/reasoning/tests/kernel/stable-tool-surface.test.ts`
Expected: 4 PASS.

- [ ] **Step 6: Verify red-on-cut**

Comment out the stable-mode short-circuit, re-run, confirm cells 1 and 3 fail, then restore it. **A test that cannot be made to fail is not a gate.**

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/harness-flags.ts \
        packages/reasoning/src/index.ts \
        packages/reasoning/src/kernel/capabilities/reason/tool-surface.ts \
        packages/reasoning/tests/kernel/stable-tool-surface.test.ts
git commit -m "feat(tool-surface): opt-in stable tool surface for cache-prefix stability (F10)

RA_STABLE_TOOL_SURFACE=1 fixes the FC tools array for the whole run. The tools
array is position zero of Anthropic's cache prefix, so per-iteration narrowing
invalidates every breakpoint every turn.

Deny-listed and gate-blocked tools are still removed -- those are correctness
constraints, not attention management, and a contract deny-list that leaked
under a caching flag would be a security defect.

Default OFF. One haiku measurement on one task shape does not move a default;
the lift rule decides that on rungs 2 and 3 of the ladder.

Records why the industry 'logit masking' rule is NOT implemented literally: the
Anthropic API exposes no per-tool masking, so availability is enforced at
execution instead. Building a masking abstraction over an API that cannot mask
is the over-engineering this program exists to stop."
```

---

### Task 10: Instrument the ablation and gate the placement

**Files:**
- Modify: `packages/benchmarks/src/disclosure-ablation.ts:75-79`
- Create: `scripts/check-volatile-placement.sh`
- Modify: `scripts/check-cross-cutting.sh`

**Interfaces:**
- Consumes: the `ArmSpec` type at `packages/benchmarks/src/disclosure-ablation.ts:70`, `RA_STABLE_TOOL_SURFACE` from Task 9.
- Produces: the `stable-surface` arm name, consumed by Tasks 11 and 12. Cross-cutting Check 8.

- [ ] **Step 1: Add the arm**

```typescript
const ARMS: readonly ArmSpec[] = [
  { name: "inline", reasoning: false, env: {} },
  { name: "prune+discover", reasoning: true, env: {} },
  { name: "prune-only", reasoning: true, env: { RA_TOOL_DISCOVERY: "0" } },
  { name: "no-prune", reasoning: true, env: { RA_LAZY_TOOLS: "0", RA_VERBOSE_RULES: "0" } },
  // F10: the arm this program exists to test. Stable FC tool array (Task 9) plus
  // volatile content in the message tail (Task 8). Distinct from `no-prune`,
  // which stabilises the tool array but still ships the standing frame and the
  // remaining-steps line inside the cached system block -- so it caches only on
  // tasks that happen to have neither, which is why the first measurement of it
  // looked better than it should generalise.
  { name: "stable-surface", reasoning: true, env: { RA_STABLE_TOOL_SURFACE: "1", RA_VERBOSE_RULES: "0" } },
];
```

- [ ] **Step 2: Add `--output`, because the harness currently has none**

**Verified 2026-07-28: `disclosure-ablation.ts` takes three POSITIONAL args (`:221-223`) — `<provider> <model> <runs>` — and writes nothing to disk. It only `console.log`s.** That violates this project's own standing rule that a bench run without `--output` persists nothing, and it is why the F10 arm table currently survives only in a terminal scrollback.

Add a fourth positional arg and a write at the end of `import.meta.main`:

```typescript
  const outPath = process.argv[5];

  // ... after the summary table is printed ...

  // A bench run that persists nothing cannot be re-read, re-checked, or cited.
  // Writing the CELLS (not just the summary) is deliberate: the summary averages
  // away the per-run variance that decides whether a gap is signal or noise.
  if (outPath) {
    await Bun.write(
      outPath,
      JSON.stringify(
        { provider, model, runs, generatedAt: new Date().toISOString(), cells: all },
        null,
        2,
      ),
    );
    console.log(`\nwrote ${all.length} cells to ${outPath}`);
  } else {
    console.warn("\nWARNING: no output path given — this run persists nothing.");
  }
```

- [ ] **Step 3: Add the manipulation check**

Every arm must print its actual cache behaviour, not just its totals. The per-cell `cacheRead` already exists (`:216`); add `cacheCreation` alongside it, and add this assertion to the summary loop:

```typescript
  // Manipulation check. An arm claiming a caching win with cacheRead 0 measured
  // nothing -- that is the disclosure-ablation trap that already cost this repo
  // a retracted finding (`builtins: [...]` floored both arms to the same visible
  // set, so the token deltas compared two identical configurations).
  if (spec.name === "stable-surface" && cr === 0) {
    console.error(
      `MANIPULATION CHECK FAILED: stable-surface reported cacheRead=0. ` +
      `Either the prefix is still churning or the prompt is below the ` +
      `per-model cache minimum (Sonnet 1024 tok, Haiku 2048 tok). ` +
      `Do NOT read a cost conclusion off this run.`,
    );
  }
```

`cr` is the mean `cacheRead` already computed in the summary loop; `spec` is the loop's `ArmSpec`. Match the surrounding loop's identifiers rather than introducing a `summary` object that does not exist.

- [ ] **Step 4: Write the placement gate**

```bash
#!/usr/bin/env bash
# check-volatile-placement.sh — F10 gate.
#
# Per-iteration content must not be rendered into the system prompt. Anthropic
# caches by exact prefix and the system block is inside it, so anything that
# changes between turns invalidates the cache on every turn. Measured cacheRead
# was 0 on the default kernel path before this was fixed.
#
# RED-ON-CUT: move the `Remaining steps:` render back into system-prompt.ts and
# this exits 1.
set -euo pipefail

SYS="packages/reasoning/src/assembly/stages/system-prompt.ts"
TAIL="packages/reasoning/src/assembly/stages/volatile-tail.ts"
fail=0

if grep -q "Remaining steps:" "$SYS"; then
  echo "FAIL: 'Remaining steps:' is rendered in $SYS."
  echo "      It changes every iteration and the system prompt is inside the"
  echo "      cached prefix. It belongs in $TAIL."
  fail=1
fi

if grep -q "renderStandingFrame" "$SYS"; then
  echo "FAIL: the standing frame is rendered in $SYS."
  echo "      Same reason — it changes across passes. It belongs in $TAIL."
  fail=1
fi

if ! grep -q "Remaining steps:" "$TAIL"; then
  echo "FAIL: $TAIL does not render 'Remaining steps:'."
  echo "      Moving volatile content must not DROP it — that is the H1"
  echo "      composed-but-never-rendered regression."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: volatile content renders in the message tail, not the cached prefix."
fi
exit "$fail"
```

- [ ] **Step 5: Make it executable and verify red-on-cut**

```bash
chmod +x scripts/check-volatile-placement.sh
./scripts/check-volatile-placement.sh          # expect OK
# Now prove the gate works:
echo '// Remaining steps:' >> packages/reasoning/src/assembly/stages/system-prompt.ts
./scripts/check-volatile-placement.sh          # expect FAIL, exit 1
git checkout packages/reasoning/src/assembly/stages/system-prompt.ts
./scripts/check-volatile-placement.sh          # expect OK again
```

**Every check in this repo is red-on-cut verified when added. Do not skip this step.**

- [ ] **Step 6: Register it as Check 8**

Add the invocation to `scripts/check-cross-cutting.sh` following the existing Check 7 pattern, and update the check count in the script's header comment from 7 to 8.

- [ ] **Step 7: Run the whole gate**

Run: `./scripts/check-cross-cutting.sh`
Expected: 8/8.

- [ ] **Step 8: Commit**

```bash
git add packages/benchmarks/src/disclosure-ablation.ts \
        scripts/check-volatile-placement.sh \
        scripts/check-cross-cutting.sh
git commit -m "bench(F10): add the stable-surface arm, gate volatile placement as Check 8

The stable-surface arm is distinct from no-prune: no-prune stabilises the tool
array but still ships the standing frame and remaining-steps inside the cached
system block, so it caches only on tasks that happen to have neither. That is
why its first measurement looked better than it should generalise.

Manipulation check refuses to let a caching conclusion be read off a run that
reported cacheRead=0 -- the same class of trap that already cost this repo a
retracted finding.

Check 8 red-on-cut verified both ways."
```

---

## Phase 3 — Measure the ladder

Owner-ratified sequence: deterministic (done, Task 7) → haiku → fast local
non-reasoning tool-callers. **Reasoning/thinking models are excluded from the
cost rungs** — their output variance swamps the signal being measured.

### Task 11: Rung 2 — haiku composite

**Files:**
- Create: `wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.json`

**Interfaces:**
- Consumes: the `stable-surface` arm from Task 10.
- Produces: the haiku arm table cited by Task 13.

- [ ] **Step 1: Confirm keys are loaded**

```bash
grep -c "ANTHROPIC_API_KEY" .env
```

Keys live in `.env` (bun auto-loads it). `echo $ANTHROPIC_API_KEY` printing nothing proves nothing.

- [ ] **Step 2: Run the ablation FOREGROUND**

**The CLI is POSITIONAL, not flagged** (`disclosure-ablation.ts:221-223`, plus the output arg added in Task 10): `<provider> <model> <runs> <outPath>`.

```bash
timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts \
  anthropic claude-haiku-4-5-20251001 3 \
  wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.json
```

Foreground, `timeout ≤ 590`, output path present. A backgrounded bench cell gets SIGKILLed silently and you will read a truncated result as a finding.

With 5 arms × 3 runs = 15 live cells, 590s may not be enough. If it times out, drop to `2` runs and record `n=2` honestly rather than reporting a partial `n=3`.

- [ ] **Step 3: Read the manipulation check BEFORE the totals**

```bash
grep -E "MANIPULATION|cacheRead|cacheCreation" wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.json
```

If `stable-surface` reports `cacheRead=0`, **stop and diagnose**. The likely causes, in order: the prompt is below haiku's 2048-token cache minimum on these tasks (check the per-call input sizes), the tool array is still mutating (dump it per iteration), or the run had too few iterations to reuse a prefix at all.

- [ ] **Step 4: Record the arm table with its uncertainty**

Write the results into the report file as a table with `±Xpp (n=N)` on every accuracy figure. With n=3 the standard error is large — **accuracy differences below ~26pp are noise and must not be reported as differences.** Cost and cache figures are near-deterministic and can be read at much smaller n; say so explicitly in the report so the two are not conflated.

- [ ] **Step 5: Commit**

```bash
git add wiki/Research/Harness-Reports/2026-07-28-rung2-haiku-composite.json
git commit -m "bench(rung2): haiku composite with corrected token accounting

First arm table measured after 2f97ca1e. Cost and cache figures are
near-deterministic and readable at this n; accuracy figures carry ~26pp of
noise at n=3 and are reported with their standard error, not as differences."
```

---

### Task 12: Rung 3 — fast local non-reasoning tool-callers

**Files:**
- Create: `wiki/Research/Harness-Reports/2026-07-28-rung3-local-composite.json`

**Interfaces:**
- Consumes: the same arm set as Task 11.
- Produces: the second tier required for a cross-tier promotion decision in Task 13.

**Model selection.** Fast, tool-calling capable, and **not** reasoning models.
From the locally available set: `qwen3.5:latest` (6.6GB) and `granite4:tiny-h`
(4.2GB) are the two best fits. Explicitly excluded: `deepseek-r1:8b`,
`phi4-mini-reasoning`, and the `qwen3:*` family — all default to thinking traces
that add unbounded output variance to a measurement whose signal is cost.

- [ ] **Step 1: Verify Ollama is reachable and the models are present**

```bash
ollama list | grep -E "qwen3.5:latest|granite4:tiny-h"
curl -s http://localhost:11434/api/tags > /dev/null && echo "ollama reachable"
```

RA reads both `OLLAMA_ENDPOINT` and `OLLAMA_HOST` as of `8e5f49e6`. If the run reports a 2048-token context, check the transport before blaming the capability table — that exact misdiagnosis has already happened once.

- [ ] **Step 2: Confirm the model actually emits tool calls before spending a full run**

**`packages/benchmarks/src/preflight.ts` is a LIBRARY, not a CLI** (verified 2026-07-28 — it exports `checkCapabilitySourcePreflight` and `PreflightOptions`, and has no `import.meta.main`). Do a one-cell smoke run instead:

```bash
timeout 300 bun run packages/benchmarks/src/disclosure-ablation.ts \
  ollama qwen3.5:latest 1 \
  /tmp/ra-preflight-qwen35.json
```

Then confirm tools actually fired:

```bash
grep -o '"tools":\[[^]]*\]' /tmp/ra-preflight-qwen35.json | head
```

Expected: non-empty tool arrays. **A model that silently fails function calling produces an arm table of zeros that reads exactly like a harness finding.** If the tools array is empty on every cell, the model cannot drive this bench — swap it out rather than reporting its zeros.

Note the probe writes to `/tmp`, not the repo tree, per the standing constraint.

- [ ] **Step 3: Run both models FOREGROUND**

Positional args, same as rung 2: `<provider> <model> <runs> <outPath>`.

```bash
timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts \
  ollama qwen3.5:latest 3 \
  wiki/Research/Harness-Reports/2026-07-28-rung3-qwen35.json

timeout 590 bun run packages/benchmarks/src/disclosure-ablation.ts \
  ollama granite4:tiny-h 3 \
  wiki/Research/Harness-Reports/2026-07-28-rung3-granite4.json
```

Local models are slower per call than haiku, so 15 cells in 590s is unlikely. Drop to `1` run per model first to get a duration reading, then size the real run from it. **Split across invocations rather than backgrounding — a backgrounded bench cell gets SIGKILLed silently.**

- [ ] **Step 4: Note the caching caveat explicitly in the report**

Ollama has no prompt-cache billing, so `cacheRead` is meaningless on this rung. **Rung 3 measures accuracy non-regression and raw token count only.** The cost conclusion rests entirely on rung 2. Write that sentence into the report file — a reader who sees "stable-surface wins" across two rungs will otherwise assume both measured the same thing.

- [ ] **Step 5: Commit**

```bash
git add wiki/Research/Harness-Reports/2026-07-28-rung3-*.json
git commit -m "bench(rung3): fast local non-reasoning tool-callers, accuracy non-regression

qwen3.5:latest and granite4:tiny-h. Reasoning models excluded deliberately --
their output variance swamps a cost signal.

Ollama has no prompt-cache billing, so this rung measures accuracy
non-regression and raw tokens only. The cost conclusion rests on rung 2 alone,
and the report says so."
```

---

### Task 13: Apply the lift rule and decide the default

**Files:**
- Create: `wiki/Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline.md`
- Modify: `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` (§7, record the verdict)
- Modify: `packages/reasoning/src/harness-flags.ts` (only if the rule says promote)

**Interfaces:**
- Consumes: Task 11 and Task 12 result files.
- Produces: the promotion verdict, and the corrected harness-overhead figure that replaces the retracted 555–640%.

- [ ] **Step 1: Compute the corrected harness overhead**

From the rung-2 table: `full` tokens ÷ `bare` tokens, and the same for cost. **This is the number that replaces the retracted figure.** Report both, because the whole point of F10 is that they now disagree.

- [ ] **Step 2: Apply the lift rule to `stable-surface`**

The §6 rule is ≥3pp accuracy lift AND ≤15% token overhead. `stable-surface` is expected to *increase* tokens and *decrease* cost, which the rule as written does not cover — it was authored before caching made tokens and money diverge.

**Do not quietly reinterpret the rule to fit the result.** That is metric-gaming, and it is a named failure in this project's history. Either:
- the mechanism clears the rule as written (unlikely — tokens go up), or
- it fails as written and you propose an explicit, ratified amendment to §6 covering the tokens-vs-cost divergence, filed as a decision document in `wiki/Decisions/`.

The second is the honest path and is itself an A-tier improvement: a lift rule that cannot express "costs less money" is a broken instrument.

- [ ] **Step 3: Write the re-baseline report**

Include: both arm tables verbatim; the corrected overhead in tokens AND cost; the explicit statement that all pre-`2f97ca1e` figures are void; the rung-3 caching caveat; and the promotion verdict with its reasoning.

- [ ] **Step 4: Record the verdict in 09 §7**

Append to the 2026-07-28 amendment: the corrected overhead figure, and the `stable-surface` verdict (promoted / opt-in / deleted).

- [ ] **Step 5: Commit**

```bash
git add wiki/Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline.md \
        wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md
git commit -m "docs(rebaseline): corrected composite overhead replaces the retracted figure

Reports harness overhead in BOTH tokens and cost, because F10 is precisely the
finding that the two diverge under prompt caching.

Records the stable-surface verdict against the lift rule as written. Where the
rule cannot express a cost win, that is filed as a proposed amendment rather
than resolved by reinterpreting the rule to fit the result."
```

---

## Phase 4 — The external credibility gate

### Task 14: τ-bench adapter

**Files:**
- Create: `packages/benchmarks/src/tau-bench/loader.ts`
- Create: `packages/benchmarks/src/tau-bench/adapter.ts`
- Create: `packages/benchmarks/src/tau-bench/pass-k.ts`
- Create: `packages/benchmarks/tests/tau-bench/pass-k.test.ts`

**Interfaces:**
- Consumes: `ReactiveAgents` builder from `@reactive-agents/runtime`.
- Produces: `runTauBench(opts): Promise<TauBenchReport>` and `passAtK(results, k): number`.

**Why τ-bench.** Ratified 2026-07-28. It measures tool-calling agents against a
simulated user with a domain policy — which is what RA is — and its native metric
is pass^k, matching the pass^8 reliability framing already in 09. SWE-bench would
score the model's coding ability more than the harness; GAIA is noisy and partly
saturated.

- [ ] **Step 1: Vendor the task definitions, do not re-implement them**

τ-bench's value is that it is third-party. A reimplemented scorer is a self-built
bench wearing a borrowed name, which this project has already ruled out as a
basis for public claims. Fetch the upstream task JSON and the domain policies
verbatim; the adapter's only job is to drive RA through them.

- [ ] **Step 2: Write the pass^k scorer test first**

```typescript
// Run: bun test packages/benchmarks/tests/tau-bench/pass-k.test.ts
//
// pass^k is the probability that ALL k independent trials of a task succeed --
// it is a RELIABILITY metric, not an accuracy metric. A harness at 80% accuracy
// has pass^8 of 0.8^8 = 0.168, which is why 09 frames reliability as the binding
// axis. Getting this exponent wrong would flatter the harness by a wide margin.
import { describe, it, expect } from "bun:test";
import { passAtK } from "../../src/tau-bench/pass-k.js";

describe("pass^k", () => {
  it("is 1 when every trial of every task succeeded", () => {
    expect(passAtK([[true, true, true]], 3)).toBe(1);
  });

  it("is 0 when any trial of the only task failed", () => {
    expect(passAtK([[true, false, true]], 3)).toBe(0);
  });

  it("averages across tasks", () => {
    // One task fully reliable, one not: 0.5.
    expect(passAtK([[true, true], [true, false]], 2)).toBe(0.5);
  });

  it("refuses a k larger than the trials recorded", () => {
    // Silently scoring pass^8 off 3 trials would overstate reliability, which is
    // exactly the kind of quiet cap this project requires be logged, not hidden.
    expect(() => passAtK([[true, true, true]], 8)).toThrow();
  });
});
```

- [ ] **Step 2b: Run it and confirm it fails with "module not found"**

Run: `bun test packages/benchmarks/tests/tau-bench/pass-k.test.ts`
Expected: FAIL — `Cannot find module '../../src/tau-bench/pass-k.js'`.

- [ ] **Step 3: Implement the scorer**

```typescript
/**
 * pass^k — the fraction of tasks for which ALL k trials succeeded.
 *
 * This is reliability, not accuracy. A harness that solves a task 80% of the
 * time has pass^8 = 0.8^8 = 0.168. 09 names reliability as the binding axis
 * precisely because that gap is where agent harnesses actually fail.
 *
 * Throws rather than truncating when k exceeds the recorded trials: scoring
 * pass^8 off 3 trials would overstate reliability, and a silent cap reads as
 * "we covered it" when we did not.
 */
export function passAtK(results: readonly (readonly boolean[])[], k: number): number {
  if (results.length === 0) return 0;
  for (const trials of results) {
    if (trials.length < k) {
      throw new Error(
        `pass^${k} requires at least ${k} trials per task; found ${trials.length}. ` +
        `Truncating would overstate reliability.`,
      );
    }
  }
  const allPassed = results.filter((trials) =>
    trials.slice(0, k).every(Boolean),
  ).length;
  return allPassed / results.length;
}
```

- [ ] **Step 4: Run the test**

Run: `bun test packages/benchmarks/tests/tau-bench/pass-k.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Build the loader and adapter**

The loader reads the vendored task JSON into a typed `TauBenchTask[]` (no `any` —
define the shape from the upstream schema). The adapter constructs an RA agent
per task with the domain's tools registered, runs `k` independent trials, and
returns `(readonly boolean[])[]` for the scorer. Keep the two files separate: the
loader knows the upstream format, the adapter knows RA, and neither should need
changing when the other's world moves.

- [ ] **Step 6: Run one task end-to-end on haiku before scaling**

```bash
timeout 590 bun run packages/benchmarks/src/tau-bench/adapter.ts \
  --tasks 1 --k 3 --model claude-haiku-4-5-20251001 \
  --output wiki/Research/Harness-Reports/2026-07-28-tau-bench-smoke.json
```

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/tau-bench packages/benchmarks/tests/tau-bench \
        wiki/Research/Harness-Reports/2026-07-28-tau-bench-smoke.json
git commit -m "bench(tau-bench): external credibility gate with a pass^k scorer

Third-party task definitions vendored verbatim rather than reimplemented -- a
reimplemented scorer is a self-built bench wearing a borrowed name, which this
project has already ruled out as a basis for public claims.

pass^k throws rather than truncating when k exceeds the recorded trials.
Scoring pass^8 off 3 trials would overstate reliability, and a silent cap reads
as coverage we do not have."
```

---

### Task 15: Ablatability audit

**Files:**
- Create: `scripts/check-ablatable.sh`
- Create: `wiki/Research/Audit-Reports-2026-07-28/ablatability.md`
- Modify: `scripts/check-cross-cutting.sh`

**Interfaces:**
- Consumes: `packages/reasoning/src/harness-flags.ts` as the registry of killswitches.
- Produces: Check 9, and the audit list of default-on mechanisms lacking an independent killswitch.

**Gate 3 of the A-tier bar.** A mechanism that cannot be turned off alone cannot be shown to earn its place — that is the lesson `RA_LAZY_TOOLS` taught by gating three mechanisms in two directions and making F3 unmeasurable for months.

- [ ] **Step 1: Enumerate every default-on mechanism**

```bash
grep -rn "process.env.RA_" packages --include=*.ts | grep -v dist | grep -v test | sort
```

For each: does it have its own flag, or does it ride another mechanism's flag? Record both lists in the audit file.

- [ ] **Step 2: Write the gate**

```bash
#!/usr/bin/env bash
# check-ablatable.sh — A-tier gate 3.
#
# Every RA_* env flag must be resolved through harness-flags.ts, not read
# directly at a use site. Direct reads are how RA_LAZY_TOOLS came to gate three
# independent mechanisms at three sites in two directions, which made F3
# unmeasurable for months: there was no way to turn discovery off while leaving
# the pruning that creates the need for discovery in place.
set -euo pipefail

STRAYS=$(grep -rn 'process\.env\.RA_' packages --include=*.ts \
  | grep -v '/dist/' | grep -v '\.test\.' \
  | grep -v 'harness-flags\.ts' \
  | grep -v '/benchmarks/' || true)

if [ -n "$STRAYS" ]; then
  echo "FAIL: RA_* flags read outside harness-flags.ts:"
  echo "$STRAYS"
  echo ""
  echo "Route the read through a named resolver in harness-flags.ts so the"
  echo "mechanism can be ablated independently of every other mechanism."
  exit 1
fi

echo "OK: every RA_* flag resolves through harness-flags.ts."
```

- [ ] **Step 3: Run it and expect failures**

```bash
chmod +x scripts/check-ablatable.sh
./scripts/check-ablatable.sh
```

It will likely FAIL on existing strays. **Fix them by routing each through a named resolver** — that is the task, not an obstacle to it. If any stray is genuinely not a mechanism killswitch (a test-only or bench-only var), widen the exclusion list with a comment saying why.

- [ ] **Step 4: Write the audit report**

List every default-on mechanism, its killswitch, whether it has lift evidence, and the verdict (keep / demote to opt-in / delete). Per 09 §7's pre-filter, a mechanism showing zero divergence across the golden corpus is INERT and is demoted or deleted **without** spending a live arm on it. Task 7's sweep result is the input for that column.

- [ ] **Step 5: Register as Check 9, verify red-on-cut, commit**

```bash
./scripts/check-ablatable.sh                       # OK
echo 'const x = process.env.RA_FAKE;' >> packages/reasoning/src/kernel/loop/runner.ts
./scripts/check-ablatable.sh                       # FAIL
git checkout packages/reasoning/src/kernel/loop/runner.ts
./scripts/check-cross-cutting.sh                   # expect 9/9

git add scripts/check-ablatable.sh scripts/check-cross-cutting.sh \
        wiki/Research/Audit-Reports-2026-07-28/ablatability.md
git commit -m "chore(gate): Check 9 — every RA_* flag resolves through harness-flags.ts

A mechanism that cannot be turned off alone cannot be shown to earn its place.
RA_LAZY_TOOLS gated three independent mechanisms at three sites in two
directions, which made F3 unmeasurable for months.

Audit report records every default-on mechanism, its killswitch, its lift
evidence, and its keep/demote/delete verdict. Mechanisms showing zero divergence
across the golden corpus are demoted without spending a live arm, per 09 §7."
```

---

## Exit criteria

The program is complete when all of the following hold:

1. `./scripts/check-cross-cutting.sh` reports **9/9**.
2. No document in `wiki/` cites a token-overhead figure predating `2f97ca1e`. Verify: `grep -rn "555\|640%" wiki/ | grep -v RETRACTED | grep -v "2026-07-28"` returns nothing.
3. The corrected composite overhead is recorded in **both tokens and cost** in `wiki/Research/Harness-Reports/2026-07-28-corrected-composite-rebaseline.md`.
4. `stable-surface` has a verdict against the lift rule — promoted, opt-in, or deleted — with the arm tables that produced it, from **two tiers**.
5. τ-bench runs end-to-end and reports pass^k on at least one domain.
6. `git status --short` is empty and the suite is at its known baseline (1 pre-existing `as-unknown-as` failure).

## What this plan deliberately does NOT do

Stated so a later reader does not mistake omission for oversight:

- **No logit-masking abstraction.** The Anthropic API cannot mask per-tool. Building the abstraction anyway would be over-engineering.
- **No `tool_choice` support.** It has one plausible use (forcing tool use when required tools are outstanding) and zero evidence. It is a candidate, not a task.
- **No `discover-tools` deletion.** F3's premise did not reproduce; the residual is a ~6% schema-weight cost. Deleting a public tool on that evidence would be premature, and deletion requires a sole-caller grep first.
- **No default flips without the lift rule.** `stable-surface` ships opt-in regardless of how good rung 2 looks.
- **No fourth north-star document.** 09 is amended in place.
