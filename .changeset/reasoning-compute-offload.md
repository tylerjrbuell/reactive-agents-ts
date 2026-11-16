---
"@reactive-agents/reasoning": patch
---

New opt-in harness switch `computeOffload` (`RA_COMPUTE_OFFLOAD=1`, default off, behavior unchanged without it). When the task text asks for a numeric aggregate over data the run reads (an aggregate verb such as sum, total, mean or average, plus a data file or csv reference), `code-execute` stays on the visible tool surface even if the task did not declare it, as long as it is in the agent's permitted tools. Once data has been read without a successful `code-execute` call, one advisory guidance line says to compute figures with `code-execute` instead of estimating them. Advisory only: it never blocks a call or ends a run.
