---
title: Tool-Calling Driver Redesign — One Signal, One Path
date: 2026-06-03
status: proposed
owner: tool-calling
related:
  - "[[Framework-Architecture-Index]]"
  - "[[2026-06-02-canonical-contracts-and-invariants]]"
  - "[[Native FC vs Text Parse]]"
tags: [design-spec, tool-calling, regression, kernel, drivers]
---

# Tool-Calling Driver Redesign — One Signal, One Path

> **Status:** PROPOSED — assess-first, no code yet (per user direction). Stage A
> kills a live regression; Stage B consolidates two parallel parsers into one.
> Every claim below is anchored to `main` @ commit `152b6e59` + the regressing
> commit `482c11e4`.

## 1. Why this exists

Two user reports, **one root cause**:

1. *"All agents are now fully regressing — they repeat themselves over and over
   and never call tools."* (the **loop** face)
2. The companion symptom: a model emits a tool call, but the harness renders the
   raw `<tool_call>` markup as if it were the final answer. (the **wrong-answer**
   face)

Both trace to a single structural defect introduced by `482c11e4`
("route non-native-FC models to text-parse so they can call tools"). That commit
fixed a real stall (a `toolCallDialect: "none"` model handed native `tools` the
provider ignores) but introduced a **wider** regression: every *uncalibrated*
Ollama model now silently loses the ability to call tools.

This is not a "make it better" redesign in search of a problem. It is a verified
regression fix (Stage A) that the canonical principles then let us pay down
properly (Stage B) instead of bolting on a third patch.

## 2. Root cause (verified by trace)

The harness has **two selectors keyed on two different signals**, and they
diverge for exactly one class of model.

| Concern | Decided by | Signal | File:line |
|---|---|---|---|
| Is a `ToolCallResolver` injected? | `caps.supportsToolCalling` | **provider claim** | `runner.ts:120-131` |
| Which `ToolCallingDriver` mode? | `calibration?.toolCallDialect` | **calibration** | `runner.ts:177-179` → `select-driver.ts:24` |
| Are native `tools` attached to the stream? | `driver.mode !== "text-parse"` | derived from driver | `think.ts:503` |

### The divergence

For a **capable-but-uncalibrated** model these disagree:

- `caps.supportsToolCalling === true` → resolver = `NativeFCStrategy` is injected.
- `calibration?.toolCallDialect === undefined` → driver = `TextParseDriver`
  (`mode: "text-parse"`).

This is **guaranteed**, not occasional, for Ollama: `local.ts:951` hardcodes
`supportsToolCalling: true` for *every* Ollama model unconditionally. So any
Ollama model not in the static calibration table (`capability.ts`) lands in the
divergent state. That is why *all* agents regressed, not one.

### How the divergence produces both symptoms

1. `think.ts:503` — because `mode === "text-parse"`, **no native `tools` are sent**
   to the provider. (Comment: constrained providers force FC when tools are
   present, which breaks text-parse.)
2. `think.ts:399-458` — `TextParseDriver.buildPromptInstructions` injects the
   `<tool_call>` XML format into the system prompt. The model dutifully emits
   that XML as **text** (`accumulatedContent`), with `accumulatedToolCalls`
   empty (no native FC events, because no tools were sent).
3. `think.ts:852` — `if (input.toolCallResolver)` is **true** (the
   `NativeFCStrategy` was injected at step 0). The resolver branch runs and
   **returns** before control can reach the act phase.
4. `NativeFCStrategy.extractWithDialect` (`native-fc-strategy.ts:32-88`) only
   recognizes: native FC events (none here), **fenced-JSON** `{"name":…}`, and
   **pseudo-code** `tool-name(args)`. It does **not** recognize the `<tool_call>`
   XML that `TextParseDriver` just instructed. So it classifies the content as:
   - `final_answer` when `stopReason ∈ {end_turn, stop}` and content is non-empty
     → `think.ts:965` assembles the **XML as the answer** → *wrong-answer face*.
   - `thinking` otherwise → `think.ts:1014→1148` returns with a nudge, the loop
     repeats, the model re-emits the same XML → *loop face*.
5. `act.ts:162-164` — the format's correct parser (`TextParseDriver.extractCalls`,
   Tier-1 regex matches `<tool_call>` exactly) is wired but **unreachable**, for
   **two** compounding reasons (see the deeper finding below).

> **Deeper finding (verified 2026-06-03) — text-parse was never a live path.**
> The kernel runs `handleActing` ONLY when `state.status === "acting"`
> (`react-kernel.ts:70`). But think.ts sets `status: "acting"` in only **two**
> places — `think.ts:952` and `think.ts:1198` — **both native-FC**. There is
> **no** think.ts transition that detects text-parse `<tool_call>` markup and
> moves to "acting". Independently: **no calibration path ever produces the
> `"text-parse"` dialect** — `calibration-runner.ts:313` emits `"none"`,
> `capability.ts` emits `"native-fc"`; `"text-parse"` is only a schema literal
> (`calibration.ts:70`). So before `482c11e4`, *every* model
> (uncalibrated / `"none"` / `"native-fc"`) routed to `NativeFCDriver`, and
> `TextParseDriver` + the `act.ts:162` branch were **dead code that never ran in
> production**.
>
> `482c11e4` routed uncalibrated/`"none"` models into text-parse mode **for the
> first time**, activating a half-built path: it suppresses native tools
> (`think.ts:503`) and injects `<tool_call>` instructions, but think.ts has no
> transition to consume that markup. The resolver-shadow (steps 3-4) and the
> missing think→acting transition are *both* present; even removing the resolver
> would not make text-parse work without completing the think.ts wiring.
>
> **This reframes the §4 decision.** Direction A (capability→native) *restores
> the only path that was ever wired end-to-end* — minimal, low-risk. Direction B
> (uncalibrated→text-parse) is **not** a flag-flip: it requires *completing the
> abandoned text-parse migration* (a new think.ts markup-detection → acting
> transition). The "orphaned extractCalls" framing was wrong about the
> mechanism, but right about the conclusion: the driver migration was never
> finished.

### What `482c11e4` actually changed

Before the commit (`git show 482c11e4 -- runner.ts`): uncalibrated/`"none"` →
`NativeFCDriver` (mode `native-fc`) → tools attached → resolver path consumed
native FC events. This *worked* for models that genuinely support native FC, and
*stalled* for `"none"` models (the bug the commit targeted).

After the commit: uncalibrated/`"none"`/`"text-parse"` → `TextParseDriver`. The
commit moved the **driver** key from native to text-parse but left the
**resolver** key (`runner.ts:126`) untouched. The two selectors, previously
accidentally aligned for uncalibrated models, now diverge — trading a rare break
(`"none"`-calibrated, uncommon) for a universal one (every uncalibrated Ollama
model, common).

## 3. Design principles this must honor

From [[2026-06-02-canonical-contracts-and-invariants]] and the project memory
spine:

- **Single source of truth** — resolver-presence, driver-mode, and tools-attach
  must derive from **one** signal, not two. The bug *is* the second signal.
- **Source-tagged provenance** — surface the observed parse mode / dialect on
  `state.meta` (mirroring `lastDialectObserved`) so a wrong route is *visible* in
  telemetry, not silent.
- **Fail-loud, not silent** — a 0-call iteration in a tool-required task should
  emit a load-bearing signal (`emitLoadBearingFailure`), not silently nudge-loop.
  This is a **net**, not the fix (§7).
- **§4.4 — no surface without a live consumer same-commit.** `extractCalls` /
  `formatToolResult` already have consumers (`act.ts`); the consolidation must
  not leave a new orphan behind.
- **No metric-gaming.** Stage B retires genuine duplication; it does not delete a
  working path to hit a "one parser" count.

## 4. The fix shape

The structural fix: **resolver-presence, driver-mode, and tools-attach must all
derive from one signal**, so that whatever route is chosen, the format the model
is *instructed* to emit is the format the harness *extracts*.

### The decision the redesign must NAME (and settle empirically, not by argument)

When the two signals diverge (capable + uncalibrated), align which way?

- **Direction A — capability is master.** Capable → native: inject resolver,
  `native-fc` driver, attach tools. Calibration *refines within* native (which
  dialect tier), it does not *downgrade*. Text-parse is reserved for
  `supportsToolCalling === false`. Restores pre-`482c11e4` behavior; keeps the
  pseudo-code/fenced-JSON fallback cogito relies on.
- **Direction B — calibration is master.** Uncalibrated → text-parse: no
  resolver, `act.ts:164` extractCalls runs. Preserves `482c11e4`'s intent.

> **DECIDED (2026-06-03): settle by spot-test, no prior.** The Stage-A selector
> is built policy-switchable (`capability-first` vs `calibration-first`); run
> gemma4:e4b under both, plus a native-FC model under the winner; whichever
> passes (0-call → success AND native model still calls tools) is locked, the
> loser removed. No pre-commitment to A or B.

Either direction kills the regression, because either makes instruct≡extract on
one path and removes the shadowing branch for that path. The doc does not need
the answer to be written; Stage A produces it.

## 5. Staging

### Stage A — Regression kill (small, gated, ships first)

**Goal:** the divergent state cannot occur. resolver-presence, driver-mode, and
tools-attach derive from one signal.

The unifying invariant:
**`injectResolver ⟺ driverMode === "native-fc" ⟺ attachTools`** — the three move
together, keyed on **one** signal.

**The §4 bake-off collapsed (advisor reconcile, 2026-06-03).** Because Ollama's
capability claim is always `true` (`local.ts:951`), "calibration-first as a
locked rule" = undefined→text-parse + "none"→text-parse = **exactly 482c11e4 =
the regression**. It is *provably* the bug, not a candidate. And text-parse is a
half-built path (no think→acting transition). So there is no two-finished-option
experiment: **capability-first-today is the only non-regressing Stage A.** The
env policy-switch is dropped — shipping a flag whose other position is the known
regression earns nothing.

**The one open empirical question** is narrow: *does native mode actually work
for an uncalibrated model like gemma4:e4b?* The baseline only showed gemma's
**forced-text-parse** behavior. Route uncalibrated→native (tools attached,
resolver present, **no** text-parse instructions) and run gemma4:e4b:
- **Passes** (native FC events, or the resolver's fenced-JSON/pseudo-code
  fallback catches it) → capability-first is Stage A. Done.
- gemma emits `<tool_call>` XML *even under native* → native insufficient →
  Stage A must also complete the text-parse think→acting transition. Escalate.

The change set:

- `selectToolCallingDriver` keys on `caps.supportsToolCalling` (capability is
  master): native unless the provider genuinely reports `false`. Calibration
  `"native-fc"` *confirms*; its absence does **not** downgrade a capable model to
  the never-completed text-parse path. This makes the driver coherent with the
  resolver (already keyed on `supportsToolCalling`, `runner.ts:126`) and the
  tools-attach (`think.ts:503`). Three call sites, now one signal.
- `think.ts:852`'s resolver branch is reached only in native mode — guaranteed by
  the invariant (resolver present ⟺ native).
- **`"none"`-class models** (genuinely no native FC) regress to their *original*
  pre-482c11e4 stall — **net-neutral**, since 482c11e4's text-parse "fix" never
  executed (text-parse was dead). Documented broken-until-Stage-B; not a Stage-A
  blocker.

**Gates (all must hold before Stage A merges):**
1. Spot-test repro flips: gemma4:e4b 0-call loop → tool call executed → success.
2. A native-FC model (e.g. a calibrated `native-fc` Ollama model, or a cloud
   provider) still calls tools — no downgrade regression.
3. Cross-tier **N=3** (local text-parse + mid + a cloud native run), zero
   regression vs the pre-`482c11e4` baseline on the standard probe set.
4. `tools` + `reasoning` + `runtime` suites green; reasoning typecheck clean.

**Scope guard:** Stage A is *routing alignment only*. The fail-loud net (§7) is
secondary and must not inflate Stage A.

### Stage B — Consolidation (follows Stage A, separate review)

Once routing is coherent, retire the genuine duplication: two parsers with
different format vocabularies.

- `tool-calling/resolver.ts` is the **older** abstraction; it throws when
  `!supportsToolCalling` and its `StructuredOutputStrategy` was never built
  ("Task 12b", `resolver.ts:9-10`). `drivers/` is the **newer** abstraction
  (interface → `NativeFCDriver` → `TextParseDriver` 3-tier).
- **Direction:** complete the abandoned driver migration. Fold
  `NativeFCStrategy`'s text fallbacks (fenced-JSON, pseudo-code, shape-match)
  into a single driver surface so there is one `extractCalls` per mode, and
  retire the resolver indirection. One selection function fuses capability +
  calibration (the Stage-A triple becomes the canonical entry point).
- **Driver stays pure extraction.** Classification (final-answer vs thinking vs
  tool-call) stays in `think.ts`, which already owns `hasFinalAnswer` /
  `extractFinalAnswer` (`tool-parsing.ts`). Do **not** bolt a `_tag` discriminator
  onto the driver — that would re-create the resolver's classify-inside-parse
  coupling we are removing.
- Surface `parseMode` / `confidence` on `state.meta` (like `lastDialectObserved`)
  so the chosen tier is observable.
- **Capability honesty (DECIDED 2026-06-03: yes, Stage B) — COUPLED with
  text-parse completion.** Narrow Ollama's blanket `supportsToolCalling: true`
  (`local.ts:951`) to a per-model probe of `/api/show` `tools` capability. When
  capability stops lying, a `"none"`-class model reports `false` → routes to
  text-parse **by capability**, collapsing the two signals into one at the source
  — the truest "single source of truth." **CRITICAL coupling:** capability-honesty
  MUST land *together with* building the **text-parse think→acting transition**
  (a new path in think.ts that detects `<tool_call>` markup → sets
  `pendingNativeToolCalls` + `status:"acting"`, mirroring the native-FC path so
  `act.ts:164` finally executes). Without it, capability-honesty would route
  `"none"`-class models (e.g. cogito) into the *still-dead* text-parse path —
  trading one cogito break for another. The driver stays pure extraction;
  think.ts owns the classification (advisor directive 3).

**Gate:** Stage B is behavior-preserving over Stage A's passing gate set. No new
orphan surface (§4.4). The pseudo-code/fenced-JSON fallbacks that cogito relies
on must survive the fold (regression-guarded).

## 6. Reframing "performance"

The user's ask named "performant." The payoff here is **reliability and task
success**, not parse-CPU efficiency. A model that can't call a tool fails the
task 100% of the time regardless of how fast the parser runs. The metric that
moves is *tool-call success rate on uncalibrated models* (currently ~0 for
uncalibrated Ollama), measured by the cross-tier probe set — not microseconds in
the regex.

## 7. Fail-loud net (secondary)

Independent of routing: a tool-required task that produces 0 tool calls for an
iteration is currently absorbed by the nudge loop. After Stage A, add a
`emitLoadBearingFailure` (or `reprompt` ParseMode escalation) when N consecutive
iterations yield 0 parsed calls despite reachable required tools. This catches
*future* instruct≢extract drift loudly instead of via a user bug report. It is a
safety net, not the regression fix — keep it out of Stage A's critical path.

## 8. Ownership routing (team-ownership pilot, active → 2026-06-15)

| Edit surface | Warden | Notes |
|---|---|---|
| `packages/reasoning/src/kernel/**` (think.ts, runner.ts, act.ts) | `kernel-warden` | MissionBrief in / UpwardReport out |
| `packages/tools/src/drivers/**`, `tool-calling/**` | `tools-warden` | the selection-function fusion + Stage-B fold |
| `packages/runtime/**` wiring (if touched) | `runtime-warden` | only if caps→input plumbing changes |
| Cross-tier ablation verdict (default-on routing) | `ablation-warden` | Stage-A gate #3 |

`482c11e4` was a direct worktree fix under explicit pilot override; the redesign
returns to warden-routed edits.

## 9. Decisions (2026-06-03 review)

1. **§4 direction** — **settle by spot-test, no prior.** Selector built
   policy-switchable; gemma4:e4b run under both, winner locked.
2. **Ollama capability honesty** — **yes, Stage B.** Narrow `local.ts:951` to a
   per-model `/api/show` probe (see §5 Stage B).
3. **Stage A branch** — `fix/text-parse-bare-toolcall` off `main` @ `152b6e59`.
4. **PR #183** (P1/P2/P2b/S11) is independent of this fix — merge decision
   unaffected.

## 10. Validation artifacts (to produce)

- Spot-test transcripts: gemma4:e4b before/after (0-call → success).
- `wiki/Research/Harness-Reports/2026-06-03-tool-calling-routing-n3.md` —
  cross-tier N=3 evidence for the Stage-A gate.
- Driver-selection contract test updated to assert the coherent triple (not the
  two independent decisions).
