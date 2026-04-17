---
"@reactive-agents/tools": patch
---

Web search: read Tavily and Brave JSON error bodies (including HTTP 432/433 quota responses), treat limit and transient HTTP statuses as recoverable, and continue to the next provider in the chain. Longer default timeout for sequential providers; clearer final error when all providers fail.
