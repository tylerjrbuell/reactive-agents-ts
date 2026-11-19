---
"@reactive-agents/tools": patch
"reactive-agents": patch
---

Security: an MCP tool annotated `readOnlyHint: false` is now always classified `write`. Before, two cases left it `unknown` or `read`, so an approval policy did not gate it:

- It also had `openWorldHint: true`. The open-world check ran first and returned `unknown`.
- The operator declared it read-only (`readOnly: true` or a `readOnly` listing). The operator promise ran first and returned `read`.

The order is now: write hints (`destructiveHint: true` or `readOnlyHint: false`) first, then `openWorldHint: true` (unknown), then read-only declarations. A server that says a tool writes is believed. `readOnlyHint: true` with `openWorldHint: true` stays `unknown`, as before.
