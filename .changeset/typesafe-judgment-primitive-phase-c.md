---
"@reactive-agents/runtime": minor
"reactive-agents": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/cost": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/interaction": minor
"@reactive-agents/tools": minor
"@reactive-agents/core": patch
---

New `.withJudgment(options?)` builder method wires an opt-in `JudgmentService`
(Choice/Score/Noul over `jev`/`llm`) into any agent, alongside a new public
composable primitive: `agent.judge({ state, questions })` — calibrated typed
judgments callable directly from user code, outside any run. Throws loudly
if `.withJudgment()` was never called (a caller mistake, not a silent no-op).

Every internal harness site this release touches is either **shadow-only**
(computes a judgment answer and compares it against the existing
heuristic/LLM decision for later ablation, but never changes what actually
ships) or **additive** (can only add a signal on top of what already passes,
never remove one, unless an explicit stricter opt-in is set):

- **Strategy selection** (`@reactive-agents/reasoning`) and **complexity
  routing** (`@reactive-agents/cost`) — shadow-only judgment classification
  alongside the existing regex/keyword heuristics. Emits `JudgmentShadow`
  events for agreement analysis; the heuristic decides exactly as before.
- **Task comprehension** (`@reactive-agents/reasoning`'s kernel) — shadow-only
  judgment fan-out reproducing the regex-derived task classification signals.
- **Guardrails** (`@reactive-agents/guardrails`) — new opt-in judgment battery
  (`enableJudgmentBattery`) runs parallel to the existing regex detectors.
  Default `judgmentStrictness: "additive"` can only add a violation or
  escalate severity (a strict superset of today's regex-only behavior);
  `"jev-primary"` is an explicit opt-in that can also unblock a regex hit the
  battery disagrees with. New opt-in `screenOutputs` runs the same battery
  over replies, observability-only (`GuardrailOutputFlagged`, never blocks).
- **Autonomy/approval confidence** (`@reactive-agents/interaction`) — the
  highest-blast-radius shadow site in this release: `PreferenceLearner`'s
  existing confidence/occurrences/cost-threshold auto-approve gate decides
  exactly as today; a judgment shadow runs in parallel for future ablation,
  never feeding back into the decision.
- **Tool-call healing** (`@reactive-agents/tools`) — new `runJudgmentHealing`
  escalation, additive over the existing synchronous fuzzy-match healer. Only
  fires when the sync healer's edit-distance/alias match misses; heals only
  above a 0.8 confidence floor, otherwise degrades to the original call
  unchanged. The existing synchronous healing pipeline is unmodified.

Every site above degrades cleanly (never fails, never blocks) when
`JudgmentService` is unconfigured, when the backend errors or times out, or
when a judgment answer doesn't clear its confidence floor — behavior for any
agent that never calls `.withJudgment()` is byte-for-byte unchanged.

No default-on behavior changes for existing agents. Several sites' exit
gates (inverting a shadow into a real decision) need real production shadow
data before that follow-up work is justified — tracked in the implementation
plan (`wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md`),
not shipped speculatively here.
