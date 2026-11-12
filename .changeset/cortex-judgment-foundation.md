---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex configures and shows the framework's Judgment API, and supports Ollama Cloud.

Judgment: a TypeSafe (Jev) key entry in Settings · Providers (saved encrypted, never echoed, `TYPESAFE_API_KEY` fallback, Test reads the model catalog); a Lab Judgment section (backend, model, timeout, Ollama keep_alive) applied as `.withJudgment()` on runs, chats and saved agents; a Judgments tab and a header badge on the run view. ui-core adds `foldJudgments` and `judgmentBadgeOf`, which fold `JudgmentEvaluated`, `JudgmentFailed` and `JudgmentShadow` into a ledger with low-confidence and uncalibrated flags.

Ollama Cloud: an Ollama API key entry and an Ollama endpoint with a one-click Ollama Cloud preset. The endpoint reaches runs, chat, helper agents, the model list and capability probes; the key is sent only to a non-local host. A 401 reads "Ollama Cloud key missing or invalid" with a link to Settings.
