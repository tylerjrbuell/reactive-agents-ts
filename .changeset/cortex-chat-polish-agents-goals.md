---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Chat polish: compact tool badges, background-agent cards, quieter goal checks, config during a run, and a per-message action row.

- **ui-core:** new chat view models. `toolBadgesOf` (one badge per tool in a group, unfixed failures first and coloured, fixed ones marked, `+N` overflow), `subAgentCardOf` / `subAgentRollup` / `argHint` (a background-agent card: status incl. abstained, tools, duration, cost, one activity line, goal status; never raw tool JSON), `goalSummaryOf` / `isImplicitRequirement` / `findSubAgentGroup` (goal checks without the answer floor every run has), `turnStrategiesOf` and `formatTurnDuration` (`12s`, `2m 05s`), and `shortToolName` is exported. The turn fold records `strategy` (`StreamCompleted.metadata.strategyUsed`) and `durationMs` (`metadata.duration`), and `finishTurnTrace` persists them, so a plain answer now persists a small trace.
- **Cortex chat:** tool groups show badges; sub-agents are compact cards under an `N agents · k running` header that open a side panel with the agent's own transcript; goal checks are a `Goals 3/4` pill, hidden when only the implicit floor exists; quick-bar chips and config commands work during a run (they apply to the next turn, never queue, and the running turn keeps its agent); each message has an action row with status, relative time (absolute on hover), `Ran 2m 05s · finished …` or a live `Running 12s`, the reported strategy (`ReAct + Reflexion` when sub-agents ran others), copy, retry, trace and fork. Also: a jump-to-latest button when scrolled up, wide markdown tables scroll inside the message, the duplicate `N steps` header label is gone, and a turn keeps the provider/model it started with.
