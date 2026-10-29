---
type: harness-report
status: complete
created: 2026-10-29
tags: [harness, sub-agents, discover-tools, live-check]
---

# Live check: tool-less sub-agent children no longer get `discover-tools`

HEAD 390bf3cc2, provider openai, model gpt-4o-mini, `withDynamicSubAgents({maxIterations:6})`, `withTools({allowedTools:[...]})`, `withTracing`. Workspace resolution confirmed: `@reactive-agents/reasoning` -> `packages/reasoning/src/index.ts`, `@reactive-agents/runtime` -> `packages/runtime/src/index.ts`. Prompt: spawn 2 named spawn-agent sub-agents ("adder" 2+2, "mult" 3*2), then report. 2 runs total, a few cents.

## Run A: parent allowedTools = [spawn-agent] (children tool-less)

Child `tool-surface-resolved` (from trace JSONL), both children:
- adder: `"visible":[],"callable":[]` -> run-completed `status:success`, `output:"4"`, `terminatedBy:final_answer`, 224 tokens
- mult: `"visible":[],"callable":[]` -> run-completed `status:success`, `output:"6"`, `terminatedBy:final_answer`, 224 tokens
- parent surface (control): `"visible":["spawn-agent","recall","discover-tools"]`; parent `success`, output reports 4 and 6, `terminatedBy:end_turn`.

Result: PASS. No `discover-tools` in either child; both complete with correct answers.

## Run B: parent allowedTools = [file-read, spawn-agent] (children inherit a real tool)

Both children: `"visible":["file-read","discover-tools"],"callable":["file-read","discover-tools"]` (reasons: file-read `visible: required`, discover-tools `visible: meta-floor`). Tool surface retained as intended (children with real tools keep discover-tools per the gate design).

Both children ended `status:failure`, error: "Could not complete the task within the available budget. What was attempted: 4 tool call(s) attempted (file-read), 0 succeeded." (adder) / "3 tool call(s) attempted (file-read), 0 succeeded." (mult). Parent `success:false`, `terminatedBy: abstained`.

Caveat: my prompt told children "it may use file-read", and file-read is a `required` tool, so the weak model kept calling file-read on trivial arithmetic with no valid path. This is a probe-prompt artifact (a required-tool gate on an irrelevant tool), not evidence about the discover-tools gate; not investigated further. Only confirms inheriting children still see their tool surface.

Scratch script and traces were under the job dir / untracked scratch dir; no source edited.
