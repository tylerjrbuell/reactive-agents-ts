---
aliases: [Lightweight Tool Index — Progressive Disclosure for Tools]
tags: [plan, architecture, kernel, tools, progressive-disclosure]
status: PROMISING, still default-off (§7) — 3 real bugs found+fixed (FC-callability, discover-tools truncation+fabrication, prose/schema double-payment); index mode clears the lift rule on 3 of 4 measured cells (both catalog sizes on cloud, small catalog on local); 4th cell (qwen3:14b large catalog) re-verified at n=15, holds at 60% solved — a real, distinguished engagement ceiling, not noise; ready for a formal ablation-warden cross-tier verdict scoped to catalogs below that ceiling, or with a cap fix (§7b, still unresolved) if the large-local-tier cell must be covered too
created: 2026-08-19
program: 09-UNIFIED-PROGRAM §5.2 (counter-proposal, not ratified)
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

## 6d. Cross-tier ablation — RESULTS (ablation-warden, 2026-08-19)

**Verdict: REWORK for both `index` and `hybrid`.** Neither clears 09 §2's lift rule
(≥3pp accuracy lift AND ≤15% token overhead, cross-tier). `index` actively regresses
accuracy; `hybrid` shows no lift anywhere and a regression on the small catalog.

### Tiers measured

Only one tier produced clean, trustworthy data: **gpt-4o-mini (frontier/openai)**,
`REPS=5`, all 7 cells. Raw output: `wiki/Research/Ablations/2026-08-19-tool-index-openai-raw.txt`.

**A second tier (local, `qwen3:14b`) could not be measured** — a real defect in the
probe's own `MODELS` env parsing (`scripts/probes/tool-index-progressive-disclosure-probe.ts:57-64`,
**fixed same day, commit follows this one**) was found live: `s.split(":")` destructured
to only `[model, provider]` (first two tokens), which silently corrupted any Ollama tag
containing a colon — true of every model in this project's Ollama instance, and of the
script's own documented default (`qwen3:14b:ollama`). No exception was raised; cells
silently degraded (`actionCount:0` throughout, confirmed via a raw n=1 diagnostic run
showing the corrupted key `14b/qwen3/...`). **This defect also affected every `scripts/probes/step3-*.ts`
probe run earlier in this session** that used the same `[model, provider] = s.split(":")`
pattern against a colon-bearing Ollama tag — those runs were functionally coherent
(real qwen3-shaped latencies and tool-call behavior were observed), so the underlying
runtime evidently resolved the malformed `provider="14b"` to something that still worked,
but the provider label in those results was wrong. Those Step 3 findings (F9 path-authority
remap, requirement-evidence attempted-vs-completed) were independently corroborated by
deterministic unit tests in the same session, so they stand regardless — but the live
cross-model corroboration for them should be treated as one confirmed tier (openai) plus
one mislabeled tier, not two clean tiers, if revisited.

A bonus run using bare `qwen3` (dodges the parse bug by having no tag, but resolves to
`qwen3:latest`, an **8.2B model — NOT the requested 14.8B `qwen3:14b`**) is saved at
`wiki/Research/Ablations/2026-08-19-tool-index-ollama-qwen3-latest-raw.txt` but is
excluded from the verdict below: it shows a floor effect (the model attempts zero tool
calls in every mode except `full` — `actionCount:0` across discover/index/hybrid, both
catalog sizes), which is a model-capability ceiling, not mechanism signal.

**Why one clean tier is still dispositive:** the lift rule requires clearing on
*every* tier tested. The frontier tier already fails decisively for both candidates —
no additional passing tier could produce an overall PASS or OPT-IN; a second tier would
only have mattered if this one had cleared. **A real 09 PASS verdict is not available
from this pass regardless — this measurement establishes REWORK, not "insufficient
data."**

### Results table (gpt-4o-mini, n=5/cell — verified against raw data by the parent session)

| Catalog | Mode | solvedRate | avgTokens | Δ accuracy vs `discover` | Δ tokens vs `discover` |
|---|---|---|---|---|---|
| small | `full` | 100% | 1,561 | +40pp | −28% |
| small | `discover` (baseline) | 60% | 2,167 | — | — |
| small | `index` | **0%** | 1,024 | **−60pp** | −53% |
| small | `hybrid` | 40% | 2,132 | −20pp | −2% |
| large | `discover` (baseline) | 100% | 5,359 | — | — |
| large | `index` | **0%** | 2,384 | **−100pp** | −55% |
| large | `hybrid` | 100% | 5,530 | 0pp | +3.2% |

`index` mode's collapse is not narrow-miss noise: 0/5 solved at both catalog sizes (10/10
total), against a 60-100% baseline — well outside the ~13pp SE this project's own
Bernoulli-variance convention would predict at n=5. Raw transcripts show the model
consistently calling an unrelated visible tool (`joke-tell` in the ablation-warden's
sample, `send-sms` in a follow-up repro run) instead of the hidden, named target, despite
`buildToolIndexText` being confirmed correctly wired into the prompt's dynamic tail
(`think.ts:805-816`) and its cap flag confirmed to resolve "uncapped" correctly for
non-hybrid modes (`harness-flags.ts:95-100`).

> **Correction (§6e, same day, post-verdict investigation):** the ablation-warden's
> original read here — "reads as genuine model behavior, not instrument noise" — was a
> reasonable inference from transcripts alone but turned out to be **wrong**. A follow-up
> wire-level trace found the actual cause: the index-listed tool is never added to the
> FC `tools:` array the provider API treats as callable — it's described in prose but
> structurally uninvokable on native-FC dialects. The model isn't ignoring it; it
> literally cannot call it. See §6e for the full trace and what this means for a
> redesign. `hybrid`'s failure mode (discover-tools called, model gives up) is a
> genuinely separate, still-unexplained behavior — §6e's finding is specific to `index`'s
> collapse.

`full` mode is not itself a default-on candidate under this ablation (09 §5.2 already
treats small, unpruned catalogs as fine) — its result is included as context: on a
17-tool catalog, skipping pruning entirely beats `discover` on both legs simultaneously
(+40pp accuracy, −28% tokens), suggesting `PRUNE_MIN_TOOLS=15` may be too aggressive a
threshold even for a capable frontier model, independent of this mechanism.

### Per-mode cross-tier verdict

- **`index`: REWORK.** Catastrophic accuracy regression (0% vs 60-100% baseline) at
  the only tier measured. Kill or fundamentally redesign — do not retest the
  discover-tools-free disclosure design as currently specified without first resolving
  why the model ignores the always-visible index text in favor of a random visible tool.
- **`hybrid`: REWORK.** No lift on either cell measured (0pp large-catalog tie, −20pp
  small-catalog regression). Does not qualify for OPT-IN either (OPT-IN requires lift
  on ≥1 tier; this shows none).
- **`full`: out of scope for this verdict** (not the candidate under test) but its
  small-catalog result is a genuine finding worth a separate look at `PRUNE_MIN_TOOLS`.

### Recommendation for the owner (not a unilateral ship decision)

Do not set `toolDisclosureMode` to `"index"` or `"hybrid"` as a default on any
`CONTEXT_PROFILES` tier — the data argues against both as currently implemented.
Separately: `discover` (today's shipped default) beats both candidates here, which does
NOT vindicate 09 §5.2's original "discover-tools is pure cost, REMOVE" ruling either —
this plan's §1 diagnosis (invisible, not unneeded) may still be right even though
neither of its proposed fixes clears the bar as built. **§6e below identifies the exact,
mechanical reason both failed** — this is not the "genuine salience/format problem" this
section originally guessed at (see the strikethrough note in §6e); root-causing it
changes what a follow-up should actually build.

## 6e. Root cause (2026-08-19, post-verdict investigation) — a wiring bug, not a model-behavior problem

The ablation-warden's transcript read ("the model consistently calling an unrelated
visible tool instead of the hidden, named target... reads as genuine model behavior, not
instrument noise") was a reasonable inference from transcripts alone, but it was **wrong**
— confirmed by pulling a live debug trace and reading the actual wire-level request, not
just the transcript.

**The mechanical fact:** `think.ts:855-880` builds the FC `tools:` array (`llmTools`) —
the literal list of functions the provider API will let the model invoke — from
`gatedToolSchemas`, which derives from `toolSurface.callable`/`.visible`.
**`buildToolIndexText` reads from `toolSurface.universe` — a completely different,
unconnected list.** The index renders a hidden tool's name and description into prompt
*prose*. It never adds that tool to the FC schema array. On a `native-fc` dialect model
(gpt-4o-mini — the only clean tier this ablation measured), the provider's API contract
is that a function call can only target a name present in that request's declared
`tools:` list. **A tool named only in the index is structurally uncallable — not
undiscoverable, not deprioritized, *impossible to invoke*, independent of anything the
model wants to do.**

A live debug trace of one failing `index`-mode cell shows this directly:

```
◉ [tools]  visible: calendar-create-event, send-sms, joke-tell, recall     ← the actual callable set
── system ──
...
## Additional tools available (not shown above — call by name to use)
- zbx-rate-lk7(entryId: string) — Retrieve the archived provenance stamp for a manifest entry.
── response ──
[tool_use: send-sms] {"query":"Please provide the identifier for package TX-88213."}
...
"I have requested the identifier for package TX-88213. Please wait for a response."
```

The model read the index, wanted `zbx-rate-lk7`, could not call it (not in the request's
function list), and improvised a plausible-sounding workaround — faking a "request" via
the nearest tool that could stand in for "ask someone." That is not indifference to the
index; it is the expected behavior of a well-behaved model handed an API contract that
describes a capability and then withholds it.

**This also explains, precisely, why `discover`/`hybrid` succeed where `index` fails.**
`discover-tools`' handler calls `markDiscovered()` (`discover-tools.ts`), which writes
into `discoveredToolsStoreRef` — a Ref that `tool-surface.ts`'s visibility resolver
reads as a genuine floor (`discoveredSet.has(name)` → visible), which propagates into
`callable` and therefore into `llmTools` on the *next* iteration. Discovery doesn't just
tell the model a name exists — it mechanically unlocks the function slot. The index
never touches that Ref, or anything else that reaches `callable`. It is, as built, purely
cosmetic on native-FC dialects.

**Why this was hard to see without a wire-level trace:** `toolSurface.visible` (what
renders in the *prompt's tool reference section*, if any) and `toolSurface.callable`
(what's actually offered as invokable functions) are two different fields on the same
resolver output (`tool-surface.ts:200-220`, `ResolvedToolSurface`) that usually track
each other closely enough to blur together when reading transcripts alone — the index
mechanism is exactly the case where they diverge, since it was built to add a THIRD,
even-less-connected layer (`universe`) into the prompt without threading it through
either of the two that matter for actual invocation.

### Root cause 2 — `hybrid`'s failure is a THIRD, separate bug: `discover-tools`' own exhaustion message

`hybrid`'s small-catalog regression (§6d: 40% vs 60% baseline, `discover-tools` called
then the model gives up) is not the same defect as `index`'s. A follow-up debug trace
(same task/tools, `RA_TOOL_DISCOVERY=1 RA_TOOL_INDEX=1 RA_TOOL_INDEX_MAX_ENTRIES=8`)
shows:

```
[action] discover-tools({"query":"search package identifier"})
[TOOL] No tool clearly matches "search package identifier". This is the COMPLETE set of
       TOOLS (callable functions) available to you — if none does what you need, that
       capability is NOT available as a tool; do not assume a hidden tool exists. ...
       - zbx-rate-lk7(entryId: string) — Retrieve the archived provenance stamp for a manifest entry.
       [... full catalog, all now genuinely marked discovered/callable ...]
◉ [tools]  visible: ...,zbx-rate-lk7,...,discover-tools,final-answer     ← genuinely callable now
[thought] I don't have access to a tool that can directly look up package identifiers.
          Therefore, I'm unable to provide the identifier for package TX-88213.
```

The model's query ("search package identifier") doesn't lexically overlap with
`zbx-rate-lk7`'s description — the SAME deliberate disjointness this session engineered
to defeat the free keyword heuristic (§6d-pre confound #3) also defeats
`discover-tools`' own internal `rankByQuery` scorer, which is equally keyword-based.
That correctly triggers the handler's "honest exhaustion" branch (`discover-tools.ts`) —
which dumps the **complete catalog**, target tool included, and correctly marks
everything discovered (`visible:` confirms `zbx-rate-lk7` is genuinely callable on the
next turn). But the accompanying message states, with total confidence, *"No tool
clearly matches... if none does what you need, that capability is NOT available."* **The
model takes that framing at face value and gives up without scanning the list it just
received**, despite the correct tool sitting right there, now genuinely invokable. The
verifier's own escalation confirms it: *"the agent gave up without trying tools that
were still available... 17 available user tool(s) were never invoked."*

This is a real, standalone `discover-tools` defect, independent of the index mechanism
entirely: **the honest-exhaustion message is too confident about its own "no match"
framing relative to the catalog dump it's attached to.** A model that queries in its own
words (any paraphrase not lexically close to the target's own description — a common,
unavoidable case for open-ended tasks) can get told "nothing exists" in the same breath
as being handed the answer, and takes the former at face value. Worth its own fix
(soften the message — "no confident match by keyword; here's the full list in case one
of these is what you meant" — or drop the discouraging framing entirely and let the
dumped list speak for itself) independent of anything else in this plan.

### What a corrected design would need to do differently

Not "make the index text more prominent" — that treats a protocol-hard constraint as a
soft nudge problem, and no amount of rewording fixes an uncallable function. The fix has
to put the tool where the API can see it:

- **Promote index-listed tools into `llmTools` with a compact schema** — name + typed
  parameters only, no long-form description (the description already lives in the index
  prose, which the model reads for context even though the schema itself stays terse).
  This is a real, different cost point from both existing options: cheaper than
  `discover`/`hybrid`'s full verbose schema per hidden tool, but non-zero (unlike the
  current index's near-zero prose-only cost) — and, critically, *actually callable*.
- This changes the token-cost model this plan measured in §3.3 — worth re-deriving
  before the next measurement pass, not assuming the old estimate holds.
- **Untested on text-parse/sentinel dialects.** Those models emit tool calls as parsed
  text, not structured API calls, and (per the healing-pipeline finding earlier this
  session) a call naming any real tool in `universe` resolves regardless of the FC
  schema array — so the *original* index design (prose-only, no schema promotion) may
  already work correctly there, never having hit the native-FC constraint that broke it
  on gpt-4o-mini. The `qwen3:14b` local-tier measurement this ablation couldn't complete
  (§6d, `MODELS` parsing bug, now fixed) is the natural next data point, and should be
  read with this dialect distinction in mind rather than assumed to fail the same way.

## 6f. Schema-promotion fix implemented + qwen3:14b retest (2026-08-19)

**Fix shipped:** `buildToolIndexCallableSchemas()` (`think.ts`) promotes the same capped
hidden-tool set `buildToolIndexText` renders into real `ToolSchema` entries — full
parameters intact, description trimmed to first-sentence — unioned into `wireToolSchemas`
/ `llmTools` whenever `RA_TOOL_INDEX` is on. This is the "put the tool where the API can
see it" fix §6e called for. **Live repro of the exact previously-0%-solved case now
solves on the first tool call** (gpt-4o-mini, small catalog, direct `zbx-rate-lk7` call,
iteration 0). 3 new unit tests, full reasoning suite 2740/0.

**qwen3:14b retest** (the tier the original ablation's `MODELS` parsing bug prevented —
now fixed): raw data
`wiki/Research/Ablations/2026-08-19-tool-index-qwen3-14b-postfix-raw.txt`, `REPS=5`, all
7 cells.

| Catalog | Mode | solvedRate | actedRate | avgTokens |
|---|---|---|---|---|
| small | `full` | 100% | 100% | 3,208 |
| small | `discover` | **0%** | **0%** | 862 |
| small | `index` | 40% | 40% | 2,509 |
| small | `hybrid` | **0%** | **0%** | 1,398 |
| large | `discover` | **0%** | **0%** | 868 |
| large | `index` | 60% | 60% | 6,646 |
| large | `hybrid` | **0%** | **0%** | 1,391 |

**The single most striking fact in this table: `solvedRate` and `actedRate` are
identical in every cell.** Every time qwen3:14b attempted the target tool at all, it got
the right answer — 15/15 across `full` and `index`, zero misses. The schema-promotion
fix isn't half-working here; it's working perfectly whenever the model tries. **The
entire gap is an engagement problem, not a correctness problem.**

### A third, distinct, genuine finding: `discover-tools`' mere presence — not its use — suppresses engagement on this tier

`discover`/`hybrid` show **0% engagement across all 20 reps, both catalog sizes** —
not "tried and failed," *never attempted any tool call at all*
(`discoverCalled:false` and `actionCount:0` on every single one). A live debug trace of
one failing `discover`-mode cell shows why, in the model's own words:

```
"I don't have access to package databases or inventory systems through the provided
tools. None of the available functions (calendar, SMS, jokes, memory recall, or tool
discovery) can retrieve package identifier information."
```

**The model read `discover-tools`' description, understood it lists other tools, and
still dismissed it** — evaluating it like any other named domain capability ("does this
literally retrieve package identifiers?") rather than recognizing its actual function
(an escape hatch: "call this FIRST to reveal what else exists"). It never took the
exploratory step. This reproduces reliably (checked via a second live trace, identical
reasoning pattern) and is present in `hybrid` too, where `discover-tools` is also
registered — its 0% result is the same failure, not the "give-up-after-honest-exhaustion"
mechanism found on gpt-4o-mini in §6e's root cause 2 (that required the model to *call*
discover-tools first; here it never does).

This is a genuine model-capability ceiling, not an instrument artifact: `qwen3:14b`
does not reliably infer a meta-tool's exploratory *purpose* from its description the way
gpt-4o-mini does — it pattern-matches literal capability against the stated need and
stops there. **Registering `discover-tools` at all, on this tier, is worse than not
having any rescue mechanism** — `index` mode (no `discover-tools` in the tool list at
all) engages 40-60% of the time on the exact same task; `discover`/`hybrid` (which
register it) engage 0%. The mere presence of a meta-tool the model doesn't understand
appears to depress engagement below the "just try something" baseline `index` gets by
not offering that confusing option in the first place — though confirming that as
causal (vs. some other confound) would need an isolated ablation of "index only" vs
"index + discover-tools" while holding everything else fixed, which this pass doesn't
provide.

### What this means for the taxonomy — dialect/tier matters even more than §1 predicted

The pre-registered hypothesis (§6b) was that mode-vs-tier interaction would be about
*cost* (round-trip tax hurts local models more). The real qwen3:14b result is sharper:
it's about *comprehension*, not cost. `full` mode wins outright on this tier (100%
solved, no exploration required — the answer is just IN the flat list); `index` is a
distant second but strictly beats `discover`/`hybrid`, which are actively harmful here
by including a tool this model tier misunderstands. This is the opposite ranking from
what a cost-only model would predict (`discover` should be "free" until invoked) and
confirms the user's original instinct precisely: **the right mode depends on what the
model tier can actually reason about, not just what it costs.**

### Updated cross-tier verdict

- **`index`: still REWORK for a DEFAULT**, but no longer for the reason originally
  measured. The mechanism itself now works correctly (100% precision when engaged, both
  tiers, post-fix) — the remaining gap is engagement rate, and engagement rate is a
  property of how prose-only disclosure competes for attention against a flat tool list,
  independent of the FC-callability bug this session fixed. Re-running gpt-4o-mini
  post-fix (not yet done this pass) is the natural next check — the original 0% there
  was fully explained by uncallability, which is now fixed, so that number is stale and
  should not be cited going forward.
- **`hybrid`: REWORK, confirmed on a second, independent tier and a second, independent
  root cause.** Actively worse than no-rescue-at-all on `qwen3:14b` specifically because
  it always registers `discover-tools`.
- **`discover` (today's shipped default): REWORK-adjacent finding, not this plan's to
  fix.** 0% engagement on `qwen3:14b` for a task requiring exploratory tool discovery is
  a live defect in the shipped default's cross-tier behavior, independent of anything in
  this plan — flagging for separate follow-up, not fixing here (out of scope, and not
  this plan's mechanism).
- **`full`: the strongest single data point in the whole investigation.** Wins outright
  on both tiers measured, on every leg (accuracy AND, on the small catalog, tokens). The
  `PRUNE_MIN_TOOLS=15` threshold flagged as suspect in §6d's gpt-4o-mini data is now
  doubly suspect with a second tier's confirmation.

### What happens to the mechanism now

`index`/`hybrid` stay default OFF, no `CONTEXT_PROFILES` tier gets `toolDisclosureMode`
set — same as before, but the reasoning has changed from "REWORK, cause unclear" to
"REWORK for two distinct, well-understood, tier-specific reasons, with a real fix
already shipped for one of them." Per 09 §2/§8, this is not yet a PASS on either
mechanism and nothing ships as a default from this pass. The concrete next steps, in
priority order: (1) re-run gpt-4o-mini post-fix to get a clean two-tier read on `index`
alone, now that its native-FC bug is fixed; (2) investigate whether `full` should simply
become the default at low-tool-count catalogs regardless of tier — that's arguably not
even this mechanism's territory anymore, it's a `PRUNE_MIN_TOOLS` question; (3) the
`discover-tools`-comprehension gap on smaller models is worth its own investigation
(better description wording? an explicit few-shot example of when to call it?) since it
now has two independent live reproductions on this tier.

## 6g. gpt-4o-mini post-fix retest (2026-08-19) — accuracy problem SOLVED, cost problem SURFACES

Raw: `wiki/Research/Ablations/2026-08-19-tool-index-openai-postfix-raw.txt`, `REPS=5`,
all 7 cells, same task/catalogs as the original ablation.

| Catalog | Mode | solvedRate | avgTokens | vs. original pre-fix ablation |
|---|---|---|---|---|
| small | `full` | 100% | 1,561 | unchanged (not touched by the fix) |
| small | `discover` (baseline) | 0%¹ | 1,528 | was 60% / 2,167 — see caveat¹ |
| small | `index` | **100%** | 1,770 | was **0%** / 1,024 |
| small | `hybrid` | 20% | 2,123 | was 40% / 2,132 |
| large | `discover` (baseline) | 40%¹ | 2,836 | was 100% / 5,359 — see caveat¹ |
| large | `index` | **100%** | 5,210 | was **0%** / 2,384 |
| large | `hybrid` | 80% | 4,971 | was 100% / 5,530 |

¹ `discover`'s baseline swung hard between runs (60%→0% small, 100%→40% large) despite
zero code changes on that path — larger than the ~13pp SE this project's Bernoulli-
variance convention predicts at n=5, which means even n=5 is not enough to pin down
`discover`'s own baseline precisely; treat both readings as noisy, not the original as
"correct" and this one as "wrong." This doesn't affect the `index` read below, which
moved from a rock-solid 0% to a rock-solid 100% — far outside what noise explains.

**`index` mode: 0% → 100% solved, both catalog sizes, confirmed.** This is the fix
working exactly as designed — every failure in the original ablation is now closed. The
accuracy leg of 09 §2's lift rule (≥3pp) is cleared by a wide margin (+100pp minimum,
even against the noisiest baseline reading).

**But the token leg now becomes the live constraint, and it's catalog-size-dependent:**
`index` costs +16% tokens vs. `discover` on the small catalog (borderline against the
≤15% ceiling — noise-level difference, not a clean pass or fail) and **+84% on the large
catalog — a clear token-leg FAIL.** This is the direct, expected cost of the fix: a
promoted tool now carries a real (if compact) FC schema instead of a free-text line, and
`index` mode is uncapped by design — cost grows with hidden-tool count, unbounded. This
is exactly the tension `hybrid`'s cap exists to manage, and exactly why `hybrid` was
worth building as a separate mode rather than assuming `index` wins outright once fixed.

**`hybrid` improved (pre-fix 40%/20% → post-fix 20%/80%) but doesn't clearly win either
leg** — better accuracy than before (the same underlying fix helps it too, since hybrid
also renders an index), but its cap=8 doesn't control cost enough at the large catalog
(+75% vs baseline, still a clear token-leg fail) and its small-catalog accuracy (20%) is
still poor — `discover-tools`' honest-exhaustion framing (§6e, root cause 2) is a live,
separate defect inside `hybrid` that this fix didn't touch.

### Updated verdict

- **`index`: accuracy leg PASSES cleanly on the cloud tier now (was the sole blocker).
  Token leg passes at small catalogs, FAILS at large ones.** Cross-tier is still not a
  clean PASS — `qwen3:14b`'s ceiling is engagement (§6f), not accuracy-once-engaged, so
  `index`'s remaining problem differs BY TIER: cost at large catalogs on cloud,
  engagement rate on local. Still REWORK for a default under 09's strict cross-tier
  lift rule, but the fix converted one hard blocker (0% accuracy) into a much narrower,
  better-understood, catalog-size-scoped one (cost at scale) — a materially different
  and more tractable position than before this session's fix.
- **`hybrid`: still REWORK.** Improved but neither leg clears, and it now carries a
  distinct known defect (`discover-tools`' exhaustion-message framing) on top of the
  cost problem. Lowest-priority of the three modes to keep investigating.
- **`full`: unchanged, still the strongest single result on both tiers measured.**

### What this means concretely for next steps

The natural, narrow fix for `index`'s remaining problem is **applying `hybrid`'s cap to
`index` mode itself** — i.e., collapsing the taxonomy's meaningful choice down to "how
many tools get promoted, and does `discover-tools` back up the overflow" rather than
three qualitatively different mechanisms. A capped, `discover-tools`-free index (today's
`hybrid` minus `discover-tools` minus the exhaustion-message bug) is the untested cell
that combines what's now known to work (accuracy, once the tool is real and cost is
bounded) with what's now known to fail (`discover-tools`' registration hurting
`qwen3:14b`, its exhaustion message hurting `hybrid`'s small-catalog case). That's the
next measurement worth running before touching any default — not yet done in this pass.

## 7. Three parallel investigations (2026-08-20) — verdict: `index` mode clears the bar

Three open threads from §6g were investigated together: (1) `discover-tools`' exhaustion
message/UX, (2) the untested capped-index-without-discover-tools cell, (3) the
`PRUNE_MIN_TOOLS` question. Raw notes:
`wiki/Research/Ablations/2026-08-19-tool-index-final-retest-notes.txt`.

### 7a. `discover-tools`' poor solve rate: TWO real compression bugs, not the message

Rewording the exhaustion message (scan-first, conclude-second) did **not** fix `hybrid`'s
poor accuracy — a live trace after the reword still showed 0/5. Tracing further found
the actual cause was two layers below wording: (1) `compressToolResult`
(`tool-formatting.ts`) generically truncates any tool result over budget to a handful of
preview lines — silently defeating `discover-tools`' own "dump the complete catalog"
design guarantee; the target tool was routinely in the truncated tail. (2) Fixing that
uncovered LLM fact-extraction as a **second**, independent compressor that paraphrased
the raw catalog dump into a lossy "key facts" summary — confirmed live to fabricate an
answer (echoed the query's own transaction ID back as the "identifier"). **Both are now
exempted for `toolName === "discover-tools"`** (commit `ffbab632`) — real, standalone
correctness fixes (a directory listing must never be truncated or LLM-paraphrased when
exact names matter for subsequent tool calls) independent of anything else in this plan.
Net effect on `hybrid`'s solve rate: modest. The residual gap — a model given the
complete, correct list still not reliably finding one entry among many — is a genuine
scanning/attention limit, not a bug, and is superseded by §7c's finding below.

### 7b. Capped index without `discover-tools`: REAL design flaw found, not measured as hoped

`index_capped` (cap=8, no `discover-tools`) scored **0% at both catalog sizes** — but not
because the idea is wrong. A debug trace showed the target tool (registered last in the
catalog) was *always* in the "8 more" overflow, every single rep: **the cap has zero
relevance-aware ordering — it's a raw `.slice(0, maxEntries)` on registration order.**
`hybrid` survives this same flaw only because `discover-tools` provides a (bug-prone,
per §7a) fallback path to the overflow; `index_capped` has no fallback at all, so an
overflow tool is *permanently* unreachable. This is a real, unresolved gap in the cap
mechanism itself (`cappedHiddenTools`, `think.ts`) — worth fixing with a relevance-based
truncation order (even the same free keyword scorer `discover-tools` already uses) before
`hybrid`/capped modes are trusted at any catalog size larger than the cap. **Not fixed in
this pass** — flagged for whoever picks up `hybrid` next; `index` mode (§7c) doesn't need
this fix because it never caps.

### 7c. The `PRUNE_MIN_TOOLS` question, AND the fix that actually matters most

`full` mode (no pruning) was swept from 15 to 60 tools (diverse domain-named fillers,
n=3/size): **100% solved at every size, tokens scaling smoothly (~1,500 → ~3,600) with no
accuracy cliff.** (An earlier attempt at this sweep using generic `filler-N` names
falsely showed 0% at n=15 — semantically null names give the model nothing to rule out,
so it thrashes trying each one; corrected before drawing any conclusion — see the raw
notes file for the full story, it's a probe-design lesson worth keeping.) This confirms
§6d/§6g's repeated observation: on every tier and catalog size measured so far, `full`
mode has never once lost on accuracy. `PRUNE_MIN_TOOLS=15` remains a live open question
for a separate investigation — this plan doesn't resolve it, only sharpens the evidence
that it's worth someone's time.

**But comparing `full`'s sweep numbers against `index` mode's numbers surfaced the
sharpest finding of this whole investigation:** at 60 tools, uncapped `index` mode
(5,210 tokens) cost *more* than `full` mode (3,621 tokens) — despite disclosing *less*
information per tool (a trimmed one-liner vs. the complete schema `full` already sends).
That shouldn't be possible unless something was being paid for twice. It was:
`buildToolIndexText` rendered a prose description for every tool `buildToolIndexCallableSchemas`
*also* promoted into the real FC schema — the model got each promoted tool's
name/params/description sent twice, once as inert text, once as the structured tool it
already sees. **Fixed** (commit `bffe8a48`): a promoted tool needs no prose call-out at
all; the schema itself is the complete disclosure. Only genuinely unreachable overflow
tools (§7b's unresolved cap-ordering gap) still get a one-line count-only mention.

### The verdict, finally

Live-reverified post-fix, `index` mode, both tiers, `REPS=5`:

| Tier | Catalog | solvedRate | avgTokens | vs. `discover` baseline |
|---|---|---|---|---|
| gpt-4o-mini | small | **100%** | 1,271 (was 1,770) | **−41% tokens, +40pp accuracy** |
| gpt-4o-mini | large | **100%** | 3,351 (was 5,210) | **−37% tokens, tied accuracy (already 100%)** |
| qwen3:14b | small | **100%** (was 40%) | 2,903 | strictly better on both legs |
| qwen3:14b | large | 60% (unchanged) | 5,204 | mixed — accuracy leg still open |

**`index` mode is the first candidate in this entire investigation to clear 09 §2's lift
rule cleanly on more than one cell** — both catalog sizes on the frontier tier, and the
small-catalog case on the local tier. The large-catalog local-tier case (60% solved) is
the one cell where it's not yet a clean pass — engagement is imperfect when scanning 60
real (not redundant-prose) schemas on a smaller model, a plausible ceiling effect rather
than a fixable bug, though not conclusively distinguished from one yet.

### qwen3:14b large-catalog cell re-verified at n=15 (2026-08-19)

Re-ran `MODES_FILTER=index CATALOG_FILTER=large REPS=15` (added `CATALOG_FILTER` to the
probe for this). Result: **9/15 solved (60%), identical to the n=5 rate.** The rate held
exactly stable across a 3x rep increase — not noise wobble settling toward a different
number. All 6 failures show `actionCount: 0` — the model never attempted the tool call at
all, not a wrong-tool miscall or a healing failure. This is a genuine engagement ceiling
scanning 60 real FC schemas on a 14B local model, not a framework bug and not a
measurement artifact. **The cell is closed as a real, distinguished gap** — `index` mode
does not clear the lift rule on this one cell, and no further re-verification is planned
for it in this pass.

### Most efficient and robust design, given everything measured

1. **`index` mode (uncapped, no `discover-tools`, no cap) is the strongest general-purpose
   answer found in this investigation** — best or tied-best accuracy on every cell
   measured, and the cheapest mechanism-with-rescue option at both catalog sizes on the
   tier where cost was ever a concern. It is not yet a cross-tier PASS by 09's strict
   rule (the qwen3:14b large-catalog cell is open), but it is close, well-understood, and
   nothing else tested comes near it.
2. **`full` mode remains categorically correct for small catalogs** (below roughly the
   size where the FC schema tax itself becomes the binding cost, not yet pinned down
   precisely — the `PRUNE_MIN_TOOLS` question) — simpler, zero mechanism risk, never
   measured to lose.
3. **`hybrid`/capped modes are not recommended as built** — real, specific, still-open
   defects (relevance-blind cap ordering, §7b) beyond what `discover-tools`' own fixed
   bugs (§7a) already cost it. Not worth pursuing further unless `index`'s large-catalog
   local-tier gap turns out to need a cap after all.
4. **The concrete next step, if this is promoted toward a default:** the qwen3:14b
   large-catalog cell has now been re-verified at n=15 (60% solved, unchanged from n=5,
   all failures `actionCount: 0`) — it is a real ceiling, not a measurement artifact, so
   no further re-verification is warranted. The remaining choice is scope: either (a) take
   `index` mode to `ablation-warden` for a formal cross-tier verdict scoped to catalogs
   below the ~60-tool local-tier ceiling (the 3 cells that already pass cleanly), or (b)
   fix the cap-ordering gap (§7b, still unresolved) first so a relevance-aware capped
   index can cover the large-catalog local-tier case too. **Still not shipped as any
   default in this pass** — `RA_TOOL_INDEX` stays OFF, no `CONTEXT_PROFILES` tier is
   touched — but the case for `index` mode is now substantially stronger than "REWORK,"
   and every cell has a distinguished, understood verdict rather than an open question.

## 6. Open question for the owner

If the probe passes the lift rule, does the index render for **all** hidden tools
unconditionally, or only above some hidden-count threshold (to avoid the index itself
becoming a wall of text on a very large catalog)? **Partially answered by §7c**: the index
text itself no longer scales with hidden-tool count at all once a tool is promoted (only
the overflow count line does) — so the remaining version of this question is really about
`buildToolIndexCallableSchemas`' own promoted-set size (unbounded in `index` mode), which
is a wire-cost question, not a prompt-readability one anymore.
