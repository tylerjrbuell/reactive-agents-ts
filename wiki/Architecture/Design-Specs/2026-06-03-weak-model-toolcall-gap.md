---
title: The Weak-Model Tool-Call Gap — Definition + Canonical Cross-Tier Design
date: 2026-06-03
status: investigation + proposed design (measurement phase pending)
owner: tool-calling
related:
  - "[[2026-06-03-tool-calling-driver-redesign]]"
  - "[[2026-06-03-tool-calling-routing-n3]]"
tags: [design-spec, tool-calling, reliability, cross-tier, weak-models, root-cause]
---

# The Weak-Model Tool-Call Gap

> Goal (user, 2026-06-03): *"get to the true root… define it absolutely… understand
> the real gap that cogito and possibly other weaker models struggle with, so we
> can design a canonical system that works well for all tiers."* "If we nail tools
> and tool-calling this is a huge win for the framework."

## 1. The gap, defined absolutely

**A model can decide the correct tool call and still fail to *emit* it.** Below
some capability threshold, on non-trivial tasks, weak models intermittently
produce the tool-call *intent as text* (a rationale or prose: tool name + args)
but never emit the structured native function-call event. The harness listens
only for native FC events (or a narrow set of text fallbacks), discards the
text-borne intent, nudges, and the model re-emits the same intent — looping to
max-iterations with zero tool calls.

For this failure mode the right answer is formed but lands in the wrong channel
(text, not the FC channel the harness reads) — an **emission/transcription
failure**, distinct from a decision failure.

> **Honesty: there are (at least) TWO candidate failure modes, mix unmeasured.**
> (a) **No-emission / rationale-as-substitute** — the run-7 evidence below
> (memory off and on). (b) **Meta-tool flailing** — in memory-ON batches cogito
> repeatedly called `find`/`pulse`/`discover-tools` instead of the task tool;
> that IS a wrong-tool-calling failure, not emission. A single clean memory-off
> probe never drifted to `find`, so (b) appears coupled to memory/recall context
> — but its frequency relative to (a) is **not measured** (§5). This doc does not
> assert a single root; it characterizes (a) sharply because we captured it, and
> flags (b) as a second mode to quantify.

### Primary evidence (cogito:14b, github/list_commits task, memory on)

A failing run emitted a rationale on every one of its 11 iterations; each
contained the full call:

```
<rationale call="1">To fetch the latest commits, I'll use github/list_commits
  with owner 'tylerjrbuell', repo 'reactive-agents-ts', perPage set to 15…</rationale>
<rationale call="1">{"why":"Use github/list_commits with perPage=15 for owner
  'tylerjrbuell' and repo 'reactive-agents-ts' to retrieve the 15 most recent
  commits.","confidence":0.9}</rationale>
…(9 more, same intent)…
```

Tool name ✓, args ✓ (owner/repo/perPage), confidence ✓ — **everything needed to
execute is present in the text.** No native `tool_use` event was ever emitted.
Result: `success:false`, `terminatedBy:max_iterations`, `toolCalls:[]`,
~9.7k tokens burned. The intent was **fully recoverable** and was thrown away.

### Why "text instead of native FC" matters structurally

The harness has exactly two emission channels and listens to them unequally:
- **Native FC events** → `think.ts:852` resolver path → executed.
- **Text content** → mined only by `NativeFCStrategy`'s narrow fallbacks
  (fenced-JSON, pseudo-code inside code blocks). A `<rationale>` block, or prose
  like "I'll use github/list_commits with owner…", matches **neither** → dropped.

So the model's most natural failure mode (narrate the call in prose) is exactly
the one the harness cannot recover. This is the **same root** as the routing
regression ([[2026-06-03-tool-calling-driver-redesign]]) seen from the other
side: the framework lacks **one robust tool-call capture that handles native FC
AND text-described intent**.

## 2. What is NOT the root (ruled out by controlled probes)

Measured on clean substrates (memory off unless noted), cogito:14b:

| Hypothesis | Test | Result | Verdict |
|---|---|---|---|
| Memory-on causes it | file-write, memory on | **5/5** | Memory alone is not it (on a trivial task) |
| A competing generic tool (`find`) steals the call | github-ish task, specific-only vs +generic, memory off | generic **never** called; specific-only no better | Tool-competition (memory-off) ruled out — but `find`-drift DID appear memory-ON (mode b) |
| The Ollama tools regression | (fixed Stage A `11996c5a`) | gemma 0→success N=3 | Separate, already fixed |

> **NOT ruled out — the rationale instruction.** We did NOT establish "rationale
> framing is not the cause." file-write was 6/6 with rationale-*on* but we never
> ran file-write rationale-*off*, and run-7's failure is *literally* the model
> emitting `<rationale>…</rationale>` and stopping — i.e. told "emit a rationale
> block before every tool call," it emits the block and treats that as compliance.
> That implicates the instruction. We cannot *rank* framings at this N (variance
> void, below), but the captured failure points at the instruction, not away from
> it. **Unresolved** — and a reason the structured-carrier design (§3.2) is
> attractive: it removes the separate prose step the model stops on.

**Critical measurement caveat — variance dominates small-N.** The same cogito
config on the github task swung 1/6 → 4/4 → 12/12 across batches. Any ranking of
prompt-framing arms from N≤12 is **statistically void** (this already produced one
false reading: "soft framing 0/5 catastrophic" was a memory/cold-start artifact,
since retracted). Quantifying *rates* requires N≥20 per cell (see §5). The
qualitative gap in §1, however, is established by the captured emission — it does
not depend on rate estimates.

## 3. The canonical design — one tool-call capture, all tiers

**Insight that makes it elegant:** weak models *reliably* emit the rationale —
that IS the failure (they emit *only* it). So treat the text channel as a
first-class source of tool calls, not a fallback afterthought.

```
            ┌─────────────────────────── one capture surface ──────────────────────────┐
  model →   │  native FC events?  ──yes──▶ structured calls                              │
            │        │no                                                                 │
            │        ▼                                                                    │
            │  text contains tool-intent? (fenced-JSON · pseudo-code · <rationale> ·     │
            │     "use <tool> with <args>")  ──yes──▶ extract → structured calls         │
            │        │no                                                                 │
            │        ▼                                                                    │
            │  no call this turn → classify (thinking / final-answer) as today           │
            └────────────────────────────────────────────────────────────────────────────┘
```

- **Strong tiers** emit native FC → caught as today. Zero change, zero overhead.
- **Weak tiers** that emit a structured call-carrier → read its fields → execute.
- The captured intent is **source-tagged** (`parseMode: native-fc | fenced-json |
  pseudo-code | structured-carrier | …`) on `state.meta`, so a tier silently
  relying on recovery is *visible* in telemetry, not hidden.

### ⚠️ Safety boundary — read STRUCTURE, not prose

The tempting reading of run-7 is "parse the call out of the rationale text." **Do
not build that as default-on.** The run-7 intents live inside a free-text `why`
string (`{"why":"Use github/list_commits with perPage=15 for owner 'tylerjrbuell'…"}`)
— recovering them means NL-parsing prose into an executable action, which is right
~90% of the time and catastrophic on the rest:
- negation — "I should NOT use delete-file, instead list-files" → fires delete-file
- alternatives — "use list_commits or maybe search" → which fires?
- past tense — "earlier I called list_commits" → re-fires
- multi-call plans narrated in one rationale → fires all, mis-ordered

And the framework's own prompt declares the rationale **non-binding** ("NOT passed
to the tool, does NOT change behavior"). Making non-binding commentary executable
— for tools that may be **outward-facing** (the original trigger was
`signal/send_message_to_user`) — is a real hazard. The existing resolver mines
*fenced JSON / pseudo-code* (syntactically unambiguous); prose-mining is a
different, riskier safety surface.

**Therefore the canonical path reads structure, never prose:**

### Design dimensions to settle (NOT pre-decided here)

1. **▶ PREFERRED — Structured carrier (make-invalid-unrepresentable, the
   [[Deliverable]] theme).** Since weak models *reliably* emit the rationale,
   change WHAT they emit: a single structured block carrying `tool` + `args` as
   real fields (e.g. `<tool_call>{"tool":"…","args":{…},"why":"…"}</tool_call>`),
   parsed by reading fields — never by NL-parsing a prose string. Emitting the
   block IS emitting the call; there is no separate prose step to stop on (which
   also addresses the rationale-as-substitute mode, §2). Recovery executes only
   when it can read an unambiguous `{tool, args}`; anything less → no call, nudge.
   This folds the parked "better rationale design" INTO the solution.
2. **Forcing (complement, not substitute).** When no structured call is readable,
   re-prompt with a forcing function ("emit the function call now, not a
   description") rather than guessing from prose. Cleaner provenance; depends on
   the model complying on retry.
3. **✗ Prose-mining (rejected as default-on).** NL-extracting tool+args from
   free-text rationale/prose. Only viable behind a confidence gate + a
   side-effect-free allowlist, if at all — and never for outward-facing tools.
   Listed for completeness; not the recommended path.

This generalizes the **Stage-B text-parse think→acting transition** from
[[2026-06-03-tool-calling-driver-redesign]] — one capture path for all tiers, but
keyed on structured emission, not prose recovery.

## 4. Cross-tier framing

The gap is a **capability gradient**, not a binary. Define tiers by *emission
reliability*, measured:
- **frontier/large**: native FC ~always → no recovery needed.
- **mid**: mostly native, occasional text-intent → recovery as safety net.
- **local/weak** (cogito:14b, small Ollama models): native FC is *stochastic* →
  recovery is load-bearing.

A canonical system serves all by making recovery **always-on but zero-cost when
unused** (it only fires when native FC is absent AND text-intent is present). No
tier is downgraded; weak tiers are caught.

## 5. Measurement plan (do this BEFORE building, to quantify + later to prove)

Small-N is void (§2). Build a proper probe matrix and run N≥20/cell:

- **Factors:** model {cogito:14b, +1 other weak local, +1 mid, +1 frontier} ×
  task {trivial (file-write), non-trivial (fetch+list), multi-tool} ×
  memory {off, on} × tool-name {flat, namespaced}.
- **Per cell, record:** tool-call success rate, `calls:[]` rate, and — for failures
  — whether the emitted text *contained extractable intent* (the recoverability
  rate, which sizes the prize).
- **Fresh Ollama + cleared `~/.reactive-agents`** per run (memory contamination is
  real — it produced the false `find`-drift reading).
- **Harness, not bash loops** — the ad-hoc loops here cannot sustain N≥20 cleanly.
  Reuse the cross-tier bench / `pass^k` infrastructure.
- **Decision gate:** recoverability rate sizes the win. If failures are
  overwhelmingly recoverable-from-text (the run-7 evidence suggests yes), the
  capture design pays off big; if failures are empty/no-intent, forcing/re-prompt
  is the lever instead.

## 6. Relationship to shipped work

- **Stage A (`11996c5a`, shipped):** capability-first routing — capable models get
  native FC. Necessary precondition (without it, uncalibrated models never even
  reach native mode). This gap is the *next* layer: even in native mode, weak
  models intermittently don't emit.
- **Stage B (this design):** the unified capture/recovery surface. Supersedes the
  earlier narrow "complete the text-parse think→acting transition" framing —
  same mechanism, now justified by the recoverability evidence and scoped
  cross-tier.

## 7. Open decisions for the user

1. **Safety (§3).** Confirm the canonical path reads **structured carriers**, not
   prose. Prose-mining of rationale is rejected as default-on (negation /
   alternatives / past-tense / multi-call hazards; non-binding-commentary →
   executable; outward-facing tools). Agree?
2. **Measurement-first?** Approve the §5 matrix (quantify rate + recoverability +
   the mode-(a)/mode-(b) mix) before building — or build the structured-carrier
   path on the run-7 qualitative evidence and measure after?
3. **Scope.** cogito-first (local only, doable here now), or stand up the full
   cross-tier matrix (needs cloud keys, absent in this env)?
4. The rationale-instruction question is **unresolved** (§2), now folded into the
   structured-carrier design rather than tuned in isolation. OK to leave the prose
   framing untouched until the carrier design lands?
