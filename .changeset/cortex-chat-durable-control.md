---
"@reactive-agents/cortex": patch
---

A chat can turn Durable runs on or off with the new `/durable` command (also a row under Limits in the Config list), so Stop, Pause and Continue work in a chat without a saved Lab agent. It sets the same `durableRuns` option as the Lab's Execution switch and applies from the next message. The "no saved run to continue from" hints in a chat now say "Turn on Durable runs with /durable".
