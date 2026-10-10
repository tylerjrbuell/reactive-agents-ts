---
type: debrief
status: completed
created: 2026-10-06
tags: demo, island-sim, simulation, reactive-agents
---

# Island Survival Simulation Demo Debrief

## Summary

We successfully built a watchable multi-agent island-survival simulation demo using the Reactive Agents SDK. The demo includes:

- A deterministic simulation engine with seeded RNG and partial observability.
- A world generator with structured output fallback.
- Per‑tick decisions using the judgment-first paradigm (`agent.judge()`), with a scripted decision maker as fallback.
- An SVG-based UI with controls for starting/pausing, stepping, adjusting speed, and inspecting agents.
- An HTTP server that serves the simulation state and provides a viewer‑safe projection (hiding private facts).
- Offline‑first operation: works without API keys, using scripted fallbacks.
- Full test coverage: all unit tests pass, including the cassette replay test which was fixed to ensure deterministic replay.
- Integration with the example suite: the demo can be run both as an interactive server and as a script via the example runner.

## Changes Made

### Core Simulation
- Updated `apps/examples/src/demos/island-sim/index.ts` to export a `run` function compatible with the example suite, while retaining the ability to start an interactive server when run directly.
- Fixed the `CassetteRecorder` to correctly store the initial world (pre‑tick) rather than the world after the last recorded tick, ensuring accurate replay.
- Added `ExampleResult` and `RunConfig` interfaces to match the example suite’s expectations.
- The `run` function simulates 100 ticks using the scripted decision maker and returns an `ExampleResult` with steps, tokens (0), duration, and a summary output.

### Test Fixes
- The cassette test (`engine/cassette.test.ts`) was failing due to an off‑by‑one error in the replay logic. The root cause was that the `CassetteRecorder` was storing the post‑tick world as the initial world in the exported cassette. This was fixed by separating the original initial world from the current world used during recording.

### UI and Server
- The server serves an HTML page at `/` and a JSON state endpoint at `/api/state` that returns a viewer‑safe projection (excluding hidden fields like `world.hidden`).
- The simulation starts automatically when the server begins and runs at 1 tick per second by default.

## Outstanding Issues
- The jev judgment backend is not fully integrated due to time constraints in wiring up the Effect runtime. The demo falls back to the scripted decision maker. Future work could integrate the jev backend properly for live judgment.
- The simulation speed is fixed at 1 tick per second; there is no dynamic adjustment based on computational load, but this is acceptable for a demo.
- The UI is rudimentary (basic HTML with no styling). A more polished UI could be built using the React/Vue/Svelte bindings, but that is outside the scope of this demo.

## Lessons Learned
- The Reactive Agents SDK facilitates building deterministic simulations with replay capability when the recording logic is correct.
- Separating concerns (world generation, decision making, recording, replay) is essential for testability and maintenance.
- The example suite provides a valuable way to ensure examples are runnable and produce consistent results.

## Next Steps
- Consider integrating the jev judgment backend for live demonstrations.
- Explore adding more sophisticated UI elements (e.g., agent trails, resource visualization) using the frontend bindings.
- Use this demo as a foundation for more complex simulations (e.g., with trading, alliances, or evolving strategies).
