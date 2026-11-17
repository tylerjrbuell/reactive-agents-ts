---
"@reactive-agents/observability": minor
"@reactive-agents/observe": patch
---

`ObservabilityService` stays quiet when stdout is not a terminal. With no `verbosity` configured, a TTY keeps the `"normal"` output as before. A server, pipe, CI job or embedding app now gets only warning and error log lines: no phase narration, no span list, no metrics dashboard. `obs.verbosity()` reports `"minimal"` in that case. An explicit `verbosity` always wins, and an explicit `"minimal"` stays fully silent. The policy is exported as `resolveVerbosity(explicit, isTTY)` along with `stdoutIsTTY()`. `ObservabilityServiceLive` accepts an optional second argument, `{ stdoutIsTTY }`, to pin the TTY state in tests.

`@reactive-agents/observe` now uses the same OpenTelemetry 2.x line as `@reactive-agents/observability` (`sdk-trace-node`/`sdk-trace-base` `^2.6.0`, `exporter-trace-otlp-http` `^0.213.0`). A clean install resolves one copy of each OTel package and no longer prints the deprecated `sdk-trace-base` 1.x warning. `@opentelemetry/sdk-trace-base` is now a declared runtime dependency, because `setupOpenInferenceExporter` imports `BatchSpanProcessor` from it. Public exports are unchanged. If you read `ReadableSpan.parentSpanId` from spans you collect yourself, switch to `parentSpanContext?.spanId` (OTel 2.x).
