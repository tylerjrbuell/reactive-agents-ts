---
tags: [evidence, event-coverage, q1c]
date: 2026-05-23
campaign-step: 2
answers: Q1c (RI vs Compose event coverage diff)
companion: architecture-drift-analysis-2026-05-23.md, capability-mapping-2026-05-23.md
---

# Event Coverage Diff — RI Dispatcher vs Compose Pipeline

## Headline result

The drift analysis assumed RI and Compose are **parallel intervention substrates**. They are NOT — they're **complementary substrates with different surface shapes**:

- **RI dispatcher = async pub-sub decider.** Subscribes to `AgentEvent` stream on `EventBus`. Evaluates kernel state. Emits typed `ControllerDecision`. The state in kernel reads via `reactive-observer.ts`.
- **Compose pipeline = synchronous content transformer.** Kernel-internal `pipeline.transform(tag, value, ctx)` calls at hard-coded chokepoints. Registered transforms reshape outgoing content in place.

**Different stages of the loop, different shapes of intervention, near-zero overlap in event coverage today.**

This reverses one of the drift analysis's premises: "Two parallel intervention systems." Not true. Closer reading required.

## RI decision surface

13 typed `ControllerDecision` shapes (`packages/reactive-intelligence/src/types.ts:169-182`):

```
early-stop | compress | switch-strategy | temp-adjust | skill-activate
prompt-switch | tool-inject | tool-failure-redirect | memory-boost
skill-reinject | human-escalate | stall-detect | harness-harm
```

Trigger surface: `AgentEvent` stream via `EventBus`, primarily `EntropyScored`. Lifecycle: subscriber runs evaluators → produces decisions → dispatcher applies suppression gates (entropy-floor, iter-floor, max-fires, token-budget) → handler enacts.

## Compose pipeline surface

7 typed tags (`packages/core/src/services/harness-types.ts:92-100`):

```
prompt.system | nudge.loop-detected | nudge.healing-failure
message.tool-result | observation.tool-result | lifecycle.failure
control.strategy-evaluated
```

Trigger surface: in-kernel `pipeline.transform(tag, defaultValue, ctx)` calls. **Empirically only 3 of 7 are wired today:**

| Tag | Site | Status |
|---|---|---|
| `prompt.system` | `kernel/capabilities/reason/think.ts:359` | ✅ live |
| `nudge.loop-detected` | `kernel/capabilities/reason/think.ts:393` | ✅ live |
| `message.tool-result` | `kernel/capabilities/act/act.ts:1069` | ✅ live |
| `nudge.healing-failure` | none | ⚠️ registered, no emit |
| `observation.tool-result` | none | ⚠️ registered, no emit |
| `lifecycle.failure` | none | ⚠️ registered, no emit |
| `control.strategy-evaluated` | none | ⚠️ registered, no emit |

Confirmed by project memory: *"Wave C — 2 new live chokepoints; 2 v0.12 deferred chokepoints (registrations compile but transforms are pass-through)."* 4 of 7 tags are scaffolded but never fired.

## Coverage matrix

| Concern | RI handles? | Compose handles? |
|---|---|---|
| Detect convergence, fire early-stop | ✅ via entropy evaluator | ❌ no signal |
| Detect divergence, switch strategy | ✅ `switch-strategy` decision | ⚠️ `control.strategy-evaluated` tag registered, never emitted |
| Detect tool failure streak, redirect | ✅ `tool-failure-redirect` decision | ❌ no signal |
| Skill activation by entropy match | ✅ `skill-activate` decision | ❌ no signal |
| Compress context under pressure | ✅ `compress` decision | ❌ no signal |
| Inject required tool when missing | ✅ `tool-inject` decision | ❌ no signal |
| Reshape system prompt at injection | ❌ no surface | ✅ `prompt.system` transform |
| Reshape loop-detected nudge text | ❌ no surface | ✅ `nudge.loop-detected` transform |
| Reshape tool-result message before append | ❌ no surface | ✅ `message.tool-result` transform |
| Reshape healing failure text | ❌ no surface | ⚠️ `nudge.healing-failure` registered, no emit |
| Reshape observation step | ❌ no surface | ⚠️ `observation.tool-result` registered, no emit |
| React to lifecycle failure events | partial (telemetry) | ⚠️ `lifecycle.failure` registered, no emit |
| Adjust temperature mid-loop | ✅ `temp-adjust` decision | ❌ no surface |
| Human-escalate on exhausted decisions | ✅ `human-escalate` decision | ❌ no surface |

## Q1c Answer

**Overlap surface: ~zero.** RI decides *what to do given state*. Compose reshapes *content at well-defined emit points*. The conceptual conflict named in the drift analysis was based on a false assumption — they don't compete, they don't coordinate either.

**But the absence of coordination IS the gap.** Concrete examples:

1. RI fires `switch-strategy` (decision) → kernel switches strategy. No `control.strategy-evaluated` tag emission. Compose users registering on that tag never see the event. The tag is registered but dead.

2. Plan-execute injects synthetic tool steps for required-tool deficits (capability-mapping L255-307). RI has `tool-inject` decision. **Same concern, two implementations**, no shared surface.

3. Healing pipeline (M4) emits failure messages. `nudge.healing-failure` tag exists. No emit point connects them. Healing fires the message, the tag is unused.

4. Verifier rejects output (terminal). No `lifecycle.failure` emission. The tag is dead.

## Reframed Call 1

The drift analysis's Call 1 ("Compose subsume RI? Dual? Invert?") had the wrong frame. Right framing:

**"Should RI decisions be re-emitted as Compose tag events, so the two systems share a single observation surface?"**

Concretely:

- RI evaluator decides `switch-strategy` → kernel ALSO emits `pipeline.transform('control.strategy-evaluated', ..., ctx)` → registered transforms can observe / override / log.
- Healing fires failure → kernel ALSO emits `pipeline.transform('nudge.healing-failure', message, ctx)` → transforms reshape.
- Verifier rejects → kernel ALSO emits `pipeline.transform('lifecycle.failure', verdict, ctx)` → transforms decide whether to log, retry, surface.

**Not subsumption. Bridge.** RI keeps deciding. Compose becomes the universal observation+override surface for those decisions plus content emit points. The 4 dead tags (`lifecycle.failure`, `control.strategy-evaluated`, `nudge.healing-failure`, `observation.tool-result`) light up when RI/healing/verifier emit on them.

**Cost:** ~4 new `pipeline.transform()` call sites at known emission points. ~30 LOC. Closes the dead-tag scaffold gap. Makes RI decisions externally hookable without touching RI internals.

**Benefit:** Compose API tagline ("don't config, compose") becomes empirically true beyond 3 tags. RI keeps internal decision logic. Two substrates → one surface.

## Effect on Q1a/Q1b

Q1a ("does RI fire ≥10% of iter?") and Q1b ("Δ-success when RI fires?") still need real runs. Step 6 (RI ablation on failure-corpus) is unchanged in scope.

But the **decision threshold** in the campaign spec needs updating:

- Original: ">30% fire + ≥5pp Δ → dual substrate justified."
- Revised: "**Any positive Δ → bridge** (RI keeps deciding, Compose tags become emission surface for decisions). RI substrate isn't subsumed — its decision logic is preserved as deciders; Compose becomes universal hookable observation."
- If Q1b shows Δ ≤ 0 (RI hurts when it fires) → **revisit RI decision logic per evaluator**, not subsume RI substrate.

This is more conservative than the drift analysis's "subsume" candidate. Better matches the substrate reality.

## What it does NOT change

- RI's entropy-threshold suppression gates (F3) are still wrong on local tier — that's a calibration bug, not a substrate question.
- 4 of 7 Compose tags being dead is still real drift — they're scaffold without callers.
- Plan-execute's synthetic kernel-state adapter (L662) is still a substrate-mismatch smell. RI's contract is kernel-shaped, but plan-execute outer-loop needs to translate. Bridge fix would route through Compose tags instead.

## Step 2 done. Steps 3–7 require real runs.

Suggested next: kick step 3 (5-task × 4-strategy quality matrix on qwen3:14b, ~30 min) — answers Q2b which directly grades the algorithmic-divergence finding from Step 1.

Tasks to add: step 6 RI ablation matters most for Q1a/b (Compose-vs-RI policy now reframed to bridge, but still needs Δ-success signal).

Steps 4 + 5 (learning) require multi-session memory persistence working — confirm M6 SQLite persistence is wired before running, else Q3c is N/A.
