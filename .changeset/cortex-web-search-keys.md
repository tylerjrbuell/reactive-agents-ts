---
"@reactive-agents/cortex": patch
---

Cortex Settings has a Web search section: add, test and remove an API key for each keyed web-search provider (Tavily, Brave, Serper, Keenable), stored encrypted like the LLM provider keys. The framework's `web-search` tool reads these keys from the process environment only, so a saved key is not yet passed to agents; the row says so. The provider docs and `.env.example` now list Keenable.
