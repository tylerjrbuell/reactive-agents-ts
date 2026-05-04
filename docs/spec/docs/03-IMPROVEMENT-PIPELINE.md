# The Self-Improvement Pipeline

> **Status:** Operational rhythm doc, pinned 2026-04-27.  
> **Companion to:** `00-RESEARCH-DISCIPLINE.md` (the rules), `01-FAILURE-MODES.md` (the catalog).  
> **Purpose:** Answer the operational question — *how* do we systematically convert "agent failed at X" into "harness reliably handles X."

---

## The pipeline, in one diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SELF-IMPROVEMENT FLYWHEEL                              │
└─────────────────────────────────────────────────────────────────────────────┘

  [1] DISCOVERY ────────────────────────────────────────────────────────┐
      Sources: failure-corpus runs, bench traces, rax-diagnose mining,  │
      spike surprises, real deployments (eventually). Observe agents    │
      failing. Capture trace + context.                                  │
                                ↓                                        │
  [2] CATALOG ──────────────────────────────────────────────────────────┤
      Promote observation to entry in 01-FAILURE-MODES.md:               │
      - Manifestation (how to spot in trace)                             │
      - Reproduction recipe                                              │
      - Severity × Prevalence × Controllability scores                   │
      - Existing harness mitigation (if any)                             │
      - Empirical evidence (spike results — initially "UNVALIDATED")     │
                                ↓                                        │
  [3] PRIORITIZE ───────────────────────────────────────────────────────┤
      Composite score = Frequency × Severity × Controllability           │
      Top-N feed the spike queue. Low-controllability modes are flagged  │
      but not chased (can't fix model-layer issues from harness).        │
                                ↓                                        │
  [4] DISSECT (per failure mode) ───────────────────────────────────────┤
      a. Reproduction spike — confirm we can reliably elicit it          │
      b. Per candidate mechanism: spike per Rule 7 (one mechanism only)  │
         × Rule 3 (≥2 providers) × Rule 4 (frozen judge)                 │
      c. Hypothesis-locked per Rule 2: "mechanism Y addresses failure    │
         mode X by signal S, on models M, at cost C"                     │
      d. Result class: PROMOTE / KILL / REFACTOR (per Rule 6)            │
                                ↓                                        │
  [5] DESIGN ───────────────────────────────────────────────────────────┤
      Validated mechanism → minimum harness integration.                 │
      Required: developer-overridable hook (Rule 9), `_unstable_*` API   │
      (Rule 10). Spike becomes the integration's regression test.        │
                                ↓                                        │
  [6] INTEGRATE + VALIDATE ─────────────────────────────────────────────┤
      Ship to harness. Re-run bench session that contains the failure    │
      mode. Confirm lift. Update 01-FAILURE-MODES.md entry status.       │
                                ↓                                        │
  [7] DEPRECATE ────────────────────────────────────────────────────────┘
      Harness mechanisms whose claimed failure-mode coverage isn't backed
      by spike evidence get a deprecation marker. When a simpler spike-
      validated mechanism subsumes them, schedule removal.

  └──────────────── Loop back to [1] DISCOVERY ───────────────────────────┘
```

The flywheel is self-reinforcing: each pass surfaces new failure modes (from spike surprises and bench observations), prunes mechanisms that don't earn keep, and grows the empirical evidence base behind every harness primitive.

---

## Per-stage operational details

### Stage 1 — Discovery

**Inputs that feed the catalog:**

| Source | Cadence | What it surfaces |
|---|---|---|
| `failure-corpus.ts` runs | On harness change | Synthetic stress scenarios (rate-limit loops, contradictory data, etc.) |
| Bench sessions (`local-models`, `real-world-full`) | Per session, weekly target | Real-task failures, cross-model variance |
| `rax-diagnose` trace mining | Ad-hoc, post-bench | Recurring patterns across many runs |
| Spike experiments | Per-spike `RESULTS.md` "Surprise" section | Unexpected interactions — new failure modes hidden in known-good paths |
| User reports / dogfooding (future) | When real users exist | Production-relevant modes the synthetic surface misses |

**Discovery rule:** every bench run + every spike either reproduces a known failure mode (cite the catalog ID) or surfaces a new one (open a draft entry). No "interesting failure, will look at later" without a catalog draft.

### Stage 2 — Catalog

Each failure-mode entry in `01-FAILURE-MODES.md` follows this template:

```
## FM-NN — <short name>

**Category:** <A. Tool engagement | B. Tool errors | C. Reasoning | D. Loop control |
              E. Output | F. Context/memory | G. Multi-turn | H. Compliance>
**Severity:** catastrophic | serious | minor
**Prevalence:** high | medium | low | unknown (high = ≥30% of trial runs)
**Controllability:** harness-fixable | requires-prompt | requires-model-swap | impossible
**Status:** UNVALIDATED | UNDER_INVESTIGATION | MITIGATED | OPEN | DEPRECATED

**Manifestation:**
  How to recognize in a trace (event pattern, output signature, etc.)

**Reproduction:**
  Spike or scenario that reliably elicits it. Reference failure-corpus ID
  or prototypes/ file.

**Existing harness mitigation:**
  What mechanisms (if any) the harness uses to address this. Cite code paths.
  Status: claimed | empirically-validated | empirically-falsified | unmitigated

**Empirical evidence:**
  Links to spikes that tested mitigations against this mode. Per-spike result.
  Each spike answers: did mechanism Y address failure X on model M?

**Open questions:**
  What's not known. What spikes would resolve it.
```

### Stage 3 — Prioritize

**Scoring formula (initial — refine empirically):**

```
priority = frequency × severity × controllability
  
  frequency:        unknown=0.5  low=1  medium=2  high=4
  severity:         minor=1      serious=2        catastrophic=4
  controllability:  impossible=0 requires-model-swap=0.25
                    requires-prompt=1
                    harness-fixable=2
```

Top-3 by priority feed the active spike queue. Lower-priority modes stay cataloged for future cycles.

**Important:** controllability = 0 modes (e.g., model-level FC failure on cogito:8b that survives retry) are CATALOGED but not chased — pursuing them is wasted spike investment. They become routing decisions ("don't use cogito for FC tasks") rather than harness fixes.

### Stage 4 — Dissect

For the active failure mode F:

```
1. Reproduction spike (single file, ~50 LOC):
   - Hypothesis: "Failure mode F is reliably elicited by scenario S on model M"
   - Run N=5+. Confirm rate ≥80%.
   - If <80%: improve scenario or refine FM definition.

2. Mechanism candidate spikes (one per candidate, ~80-200 LOC each):
   - Hypothesis: "Adding mechanism Y to bare-LLM reduces F by ≥X% on model M"
   - PROMOTION: F-rate drops to <Y on ≥2 providers, no regression on adjacent failure modes
   - KILL: F-rate unchanged or other modes regress
   - REFACTOR: F-rate drops but mechanism is more complex than needed

3. Cross-model expansion:
   - Once a mechanism PROMOTEs on its target model class,
     test on adjacent classes (one local, one frontier, etc.)
   - Map the mechanism's effective scope (which model tiers, which task shapes)
```

Update the failure-mode entry's `Empirical evidence` section after each spike.

### Stage 5 — Design

When mechanism Y has accumulated enough evidence to PROMOTE for failure mode F within scope S:

- Write the harness integration (minimum form, per Rule 8)
- Add developer-overridable hook (Rule 9): `KernelInput.foo?: FooHookType`
- Mark public API `_unstable_*` (Rule 10) until ≥3 external validations
- The spike becomes the integration's regression test (lives in `packages/benchmarks/tests/` or similar)

### Stage 6 — Integrate + Validate

After integration:

- Run the relevant bench session (`local-models` minimum; ideally `real-world-full`)
- Confirm aggregate lift on tasks that exercise failure mode F
- If no aggregate lift: integration drift — investigate before merging
- Update FM entry: `Status: MITIGATED` (or partially, with scope notes)

### Stage 7 — Deprecate

A harness mechanism becomes a deprecation candidate when ANY of:

- Its claimed failure mode coverage has spikes that show NO lift
- A simpler validated mechanism covers the same scope
- The failure mode it targets has been re-classified as `Controllability: impossible`
- Bench shows no measurable degradation when the mechanism is disabled (ablation)

Deprecation process:
1. Mark with `@deprecated` JSDoc tag + reference to evidence
2. Open issue: "Remove X in next major (M.0+1) — evidence: <spike refs>"
3. Bench monitors for regressions during the deprecation window
4. Remove in next major version

---

## How this differs from the old "build and hope" pattern

| Old pattern | New pipeline |
|---|---|
| Build mechanism because it seems reasonable | Build mechanism because evidence shows it addresses a cataloged failure mode |
| Validate at the end of a multi-week sprint | Validate per-mechanism in spike, before integration |
| Discover regressions in production | Catch with bench session that includes the failure-mode scenario |
| Mechanisms accumulate; nothing gets removed | Deprecation is a first-class outcome of the loop |
| "Did this commit help?" — vibes | "Did mechanism Y on failure mode X show lift?" — empirical |

---

## Concrete weekly rhythm (target)

When the project is operating at full discipline, a typical week:

- **Mon:** Bench session run on current main; discover any regressions or new failure modes
- **Tue–Wed:** Pick top-priority cataloged failure mode; run reproduction spike + 1-2 mechanism spikes
- **Thu:** Update catalog with results; if PROMOTE, design + integrate the mechanism
- **Fri:** Bench validates the integration; deprecate any superseded mechanism

That's 1-2 cataloged mitigations per week, or 1 deprecation. After 10 weeks: a substantially smaller, empirically justified harness.

---

## What's needed to operationalize this NOW

| Need | Status | Action |
|---|---|---|
| `01-FAILURE-MODES.md` skeleton | DRAFTED | Seed with 8-12 known failure modes from existing work |
| Frozen judge (Rule 4) | NEEDED | Single SHA, separate process; pin model + prompt |
| Bench `regression-gate` in CI | EXISTS, NOT WIRED | Add as required check on PRs |
| Spike infrastructure (`prototypes/`) | EXISTS (3 spikes shipped) | Continue bottom-up extraction |
| `RESEARCH_LOG.md` per-spike entries | EXISTS | Maintain discipline |
| Deprecation tooling (JSDoc + lint rules) | NOT STARTED | Add when first deprecation lands |

The pipeline can run today with what exists. Each cycle improves the tooling demand-driven, per Rule 8.
