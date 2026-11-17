---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Anonymous run telemetry is now opt-in. An agent with no telemetry setting sends no run report to api.reactiveagents.dev, creates no install id, and prints no "Reactive Intelligence" telemetry notice. To opt in, use `.withReactiveIntelligence({ telemetry: true })` (or `{ telemetry: { enabled: true, endpoint } }`), or set `REACTIVE_AGENTS_TELEMETRY=1` (or `true`) in the environment. An explicit `telemetry: false` beats the env opt-in. `DO_NOT_TRACK=1` and `REACTIVE_AGENTS_TELEMETRY=0` still turn telemetry off, even over an explicit `true`. The local run observation on disk (`~/.reactive-agents/observations`, used by local calibration) is still written when telemetry is off. When you opt in, the once-per-process notice still prints, and a run with telemetry off no longer uses up that notice.
