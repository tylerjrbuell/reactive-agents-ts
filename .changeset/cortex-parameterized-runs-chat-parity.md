---
"@reactive-agents/cortex": minor
---

Cortex: parameterized runs and chat/builder parity. Agent templates support `{{variable}}` placeholders filled at launch — server-authoritative resolver, `POST /api/template/resolve` live preview, schema-driven fill modal on Lab and saved-agent runs, a Variables editor with auto-detection and inline highlighting in prompt/persona/task fields, and cron/gateway runs resolving from variable defaults (runs 400 on unresolved required variables; the `secret.` namespace is reserved). Chat sessions gain full builder tool parity: MCP servers, agent-tools, and sub-agents now thread into chat agents, with session config editable in a modal and chats startable from a saved agent's config snapshot. Cortex also follows framework provider defaults dynamically (with a refreshed offline model mirror) and disposes cached/ephemeral chat agents correctly so MCP containers tear down.
