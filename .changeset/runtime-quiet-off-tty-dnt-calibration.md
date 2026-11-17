---
"@reactive-agents/runtime": minor
---

A plain agent (no `.withObservability()`) no longer narrates phases to stdout when stdout is not a terminal. With no `verbosity` set, a TTY keeps the `"normal"` live log lines as before. A server, pipe, CI job or embedding app now prints only warning and error lines. An explicit `verbosity` always wins, and an explicit `"minimal"` stays fully silent. Only stdout changes: EventBus events, trace data, the run summary buffer and logger subscribers are the same in both cases, so UIs built on events (such as Cortex) see every event.

Community calibration (`calibration: "auto"`) no longer requests a community profile when `DO_NOT_TRACK` is set or `REACTIVE_AGENTS_TELEMETRY=0`. Resolution falls back to the shipped prior and local observations, with no network request.
