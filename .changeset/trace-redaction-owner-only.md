---
"@reactive-agents/trace": patch
---

Security: recorded traces now redact more secrets and are owner-only on disk. The trace recorder additionally redacts `sk-proj-` keys containing `-`/`_`, `github_pat_`, `gho_`/`ghu_`/`ghr_` tokens, Slack `xox*`, Stripe `sk_`/`rk_` live/test keys, OpenRouter `sk-or-`, Groq `gsk_`, xAI `xai-`, PEM private key blocks, `Basic` auth headers and `password=` / `secret=` / `token=` assignments. New trace directories are created `0700` and trace files `0600` (existing directories and files keep their current permissions).
