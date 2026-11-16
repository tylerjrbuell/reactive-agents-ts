---
"@reactive-agents/reasoning": patch
---

Plan posture now frames the goal the model sees as plan-only ("Plan how to accomplish this; do not carry it out: <task>"; the typed task and message history are untouched, execute posture is unchanged). Checklists the harness derives from a plan reply are written with `origin: "harness-derived"` (replacing the internal `harnessDerived` flag) and carry a per-step tool hint parsed from `tool: name` in the step text. A seeded execute run whose unchecked step names a tool that just succeeded gets one advisory line proposing to mark it done; it never blocks completion and is inert without hints.
