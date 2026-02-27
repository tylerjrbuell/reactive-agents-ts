# foundations/

Core builder patterns every Reactive Agents developer needs.
All 4 examples run offline in test mode.

| # | File | Shows |
|---|------|-------|
| 01 | simple-agent | Minimal agent: build → run → inspect result |
| 02 | lifecycle-hooks | `before`/`after` hooks on every execution phase |
| 03 | multi-turn-memory | SQLite episodic memory across 3 conversation turns |
| 04 | agent-composition | Delegate to a sub-agent via `.withAgentTool()` |

Run all: `bun run ../../run-all.ts --filter foundations`
