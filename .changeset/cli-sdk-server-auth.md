---
"@reactive-agents/cli": minor
---

`rax deploy --mode sdk`: the generated server now requires `Authorization: Bearer <RAX_API_KEY>` on `/chat` and `/chat/stream` (a random key is generated and printed once at startup when `RAX_API_KEY` is unset), rejects request bodies over 1 MiB, and no longer sends `access-control-allow-origin: *`. `/health`, `/ready` and the agent card stay open. **Behavior change:** existing clients must send the key; browser apps on other origins need a gateway in front.
