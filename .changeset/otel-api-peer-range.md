---
"@reactive-agents/observability": patch
"@reactive-agents/observe": patch
---

Pin `@opentelemetry/api` to `~1.9.0`. `^1.9.0` resolved the new 1.10.0, which every stable OpenTelemetry SDK 2.x package still rejects (`<1.10.0` peer), so installing under Bun printed repeated `incorrect peer dependency "@opentelemetry/api@1.10.0"` warnings. Installs no longer warn.
