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

## Non-goals (v1)
Read-only exploration tools in plan mode (decide after the measurement), hard enforcement that execute must follow the list (advisory only), a second LLM call to structure the plan.
