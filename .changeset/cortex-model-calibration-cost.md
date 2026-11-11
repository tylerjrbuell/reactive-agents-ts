---
"@reactive-agents/cortex": minor
---

Cortex: the Model page shows what a model costs and how the harness adapts to it, and Runs can resume a crashed durable run.

- **Spend** on the Model page: spend over the model's last 50 runs (priced by the framework), spend per successful run, and tokens in, out and served from the prompt cache.
- **Calibration** on the Model page: the framework's calibration for the model in plain words (tool result size, attention to instructions, act or answer, tool classifier, parallel tool calls, shortened results, tool-call format), each marked Shipped or Learned from your runs, plus the run observations behind the learned values and the learned uncertainty thresholds. Read only.
- **Stopped mid-run** on Runs: a desk run with durable runs on that was still going when Cortex stopped is listed with **Resume**, which continues it from its last checkpoint with the framework's `resumeRun` on the same run.
