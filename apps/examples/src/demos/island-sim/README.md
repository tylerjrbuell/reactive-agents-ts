# Island Survival Simulation Demo

A watchable, offline-first multi-agent island-survival simulation demo where one LLM call generates the world, `agent.judge()` picks each agent's action per tick, and a pure deterministic engine owns and renders the state.

## Run

```bash
bun run apps/examples/src/demos/island-sim/index.ts
```

The simulation will start on port 3007 (default). Open your browser to `http://localhost:3007` to view the simulation.

## Controls

- **New Simulation**: Generate a new world and reset the simulation.
- **Start/Pause**: Start or pause the real-time simulation.
- **Step**: Advance one tick when paused.
- **Speed**: Adjust the simulation speed (ticks per second).
- **Agent Select**: Choose an agent to inspect in the sidebar.

## Modes

The demo runs in **offline mode** by default, using scripted world generation and scripted decision makers. To use live LLM providers, set the appropriate environment variables or modify the `main` function in `index.ts` to instantiate live agents.

## Judgment Backend Selection

The live wiring in `main` prefers:
1. `ollama` (if available)
2. `jev` (if `TYPESAFE_API_KEY` resolves)
3. `llm` (fallback LLM provider)
4. `scripted` (fallback to scripted decision maker)

## Cassette Export/Replay

The simulation records decisions in a cassette that can be exported and replayed for deterministic playback.

## Test

Run the test suite:

```bash
bun test apps/examples/src/demos/island-sim --timeout 15000
```

## Typecheck

```bash
bun run typecheck
```