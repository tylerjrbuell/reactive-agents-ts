---
"@reactive-agents/cortex": patch
---

Settings · Voice: the local listening preset is now "Speaches (local)" (the renamed faster-whisper-server) and there is a "Speaches (local, Kokoro)" reading preset (`speaches-ai/Kokoro-82M-v1.0-ONNX`, voice `af_heart`). When Test fails because the server has not downloaded the model ("not installed locally"), the page shows how to download it and a copyable `curl -X POST …/v1/models/<model>` command. Presets that share a URL are told apart by model.
