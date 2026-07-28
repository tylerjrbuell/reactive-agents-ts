---
tags: [audit, system-map, simplification, evidence]
date: 2026-07-28
status: EVIDENCE — measured, not impression
feeds: "[[../../Architecture/Design-Specs/2026-07-28-ideal-architecture|the ideal-architecture spec]] (corrects §5 emphasis)"
---

# System Map — where the complexity actually is

Every number here was measured today. Where a previous document asserted something this
contradicts, the contradiction is called out rather than quietly reconciled.

---

## 1. The headline

**Tier-scaling already exists. It covers the cheap layer and stops exactly where the
expensive layer begins.**

| Subsystem | LOC | Tier-gated sites |
|---|---|---|
| `kernel/loop` | 7,128 | **8** |
| `capabilities/act` | 3,809 | **5** |
| `capabilities/reason` | 2,800 | **4** |
| `assembly` | 1,899 | **2** |
| `strategies` | 9,302 | **1** |
| — | | |
| `capabilities/decide` (arbitrator + guards) | 2,572 | **0** |
| `capabilities/verify` | 2,315 | **0** |
| `capabilities/reflect` | 1,023 | **0** |
| `capabilities/comprehend` | 907 | **0** |
| `capabilities/attend` (context/compaction) | 831 | **0** |
| `capabilities/sense` (entropy) | 620 | **0** |
| `kernel/assessment` | 664 | **0** |
| `kernel/control` | 640 | **0** |
| `kernel/contract` | 507 | **0** |

**~10,000 LOC of decision, verification, sensing and control machinery runs byte-identically
for `claude-opus` and for a 4B local model.** The 20 tier-gated sites are all in prompting,
context assembly and loop budgets — the layer that costs the least.

This is the precise, actionable form of the 555–640% overhead. It is not "we lack tier
scaling." It is **"tier scaling was applied to the prompt layer and never extended to the
reasoning layer."**

### And the tiers have less resolution than the code assumes

Four tiers are declared (`local | mid | large | frontier`). `selectAdapter` resolves them to
three adapters — and **`midModelAdapter` and `defaultAdapter` set an identical hook set**
(`continuationHint`, `synthesisPrompt`, `qualityCheck`). Only `localModelAdapter` differs, by
adding `errorRecovery`.

So the tier system's real resolution is **binary — local vs not-local** — while call sites
branch as though four levels existed. A `frontier` run and a `mid` run get the same adapter.

---

## 2. Correction to the ideal-architecture spec (§5)

That spec proposed tier-scaled intervention as "the keystone" and implied it needed building.
**That was wrong in two ways and I am correcting it rather than restating it:**

1. **The mechanism exists** (`selectAdapter`, `profile.tier`, 20 live sites). The work is
   *extending its reach*, not inventing it — a much smaller and more credible change.
2. **It over-weighted the meta-loop.** I flagged Waves B/D/E/F as dark machinery. They are
   dark, but they are **small**: assessment 664 + control 640 + contract 507 + ledger 1,071
   = **2,882 LOC, 9% of the kernel**. Deleting the meta-loop would be attacking the cheapest
   thing in the building.

The complexity mass is `act` + `reason` + `decide` + `verify` (**11,496 LOC**) plus
`strategies` (**9,302**). That is where a simplification program has to aim.

---

## 3. Size distribution

```
reasoning   46,950      kernel        30,744      capabilities  15,228
runtime     34,657        capabilities 15,228       act           3,809
tools       13,119        loop          7,128       reason        2,800
llm-provider 11,631       state         2,414       decide        2,572
benchmarks  10,087        utils         1,755       verify        2,315
reactive-int 5,883        ledger        1,071       reflect       1,023
observability 5,615       assessment      664       comprehend      907
core         5,558        control         640       attend          831
memory       5,296        policy          558       sense           620
                          contract        507       recall          219
                                                    learn           132
```

**`recall` (219) and `learn` (132) are effectively empty** — consistent with 08 §2's
"noop layers only; recall results computed then `void`ed." Two of the ten advertised kernel
capabilities are stubs. The ten-capability model overstates what executes.

---

## 4. Runtime weight, from a real trace

One real run — 114 trace events for **7 LLM calls**:

| Event kind | Count | Per LLM call |
|---|---|---|
| `kernel-state-snapshot` | 28 | 4.0 |
| `assessment` | 14 | 2.0 |
| `entropy-scored` | 12 | 1.7 |
| `tool-call-start/end` | 11 + 11 | 1.6 |
| `ledger-entry` | 10 | 1.4 |
| `projection-rendered` | 7 | 1.0 |
| `tool-surface-resolved` | 7 | 1.0 |
| `llm-exchange` | 7 | — |

These are local computation, not model calls, so they are cheap in tokens — but they are the
observability surface a user has to read to understand one run, and **16 events per model
call is a comprehension tax**.

---

## 5. The missing instrument (blocks the 640% question)

`LlmCallPurpose` (`think | plan | synthesize | extract | classify | verify`) is declared once
at the provider boundary and **the gateway stamps it on every mediated request**
(`b9fee154`). There are **64 purpose-stamped call sites** — and `synthesize` (20) outnumbers
`think` (18).

**But the trace does not record it.** Every `llm-exchange` event in a real trace reads
`UNSTAMPED`.

Consequence: *we cannot attribute token spend to a subsystem.* We know the harness costs
555–640%; we cannot say which purpose is spending it. Making `purpose` land on the
`llm-exchange` event is a small change and is the **highest-leverage instrument fix
available** — it turns "the harness is expensive" into "`synthesize` is 40% of spend."

**Do this before the composite ablation**, so the composite reports composition and not just
a total.

---

## 6. Triage

### Over-complicated — aim here

| System | LOC | Why |
|---|---|---|
| **`strategies`** | 9,302 | 9 strategies, 1 tier-gated site. Heavy search already falsified (no lift, 3–15× cost); `adaptive` INCONCLUSIVE at n=1 |
| **`capabilities/decide`** | 2,572 | 6 terminating guards, **zero tier-awareness**, measured misfire rate **1 of 1** |
| **`capabilities/verify`** | 2,315 | two verifiers with one receipt field (B4 history); zero tier-awareness — a frontier model pays full verification overhead |
| **`sense` + reactive-intelligence** | 620 + 5,883 | entropy sensing feeding dispatcher patches; 12 entropy scores per 7 calls; 3 tier sites in RI, 0 in `sense` |

### Under-built or stub — decide honestly

| System | LOC | Verdict |
|---|---|---|
| `recall` / `learn` | 219 / 132 | stubs. Wire or delete — do not keep advertising ten capabilities |
| `kernel/contract`, `assessment`, `control` | 2,882 total | small and dark. Cheap to keep, cheap to finish. **Not** the simplification target |

### Load-bearing — protect

Durable rail · run ledger (one enforced write path) · receipt/trust spine · calibration +
flywheel · deterministic replay · gateway · Cortex/UI kit. None of these appear in the
over-complicated column.

---

## 7. The streamline strategy that follows

Ordered so each step is licensed by the one before, and each is cheap relative to its payoff.

1. **Stamp `purpose` onto `llm-exchange`.** Small. Unblocks per-subsystem cost attribution.
   Without it every later step argues about a total instead of a composition.
2. **Composite ablation** (`bare` / `core` / `full`, ≥2 tiers) — now reporting *where* the
   tokens go, not just how many.
3. **Extend tier-gating from the prompt layer into `decide` / `verify` / `sense`.** The
   mechanism exists; this is reach, not invention. Expected to be the single largest overhead
   reduction on frontier models, and it removes nothing from local ones.
4. **Collapse guards 6 → 1** (proposals to the single terminal owner). Best-evidenced
   subtraction in the codebase.
5. **Retire strategies on replay evidence**, one loop plus configuration.
6. **Resolve `recall`/`learn`** — wire or delete.

Steps 3–6 are all *subtraction or narrowing*; none require new architecture. Step 1 is the
only thing that must be built, and it is small.

---

## 8. What this map does not claim

- **It does not price the systems in tokens.** LOC and trace-event counts are proxies. §5 is
  the reason: the real instrument is not wired yet. Treat the triage in §6 as *where to point
  the measurement*, not as a verdict.
- **`sense`/RI being unmeasured is not evidence they are worthless.** They fired in production
  per 08 §2 and may be exactly what carries weak models. The claim here is narrower: **they
  are not tier-conditional, so frontier runs pay for them with no evidence of return.**
- **Zero tier-gated sites is not automatically a defect.** Some logic *should* be universal —
  the ledger, the terminal authority, the receipt. The finding is that universality was never
  a decision in `decide`/`verify`/`sense`; it is the default nobody revisited.
