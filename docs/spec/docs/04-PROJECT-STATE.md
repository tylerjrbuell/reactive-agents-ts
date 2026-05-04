# Project State — Read This First

> **Status:** Authoritative landing document, written 2026-04-27.  
> **Purpose:** Single page to understand WHERE WE ARE on the project — empirically, methodologically, and operationally — without reading 30+ scattered docs.  
> **Audience:** Tyler, Claude, future contributors, future agent sessions starting cold.

---

## TL;DR

- **The project's vision is intact** (`00-VISION.md`) — control over magic, model-adaptive intelligence, observable agents.
- **The architecture target is set** (`15-design-north-star.md` v3.0) — 10 capabilities, kernel cognitive architecture, ~22 packages.
- **What changed this week**: we added a research discipline that says **every harness change must be empirically justified by a single-file spike that isolates one mechanism against one failure mode**. Codified in `00-RESEARCH-DISCIPLINE.md`.
- **What the empirical evidence says today**: the harness's defensible value is **trust** (refusing to ship fabrications), not capability boost. Mechanisms are tier-specific. Most of the 30+ packages haven't been spike-validated yet.
- **The mandate**: v0.10.0 release is deferred until architecture + validation discipline are in place. No more shipping features on a fractured foundation.

---

## The Authoritative Doc Hierarchy

Read in this order. Stop when you have what you need.

| Order | Doc | What it tells you |
|---|---|---|
| 1 | **`00-VISION.md`** | What we're building toward. The 8 pillars (Control, Observability, Flexibility, Scalability, Reliability, Efficiency, Security, Speed). Stable. |
| 2 | **`15-design-north-star.md`** v3.0 | The architectural target (10 capabilities, cognitive kernel, package strategy). v0.10 deferred until this is built. |
| 3 | **`00-RESEARCH-DISCIPLINE.md`** | The 12 rules that govern any harness change. Hypothesis-first spikes. No shipping without empirical evidence per failure mode. |
| 4 | **`01-FAILURE-MODES.md`** | The catalog: what can go wrong with the harness, prioritized by frequency × severity × controllability. 14 seed entries; living doc. |
| 5 | **`02-IMPROVEMENT-PIPELINE.md`** | How discoveries flow into harness changes: 7-stage flywheel from DISCOVERY → CATALOG → PRIORITIZE → DISSECT → DESIGN → INTEGRATE+VALIDATE → DEPRECATE. |
| 6 | **`prototypes/RESEARCH_LOG.md`** | Running record of every spike (hypothesis → outcome → next move). |
| 7 | **`prototypes/RESULTS-*.md`** | Per-spike detailed findings. |
| 8 | **`harness-reports/`** | Bench data + spike data. Per-run JSON. |

Layer-specific deep dives (memory, reasoning, tools, etc.) live in `02-layer-*.md` through `09-layer-*.md`. These are subsystem references — read when investigating a specific subsystem, not at session start.

---

## Empirical State of the Harness (as of 2026-04-27)

### What we have empirical evidence for

| Finding | Evidence | Confidence |
|---|---|---|
| Harness is net-positive vs main on local-tier (cogito-8b, qwen3-4b) | Bench `local-models` session, both lift +0.23 | Direction high; magnitude approximate (n=15 per cell) |
| Verifier `agent-took-action` check converts confident-fabrication → honest-fail on cogito | Spike p01b: 5/5 reject | High for this mechanism × this model × this task |
| Verifier-driven retry helps qwen3 recover from fabrication on rw-2 | Pass B today, trace `01KQ84GK70AX1HG485ZRY9QMAS`: ✗→✓ recovery | Real direction; n=1 |
| Verifier-driven retry does NOT help cogito (model ignores feedback) | Spike p02: 0/5 recovery, +4.2× tokens for nothing | High for this model × this task |
| qwen3 thinking-mode interaction empties harness output | Discovered today; `packages/llm-provider/src/providers/local.ts:215` auto-enables thinking | Confirmed; bench data for qwen3:4b harness needs re-run |
| Bare LLM is competent but shallow | Spike p00v2: qwen3 with proper config calls tools, computes, but grabs red herring 5/5 | High for this task |
| Long-form synthesis regresses on retry | Earlier today, trace 01KQ84EQ06S6E6WZJGF1BKZ7ZQ: 7/15 fab → 49/88 fab on retry | Direction observed; mechanism unclear |

### What we DON'T have evidence for (despite the harness having mechanisms for these)

- Reactive intelligence dispatcher's per-tier net contribution
- Strategy switching effectiveness (does the new strategy actually recover?)
- Context compression's actual lift (dual systems uncoordinated per memory)
- Skill system's contribution (3/6 hooks unwired per memory)
- Memory consolidation effectiveness in production
- Calibration's behavioral influence
- Sub-agent delegation success rate
- Most of the ~30 packages

These are not "broken" — they're **unvalidated**. The pipeline now exists to validate them or mark them for deprecation.

### What we know is currently broken or limited

- cogito:8b calibration says `native-fc` but FC is unreliable in practice (FM-A2 in the catalog)
- Harness auto-enables qwen3 thinking-mode → empty content output (FM in observation)
- ToT outer loop doesn't honor early-stop (per memory `project_running_issues`)
- Skill lifecycle hooks not wired (3/6) (per memory)
- Dual compression systems may both fire (per memory)
- v0.10.0 release prep complete but unpushed (per memory)
- Branch hygiene: feature work happening on `feat/phase-1-sprint-2-invariant-curator`, not Sprint 3.5/3.6 branch
- Public APIs added this session NOT marked `_unstable_*` (Rule 10 violation — needs cleanup)

---

## The Methodology Shift (the most important change this week)

### Old way (what got us here)

1. Identify a failure pattern (often anecdotal, single-trace)
2. Hypothesize a mechanism that might help
3. Build it across multiple packages
4. Validate at end of sprint with bench (if at all)
5. Ship and hope

### New way (what we're doing going forward)

1. **DISCOVERY** — observe failure (failure-corpus, bench, trace mining, spike surprise)
2. **CATALOG** — entry in `01-FAILURE-MODES.md` with severity × prevalence × controllability
3. **PRIORITIZE** — top-N by composite score
4. **DISSECT** — single-file spike (~80–200 LOC), hypothesis-locked, raw provider SDK, ONE mechanism
5. **EVIDENCE** — spike across mechanism × model × failure-mode matrix; six-level signal taxonomy (behavioral, mechanistic, quality, cost, robustness, surprise)
6. **PROMOTE/KILL/REFACTOR** — explicit gates, no "interesting, will revisit"
7. **INTEGRATE** — minimum form in harness, with developer-overridable hook (control pillar), `_unstable_*` API marker, spike becomes regression test
8. **VALIDATE** — bench session re-run confirms aggregate lift
9. **DEPRECATE** — harness mechanisms whose claimed coverage isn't backed by spike evidence become deletion candidates

The discipline is codified in `00-RESEARCH-DISCIPLINE.md` (Rules 1-12). The catalog is `01-FAILURE-MODES.md`. The operational rhythm is `02-IMPROVEMENT-PIPELINE.md`.

### Critical scope-of-claims rule (Rule 11)

A spike validates ONE mechanism × ONE failure mode × ≤2 models × ONE task. Generalizing to "the harness should X" or "delete component Y" requires multiple corroborating spikes + bench-layer evidence. Single-spike findings shape the next spike, not harness-level decisions.

---

## What This Session Arc Produced (Apr 27, 2026)

### Architectural code commits (on `feat/phase-1-sprint-2-invariant-curator`)

| Commit | What | Status |
|---|---|---|
| `13c80dcd` | Parrot leak fix — kernel owns final output, status=failed → output=null | Shipped |
| `94a774cb` | Sprint 3.4 stages 1-3 — separate harness signals from output | Shipped |
| `fa796c7f` | Sprint 3.6 Phases 1-2 — first-class harness diagnostic system | Shipped |
| `9c7f0196` | Skill rewrite: harness-improvement-loop on diagnose system | Shipped |
| `2bcd7209` | Per-iteration end + terminal pre-verifier snapshots | Shipped |
| `45960be6` | Verifier-driven retry mechanism | Shipped, **needs `_unstable_*` marker** |
| `14135d6d` | Verifier + retry policy injection (control hooks) | Shipped, **needs `_unstable_*` marker** |
| `58b2e821` | Pinned research discipline contract + bench baselines | Shipped |
| `efd6cb44` | Spikes p00 + p00v2 | Shipped |
| `7cae34c9` | Spikes p01 + p01b (verification gate isolation) | Shipped |
| `5f3515a6` | Spike p02 (retry KILL on cogito) | Shipped |
| `d0b9d956` | Failure-mode catalog + improvement pipeline + Rules 11-12 | Shipped |

### Research artifacts

- 5 spike files in `prototypes/` (p00, p00v2, p01, p01b, p02)
- 4 RESULTS docs (p00, p00v2, p01, p02) — **p01 and p02 contain pre-Rule-11 overclaim language flagged for calibration**
- `RESEARCH_LOG.md` running record
- `harness-reports/spike-results/` raw JSON per spike
- `harness-reports/bench-comparison-2026-04-27/` bench data + SUMMARY

### Foundational docs (the methodology layer)

- `00-RESEARCH-DISCIPLINE.md` — 12 rules
- `01-FAILURE-MODES.md` — 14 seed entries, categorized A-H
- `02-IMPROVEMENT-PIPELINE.md` — 7-stage flywheel
- This doc (`PROJECT-STATE.md`) — landing page

---

## What's Stale or Needs Attention

### Stale docs (March-era, may not reflect current architecture)

- `09-ROADMAP.md` (Mar 11) — pre-dates Sprint 3.x work; per memory, ROADMAP is 5/5 stale
- `11-missing-capabilities-enhancement.md` (Mar 11) — pre-dates current capability list
- `FRAMEWORK_USAGE_GUIDE.md` (Mar 11) — pre-dates current builder API surface
- `START_HERE_AI_AGENTS.md` / `DOCUMENT_INDEX.md` (Apr 9) — should now point to `PROJECT-STATE.md` first
- Various `02-layer-*.md` through `09-layer-*.md` — subsystem deep dives; useful but may have stale claims about effectiveness

**Recommendation:** don't bulk-rewrite. Each doc gets a one-line status banner if/when it's touched: `> Status: <date>; some content may not reflect post-2026-04 architecture. See PROJECT-STATE.md for current state.`

### Cleanup tasks (carry forward)

| Task | Why | Priority |
|---|---|---|
| Calibrate `RESULTS-p01.md` + `RESULTS-p02.md` per Rule 11 (walk back overclaim language) | Current language reads as harness-level verdict; evidence supports only mechanism × model × task claims | High (do next session) |
| Mark `VerifierRetryPolicy` + new trace event types as `_unstable_*` | Per Rule 10; currently exposed as stable with zero external validations | High (next session) |
| Branch hygiene: cherry-pick session work onto a clean Sprint 3.5/3.6 branch off main | 92 commits on `feat/phase-1-sprint-2-invariant-curator` makes review impossible | High (before any v0.10/0.11 release) |
| Re-run bench `local-models` for qwen3:4b harness with thinking explicitly disabled | Current bench data for qwen3:4b harness corrupted by thinking-mode interaction | Medium |
| Set up frozen judge (per Rule 4) | Single SHA / separate process / pinned model. Current bench's judge changes when agent code changes — confounds comparison | Medium |
| Wire `regression-gate` bench session into CI | Catches future commits that regress the matrix | Medium |
| Set up cross-provider matrix (claude-haiku at minimum) | All current empirical work is local-only; frontier behavior untested | Medium |
| Survey/triage the layer docs (`02-09-layer-*.md`) for stale claims | Many are March-era and may misrepresent current package state | Low (defer until v0.10 prep) |

---

## Next Session Priorities (in order)

1. **Calibrate RESULTS-p01.md and RESULTS-p02.md** per Rule 11 — small focused edits; remove "captures X% of harness value" overclaim language
2. **Mark new public APIs `_unstable_*`** — `VerifierRetryPolicy`, new trace event types from Sprint 3.6
3. **Branch hygiene** — cut a clean branch, cherry-pick this session's commits, prepare for review
4. **Pick top-priority failure mode (FM-C1 — shallow reasoning)** and design the reproduction spike
5. **Cross-provider expansion** — add claude-haiku to spike matrix (one frontier reference)
6. **Spike-validate FM-D1 (premature termination)** — empirically test if the in-loop required-tools redirect actually causes tool calls

After 4-5 sessions of running this loop, the expected state:
- 3-5 mechanisms PROMOTED with evidence
- 2-4 mechanisms KILLED with written record
- A smaller, simpler harness with proven primitives
- A v1.0 README that writes itself

---

## What's Implicit (and worth saying)

- This methodology produces a SMALLER harness over time, not a larger one. That's the intended outcome.
- The "30-LOC verification gate captures 98% of harness value" claim from earlier today (RESULTS-p01.md) was an overreach. It captures the no-tool-fabrication failure mode on cogito × rw-2. The harness's other mechanisms address other failure modes that haven't been spike-tested yet.
- Many harness mechanisms might survive their spike test. We don't know yet. The default position is **agnostic, not skeptical** — until evidence comes in, treat existing mechanisms as un-validated, not condemned.
- The control pillar work (override hooks per Rule 9) is what makes the simplification productizable. A simple harness with developer-overridable everything > a complex harness with hidden defaults.
- v0.10.0 release was complete but unshipped per memory. The mandate from north star v3.0 is to defer until cognitive kernel architecture is in place. This session's work fits within that — the discipline + catalog are foundational to the validation discipline north star §7 calls for.

---

## Memory Sync

Both `.agents/MEMORY.md` and personal Claude memory are updated to reflect:
- Control pillar discipline (Rule 9 for new harness primitives)
- Research discipline contract Rules 1-12
- Failure-mode-first investigation
- Pointer to this PROJECT-STATE.md as session-start read

Future agent sessions will inherit this discipline at session-start.

---

*This document is the synthesis of multi-day work spanning Apr 22-27. It is meant to be the single page that brings any new session — human or AI — up to speed without spelunking. Update it when the empirical state changes meaningfully (new mechanism validated, new failure mode catalogued, methodology change). Do not update it for every commit.*
