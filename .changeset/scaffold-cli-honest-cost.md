---
"create-reactive-agent": patch
"@reactive-agents/cli": patch
---

Scaffolded xAI projects use `grok-4.7`, and generated projects and `rax` no longer print a partial cost as an exact total.

- `--provider=xai` now writes `.withModel("grok-4.7")`. It wrote `grok-4`, which is no longer on xAI's price list, so every run of a scaffolded xAI project reported its cost as unknown.
- The `minimal` and `with-tools` templates print the billed total from `await result.totalCost?.()` (background debrief included). The `streaming` template prints the `StreamCompleted` cost. When a model had no known price, all three print `>= $x (some prices unknown)` instead of an exact-looking `$x`. The `cloudflare-worker` template's JSON response adds `costComplete`.
- `rax run` prints the billed total from `result.totalCost()`, and `rax run` and `rax eval` mark a partial cost the same way.
