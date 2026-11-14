---
"@reactive-agents/llm-provider": minor
---

Ollama capability rows and calibrations are now tied to the model's content digest. A re-pulled tag whose digest changed is detected: a stale probed capability row is re-probed (and rewritten), a stale digest-bearing calibration falls back to tier defaults, and a typed `recalibrate` signal is published via `onModelDigestStale`. Records without a digest (static table, shipped calibrations, older cache files) behave exactly as before. New optional `digest` field on `ModelCalibration` and `Capability`.
