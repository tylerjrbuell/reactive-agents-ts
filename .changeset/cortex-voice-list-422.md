---
"@reactive-agents/cortex": patch
---

Speech settings: voices are listed from Speaches (`GET /models/<model>`, labelled with language and gender) as well as Kokoro-FastAPI `/audio/voices`, re-listed after the endpoint changes and once on load. The Speaches preset sets `af_heart` with its model, a voice the model does not offer is reset or flagged inline, and a 422 voice rejection shows its first sentence instead of a generic failure.
