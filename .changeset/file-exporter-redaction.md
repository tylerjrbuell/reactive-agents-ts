---
"@reactive-agents/observability": patch
---

The observability file exporter now redacts secrets before writing JSONL. Log messages, log metadata, span attributes, span event attributes and metric labels pass through `defaultRedactors`; previously a secret in a logged message landed on disk unredacted. Pass `redactors` to `makeFileExporter` to use your own list, or `[]` to disable.
