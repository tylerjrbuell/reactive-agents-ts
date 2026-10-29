---
type: harness-report
status: complete
created: 2026-10-28
tags: [harness, cortex, chat, todo, advisory-checklist, model-compliance, probe]
---

# Todo status-update compliance by model (Cortex chat)

**Question:** with Cortex chat defaults (`metaTools {enabled:true, todo:true}`, tools `["web-search"]`, strategy `reactive`, maxIterations 10, memory off), cogito:14b was seen calling `todo add` but never `start`/`done`. Model compliance or harness gap?

**Method:** fresh sessions via `POST /api/chat/sessions` (payload built from `chatDefaultConfig()` + `cortexRunsPostBody`) and `POST /sessions/:id/chat/stream`; read SSE `ToolCallStarted/Completed` + `ChecklistUpdated`, and the per-turn trace (`tool-surface-resolved`, `llm-exchange`, `tool-call-end`). Sequential, `timeout 300`. GPU checked first (`ollama ps`: only cogito:14b resident, no contention; unloaded between models). Probe sessions (`v5-*`) deleted afterward. n=2 per cell (n=3 for cogito arm A), so qualitative only.

## What the model sees about todo

- Tool surface: `todo` is `visible: meta-floor` every iteration (`toolSchemaNames: ["web-search","todo"]`).
- System prompt does NOT mention todo (Role/Instructions/Tone/Goal only). The only guidance is the tool description (`packages/tools/src/skills/todo.ts`):
  - "Call todo({action:'add', items:[...]}) ONCE at the start of any task with 3+ distinct steps, then todo({action:'done', id:N}) as you finish each item."
  - "todo({action:'start', id:N}) marks an item in progress; todo({action:'list'}) shows current state."
  - "Finish every item (or explicitly note why one is unmeetable) before delivering your final answer."
- Only in-band reminder is the tool RESULT footer ("Work the first unchecked item next. Mark items done as you complete them.") - seen only if the model already called todo. Nothing fires when advisory rows sit pending/in_progress at final answer (no reminder, no gate; advisory is non-blocking by design).

## Results

Arm A = the exact 4-step task, verbatim. Arm B (supplementary, to elicit use) = same task prefixed "Use your todo tool to plan this task."

| Model | Arm | Run | todo calls (order) | Final advisory rows | Iters |
|---|---|---|---|---|---|
| cogito:14b | A | 1-3 | none (web-search only) | none | 2,4,4 |
| qwen3:14b | A | 1-2 | none (web-search only) | none | 2,2 |
| gpt-5-mini | A | 1-2 | n/a - run failed `llm_error` 400 `max_tokens` unsupported (running Cortex server predates commit 8502a9111; needs restart) | n/a | 0 |
| gpt-4o-mini (substitute) | A | 1-2 | none | none | 2,2 |
| cogito:14b | B | 1 | add[1] x3, `create`[3] (invalid action, err), start1, start2, start3 | 3 rows, all in_progress, 0 done | 7 |
| cogito:14b | B | 2 | add[4], `mark_done`[2] (invented action, err) | 4 rows, all pending | 5 |
| gpt-4o-mini | B | 1 | add[4], done1, done2, done3 | 3 done, 1 pending (last step never closed) | 7 |

Not measured: qwen3:14b arm B, gpt-5-mini (server error).

## Diagnosis

1. Arm A: no tested model calls todo unprompted on this 4-step task, even though it is exactly the "3+ steps" case the description names. The description alone does not trigger use; todo is effectively inert by default for these models.
2. Arm B: cogito:14b never produced a valid `done` (invented `create`/`mark_done`, or stopped at `start`) and ended with unresolved rows while delivering a final answer; gpt-4o-mini used add/done correctly but left the last row open. So compliance is model-dependent AND nothing in the harness reacts to rows left open.
3. Reproducing "add but never start/done" confirmed in spirit (cogito B-2: add then invalid done; B-1: start only). Contributing wording gap: description never says action names are closed-set (`add|start|done|list`) - only the parameter description does.

## Recommendation (distinguish the three)

- (a) Model compliance only - partly true (cogito invents action names; 14b-class tool-calling is weak) but not sufficient: gpt-4o-mini also leaves a row open, and nobody uses todo unprompted.
- (b) Description wording gap - real, cheap: state "action must be exactly one of add|start|done|list", and pair "add ONCE" with "after finishing each step call done with its id BEFORE the next step". Low risk.
- (c) Harness gap - real: no reminder when advisory rows are pending/in_progress at the point the model tries to finish. Candidate: add a `PendingGuidance` line (not a USER message, per Pitfall 9) such as "N todo items still open" when advisory rows remain at final-answer time; keep non-blocking.
- Both (b) and (c) change model-visible text/behavior: per the lift rule they need an ablation-warden ruling (V4/V1) - >=2 tiers, >=3pp lift, <=15% token overhead - before default-on. Ship (b)/(c) opt-in or under ablation first. Also restart the Cortex server so gpt-5-mini can be probed (stale `max_tokens` build).

Raw artifacts were in `/tmp/v5/` (not committed).
