---
tags: [harness, planning, root-cause, north-star]
date: 2026-07-10
status: active
supersedes-in-part: 2026-07-09-capability-measurement-wave.md
---

# Harness root-cause closure program

Consolidates: North Star v6.0 (4-arc wiring program) × the 07-08 long-horizon sweep ×
the 07-09 capability audit × the 07-09/07-10 wire root-cause sessions. One list, ranked
by measured impact, each item stated as its root cause — not its symptom.

## Closed (this wave, all mutation-tested, live-verified where possible)

| # | Root cause | Fix | Commit |
|---|---|---|---|
| 1 | No directory-listing tool — recovery path structurally absent | `list-directory` + availability-aware ENOENT hint | `517075ef` |
| 2 | Receipt certified fabrication (`ok>0` ⇒ grounded; `failed` computed-never-read) | unresolved-failure × no-final-answer rule, per (tool,target) | `517075ef` |
| 3 | **ICS nudge ORDERED fabrication** ("skip this tool, use data from other calls") + premature-write push | substitution order removed; quota informational during recovery | `8b97ad9a` |
| 4 | Memory stack built when memory OFF (hidden extraction LLM call/run) | ambient merge gated | `8b97ad9a` |
| 5 | Model never re-reads its own reasoning (`content:""` every replayed turn) | `thought` events always recorded; rendered behind `RA_THOUGHT_CONTINUITY=1` | `8b97ad9a` |
| 6 | Engine-phase LLM calls unattributable (`llm-direct` catch-all) | `runPipeline` scopes `CurrentRunContext` | `8b97ad9a` |
| 7 | Meta-tools = 67% of schema budget, zero calls; `find` = silent web egress | task-facing defaults; skill generated from enabled set; recall schema 10→4 params | `50942fb3` |
| 8 | Trace recorded evidence nobody read; store unbounded (113k files/670 MB) | `analyzeWire` section in every run report + retention at recorder init | this commit |

Measured after 3+7: same trip-hazard task, qwen3:14b — 17,305 → **10,852 tokens**,
schema 7,472 → **4,024 chars/request**, still solves (184). n=1, directional.

## Open — ranked by leverage

### Tier 1: decides how good every run can be

1. **Thought-continuity ablation** (flag shipped). Changes every prompt of every
   multi-step run — the lift gate decides the default, not opinion. **Prereq for
   thinking-locals:** the Ollama provider discards the `thinking` field, so
   `assistantThought` is empty for qwen3-class models — capture it (capped) or the
   flag is inert on the tier the framework most wants to boost.
2. **Per-entity requirements.** The requirement gate tracks tool NAMES; one read of
   `orders.json` satisfied `file-read` while the required `rates.json` failed. One
   primitive closes three defects: the nudge-vs-abstain fight (wire-verified), the
   receipt's target blind spot (worked around via arg-fingerprint), and the dead
   `cardinality: "per-entity"` field on `fileReadTool`.
3. **Kernel→engine signal unification.** `ctx.toolResults` / `ctx.metadata.lastResponse`
   are empty on the kernel path ("5+ scattered gates", the code's own comment), so
   memory extraction is erratically reachable and any phase gating on engine ctx is
   blind. Single source: project kernel results into ctx at the boundary. Also unblocks
   the pending attribution proof for #6 above.

### Tier 2: inert machinery — wire it or delete it (owner's rule)

4. **Ledger MISSING-WRITERs**: `requirement` and `handoff` each have a live reader
   already waiting (`assess.ts:207`, `standing-frame.ts:147/177`). Mint at
   requirement-satisfaction and at `applyStrategySwitch`. Delete `contract-amended`,
   `checkpoint-marker`, `deliverable-commit` unless a reader ships with the writer.
5. **`verifierTier`**: 4 tiers declared, 1 implementation, 0 dispatch. Build the
   dispatch (frontier skips self-critique; local gets checker) or delete the field.
6. **Adaptive-plan fields** (`scaffoldingLevel`, plan `maxIterations`, `memoryPosture`,
   `toolSurface`): zero readers ⇒ DEEPEN/LEAN recompile is a behavioural no-op. Wire
   scaffoldingLevel→guard aggressiveness, or shrink the plan to `horizonProfile`.
7. **`check-control-plane.sh` GRANDFATHERED list** (4 forcing sites) has never shrunk;
   its own comment mandates it. One site per wave.
8. **H5 completion-status** wired into `reactive` + `direct` only — the other six
   strategies still map `done→completed` unguarded.

### Tier 3: context & tools polish

9. **Compaction never fires** (threshold = `window*4` chars ≈ the whole window) and
   failed tool results are `preserveOnCompaction:true` ⇒ pinned all run; the
   documented `recencyBudgetChars` role contradicts the wiring.
10. **Tool roster**: two terminators (`task-complete` vs `final-answer`); three
    overlapping memory tools (`recall`/`checkpoint`/`scratchpad`); `rag-search` +
    `scratchpad` marked superseded yet exported; `file-write` lacks append/patch;
    `file-read` lacks ranged read; `crypto-price`/`gws-cli` niche-in-core.

### Measurement (prerequisite for any default-on decision)

11. **Bench P2**: convert the 7 `llm-judge` tasks to deterministic graded checks
    (suite sd 0.50 → ≤0.30; 3pp verdict cost 556 → 147 runs/arm). Declared metric
    change ⇒ re-baseline immediately after.
12. **Bench P3**: more `horizon:long` tasks — one Bernoulli cell measures ALL of the
    2026-07 harness work today.
13. **Re-cut the adaptive ablation** (task #36) after the metric change + seam fixes.

## Discipline

Every fix in this program: root cause named, non-test consumer reads it, behavior
changes, a mutation goes red, and where a default changes — an ablation or an explicit
owner decision (meta-tools was an owner decision, recorded here).
