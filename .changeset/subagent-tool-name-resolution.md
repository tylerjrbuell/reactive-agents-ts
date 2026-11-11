---
"@reactive-agents/runtime": patch
---

Sub-agent tool names are now resolved against the tools the child really has. A parent that passes `umami_get_website_stats` to `spawn-agent` / `spawn-agents` (or in a `.withAgentTool` call's `tools` arg) gives the child `umami/get_website_stats`, both as an allowed and a required tool, instead of an allowlist that matches nothing. Names that match no tool, or more than one, are dropped and the parent's tool result says so. When none of the requested tools exist, the child is not started; the result names the unknown tools and lists the available ones.
