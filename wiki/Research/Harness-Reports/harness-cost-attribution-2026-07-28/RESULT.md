---
tags: [harness-report, live-measurement, failure-modes, evidence]
date: 2026-07-28
status: EVIDENCE — n=3 per cell; directional, not a lift verdict
instrument: packages/benchmarks/src/harness-cost-attribution.ts
---

# Live harness cost attribution — the inversion, and five failure modes

**Task** (identical in every cell): read `./data.json`, compute the mean of the `score`
field, write only that number to `./avg.txt`, report done.
**Arms:** `inline` (the DEFAULT path, `_enableReasoning` false) · `kernel`
(`.withReasoning()`) · `kernel+RI` (+ `.withReactiveIntelligence()`).
**n=3 per cell.** Deliverable = `avg.txt` exists in the sandbox root.

---

## 1. The headline: the harness helps the STRONG model and hurts the weak one

| tier | arm | mean tokens | vs inline | deliverable | terminal status |
|---|---|---|---|---|---|
| **qwen3.5** (local) | inline | 2,343 | — | **3/3** | success |
| | kernel | 3,937 | +68% | **1/3** | **failure 3/3** |
| | kernel+RI | 9,209 | +293% | 3/3 | success |
| **haiku** (frontier) | inline | 937 | — | **0/3** | **"success" 3/3** |
| | kernel | 12,160 | **+1198%** | **3/3** | success |
| | kernel+RI | 12,140 | +1196% | 3/3 | success |

**This is the exact inverse of the weak-model compensation thesis.** On this task the
kernel is what makes the *frontier* model work (0/3 → 3/3) and is what *breaks* the local
model (3/3 → 1/3).

The mechanism is visible in the traces and is not about model strength at all — it is about
**whether the model reliably reaches for a tool unprompted**:

- `qwen3.5` is tool-call-tuned. Inline, it calls `file-write` and succeeds 3/3. The
  kernel's extra structure over-constrains a model that was already doing the right thing.
- `haiku` is chat-tuned. Inline it makes **one** LLM call, dispatches **zero** tools, and
  answers in prose. The kernel's tool pressure is what converts it from 0/3 to 3/3.

**Implication for the tier-scaling proposal:** keying intervention on *model tier* is the
wrong axis. The predictive signal here is **tool-call propensity**, which calibration
already observes per model. A 4B tool-tuned model may need *less* harness than a frontier
chat model.

---

## 2. Five failure modes, each observed in trace

### F1 — Dishonest success on the default path (most serious)
`haiku` + `inline`, **3/3 runs**: `status=success`, `tools=[-]`, 1 LLM call, **no
deliverable**. The run reports success having produced nothing and called nothing.
Reproduced on a 4th confirmation run.

This is the framework's own differentiator failing where most users live. The trust spine
exists precisely to make "did it actually do the work?" answerable, and on the default path
it returned `success`. Cf. the register's abstention chain, where an honest decline was
scored as success at four sites — same shape, different site.

### F2 — Terminal authority declares failure with the deliverable on disk
`qwen3.5` + `kernel`, **3/3 runs `status=failure`** — including run [2], which
**wrote the file** (`file=Y`, `status=failure`). Guards fired: `terminal_decision` ×3,
`stall_deliverable` ×1.

Same class as the Wave C.2 close-out defect where a *delegated* deliverable was refused
because the gate judged from the wrong substrate. That one was fixed for delegation; this
is the non-delegated case on a local model.

### F3 — `discover-tools` burn is kernel-only
`discover-tools` appears in **every** kernel-arm trace and **no** inline trace. The kernel
spends model calls discovering tools the inline path simply uses. On haiku the kernel arm
dispatches `discover-tools, file-read, code-execute, file-write` over 14 iterations to do
what inline attempts in 2.

### F4 — RI's cost is non-linear and unpredictable
- Easy task: RI adds **~0%** (5,079 → 5,091 on haiku) and changes nothing.
- Local hard task: RI adds **+225pp over kernel** (68% → 293%), pushing iterations to
  9/12/18 — but recovers the deliverable **1/3 → 3/3**.
- Frontier hard task: RI is **identical to kernel** (12,140 vs 12,160, and the same tool
  sequence).

So RI is free, decisive, or irrelevant depending on the cell, with no way to predict which
from configuration. One earlier run spent a single `synthesize` call of **8,852 tokens over
115s**.

### F5 — `low_delta_guard` fires without being fatal
It fired on **every** haiku kernel run, all of which succeeded 3/3. Consistent with the
2026-07-27 finding that the evidence-delta reset *delays* rather than prevents the fire —
and a reminder that guard-fire rate is not an outcome measure.

---

## 3. Composition: the overhead is not what was assumed

**Every kernel token on the easy task was `purpose: think`** — zero `classify`, `verify`,
`synthesize` or `extract` calls. The overhead is therefore **not** a swarm of harness-internal
model calls. It is:

1. **more iterations** (haiku kernel 14 vs inline 2), and
2. **much larger prompts per call** (~2.4× on the easy task).

That matters for the simplification target: cutting "harness LLM calls" would attack
something that mostly is not there. The cost is in *context assembly and loop length*.

`synthesize` appeared only once across all cells — the 8,852-token RI outlier — which makes
the earlier static count (20 `synthesize` sites vs 18 `think`) a poor predictor of runtime
spend. **Call-site counts are not spend.**

---

## 4. Limits — read before quoting any of this

- **n=3 per cell, one task shape, two models.** For 3/3 vs 0/3, Fisher two-tailed is
  **p ≈ 0.1** — not significant on its own. What carries weight is that the pattern is
  consistent across every run in a cell *and* has a mechanistic explanation visible in the
  traces (tool dispatch counts), not that the arithmetic clears a threshold.
- **One anomaly, unexplained:** `qwen3.5` inline run [2] recorded 0 tokens, `it=0`,
  `status=unknown`, `tools=[-]` — yet the deliverable existed. Possibly a cache hit or a
  trace race. Not counted as evidence either way; flagged for follow-up.
- **`(unmediated)` is not a purpose.** Inline calls bypass the stamping gateway, so their
  absence of `purpose` means "unmediated", never "think".
- **This is an OVERHEAD and FAILURE-MODE instrument, not a lift gate.** Promotion decisions
  still go through 09 §6 with proper arms.

---

## 5. What this changes

1. **Tier-scaling should key on tool-call propensity, not model tier.** F1/the inversion is
   direct evidence that "frontier ⇒ less harness" is wrong.
2. **F1 and F2 are bugs to fix, not overhead to trim.** A default-path run that reports
   success having done nothing, and a terminal gate that reports failure with the artifact on
   disk, are both trust-spine defects — the thing the framework claims as its moat.
3. **The simplification target moves** from "cut harness LLM calls" to **"cut context size
   and loop length"**, which is where the tokens actually are.
4. **The composite ablation must include a tool-propensity axis** and must not use an easy
   task — where every arm succeeds, overhead is unpurchased by construction and the run
   measures nothing.

---

## Appendix — instrument faults paid for en route

Four void arm-sets today, all probe-side, each now fixed so it cannot recur:
unseeded fixtures (task read a file that was never in the sandbox root); deliverable check
hardcoded to `report.md` while the task wrote `avg.txt`; a default task too easy to show
lift; and an `.withEvents()` subscription that returned 0 events on *both* paths including
one that demonstrably emitted 35 trace events.

Each initially looked like a harness failure. **Fourth consecutive session in which the
instrument, not the system, was the bug** — the standing prior should now be that a
surprising result indicts the probe first.
