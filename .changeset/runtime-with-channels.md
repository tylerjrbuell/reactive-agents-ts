---
"@reactive-agents/runtime": minor
---

`.withChannels({ adapters, routes, agents })` now starts the channel router. Routes match inbound conversations to a target agent, with per-route owners, allow and deny lists, and a `senderTools` surface that defaults to `ReadOnly` for non-owners. The runtime builds one agent per (route, role) from your `agents` factories and removes mutating, MCP and unclassified tools from a sender's agent before it is built, so the restriction is a tool list, not a prompt. The router starts and stops with `agent.start()` and its handle; `agent.channelRouterStatus()` reports channels, routes, drops, sessions and whether the store is durable. Routes also serialize as `channelRoutes` in `AgentConfig`. Router state is in memory unless you pass a `store`, and startup logs a warning when it is. The existing `triggers` path is unchanged.
