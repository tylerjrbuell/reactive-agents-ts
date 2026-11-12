---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

Speech settings: voices are listed from Speaches (`GET /models/<model>`, labelled with language and gender) as well as Kokoro-FastAPI `/audio/voices`, re-listed after the endpoint changes and once on load. The Speaches preset sets `af_heart` with its model, a voice the model does not offer is reset or flagged inline, and a 422 voice rejection shows its first sentence instead of a generic failure.

Voices show friendly names (`Heart (American English, female)`) grouped by language in a searchable picker with a "Custom voice id..." entry, replacing the native datalist that only matched the typed value. Only one reading speaks at a time: every browser and server speech engine goes through one shared speech coordinator in `@reactive-agents/ui-core`, so starting a reading cancels the one in flight (its late callbacks are inert) and the controller that was cut off goes idle.

Speech engines settle each utterance exactly once and silence its audio element, so a late `ended`, a stray error or an interrupted `play()` cannot advance the queue twice or leave sound playing, and no `play()` rejection goes unhandled. A `pause()` from outside Cortex (a browser extension or media-key controller) is detected, retried once, and reported once as an `external-pause` error with guidance (Incognito test, Browser speech) instead of silently skipping through the transcript; Settings gains an "Audio diagnostic" button next to Test.
