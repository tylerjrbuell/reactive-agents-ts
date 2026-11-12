---
"@reactive-agents/cortex": patch
---

Web-search keys saved in Settings · Web search now reach the agents Cortex builds (chats, desk runs and gateway agents) through `.withTools({ webSearch: { apiKeys } })`, so a saved Tavily, Brave, Serper or Keenable key works without setting an environment variable. Keys stay out of configs, traces and exported code, and a key in the server environment still wins unless "Use saved key" is chosen. The Tools section of the builder and chat config panel gains a Web search providers control (order and choice, saved as `tools.webSearch.providers`), and the provider table is now read from the framework's `WEB_SEARCH_PROVIDERS`.
