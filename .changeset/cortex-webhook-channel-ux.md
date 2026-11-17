---
"@reactive-agents/cortex": minor
---

Webhook channels and routes no longer use messaging wording or chat-only settings: the route editor hides the conversation and trigger selectors, per-sender cap, reset commands and failure notice for a webhook, rewords the rest ("Runs per hour", "Run limit (seconds)"), and no longer preselects the first saved agent. The webhook channel card now shows how to connect a caller (the framework's own connection info with curl, Node and OpenSSL examples, loopback note), a Generate secret action (stored sealed, shown once) and a Send test request button that signs and posts from the server.
