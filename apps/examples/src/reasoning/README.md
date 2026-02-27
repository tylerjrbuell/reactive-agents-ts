# reasoning/

Reasoning strategies and model-adaptive context profiles.

| # | File | Shows | Offline? |
|---|------|-------|----------|
| 19 | reasoning-strategies | Same task solved by 3 strategies (reactive, plan-execute-reflect, adaptive) | ⚡ |
| 20 | context-profiles | local/mid/large/frontier tier profiles — compaction and context budget differ | ✅ |

Valid strategy names: `"reactive"`, `"plan-execute-reflect"`, `"tree-of-thought"`, `"reflexion"`, `"adaptive"`.

Run: `bun run ../../run-all.ts --filter reasoning`
