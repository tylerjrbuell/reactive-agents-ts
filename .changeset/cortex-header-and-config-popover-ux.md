---
"@reactive-agents/cortex": patch
---

The final answer's toolbar is now one slim row that stays flush at the top of the chat thread or run pane while you read that answer (it used to hang about 24px below the top and let text show above it) and lets go at the answer's end. Copy as Markdown and the save options moved into one "Copy or save" menu, buttons show icons only in a narrow pane, and Outline jumps land below the bar.

The chat Config popover now opens next to its button (flipping and shifting to stay on screen) on a menu of the five setting groups. A group shows its rows under a header with Back and the group name; a row's picker has its own Back row. Back or Escape goes up one level before closing, and closing a picker returns to its group.

Security hardening: the Cortex server now answers 403 to any `/api/*` or `/ws/*` request (WebSocket upgrades included) whose `Host` is not localhost, 127.0.0.1, [::1], an IP literal, the `CORTEX_URL` host or a name in the new `CORTEX_ALLOWED_HOSTS`, or whose `Origin` is a foreign site, which stops DNS-rebinding pages from reaching the unauthenticated API. Voice endpoints can no longer point at link-local or cloud-metadata addresses (169.254.0.0/16, fe80::/10, `metadata.google.internal`); loopback and LAN servers still work. `POST /api/voice/transcribe` now caps the recording while streaming the body (chunked uploads included), and chat attachments are limited in the request schema (item count and string lengths). Server tests can no longer spend money: `bun run --cwd apps/cortex test` strips provider keys, and a gateway trigger test that called Anthropic now uses the test provider.
