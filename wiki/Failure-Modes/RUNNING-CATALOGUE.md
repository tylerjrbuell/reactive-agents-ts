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

## F6 — Fixed kernel tax on tasks needing no tools

**Cell:** "What is 17 × 23? Answer with just the number. Do not use any tools." n=2 per tier.

```
haiku    inline   840t  it=2   |  kernel 4,608t  it=7   +449%
qwen3.5  inline   709t  it=2   |  kernel 4,018t  it=7   +467%
```

Both arms answer correctly. The kernel spends ~4.6× and 7 iterations on arithmetic, and the
multiplier is **the same on both tiers** — so this is a *fixed structural* tax, not a
model-adaptive one. Pure waste on this shape: nothing is bought.

---

## F7 — Honest abstention costs 7× and says less

**Cell:** haiku · "population of the fictional city of Aetheria" · n=2.

```
inline   982t  1 call   → "I don't have access to information about a fictional city called Aetheria."
kernel 6,897t  5 calls, 10 iters, tools=[recall]
                        → "Could not complete the task — no grounded answer could be produced…"
```

**Good news, recorded as such:** neither arm fabricates. Both decline honestly — the
abstention chain works.

**The cost:** +608% for a *more generic* message. The kernel also invokes `recall` (memory)
against an unanswerable question. Both arms report `status=success` for a declining run,
which is worth reconciling against `deriveRunOutcome`'s `abstained → failure` mapping.

---

## F3 — `discover-tools` burn is kernel-only

Present in **every** kernel trace, **no** inline trace. On the multi-step task haiku's kernel
arm takes 14 iterations (`discover-tools, file-read, code-execute, file-write`) to do what
inline attempts in 2. The kernel spends model calls discovering tools the inline path simply
uses.

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

## F9 — The kernel silently widens the tool surface beyond what was configured

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
