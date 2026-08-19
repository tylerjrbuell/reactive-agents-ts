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

## 6. Open question for the owner

If the probe passes the lift rule, does the index render for **all** hidden tools
unconditionally, or only above some hidden-count threshold (to avoid the index itself
becoming a wall of text on a very large catalog)? Not resolved here — worth deciding once
real hidden-tool-count distributions are visible from the probe's own runs.
