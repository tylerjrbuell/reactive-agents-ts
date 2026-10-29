---
type: implementation-plan
status: active
created: 2026-10-29
updated: 2026-10-29
tags: [implementation-plan, harness, posture, plan-mode, tool-policy, guidance, cortex]
spec: "[[2026-10-28-plan-and-goal-primitives]]"
---

# Plan 7 — Run posture (plan-only) as a harness concept, not a prompt

**Problem (trace 01M64DD47R0W…):** `/plan` was implemented as prompt text ("plan first, do not act"). The harness then injected its own, contradictory nudges: the todo result said "Work the first unchecked item next… do not give your final answer while items are open", the act-reminder said "give your final answer now". The model followed the loudest harness voice and executed. Fixing it with more prompt text (an override sentence) is the wrong layer: the context must never contain contradictory instructions.

**Design:** a run **posture** is typed state the harness owns; every harness-authored instruction is derived from it, so only one coherent story reaches the model.

1. `RunPosture = "execute" | "plan"`. Carried on the RunEnvelope as `rails.posture?: RunPosture`; absent == `execute` (request bytes identical to today — pinned).
2. **Enforcement is deterministic, not prompted.** Under `plan` the tool surface is limited by the existing tool-policy choke point to planning tools (`todo`, `brief`, `final-answer`, read-only discovery such as `find`/`recall`); a blocked call is recorded, never executed (existing behavior). The model cannot execute a step even if it tries.
3. **Single voice.** All harness guidance that depends on posture is rendered from the posture: under `plan`, the system `Guidance:` carries exactly one line ("Planning only: record the steps with todo, then present the plan and stop; do not start work"). Execute-oriented nudges are suppressed or reworded under `plan`: the todo result closing line (tools exposes a posture-aware line: plan → "Plan recorded (N items). Present it to the user and stop."), the act-reminder, the continuation/"work the next item" text, the checklist reminder.
4. **Completion is typed:** a plan-posture run is complete when the checklist is non-empty and the model has replied; requirement `answer` is satisfied by the plan summary (no stall/continuation guards firing on a deliberately stopped run).
5. **Cortex:** `/plan <task>` sends the task UNWRAPPED with `posture: "plan"` (chat turn option / request field); a "Planning mode" badge shows on that turn; the next normal message runs in `execute` posture, and `/go` (or a button on the plan card) sends the go-ahead turn. No prompt wrapper text remains.

## Tasks
- **P1 · runtime-warden:** `RunPosture` type (core), envelope `rails.posture`, chat engine per-turn option `posture` threaded through stream/tool/direct paths and `SessionOptions` send options; absent ⇒ byte-identical; tests.
- **P2 · tools-warden:** posture-aware todo result closing line (`execute` unchanged; `plan` → plan-recorded line); pure param, default execute.
- **P3 · kernel-warden:** read `rails.posture`; plan tool-surface restriction via tool policy; suppress/reword execute-oriented nudges under plan (todo closing line from P2, act-reminder, checklist reminder); one `Guidance:` line; completion rule; trace event `posture-applied`; scripted-model tests incl. the trace shape (model tries `crypto-price` under plan → blocked/recorded, never executed); no-change identity under execute.
- **P4 · cortex:** server route field `posture`, `/plan <task>` unwrapped, badge, `/go`; delete the prompt wrapper (`plan-command.ts` planPrompt) once P1–P3 land; docs + changeset.
- **P5 · harness-warden:** after-fix probe on gemma4:e4b/qwen3 (plan task: zero executed non-plan tools, plan recorded, summary delivered).

Order: P1 ∥ P2 → P3 → P4 → P5. P3 waits for the in-flight kernel dispatch (truncation clamp / stall synthesis).
