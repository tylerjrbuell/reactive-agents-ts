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

## Leverage table

| # | Mode | Worst observed | Outcome damage | Breadth |
|---|---|---|---|---|
| **F8** | Tool-error thrash | **+4867%**, 21 iters | inline succeeds, kernel FAILS | any missing/failing tool input |
| **F1** | Dishonest success (default path) | 1 call, 0 tools | reports `success`, produces nothing | frontier + inline |
| **F2** | Terminal gate fails a produced deliverable | — | `status=failure` with file on disk | local + kernel |
| **F6** | Fixed kernel tax on no-tool tasks | **+449%..+467%** | none (both correct) | every tier, every no-tool task |
| **F7** | Abstention costs 7× for a worse message | +608% | message less informative | frontier + kernel |
| **F3** | `discover-tools` burn | 14 iters vs 2 | none directly | kernel only |
| **F4** | RI cost non-linear | +225pp or 0% | sometimes recovers deliverable | unpredictable |
| **F5** | `low_delta_guard` fires without being fatal | — | none | frontier + kernel |

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

**Why it is #1:** worst cost multiplier, worst outcome flip, and the triggering condition
(a tool input that isn't there) is ubiquitous in real work.

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

## Cross-cutting observations

**O1 — The inversion.** The kernel is what makes the *frontier* model work on the
tool-requiring task (0/3 → 3/3) and what *breaks* the local one (3/3 → 1/3). The predictive
variable is **tool-call propensity**, not model tier: `qwen3.5` is tool-tuned and calls
`file-write` unprompted; `haiku` is chat-tuned and answers in prose unless pressured. Any
tier-scaling design should key on propensity, which calibration already observes.

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
