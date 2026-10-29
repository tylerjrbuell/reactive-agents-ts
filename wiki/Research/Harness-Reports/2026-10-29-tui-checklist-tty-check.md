---
type: harness-report
status: complete
created: 2026-10-29
tags: [observability, tui, checklist, plan-and-goal-primitives]
---

# TUI checklist real-TTY check (Plan 3 Task 8, commit fef1372ab)

Closes the "manual real-TTY check NOT done" caveat. Verdict: **works, no bug found.**

Method: test provider (`.withTestScenario` with `todo` add x3 / start / done / start / done, 1.2s `delayMs` per turn), `.withMetaTools({todo:true,...})`, `.withObservability({verbosity:"normal", live:true, checklist})`. Run under a python `pty` (120x30), raw bytes captured with timestamps. (`script` is not installed on this box.) Scenario ended after 3 tool calls (token-delta guard, unrelated to rendering), so only item 1 reached `done`.

## Observed (ANSI stripped, `checklist: true`, TTY)

```
Thinking...  ·  entropy 0.42  ·  ☑ 0/1
Thinking...  ·  entropy 0.42  ·  ☑ 0/1 · todo 0/3
Thinking...  ·  iter 1  ·  entropy 0.42  ·  ☑ 0/1 · todo 0/3
Thinking...  ·  iter 2  ·  entropy 0.42 →  ·  ☑ 0/1 · todo 0/3 · gather data
·✓ gather data                       <- announced once to scrollback
Thinking...  ·  iter 2  ·  entropy 0.33 ↓  ·  ☑ 0/1 · todo 1/3
Thinking...  ·  iter 2  ·  504 tok  ·  entropy 0.33 ↓  ·  ☑ 0/1 · todo 1/3
```

- Suffix updates in place (todo 0/3 -> active title -> 1/3); the finished row prints exactly once; no duplicate lines.
- `checklist: false`: no `☑`, `todo`, or `✓ <item>` anywhere in the TTY stream.
- Piped (non-TTY): no renderer/spinner output, plain log lines only, no checklist text.

Note: `☑ 0/1` is a requirement row (gate truth) the engine declared; shown by design before the advisory todo count.
