---
tags: [ablation, verdict, tool-index, progressive-disclosure]
created: 2026-08-19
related: [[2026-08-19-lightweight-tool-index-progressive-disclosure]]
---

# ablation-warden verdict — `index` mode (`RA_TOOL_INDEX`)

**Verdict: OPT-IN. NOT default-on, in any scope, on current evidence.**

## Independent re-verification performed

1. Probe/flag wiring inspected directly (`scripts/probes/tool-index-progressive-disclosure-probe.ts`,
   `think.ts:194-260,895-935`, `harness-flags.ts:83-100`) — matches the plan doc's own
   description; `MODE_ENV` correctly isolates `RA_LAZY_TOOLS`/`RA_TOOL_DISCOVERY`/`RA_TOOL_INDEX`
   per mode, `discoveredToolsStoreRef` is force-reset per cell, schema-promotion +
   double-payment fixes (commit `bffe8a48`) are live in `think.ts`.
2. Re-ran gpt-4o-mini / small catalog / `index` mode myself, REPS=5: **100% solved,
   1271 tokens, deterministic across all 5 reps** — exact match to the plan doc's
   claimed number. Trustworthy.
3. Re-ran qwen3:14b / large catalog / `index` mode myself, REPS=5: **40% solved (2/5),
   avgTokens 4671** — not identical to the doc's n=15 60% but well inside Bernoulli
   noise (2/5 vs 9/15 is a 1-success swing at n=5, ~22pp SE). Confirms the doc's own
   characterization: this is a real, partial engagement ceiling in the 40-60% band, not
   0% and not 100%. All misses were `actionCount:0` (never attempted), matching the
   doc's n=15 finding exactly — not a wrong-tool or healing failure.

## A confound the plan doc did not fully close, material to this verdict

The doc's own §6f `discover`-mode baseline for qwen3:14b (0% solved both catalog
sizes, ~862-868 tokens) was measured **before** §7a's `discover-tools` truncation/
LLM-paraphrase-compression fixes (commit `ffbab632`). §7a re-tested `hybrid` but never
re-ran a clean, post-fix `discover`-mode baseline on the local tier. This means:

- I cannot certify a trustworthy token-overhead percentage for `index` vs. today's
  shipped default (`discover`) on qwen3:14b — the only baseline on record is stale and
  was itself degenerate (0% engagement — a near-zero-effort, near-zero-cost failure
  mode is not a meaningful cost baseline to divide by).
- This is a *second*, independent reason (beyond the large-catalog engagement ceiling)
  that the local tier cannot be certified as passing the token-overhead leg of the lift
  rule right now, on any catalog size.

## Verdict by tier

**gpt-4o-mini (frontier, native-FC):** clean PASS-quality result, reproduced
independently. Both catalog sizes: accuracy tied-or-better (+40pp small, tied-at-100%
large) and tokens **decrease** vs `discover` baseline (-41% small, -37% large per plan
doc §7, matching my own small-catalog re-run exactly). This tier alone clears 09 §2's
lift rule with room to spare.

**qwen3:14b (local, native-FC-capable but weaker):**
- Small catalog: accuracy improved dramatically (0%→100% per doc), but token overhead
  vs. `discover` cannot be certified (stale/degenerate baseline, see above). Cannot be
  called a clean pass on the token leg.
- Large catalog: accuracy ceiling confirmed independently at 40-60% (not 0%, not
  100% — real, partial, `actionCount:0`-pattern engagement failure, not an accuracy
  bug). Token cost is also very large in absolute terms (4,671-6,740 avg) against
  whatever the true current baseline is.

## Application of the lift rule (09 §2)

Cross-tier divergence is explicit and real: one tier (frontier) clears cleanly on
every measured cell; the other tier (local) has one cell with a confirmed partial
ceiling and one cell with an uncertifiable cost baseline. Per the lift-rule table,
**cross-tier divergence maps to OPT-IN or REWORK, not PASS** — and because real,
substantial lift exists on ≥1 tier (frontier, unambiguous), REWORK (no lift anywhere)
is too harsh a read. This lands as **OPT-IN**.

## Is the qwen3:14b large-catalog cell disqualifying for a *scoped* default?

Yes, for that cell specifically — it is a real, reproduced (n=5 independently, n=15
in the plan doc) engagement ceiling, not noise, and not fixable by widening the cap
(the known `cappedHiddenTools` relevance-blind slice bug, §7b, makes capped modes
*worse* here, not better — do not reach for `hybrid`/`index_capped` as a patch for
this cell, per the mission brief's own flag). It is **not** disqualifying in relative
terms — `discover` (today's shipped default) scores 0% on the same tier/cell per the
plan doc's own §6f measurement (a *worse*, unrelated defect: the model doesn't
understand `discover-tools`' purpose at all). So `index` beats today's shipped default
on this exact cell on the accuracy leg. It is disqualifying for CERTIFYING a clean
lift-rule PASS, because the token-overhead leg can't be computed against a valid
baseline, and 40-60% is still a real accuracy ceiling, not "acceptable."

## Recommendation (execution deferred to the parent agent)

1. Keep `RA_TOOL_INDEX` opt-in (current state — do not flip any default). This is
   already the case; no regression risk from this verdict.
2. If a **scoped default** is wanted, the only tier that currently clears the bar
   cleanly is **frontier/cloud native-FC tiers** (measured: gpt-4o-mini). Recommend
   wiring via `ContextProfileSchema.toolDisclosureMode` set to `"index"` **only on the
   `"frontier"` tier entry** in `CONTEXT_PROFILES` (`context-profile.ts`) — not a raw
   tool-surface-size runtime check. Reason: §6f's own finding is that the qwen3:14b
   gap is about model *comprehension*, not catalog size or token cost per se ("it's
   about comprehension, not cost") — a size-threshold check would incorrectly apply
   the mode to any tier/dialect crossing that count, including tiers proven not to
   handle it well. Tier-scoping via the existing profile substrate is the correct
   knob; a bare `hiddenToolCount > N` check is not.
3. Do not extend a default to `local`/`mid` tiers from this evidence. Before
   reconsidering, re-run a clean post-`ffbab632` `discover`-mode baseline on
   qwen3:14b (both catalog sizes) to get a certifiable token-overhead number, and
   treat the large-catalog cell as a standing, out-of-scope-for-index-mode ceiling
   unless `cappedHiddenTools`' relevance-ordering bug (§7b) is fixed and re-measured
   as its own candidate.
4. Do not promote `hybrid`/`index_capped` in any scope — REWORK stands unchanged,
   confirmed by two independent root causes (§6e/§7a exhaustion-message defects,
   §7b relevance-blind cap) neither of which this pass touched.
