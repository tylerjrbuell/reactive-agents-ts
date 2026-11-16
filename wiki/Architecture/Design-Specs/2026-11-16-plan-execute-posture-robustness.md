---
type: design-spec
status: active
created: 2026-11-16
tags: [posture, plan-mode, todo, harness, chat, cortex]
---

# Plan / Execute posture: harness-driven, durable, robust

Supersedes the "plan = zero tools" contract of commit 99837034f. Owner direction 2026-11-16: plan mode keeps the planning meta tools (todo) so the plan is a **durable checklist**; execution **starts from that checklist** and is encouraged to follow it; the **harness intervenes deterministically** instead of relying on the model to call tools well.

## Research summary (see session notes)
Claude Code / Codex / Cursor / OpenCode: plan mode = read-only exploration + explicit approval gate; enforcement lapses are the known weakness (prompt-based). We keep enforcement at the tool-policy choke point (deterministic) and go further: the plan is a typed artifact the harness owns.

## Contract

### Plan posture
1. **Tool surface** = `PLAN_POSTURE_TOOLS`: planning meta tools only: `todo` (durable checklist), `brief` (if present), `final-answer`. No capability tools, no writes, no side effects. Blocked calls stay recorded and never run (unchanged mechanism).
2. **Tool catalog by name** (opt-in flag `planToolCatalog`, default OFF until measured): one guidance block listing the execute-phase tools by name + one-line description (capped), "you cannot call these now; reference them in steps as `tool: name`".
3. **Guidance (single voice):** "Plan mode: reason it through, then record the steps with todo (one actionable step each, naming the tool to use when known), then present the plan. You cannot run tools other than todo until the user switches to execute."
4. **Harness intervention (do not rely on the model):**
   - After the plan turn's final reply, if the todo list is empty, the harness derives the checklist deterministically from the reply (numbered/bulleted step lines; pure function, tested) and records it through the same checklist mechanism (`ChecklistUpdated`), tagged `origin: "harness-derived"`. No second LLM call in v1.
   - Completion rule: the run completes when a reply exists (as today); the plan checklist is guaranteed non-empty or an explicit `plan-no-steps` signal is emitted.
   - No required-tool gates, no act-or-answer forcing (unchanged).

### Execute posture (and mode switch)
5. **Handoff is typed state, not prose:** the conversation's todo list already persists across turns (`chat/todo-seed.ts` `TodoCarry`, `RunEnvelopeRails.initialAdvisory`). Switching plan -> execute runs the next turn **seeded from the plan checklist**. Nothing re-parses prose.
6. **Execution guidance (single voice):** "Follow the plan checklist: work the next unchecked step, mark it done with todo when finished, and revise the list with todo if reality differs from the plan." Rendered while unchecked steps remain; advisory (never blocks completion, never vetoes), consistent with the basis model (heuristic = advisory).
7. **Harness assistance in execute:** reuse the existing todo state-change progress (loop detection), outstanding-checklist reminders and `TodoCarry`; add: when a step names a tool (`tool: x`) and that tool call succeeds, the harness proposes marking the step done (advisory line) rather than waiting for the model to remember.
8. **Execute with an empty checklist** behaves exactly as today (byte-identical).

### Session mode (already shipped, 87b4f9776 / b7ba223e1)
`AgentSession.mode`, `setMode`, `ChatModeChanged`; per-turn posture option stays an override.

## Work split (sequential where noted)
- **kernel-warden (1st):** PLAN_POSTURE_TOOLS = {todo, brief?, final-answer}; guidance lines (plan + execute posture follow-the-list line); deterministic plan-step derivation function + `harness-derived` checklist record at plan-turn end (shared substrate, not per strategy); `planToolCatalog` flag + catalog block (default OFF); execute follow-the-list guidance when seeded list has unchecked items; tests; update the pure-reasoning tests from 99837034f accordingly (do not weaken).
- **tools-warden (parallel):** restore/keep the todo plan-posture branch (it is live again): plan closing line ("Plan recorded (N steps). Present it to the user; execution starts from this list."), execute path unchanged; tests.
- **runtime-warden (2nd):** wire plan-turn checklist -> TodoCarry -> next execute turn seed (verify existing path covers plan turns; add the missing pieces), session exposes `session.plan` (read: steps with status) and `session.setPlan(steps)` (user edits before Execute), mode switch plan->execute seeds from it; `ChatModeChanged` unchanged; docs truth pass.
- **cortex-warden (3rd):** plan card renders the checklist (editable steps: reorder/edit/remove/add before Execute), Execute button switches mode with the edited list, plan card persists; docs.
- **ablation-warden (after):** plan+execute vs execute-only on multi-step tasks (success, steps followed, tokens); `planToolCatalog` on/off. Accept rule stated before running.

## Framework-first public API (owner rule: Cortex is an expression of framework abilities)
Everything above must be reachable from the builder/agent API with no Cortex involvement; Cortex only renders and persists. Surface (names guessable without docs; additive; modality-neutral):
- **Typed `Plan`** (core, additive): `{ id, goal, steps: PlanStep[], createdAt, source: "model" | "harness-derived" | "user-edited" }`, `PlanStep { id, title, tool?: string, status: "pending" | "in-progress" | "done" | "skipped" }`. Maps 1:1 to the existing checklist rows (`ChecklistSnapshot`), with `tool` hints from the plan.
- **`agent.plan(input, options?) -> Plan`**: runs the task under plan posture (reasoning + planning meta tools only), returns the durable `Plan` (harness-derived fallback guaranteed non-empty or a typed `PlanNoSteps` failure). No chat session required.
- **`agent.run(input, { plan })` / `agent.execute(plan, options?)`**: executes seeded from the plan's checklist with the follow-the-list guidance; the final result reports per-step status (`result.plan`).
- **Chat sessions**: `session.mode`/`setMode` (shipped), `session.plan` (read), `session.setPlan(plan | steps)` (edit before execute); mode switch plan->execute seeds from it. Same primitives underneath.
- **Builder**: `.withPlanning({ toolCatalog?: boolean, ... })` is optional sugar for defaults; plan/execute work without it (posture is per-call state, not builder config).
- **Events** (core, additive): `PlanRecorded {planId, steps, source}`, `PlanStepStatusChanged {planId, stepId, from, to}` (plus the shipped `ChatModeChanged`), so any UI/trace consumer can render plan progress.
- **Docs + skills**: builder-api reference, a "Plan then execute" guide, `apps/docs/skills` consumer skill update (builder-api-reference / reasoning-strategy-selection mention), and CLI `rax` flag if `rax run` has a posture/plan option (report).
- **Cortex** is then only: toggle, editable plan card, persistence, feed rendering.

## Non-goals (v1)
Read-only exploration tools in plan mode (decide after the measurement), hard enforcement that execute must follow the list (advisory only), a second LLM call to structure the plan.

## Addendum 2026-11-16 (owner): clarifying questions and bounded recon in plan mode
Owner direction: a robust planner can ask the user before finalizing, and may run a few tools as recon (e.g. look up the umami website id) so execution is smooth, without drifting into execution. This promotes the v1 non-goal "read-only exploration tools in plan mode".

### Questions
- `request-user-input` (existing tool, `packages/tools/src/skills/request-user-input.ts`, kernel `act/user-interaction.ts`) joins `PLAN_POSTURE_TOOLS` when user interaction is wired. Guidance: ask only when a missing answer would change the plan; batch questions in one call; never ask what recon or the conversation can answer. A pending question suspends the plan turn through the existing user-interaction path; the answer resumes it. Cortex/any UI renders it through the existing HITL card.

### Recon (flag `planRecon`, default OFF until measured)
- Eligibility is a declared property, not a heuristic: each tool carries `effect: "read" | "write" | "unknown"` (MCP `readOnlyHint` maps to read; built-ins classified; unknown = not eligible). Only `read` tools are callable in plan posture, in addition to `todo`/`brief`/`request-user-input`/`final-answer`.
- Bounded by the harness, not by prompt: at most N recon calls per plan turn (default 6), per-tool call cap, no side-effect tools ever, results are recorded as plan **findings** (id, tool, one-line summary) on the Plan and shown in the plan card, and the guidance says "recon only to remove unknowns the plan needs (ids, names, ranges); do not do the task".
- Anti-drift rule: recon budget exhausted, or the model's reply lacks a plan -> the harness forces the plan reply (tools withheld, existing derive-from-reply fallback). Recon does not count toward the execute iteration budget.
- Execution seeds findings into the execute turn as context (e.g. "website id = X") so recon is not repeated.
- Ablation before any default change: plan+recon vs plan-only on multi-step MCP tasks (success, wasted steps, tokens, premature-execution rate = write-effect attempts).

### Work split
tools-warden (effect classification + request-user-input in plan) -> kernel-warden (posture surface, recon budget, findings, forced plan reply) -> core-warden (Plan.findings, PlanRecorded payload, markdown/JSON/HTML formats) -> runtime-warden (config key, findings carry, user-interaction wiring in plan sessions) -> cortex-warden (question card in Plan mode, findings panel) -> ablation-warden.
