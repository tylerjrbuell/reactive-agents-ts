---
tags: [failure-modes, canonical, running-catalogue, evidence]
date: 2026-07-28
status: RUNNING — append as new modes are observed; do not prune without a fix or a refutation
instrument: packages/benchmarks/src/harness-cost-attribution.ts
---

# Running Failure-Mode Catalogue

Every entry is **observed in a live trace**, not inferred from code. Each carries the cell
that produced it so it can be re-run. Ordered by leverage — cost × outcome damage × breadth.

**Arms:** `inline` = the DEFAULT path (`_enableReasoning` false) · `kernel` =
`.withReasoning()` · `kernel+RI` = + `.withReactiveIntelligence()`.
**Tiers:** `haiku` = claude-haiku-4-5 · `qwen3.5` = qwen3.5:latest (ollama).

---

> ## ⚠⚠ SECOND RETRACTION PASS (2026-07-28) — F8 and F2 also fall
>
> Re-running every tool-dependent cell with a **pinned, identical tool surface** kills two
> more entries. Both had the same root as O1: the harness registered only `file-write`, so
> the kernel's injected `discover-tools` (**F9**) was the only reason the arms differed.
>
> | entry | claimed | with a fair tool surface | verdict |
> |---|---|---|---|
> | **F8** tool-error thrash | kernel 46,296t / 21 iters / FAILURE vs inline 932t / success | kernel **3,621t / 6 iters / success** vs inline 1,671t | **RETRACTED** — the 50× was the kernel hunting for a read capability it had not been given |
> | **F2** terminal gate fails a produced deliverable | 3/3 `status=failure`, one with the file on disk | **2/3 success with `file=Y`**; the one failure produced no file (an honest failure) | **RETRACTED** |
>
> **F9 is the actual root defect, and it manufactured the others.** It fabricated O1, F8,
> F2 and the local half of F4 by silently making the two arms non-comparable. An arm study
> that varies `.withReasoning()` also varies the tool surface unless tools are pinned.
>
> **What survives, and why:**
>
> - **F1** — independently verified, control-validated, **now fixed** (`df04ae1e`). Never
>   depended on the tool surface: the run declared a deliverable, produced prose, and was
>   scored `success`.
> - **F6** (+449%/+467% on a no-tool task) and **F7** (abstention costs 7×) — no tool is
>   involved in either, so the confound cannot apply. The fair-surface F8 re-run
>   independently reproduced F7's pattern: kernel **+117%** for a *less* informative message
>   (*"Could not complete the task — no grounded answer"* vs inline's *"The file
>   ./missing-input.json does not exist at the specified path"*).
> - **F9** — verified deterministically on the test provider, no live model involved.
> - **F5**, **F3** — observational; F3 is a *consequence* of F9.
>
> **Standing lesson, now paid for twice in one day:** pin every variable an arm study is not
> deliberately varying. The tell both times was in the **output text**, never in a status
> field or a token count.

> ## ⚠ RETRACTION (2026-07-28, same day) — read before anything below
>
> **O1 "the inversion" is WITHDRAWN. It was a probe artifact and it was committed as a
> finding (`64b3b4a9`) before being caught.**
>
> The claim was: the kernel makes the frontier model work (0/3 → 3/3) and breaks the local
> one (3/3 → 1/3). **Cause: the harness registered only `file-write`, so the `inline` arm
> could not read files at all** — while the `kernel` arm reached `file-read` anyway, via a
> `discover-tools` meta-tool it injects beyond the configured set (**F9**). The comparison
> was never kernel-vs-no-kernel; it was *crippled-tool-surface* vs *silently-widened*.
>
> Caught by the output text: inline said *"I don't have the ability to read files
> directly"* — an honest refusal, not the "chat-tuned model answers in prose" story I
> attached to it.
>
> **Re-run with an identical tool surface on both arms, n=3 per cell:**
>
> | tier | inline | kernel | kernel+RI |
> |---|---|---|---|
> | haiku | 3,710t · 4 iter · **3/3** | 7,354t (**+98%**) · 9 iter · 3/3 | 7,353t · 3/3 |
> | qwen3.5 | 2,633t · 4 iter · **3/3** | 4,128t (**+57%**) · 9 iter · 3/3 | 3,683t · **2/3** |
>
> **Corrected finding, simpler and worse:** on this shape the kernel is **pure overhead on
> both tiers** — +57%/+98%, 2.25× the iterations, identical outcome — and **RI introduces a
> failure** (2/3 local). There is no inversion and no tier story here.
>
> Second confound, also mine: `deliverable` checks that the file EXISTS, not that its
> contents are CORRECT. Every "3/3" above should be read as *produced something*, not
> *produced the right number*.

## Leverage table

**Status after the second retraction pass. Read this table, not the prose below it, for
current standing.**

| # | Mode | Standing | Note |
|---|---|---|---|
| **F9** | Kernel widens the tool surface beyond config | **REAL — root defect** | control-boundary breach; manufactured O1/F8/F2 |
| **F1** | Dishonest success (declared deliverable unproduced) | **REAL — FIXED `df04ae1e`** | control-validated |
| **F6** | Fixed kernel tax on no-tool tasks (+449%/+467%) | **REAL** | tier-independent; no tools involved so no confound |
| **F7** | Kernel pays 7× for a *worse* honest decline | **REAL** | independently reproduced at +117% on the F8 re-run |
| **F5** | `low_delta_guard` fires without being fatal | REAL (observational) | guard-fire rate is not an outcome measure |
| **F3** | `discover-tools` burn | REAL but derivative | a consequence of F9 |
| **F4** | RI cost non-linear | **PARTIAL** | the local hard-task figure was confounded; the ~0%-vs-decisive spread stands |
| ~~**F8**~~ | ~~Tool-error thrash +4867%~~ | **RETRACTED** | probe artifact — see second retraction pass |
| ~~**F2**~~ | ~~Terminal gate fails a produced deliverable~~ | **RETRACTED** | probe artifact — see second retraction pass |
| ~~**O1**~~ | ~~The inversion~~ | **RETRACTED** | probe artifact — see first retraction |

---

## F8 — Tool-error thrash *(highest leverage found)*

**Cell:** haiku · task "Read `./missing-input.json` … if you cannot read it, say so
explicitly" · no fixtures seeded (the file genuinely does not exist) · n=2.

```
inline      932t    2 iter  success   tools=[-]
kernel   46,296t   21 iter  FAILURE   tools=[discover-tools,file-read,list-directory]
                                       think:13c/46,139t  classify:1c/426t
kernel+RI 23–46k   18–21 iter FAILURE  same tool set
```

**+4867% and a worse outcome.** A missing input — the most ordinary error in agent work —
sends the kernel into a discovery/retry loop of 13 think calls across 21 iterations and it
still fails, while `inline` answers correctly in a single call.

This is not a probe artifact: both arms ran the identical setup and `inline` handled it.

Notes:
- First appearance of a **non-`think` purpose** in any kernel cell (`classify`), i.e. the
  classifier engages on error paths.
- The tool triple `discover-tools → file-read → list-directory` repeating across 21
  iterations is the thrash signature to grep for.
- The "5-stage healing pipeline" is supposed to own this shape. It converts a
  one-call answer into a 46k-token failure.

**Local tier does NOT thrash — it fails fast.** qwen3.5, same task, n=2: kernel 514t mean,
1 iteration (one run `it=0`, 0 tokens), `status=failure`; inline 712t, `success`, 2/2.

So the shared defect is **the kernel cannot handle a missing tool input while inline can —
4/4 kernel runs failed across both tiers, 4/4 inline runs succeeded.** The cost profile is
what differs: frontier *thrashes* (46k, 21 iters), local *bails* (0.5k, 1 iter). A fix must
address both, and the 50× figure is frontier-specific.

**Why it is #1:** worst cost multiplier, an outcome flip on both tiers, and the triggering
condition (a tool input that isn't there) is ubiquitous in real work.

---

## F1 — Dishonest success on the default path

**Cell:** haiku · inline · multi-step task (read JSON → compute → write `avg.txt`) · n=3
plus a 4th confirmation run.

```
inline  937t  1 LLM call  it=2  status=success  tools=[-]  deliverable 0/3
```

Reports **`success`** having dispatched **zero tools** and produced **no deliverable**.
The model answered in prose; nothing checked that the declared artifact existed.

The trust spine is the framework's claimed moat (08 §0: *"verification is the #1 unmet
need"*), and on the path most users are on it returned `success` for a run that did nothing.
Same shape as the register's abstention chain (honest decline scored as success at four
sites) — new site.

---

## F2 — Terminal authority fails a run whose deliverable exists

**Cell:** qwen3.5 · kernel · same multi-step task · n=3.

All three runs `status=failure`. Run [2] wrote the file (`file=Y`) and **still**
reported failure. Guards: `terminal_decision` ×3, `stall_deliverable` ×1.

Same class as the Wave C.2 close-out defect where a *delegated* deliverable was refused
because the gate judged from a substrate that could not contain it. That was fixed for
delegation; this is the **non-delegated** case.

---

## F6 — Fixed kernel tax on tasks needing no tools ✅ FIXED (`13dc6c80`, `228bf10e`)

**Original cell:** "What is 17 × 23? Answer with just the number. Do not use any tools." n=2 per tier.

```
haiku    inline   840t  it=2   |  kernel 4,608t  it=7   +449%
qwen3.5  inline   709t  it=2   |  kernel 4,018t  it=7   +467%
```

Both arms answered correctly, and the multiplier was **the same on both tiers** — a fixed
structural tax rather than a model-adaptive one. Two distinct drivers, found in order:

**Driver 1 — tool doctrine on a toolless run** (`13dc6c80`). `buildSystemPrompt` had no idea
whether tools existed, so a zero-tool run received the full tool doctrine — including a
sentence teaching parallel tool-call batching — immediately followed by the tool reference
block's "No tools available for this task." 404 → 236 chars (−42%) on genuine zero-tool runs;
with-tools control unchanged.

**Driver 2 — the tool-relevance classifier** (`228bf10e`). One extra LLM round-trip per run,
default-on for any agent with `.withReasoning()`. Cross-tier ablation
(`packages/benchmarks/src/classifier-ablation.ts`), {1-tool, 21-tool} surfaces × {tool,
no-tool, custom-tool} tasks:

```
cell               haiku-4.5   qwen3.5-9b   accuracy (on/off)
small  tool        +25%        +32%         2/2  2/2
small  no-tool    +127%       +167%         2/2  2/2
small  custom      +75%        +60%         2/2  2/2
large  tool         -3%         -5%         2/2  2/2
large  no-tool    +134%       +166%         2/2  2/2
large  custom      +29%        +28%         2/2  2/2
```

Same sign in all six cells on both tiers, zero accuracy difference anywhere. Against the lift
rule (09 §6: ≥3pp lift AND ≤15% overhead) that is **0pp lift at +25%..+167%** → flipped to
opt-in (`.withRequiredTools({ adaptive: true })`). Kept rather than deleted: it is still the
better pruner on a wide surface (3 visible vs the heuristic's 12).

**The root defect the ablation exposed.** The classifier's only apparent win — the custom-tool
cell, 8–18% *cheaper* — was not better classification. Lazy disclosure's allow-set in
`computePromptSchemas` was fed ONLY by classifier output, so an unclassified run hid every
domain tool and burned an extra `discover-tools` round trip to reach a tool the task named
outright (9 iterations vs 6). Compounding it, the `withTools({ builtins })` floor was unioned
into `relevantTools`, making `hasClassification` — "did a classifier speak?" — true on runs
where none had. Fixed: the heuristic seeds the allow-set when unclassified, and the floor now
rides a dedicated `KernelInput.builtinFloorTools`. The custom cell then **inverts to
+75%/+60% against the classifier** (5,092t → 3,946t, 9 iterations → 6).

**Two probe faults recorded rather than quietly fixed** — both produced real-looking numbers
that measured nothing. (1) `builtins: [...]` is a prune FLOOR, so an early design that floored
10 builtins made both arms identical (`vis=12` in each). (2) The first draft of the floor
regression cell survived its own red-on-cut, because the never-prune-to-meta-only guard
rescued the tool it was meant to prove was floored.

---

## F7 — Honest abstention: cost half RETRACTED, message + status halves FIXED (`60730287`)

**Original cell:** haiku · "population of the fictional city of Aetheria" · n=2.

```
inline   982t  1 call   → "I don't have access to information about a fictional city called Aetheria."
kernel 6,897t  5 calls, 10 iters, tools=[recall]
                        → "Could not complete the task — no grounded answer could be produced…"
```

**Good news, and it held up:** neither arm fabricates. Both decline honestly — the abstention
chain works.

### ⚠️ RETRACTED — the "+608%" cost claim

The cell compared a **toolless** inline arm against a kernel arm that **had tools** (its own
trace shows `tools=[recall]`), so most of the gap was the cost of actually trying to ground the
answer — correct behaviour, not overhead. **Fourth finding this session to fall to a
tool-surface confound** (see the O1/F8/F2 retractions above). Re-measured with the missing
`inline+tools` control:

```
inline           75t  1 call   model's own decline
kernel          337t  1 call   model's own decline
inline+tools  2,244t  2 calls  model's own decline
kernel+tools  6,020t  4 calls  model's own decline
```

Residual kernel overhead at a **matched surface** is +168%, not +608% — and it is ordinary
iteration overhead, not specific to abstention. New harness
`packages/benchmarks/src/abstention-cost.ts` carries the `inline+tools` control so this cannot
be misread the same way again.

### ✅ FIXED — the message named no cause

`decideForcedAbstention` had always computed a specific cause ("no successful tool call for
required tools (web-search); could not ground an answer in available evidence") and stashed it
in `meta.abstention.reason`, where nothing rendered it. Every forced abstention reached the
user as one identical sentence. The sentinel now carries an optional `detail`, rendered as a
`Cause: …` suffix; absent detail is byte-identical to the old text.

**Deliberately not fixed by surfacing the model's own decline.** The two forced-abstention
triggers are "a required tool was unavailable" and "the model's synthesis was REJECTED as
ungrounded" — promoting the rejected synthesis to output would undo the rejection and re-open
the dishonest-success hole closed 2026-07-22. A test pins that this path stays harness-authored.

### ✅ FIXED — an abstention scored as a success

The kernel reports `status: "completed"` for a forced abstention (the decline completed
cleanly), which `execution-engine` read straight through — so a run that delivered nothing and
said so published `AgentCompleted.success: true` and `run-completed.status: "success"`.
`deriveRunOutcome` has mapped `abstained → failure` since 2026-07-23, but that governs only the
debrief and learning lanes; the terminal status was a separate, disagreeing rule, so the gate
lane (`testing/src/gate/runner.ts`) still scored abstentions as successes. **Same shape as F1,
one lane over.** `terminatedBy` and the abstention descriptor are unchanged — only the coarse
success bit moves.

---

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

---

## F4 — RI's cost is non-linear and unpredictable

- easy task, haiku: **~0%** (5,079 → 5,091), changes nothing
- hard task, qwen3.5: **+225pp over kernel** (68% → 293%), iterations 9/12/18 — but
  recovers the deliverable **1/3 → 3/3**
- hard task, haiku: **identical** to kernel (12,140 vs 12,160), same tool sequence
- one run: a single `synthesize` call of **8,852 tokens over 115s**

Free, decisive, or irrelevant depending on the cell, with no way to predict which from
configuration.

---

## F5 — `low_delta_guard` fires without being fatal

Fired on **every** haiku kernel run of the multi-step task; all succeeded 3/3. Consistent
with the 2026-07-27 measurement that the evidence-delta reset *delays* rather than prevents
the fire. **Guard-fire rate is not an outcome measure** — that error already cost one wrong
reading and is recorded in the low-delta session file.

---

## F9 — The kernel silently widens the tool surface beyond what was configured ✅ FIXED (`9d1252d3`, `2f97ca1e`)

**Cell:** deterministic provider · `withTools({ builtins: ["file-write"], adaptive: false })`
on both arms · read `tool-surface-resolved` + `toolSchemaNames` from the trace.

```
inline   configured=[file-write]  actual=[file-write]
kernel   configured=[file-write]  actual=[discover-tools, file-write]
```

The kernel injects `discover-tools`, which then lets the run **activate tools that were
never registered** — live traces show kernel arms using `file-read`, `code-execute` and
`recall` under a config that declared only `file-write`.

Two consequences:

1. **It is a control-boundary surprise.** Vision pillar #1 is *Control*. A user who writes
   `builtins: ["file-write"]` gets an agent that can also read files and execute code. That
   is a sandboxing and least-privilege concern independent of cost, and it deserves a
   decision (declare it, gate it, or drop it) rather than being incidental.
2. **It invalidated a whole comparison** — see the retraction at the top. Any arm study
   that varies `.withReasoning()` is *also* varying the tool surface unless tools are
   pinned explicitly. Pin them.

Related but distinct from **F3** (`discover-tools` burn): F3 is the cost of the extra
calls, F9 is the capability the injection grants.

**Fixed.** Two halves. The engine half (`9d1252d3`) — `execution-engine.ts` now
hands the kernel `exposedToolSchemas` (the post-`builtins`, post-forbidden,
post-allowlist set) instead of `initialToolSchemas`. The capability half
(`2f97ca1e`) — `discover-tools` now builds its catalogue from the permitted
surface, so it can no longer advertise "10 tools available (now callable)" under
`builtins: ["file-write"]` and then successfully execute a withheld `file-read`.

**Pinned by** `packages/runtime/tests/discover-tools-respects-surface.test.ts`
(3 cells, red-on-cut verified).

---

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

---

## Cross-cutting observations

**O1 — WITHDRAWN.** See the retraction at the top of this file. The apparent inversion was
F9 plus a crippled inline tool surface. On a fair comparison the kernel is pure overhead on
both tiers on this shape. *Kept as an entry rather than deleted: the retraction is more
useful than the claim was.*

**O2 — Overhead is iterations and prompt size, not harness LLM calls.** Nearly every kernel
token across all cells is `purpose: think`. `classify` appeared once (F8), `synthesize` once
(F4). The static site count (20 `synthesize` vs 18 `think`) predicted runtime spend badly —
**call-site counts are not spend.** Simplification should target **context assembly and loop
length**.

**O3 — The kernel's cost floor is high and shape-independent.** ~4.5× on arithmetic, ~7× on
an abstention, ~13× on a tool task, ~50× on a tool error. The floor exists before any task
difficulty is considered.

---

## Method note

Four void arm-sets were produced and discarded today, all probe-side: unseeded fixtures, a
deliverable check hardcoded to the wrong filename, a default task too easy to show lift, and
an event subscription returning zero on both arms. Each initially looked like a harness
failure.

**Fourth consecutive session in which the instrument, not the system, was the bug.** The
standing prior when a result surprises: indict the probe first.

**Statistical honesty:** n=2–3 per cell. These resolve *large* effects — a 50× cost blowup
and a 0/3-vs-3/3 outcome flip are not subtle. They do **not** resolve a 3pp lift, and no
entry here should be quoted as a lift verdict. Promotion still goes through 09 §6.

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
