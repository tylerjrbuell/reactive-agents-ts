---
"@reactive-agents/tools": patch
---

`find` now tells the truth about web search. `findToolFor({ web, webFallback })` drops the `web` scope and the "falls back to web" claim when the handler has no web source or the fallback is off. New `findDescriptionFor(state)` derives these options from the handler's `FindState`. The default `findTool` text is unchanged. When a caller asks for `scope: "web"` and no web source is wired, or the web search fails, the result now carries a `note` saying so instead of returning a silent empty list.
