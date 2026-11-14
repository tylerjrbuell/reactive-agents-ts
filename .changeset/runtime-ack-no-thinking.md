---
"@reactive-agents/runtime": patch
---

Model-written channel acknowledgements (`ack.source: "model"`) now run with extended thinking off. On a thinking model (e.g. ollama mimo-v2.6) the ack completion used to reason first and miss the router's 3 s bound, so every ack fell back to the canned text. The ack budget is 80 tokens, and an empty or thinking-only result is never used as ack text.
