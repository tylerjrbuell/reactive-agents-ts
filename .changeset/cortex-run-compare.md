---
"@reactive-agents/cortex": minor
---

Compare two runs. Select two runs in Runs and press **Compare**, or choose **Compare with…** in a run's More menu, to open `/runs/compare`: outcome, tokens, cost, duration and output speed side by side, the resolved config settings that differ, and, when both runs recorded a trace, the framework replay diff (`diffTraces`) laid out by loop with the first divergence marked and a line diff of the two answers. Runs without a trace are compared on their summary and config. API: `GET /api/runs/compare?a=&b=`.
