---
"@reactive-agents/channels": minor
---

The webhook channel now describes how to call it. `WebhookChannelAdapter.connectionInfo({ baseUrl })` (and the pure `webhookConnectionInfo`) returns the ingress path and URL, the signature header, algorithm and signed bytes, replay rules, and curl, Node and openssl examples. `signRequest(secret, body)` builds the headers a sender must attach. Both use the same constants signature verification uses; the signature scheme is unchanged.
