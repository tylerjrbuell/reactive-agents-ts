---
"@reactive-agents/observability": patch
---

The shared `defaultRedactors` now also redact `sk-proj-` keys containing `-` or `_`, OpenRouter, fine-grained GitHub and `gho_`/`ghu_`/`ghr_` tokens, Slack, Stripe, Groq and xAI keys, PEM private-key blocks, `Basic` auth credentials and `password=` / `secret=` / `token=` assignments, so logger and OTel exporter output no longer leaks them. The file exporter and file logger now create directories with mode 0700 and files with mode 0600.
