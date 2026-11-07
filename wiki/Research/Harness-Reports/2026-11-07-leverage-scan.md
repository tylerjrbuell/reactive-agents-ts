---
type: research
status: complete
created: 2026-11-06
tags: [harness, leverage-scan, workstream-h, rax-diagnose, act-or-answer, zero-token]
---

# Leverage scan after act-or-answer auto and skills (2026-11-07)

Zero-token scan. No live model runs. Sources: benchmark cohorts only (Workstream H verdict corpora `verdict-h/corpus/{before,after}-{h3,lh}`, 104 runs; act-or-answer A/B cohorts `aoa/traces-*`, 33 runs), re-attributed with the current instrument (`rax-diagnose attribute --all`, HEAD `cc41a8fa1`). The owner's private trace store was not read.

## Caveats first

- **The "after" corpora are stale.** They were recorded 2026-11-06 10:41 to 11:09. That is before the withheld-turn fixes (`ba92f785a` 11:50, `a5e58a4ea`, `e12e3f368` 13:2x), F3 (`7b9cda576`), forcing (`8d337c4ab` 17:20) and value-shape healing (`e62e35810` 20:35). Their 2 `harness:contradictory-guidance` runs and 1 `harness:tool-call-dropped` run may already be fixed.
- **The A/B cohorts are small.** n = 2 or 3 per cell, one task per cell (lh-1, or rw-7 for h3 cogito). All 34 runs ended unsolved. Every solve-rate gap here is Bernoulli noise (gaps under 26pp at n ≤ 5).
- **No paid-tier corpus exists for current code.** The newest frontier artifacts are the 2026-09-15 haiku flag runs. Every paid-tier claim below is a code fact, not a count.

## Attribution tables (current instrument)

Failed runs by reason and tier, Workstream H corpora:

| Reason | before-h3 cog / qwen | after-h3 cog / qwen | before-lh cog / qwen | after-lh cog / qwen |
|---|---|---|---|---|
| not-failed (solved) | 0 / 7 | 1 / 10 | 0 / 1 | 1 / 2 |
| model:had-evidence-wrong-output | 3 / 5 | 6 / 4 | 2 / 2 | 1 / 2 |
| model:evidence-not-gathered | 0 / 0 | 3 / 0 | 4 / 4 | 3 / 4 |
| harness:forcing-unused | 5 / 0 | 3 / 0 | 2 / 2 | 4 / 2 |
| harness:loop-after-work | 3 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| harness:premature-stop | 2 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| harness:contradictory-guidance | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 0 |
| harness:tool-call-dropped / evidence-missing / evidence-truncated / offer-accepted | 0 / 0 | 2 / 0 | 3 / 0 | 0 / 0 |
| model:fabrication-vetoed | 0 / 0 | 0 / 1 | 0 / 2 | 1 / 1 |
| environment:* | 0 / 1 | 0 / 0 | 0 / 0 | 0 / 1 |
| unattributed | 0 / 0 | 0 / 0 | 1 / 1 | 0 / 0 |

Harness-attributed: 37 of 82 failed runs. `harness:forcing-unused` accounts for 20 of those 37 (9 of 13 in the after corpora).

A/B arms (act-or-answer off vs on/proactive):

| Arm | Failed runs | forcing-unused | Top other reasons |
|---|---|---|---|
| off (4 cells) | 11 | 8 | tool-call-dropped 1, wrong-output 1, unattributed 1 |
| on + pro + pro3 + pro4 (8 cells) | 23 | **0** | wrong-output 10, environment:tool-failure 5, evidence-not-gathered 3, unattributed 3 |

Shipped forcing removes its target reason completely: 8 of 11 off-arm failures down to 0 of 23 in the forced arms. It does not touch the next blockers. Those are refused JSON writes (item 1), unread task inputs (item 3) and code tasks with no way to run tests (item 4). `actOrAnswer` still defaults to off (`.changeset/reasoning-act-or-answer-auto.md`, `harness-config.ts:270`), so default runs still carry forcing-unused.

## Ranked items

| # | Item | Evidence (count + source) | Tier | Class or site | Owner |
|---|---|---|---|---|---|
| 1 | Repair, don't refuse, `.json` file-write content with nested quotes; one JSON repairer | 45 of 72 failed tool calls (62%) across all cohorts are the invalid-JSON refusal, in 23 of 57 runs that wrote a `.json` file. 41 of 46 refused contents carry an unescaped quote copied from the task text. A zero-token repair prototype parses 34/46 (17/23 runs). On the newest arms (pro3/pro4 at `dc7d9eb80`, which already include value-shape healing and the new refusal text): 12 refused, 9 repaired, 4/4 runs | both local tiers; general (any model writing JSON as a string) | class | tools-warden |
| 2 | `actOrAnswer: "auto"` default-on for Ollama, then delete the prose producers it makes dead | forcing-unused: 20 of 37 harness-attributed failures. A/B: 8/11 in the off arms vs 0/23 in the forced arms. Solves 0/34 in all arms (noise). Plan 9 row: partial-credit mean up in 3/3 cells. Cogito tokens +41% (local, free) | local only (auto keeps paid tiers off) | class | ablation-warden, then runtime-warden / kernel-warden |
| 3 | Per-entity input coverage (DEBT #39, generic half still OPEN) | `model:evidence-not-gathered`: 18 failed runs (8 before-lh, 7 after-lh, 3 after-h3), the second-largest failure class. Instrument detail: "8/12 task-listed input(s) not read before the divergence turn" (lh-debug-green, lh-pipeline-stages, h3-todo-heavy) | both local tiers; likely paid too | class | kernel-warden |
| 4 | Code tasks cannot run their tests; code-execute error text misleads | 9/9 `code-execute` calls in all cohorts were shell commands (`bun test`, `cd …`), and 9/9 failed. rw-7 + lh-debug-green: 16/16 failed in the after corpora. The rw-7 prompt says "Do not stop until `bun test` exits 0", but the run offers no shell | both local tiers; any coding agent | class (truthfulness) + site (bench) | tools-warden (`tool-execution.ts`, routed by scope); bench surface = owner (no warden) |
| 5 | HEAD baseline plus a paid-tier corpus | The after corpora predate about 10 fixes (dated above). There are 0 paid-tier traces on current code, so every Workstream H KEEP lacks the cross-tier leg | all | measurement | harness-warden (paid spend needs owner approval) |
| 6 | Instrument: harness refusals of model content are mislabeled | Of the 23 runs with a JSON refusal: 6 are labeled `environment:tool-failure` and 4 `unattributed`. `ruleToolFailure` treats 3+ failed calls as environment. The residual names "untyped Guidance" text but never links the target's refused writes | instrument | class | harness-warden (`packages/trace`) |
| 7 | Post-tool LLM calls (paid cost) | 48/232 (21%, h3) and 62/188 (33%, lh) of LLM calls fall after the run's last tool call. h3: 27 think + 15 synthesize + 6 verify. lh: 56 think + 6 synthesize. On paid tiers, forcing stays off, so these turns stay billed | paid (cost); local (latency) | class (spike first) | kernel-warden |
| 8 | Fixed 1,200-char tool-result budget regardless of free window | `context-profile.ts:144` (local) and `:164` (mid) use a fixed 1200. 20 of 48 lh runs compressed a fresh web-search result ("2294 chars > budget 1200 (window 32768, local)"). 2 runs are attributed `harness:evidence-truncated` | local + mid | class (small count) | kernel-warden |

### 1. JSON content repair at the file-write boundary

- **Anchors:** `packages/tools/src/skills/file-operations.ts:410` (the refusal). Three JSON repairers exist today: `packages/tools/src/tool-calling/lenient-json.ts:41`, `packages/reasoning/src/structured-output/json-repair.ts:55` and `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:257` (`repairJsonControlChars`).
- **Failure shape:** the task text says `"component model"`. The model copies that question into a JSON string value with one escape level too few, e.g. `"question": "What is the WASI Preview 2 "component model", what does it …"`. `JSONDecodeError: Expecting ',' delimiter` (40 of 46 refusals). The refusal text already asks for the JSON value itself (`37939f2a9`), and value-shape healing already accepts objects (`e62e35810`). The model still sends a string.
- **Prototype rule (zero-token):** inside a string, a `"` closes the string only if it is followed by whitespace and then `}`, `]` or `:`, or by `,` and then the start of a value (`"`, `{`, `[`, a digit, `-`, `t`, `f`, `n`) or `}` / `]`. Otherwise it is escaped. 9 of the remaining 12 failures are `Extra data` from a surplus closing bracket. A bracket-balance trim would likely recover most of those.
- **Guard rails:** accept the repair only if the result parses and the repair inserted only backslashes or dropped only trailing brackets (no content characters changed). Record the heal on the call result and trace, e.g. `healed: "json-quotes"`. If the repair fails, keep refusing.
- **Canonical:** one JSON repairer in tools, extended there, with the reasoning copies folded in. This follows the one-home-per-fix-class rule.
- **Why first:** cheap. Verifiable zero-token by replaying the 46 recorded contents. It also unblocks a clean measurement of item 2: forced lh-1 arms now fail on this refusal, which confounds the forcing ablation.

### 2. Act-or-answer auto as the local default

- Plan 9 Workstream H row "Steering by prose" lists the ablation-warden matrix as next. Default today: off (`packages/reasoning/src/harness-flags.ts:206`, `harness-config.ts:270`).
- Run it after item 1, with ≥3 tasks, k ≥ 5, qwen3:4b + cogito:8b, and record the act-or-answer tally from `result.metadata.extensions.actOrAnswer`. KEEP on tokens + accuracy per the lift rule. If it passes, delete the prose "call X" producers that forcing makes dead, as a drift-reduction step (Plan 9 row, "then delete the prose producers it makes dead").

### 3. Per-entity input coverage

- **Code facts:** `packages/reasoning/src/kernel/ledger/emit.ts:286` says generic per-entity tool coverage is not closed. Cardinality metadata exists but has no condition reading it (`packages/reasoning/src/structured-output/infer-required-tools.ts:258`, `packages/tools/src/skills/file-operations.ts:136`). DEBT-REGISTER #39: "Generic per-entity tool-coverage … still OPEN".
- **Mechanism of harm:** one `file-read` satisfies `tool:file-read`. After that, the exit gate accepts done, and act-or-answer's outstanding-work test sees no work. So item 2 cannot reach these 18 runs: the model stops after reading 1 to 4 of 6 to 12 listed inputs.
- **Spike before build:** count tasks whose listed paths are all genuinely required, to measure the false-outstanding risk. The instrument's "task-listed input" extraction in `packages/trace` is the reference rule to reuse. These runs are model-attributed today. If the harness accepts done with listed inputs unread, that is arguably `harness:premature-accept`. I did not re-label them.

### 4. Code tasks with no way to run tests

- **(a) Truthfulness (tools-warden; the anchor file routes to tools-warden by scope):** `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:225,412` answer a shell command with "fix the code and retry". The error should say that code-execute runs JS/TS in a sandbox, not a shell, and whether a shell exists in this run.
- **(b) Bench surface (no warden, owner call):** `packages/benchmarks/src/tasks/real-world.ts:1138` (rw-7) and `packages/benchmarks/src/h3/long-horizon-tasks.ts:271` (lh-debug-green) demand passing tests but offer only `code-execute`. Either offer `terminal`, or reword the prompt. Changing the frozen suite needs a new manifest hash.
- **(c) Product:** this is the Plan 9 coding-agent profile (workspace + terminal + "tests pass" acceptance check).

### 5. HEAD baseline and a paid-tier corpus

One H3 + long-horizon run at HEAD (with item 1 if it lands first): qwen3:4b + cogito:8b k=5, plus one paid tier (e.g. haiku) k=3. It re-bases items 2, 3 and 7. It also supplies the cross-tier leg that diagnostic discipline #4 requires, and the `cache_read` / `cache_creation` split for paid cost work.

### 6. Instrument: content refusals

- `packages/trace/src/cause.ts:429` (`ruleToolFailure`) maps to `environment:tool-failure` through `packages/trace/src/taxonomy.ts:103`. `packages/trace/src/attribution.ts:776` handles the unattributed residual.
- **Proposed reasons:**
  - `model:invalid-content`: the write boundary refused model-authored content, and no deterministic repair parses it.
  - `harness:refused-repairable`: a deterministic repair parses it. This makes item 1 visible to SELECT.
- This also settles the open owner call on `repeated-identical-call` for the refusal case.
- Mine to fix. It needs a red-on-cut test and the before/after table over these corpora.

### 7. Post-tool calls

Spike first, zero-token: for each post-tool synthesize/verify call, did the final output differ from the last pre-call draft? Fold or delete only the calls that never change the output. The lh think turns overlap item 2 (no-call stalls) on local. On paid tiers they remain billed.

### 8. Tool-result budget

Derive the per-result budget from the remaining window instead of a fixed char count. The "deterministic over LLM-driven" golden rule applies. With 2 attributed runs the count is low, and paid tiers would pay for wider results, so this needs the lift rule.

## Not ranked (no count evidence)

- **Skills.** Steps 1-2 are committed (`5fc0cd7de`). Steps 3-4 sit uncommitted in the working tree (`skill-activation.ts`, `skills-context.ts`). The corpora hold 0 real skill runs. The §8 live measurement is itself the spike: run it once step 4 lands.
- **F4 repair-not-refuse for pruned permitted tools.** The failed-call tally shows 0 unknown or unavailable tool refusals in these cohorts.
- **GitHub issues.** Open issues are older research gates: τ-bench #48/#49, code-action #34/#36, delegation #42, memory #43, plus provider adapters #54/#55 and #213 (9 silent withers, a drift item). None carries a count on current code.

## Method

- `bun ./packages/diagnose/src/cli.ts attribute --all <dir>` per cohort, plus per-run `attribute <file> --json` / `cause <file> --json` joined with `run-started.model` and `eval-graded.taskId`.
- Failed-tool tally, JSON-refusal classifier and repair prototype: small Python readers over `tool-call-end` events (args.content, error), run with `python3 -I`.
- Post-tool share: count of `llm-exchange` events with `seq` greater than the run's last `tool-call-end`.
