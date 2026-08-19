---
aliases: [Lightweight Tool Index — Progressive Disclosure for Tools]
tags: [plan, architecture, kernel, tools, progressive-disclosure]
status: proposed
created: 2026-08-19
program: 09-UNIFIED-PROGRAM §5.2 (counter-proposal)
---

# Lightweight Tool Index — a proven-pattern alternative to deleting `discover-tools`

**Program position:** counters `09-UNIFIED-PROGRAM.md` §5.2 ("discover-tools is pure
cost — REMOVE"). Not a rejection of the evidence — a re-diagnosis of what it actually
shows, plus a cheaper mechanism that targets the real cause. Requires an `ablation-warden`
cross-tier measurement before any default changes, per §2's lift rule. This is a plan to
measure, not yet a plan to ship.

---

## 1. Why §5.2's own evidence doesn't support removal

§5.2's table: `discover-tools` invocations across ~35 cells = **0**. Read as "it never
fires, so it's dead weight." But the codebase's own instrumentation already explains
*why* it never fires, and the explanation is not "unneeded" — it's "invisible."

`tool-surface.ts:249` (`resolveToolSurface`) computes a `reasons: ReadonlyMap<string,
string>` entry for **every** tool the model can't see this iteration —
`"hidden: lazy-undisclosed"`, `"hidden: classification-pruned"`, etc. (`:353-360`). This
map exists purely for internal tracing (the `tool-surface-resolved` trace event,
`think.ts:671`). **It is never rendered into the prompt.** The model has no way to know
anything is hidden — no name, no count, no hint — so it has no reason to think to call
`discover-tools`. Zero invocations is not evidence the rescue is unneeded; it's the
predictable outcome of a rescue mechanism the model can't see is available.

There is a **measured, in-repo, dated example of the actual cost this produces**
(`tool-surface.ts:58-68`, 2026-07-28, haiku + qwen3.5, 21-tool surface, task
`"Use the sql-query tool …"` — naming the tool explicitly):

| Arm | iter0 visible surface | Iterations to first correct call |
|---|---|---|
| classifier ON | `file-write, sql-query, sql-schema, …` | 6 |
| classifier OFF | `file-write, recall, discover-tools` | 9 |

The classifier-off arm's extra 3 iterations were spent because the model had to guess
that `discover-tools` might help, call it blind, and only then see `sql-query` exist —
despite the task naming it outright. §5.2 measured `discover-tools` never gets called;
this comment shows what happens on the rare occasion the model *does* stumble into
calling it: it works, at a 50% iteration-count tax, because the discovery round-trip is a
whole extra model turn instead of being free information already present in the prompt.

## 2. The proven pattern, already shipped once in this codebase

Skills (2026-08-06, project memory `project_skill_activation_2026_08_06`) hit the
identical problem — full skill content was either injected unconditionally (expensive)
or not injected at all (invisible) — and the fix was **catalog-only visibility +
explicit/auto-activation**: a cheap, always-present name+description index, with the
expensive full content loaded only on demand. `wiki/Architecture/Specs/07-ROADMAP-v1.0.md`
Phase 6 names this "Anthropic-pattern progressive disclosure" and explicitly scopes it to
tools as unfinished future work — this plan is that work.

**The mechanism to build:** replace `discover-tools`'s reactive meta-tool with a small,
always-rendered index line for every currently-hidden tool, sourced from data the
resolver already computes (`toolSurface.universe` minus `toolSurface.visible`, keyed by
the existing `reasons` map) — no new discovery logic, just surfacing what's already known
internally. Full schemas stay gated exactly as today (only required/relevant/used/
allowed/meta get the full parameter schema) — this changes *visibility of existence*,
not *the pruning policy itself*.

## 3. Mechanism design

### 3.1 What renders

One line per hidden tool, reusing `discover-tools.ts`'s existing `formatToolLine` format
(name + params + first-sentence-of-description, already tuned for terseness):

```
## Additional tools available (not shown above — call by name to use)
- sql-query(query: string) — Run a read-only SQL query against the connected database.
- sql-schema(table: string?) — Return the schema for one table, or all tables if omitted.
```

Rendered in the **dynamic tail** (`think.ts:749`, same seam as `rationaleInstructions`/
`guidanceText` — `parts.push(...)`), not the stable prefix: the hidden set changes every
iteration as `toolsUsed`/`discovered` grow, so caching it in the prefix would go stale
immediately. This mirrors how `guidanceText` is already placed for the same reason.

### 3.2 Data source (no new computation)

```ts
const hidden = toolSurface.universe.filter(
  (ts) => !toolSurface.visible.some((v) => v.name === ts.name),
);
```

`universe` and `visible` already exist per-iteration in `think.ts:331-369`. This is a
pure derivation from data already computed for the trace event — the index costs zero
additional resolver work, only prompt-rendering work.

### 3.3 Cost shape — why this should beat `discover-tools` on the token leg

`discover-tools`'s cost was the **schema tax**: Move 1 P2 measured ~1,000 chars of tool
schema (name + description + full JSON parameter schema) shipped on **every single call**
in the FC array, whether or not the model ever used it (`09-UNIFIED-PROGRAM.md §5.2`,
"wire cost" row). The index proposed here has no schema at all — no FC tool definition,
no parameters block, just plain text lines in the system/guidance prompt. Per-hidden-tool
cost is one line, ~15-30 tokens, and it **only appears when tools are actually hidden**
(an unpruned surface renders nothing). Where `discover-tools` cost ~1,000 chars
unconditionally forever, the index costs roughly (hidden-tool-count × 20 tokens)
conditionally, only under pruning pressure.

### 3.4 Flag gating — independently ablatable, per this file's own doctrine

`harness-flags.ts`'s header is explicit that harness mechanisms must be independently
switchable or they can't be measured (the exact reason `RA_LAZY_TOOLS`'s three-mechanism
compound switch was split in the first place). New resolver, same pattern:

```ts
/**
 * Always-visible lightweight index of hidden-but-permitted tools (progressive
 * disclosure, 2026-08-19 — counters 09 §5.2's discover-tools removal).
 * Default OFF pending ablation-warden measurement. RA_TOOL_INDEX=1 to enable.
 */
export function toolIndexEnabled(): boolean {
  return readFlag("RA_TOOL_INDEX") === "1";
}
```

Default OFF until measured — this is a candidate mechanism, not a shipped one. Does not
touch `lazyDisclosureEnabled()` or `toolDiscoveryEnabled()`; both stay exactly as they
are so the probe below can run all four combinations (index × discovery) independently.

### 3.5 Relationship to `discover-tools` itself

This plan does **not** propose deleting `discover-tools` in the same change. The index
and the meta-tool are not mutually exclusive — the index solves the *invisibility*
problem; `discover-tools`'s query-filtering (`rankByQuery`, relevance floor, "honest
exhaustion" catalog dump) remains useful for a surface too large to fully enumerate as an
index (hundreds of tools) or for a model that wants to search by intent rather than scan
a list. Whether `discover-tools` becomes redundant once the index ships is an empirical
question for a later measurement, not an assumption baked into this one. **Do not let
this plan's scope creep into "and also remove discover-tools" — that re-opens exactly the
premature-removal question the user pushed back on.**

## 4. Probe design

Three arms, same task shapes, cross-tier (matching this project's rung-2/rung-3 ladder —
a frontier/cloud model and a local tool-caller):

| Arm | Pruning | `discover-tools` | Index |
|---|---|---|---|
| **A — baseline** | ON (default) | ON (default) | OFF |
| **B — candidate** | ON | ON (unchanged — see §3.5) | **ON** |
| **C — control** | ON | OFF | OFF |

Arm C exists to prove the index is doing the work, not merely "removing discover-tools's
own token tax happened to help" — if C alone recovers most of B's gain, the index isn't
earning its keep and `discover-tools` really was closer to inert than helpful.

**Task design — reproduces the exact measured failure class from §1, live:** a tool
catalog with ≥16 tools (`PRUNE_MIN_TOOLS=15` in `think.ts:319`, so pruning actually
triggers), where the task names a tool BY NAME that pruning will hide (not in
required/relevant/allowed/floor/meta) unless discovered. This is the shape
`tool-surface.ts:58-68`'s comment already measured by hand; the probe automates and
extends it cross-model.

**Metrics per cell:**
- **Iterations to first correct call** of the named-but-hidden tool (the direct
  replication target — baseline 9, classifier-on comparator 6, from the in-repo example).
- **Total tokens** for the run (the lift-rule token leg).
- **Success** (did the run complete the task at all — accuracy leg).
- **Discovery-mechanism usage**: did the model call `discover-tools` (arm A/B) or
  correctly call the named tool directly on iteration 0 (arm B's intended win)?

**Lift-rule mapping (09 §2):** candidate (B) must show ≥3pp accuracy lift AND ≤15% token
overhead vs baseline (A), cross-tier. Given the cost shape in §3.3, the expected outcome
is actually a token **decrease** alongside the accuracy lift — if that's not what's
measured, the ablation-warden verdict is the ruling, not this plan's hypothesis.

## 5. What this plan does NOT do

- Does not implement the index yet — the probe below is the first deliverable, per this
  project's "no metric-gaming, no promoting a mechanism because it's elegant" doctrine
  (8 prior lift attempts, 0 passes, per 09 §8). Implementation is gated on the probe
  clearing the lift rule.
- Does not touch `discover-tools` itself (see §3.5).
- Does not resolve 09 §5.2's own open item — this plan is filed as a counter-proposal
  pending measurement, not a ratified amendment. If the probe fails the lift rule, §5.2's
  removal ruling stands and this plan is dead, same as any other falsified lever (09 §2:
  "falsified levers stay dead").

## 6a. Status (2026-08-19) — mechanism implemented, probe built and smoke-tested, NOT yet measured

**Shipped, default-off, zero behavior change to the default config:**
- `toolIndexEnabled()` (`harness-flags.ts`, `RA_TOOL_INDEX=1` to enable).
- `buildToolIndexText()` (`think.ts`, exported) + wired into the dynamic tail at the same
  seam as `guidanceText`. Typecheck clean, full `packages/reasoning` suite green (2733/0)
  with the flag off by default.
- `scripts/probes/tool-index-progressive-disclosure-probe.ts` — 4-arm probe (A baseline,
  B index+discovery, C control, D index-only per §4, revised to 4 arms below).

**A single-model smoke test (gpt-4o-mini, n=1 per arm — NOT a measurement, just probe
validation) surfaced two real confounds before producing any usable signal:**

1. **Guessable target-tool name.** The first target name (`fx-convert`) let the model
   blind-call it by a plausible guess with ZERO rescue mechanism active — it resolved
   anyway because the tool-call resolver heals a named call against `toolSurface.universe`
   (the full catalog), not `visible` (`think.ts:183`, documented, deliberate — a
   hallucinated-but-real name should still resolve). This silently invalidated the A/B vs
   C/D comparison (a guessable name makes "no rescue" arms look identical to "has rescue"
   arms). Fixed by using an unguessable codename-style tool name
   (`zbx-rate-lk7`).
2. **A real, separate framework bug**: `discoveredToolsStoreRef` (the module-level Ref
   backing `discover-tools`'s "discovered" set) is only reset when `RA_TOOL_DISCOVERY` is
   ON (`tool-capabilities.ts` — the reset lives inside the `if (toolDiscoveryEnabled())`
   block). Running arms sequentially in one process, a discovery-ON arm's "list everything"
   call (`discover-tools` with no query marks the ENTIRE catalog as discovered) leaked
   forward into a later discovery-OFF arm — which never resets the ref — making pruning
   look completely disabled in that arm (every tool visible). **Filed as its own follow-up,
   out of scope for this plan**: the ref should reset per-run unconditionally, not gated
   behind the discovery flag. The probe works around it by force-resetting the ref before
   every cell (`Ref.set(discoveredToolsStoreRef, new Set())`) — a workaround appropriate
   for a probe simulating separate runs, not a fix for production (where each real run
   should get an isolated ref regardless of this flag).

**After both fixes, one clean 4-arm smoke run (still n=1 — not a measurement) showed:**

| Arm | Target called? | Tokens | Notes |
|---|---|---|---|
| A — baseline | iter1, via `discover-tools` | 1533 | pruned correctly, rescued correctly |
| B — index + discovery | iter1, via `discover-tools` (index IGNORED) | 2935 | model reached for the familiar `discover-tools` call despite the index text being present and correctly rendered (verified directly) — paid for both, ~2× baseline tokens, same iteration count. **Not a win in this run.** |
| C — control (no rescue) | never | 635 | task effectively failed/gave up cheaply |
| D — index-only (no discover-tools) | inconclusive — `success:true`, 3 actions, but the logged action names didn't match the target tool by exact name | 1694 | needs a follow-up run with full step-by-step inspection before this cell means anything |

**Honest read:** this is not evidence for or against the hypothesis — it's one noisy
sample per arm on one model, with the probe's own confounds only just fixed. Arm B's
result is a genuine warning sign worth taking seriously before assuming the index is a
clean win: an always-visible index competing with a still-present `discover-tools` may not
redirect model behavior away from a familiar affordance, which is exactly why §4's arm
design separates "index added" (B) from "index replaces discovery" (D) — B alone was never
the real proposal (see §3.5). **Next actual step is the full cross-tier ablation-warden
run** (≥5 reps/cell, ≥2 model tiers per the project's measurement ladder, arm D as the
primary comparison against A) — not committing to a verdict off this smoke test.

## 6b. Design extension (2026-08-19) — per-tier mode, not a global toggle

User pushback on treating this as one global on/off: task shape and model tier both
change which mechanism wins, and the codebase already has the substrate for
tier-scoped policy (`ContextProfileSchema` / `CONTEXT_PROFILES`, `Tier = "local" |
"mid" | "large" | "frontier"`, `packages/reasoning/src/context/context-profile.ts`) —
this pulls 09 §7 Step 4 ("profiles") forward, scoped to just tool disclosure.

### The cost asymmetry driving the case split

The index is a **recurring per-iteration cost** (small, paid every turn, however many
turns the task runs). `discover-tools` is a **one-time cost when invoked**, but it costs
a whole extra model round-trip. Which wins is genuinely task-shape-dependent — this is
not resolvable by intuition alone, which is why §6a's measurement step exists rather
than shipping a guess.

### Mode taxonomy — shipped as a schema knob, `toolDisclosureMode` (§6c)

| Mode | Pruning | `discover-tools` | Index | When it should win |
|---|---|---|---|---|
| `"full"` | OFF | — | — | Catalog small enough that pruning is pure overhead (below `PRUNE_MIN_TOOLS`-ish territory, or a frontier tier where cache-amortized full schemas may beat any disclosure machinery at all). |
| `"discover"` | ON | ON | OFF | **Today's default**, unchanged. Kept as an explicit, back-compat choice. |
| `"index"` | ON | OFF | ON, uncapped | Medium catalog, few iterations expected, or a tier (local/small) where an extra round-trip is disproportionately expensive. |
| `"hybrid"` | ON | ON | ON, capped (`toolIndexMaxEntries`) | Large catalog where an uncapped index becomes its own wall of text — index covers the likely-near set, `discover-tools`' query search covers the long tail. |

### Additional case not in §4's original design: the classifier

When `.withRequiredTools({adaptive:true})`'s LLM tool-relevance classifier is on
(opt-in, default off, per `wiki/Decisions/2026-08-11-...`), a paid judgment has already
decided a tool is irrelevant — showing it in a free index second-guesses that judgment
for tokens spent with no plausible gain, and the classifier's own `hasClassification`
flag already suppresses the free keyword heuristic for exactly this reason
(`tool-surface.ts:118`). The index should follow the same rule: `buildToolIndexText`
should not render (or should render only the classifier's own "possibly relevant"
tier, if the classifier expresses one) when `hasClassification` is true. **Not yet
wired — flagged for the implementation that promotes a validated mode to a real
per-tier default, not built speculatively ahead of the measurement.**

### 6c. What's shipped now vs. what's still a knob with no default

**Shipped, zero behavior change (verified: full `packages/reasoning` suite 2733/0,
typecheck clean, both before and after):**
- `ContextProfileSchema.toolDisclosureMode` / `.toolIndexMaxEntries`
  (`context-profile.ts`) — additive optional fields, **no tier in `CONTEXT_PROFILES`
  sets them**, so every tier's resolved profile is byte-identical to before this
  change until something sets the field explicitly.
- `buildToolIndexText`'s cap parameter (`maxEntries`) — the hybrid mechanic. New unit
  tests (`tests/kernel/reason/tool-index-text.test.ts`, 4/4 pass) pin: no-cap lists
  everything, cap truncates and names the overflow count, cap ≥ hidden-count is a
  no-op.
- `think.ts` threads `profile.toolIndexMaxEntries` into the existing (still
  `RA_TOOL_INDEX`-flag-gated) call site.

**Deliberately NOT done — this is the ratification step that comes AFTER
measurement, not before:**
- No code resolves `toolDisclosureMode` into the low-level `RA_LAZY_TOOLS` /
  `RA_TOOL_DISCOVERY` / `RA_TOOL_INDEX` flags yet — `discover-tools` registration
  (`tool-capabilities.ts`) doesn't currently receive `profile` at all, and wiring it
  is a real (if small) refactor that should happen once a mode is validated, not
  speculatively.
- No `CONTEXT_PROFILES` tier sets `toolDisclosureMode` — the per-tier table in §6b is
  a **hypothesis to measure against**, not a shipped default. Setting it now would be
  a default-on behavior change with zero ablation-warden evidence, which is exactly
  the mistake 09 §2's lift rule and §8's "no promoting a mechanism because it's
  elegant" exist to prevent.
- The user-facing builder method (something like `.withReasoning({ contextProfile: {
  toolDisclosureMode: "hybrid" } })` already works today via the existing
  `profileOverrides` mechanism — no NEW builder surface needed, the schema field is
  enough) is usable for the ablation probe today, but isn't documented/announced as a
  public feature until a mode is validated.

## 6d-pre. Instrument validation (2026-08-19) — four confounds found and fixed

Before handing this to a measurement pass, the probe itself was hardened through five
single-rep smoke iterations. **Every one surfaced a real bug in the instrument, not the
mechanism under test** — consistent with 09 §2's "a surprising measurement indicts the
instrument first":

1. **Guessable target-tool name** (`fx-convert`) — resolved via `toolSurface.universe`-
   based healing (`think.ts:183`, deliberate — a hallucinated-but-real name should still
   resolve) even with zero rescue mechanism active, silently equalizing every arm. Fixed
   with an unguessable codename (`zbx-rate-lk7`).
2. **World-knowledge-answerable task** — "convert 100 USD to EUR" is estimable by a
   capable model without ever calling the tool, so `success` didn't require tool use at
   all. Fixed by making the tool's output an arbitrary, unguessable value
   (`QK-77219-ZM`) with no real-world meaning, and adding `taskWasActuallySolved()` — a
   verbatim substring check against the output — as the primary accuracy metric,
   independent of the (separately noisy) verifier's own success judgment.
3. **Lexical-overlap heuristic rescue** — the fix for #2 introduced task wording
   ("transaction ID") that shared a word with the tool's own description, triggering
   `filterToolsByRelevance`'s free keyword heuristic (a single shared word >3 chars is
   enough — no relevance floor, unlike `discover-tools`' own `RELEVANCE_FLOOR=2`) and
   rescuing the tool regardless of mode, again equalizing every arm. Fixed with
   deliberately disjoint vocabulary between task and tool description.
4. **Wrong result field** — `taskWasActuallySolved` read `r.answer`, which is
   `undefined` on `AgentResult`; the real field is `r.output`. Silent false-negative on
   every cell until caught by manually inspecting one run's raw output.

Also fixed, separately, as a real (non-probe) framework bug found along the way:
`discoveredToolsStoreRef`'s reset was gated behind `RA_TOOL_DISCOVERY` instead of
running unconditionally — shipped as its own commit, `packages/reasoning/src/kernel/capabilities/act/tool-capabilities.ts`.

Post-fix, a full 1-rep-per-cell dry run (7 cells: 4 modes × small catalog, 3 modes ×
large catalog) completed with the target tool correctly hidden by pruning in every
non-`full` mode, correctly reachable across all modes, and `solved` correctly
discriminating a tool-grounded answer from a guessed one. **The instrument is now sound
enough to trust a real measurement's numbers** — which single-rep smoke runs are not
(model-response variance alone makes n=1 uninterpretable; ~13pp SE at n=5 per this
project's own Bernoulli-variance convention).

## 6d. Cross-tier ablation — dispatched, not yet returned

Given how many live model calls a proper cross-tier, multi-catalog-size, multi-rep
measurement requires, this was handed to an `ablation-warden` agent (background) rather
than run inline — see the session record for the dispatch brief. It covers: modes
`full` / `discover` (baseline) / `index` / `hybrid`, catalog sizes matching §4's medium
case and a large (60+ tool) case for the hybrid arm specifically, ≥2 tiers (a
cloud/frontier-adjacent model given Anthropic's own key had no credit this session, and
a local Ollama tool-caller), ≥5 reps/cell per this project's Bernoulli-variance
convention (5 tasks × n≤5 has ~13pp SE — single-run smoke tests in §6a are NOT this
measurement, only proof the probe itself works). Verdict to be appended here once it
returns, per-tier, against the lift rule (§2: ≥3pp accuracy AND ≤15% token overhead).

## 6. Open question for the owner

If the probe passes the lift rule, does the index render for **all** hidden tools
unconditionally, or only above some hidden-count threshold (to avoid the index itself
becoming a wall of text on a very large catalog)? Not resolved here — worth deciding once
real hidden-tool-count distributions are visible from the probe's own runs.
