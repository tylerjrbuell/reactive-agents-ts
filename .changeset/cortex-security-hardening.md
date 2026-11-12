---
"@reactive-agents/cortex": minor
---

Cortex security hardening. Loopback stays zero-friction; everything else is tightened.

- **Access token.** Binding off loopback (`CORTEX_HOST=0.0.0.0`) now needs `CORTEX_TOKEN`; the server refuses to start without it. When set, `/api/*` and `/ws/*` require it as `Authorization: Bearer`, the `cortex_token` cookie (`GET /?token=<token>` sets it, HttpOnly and SameSite=Strict), or `?token=` on `/ws/*`. Requests tagged `Sec-Fetch-Site: cross-site` are refused, closing cross-site `GET`s that carry no `Origin`.
- **Outbound URLs.** The Ollama endpoint (`GET /api/models/ollama?endpoint=`, `PUT /api/settings/ollama`) and the voice base URLs share one validator: http(s) only, no credentials, no link-local or cloud-metadata host, including names that resolve to one. Model discovery and voice calls never follow redirects, and voice errors no longer echo the upstream body.
- **MCP credentials are write-only.** `GET /api/mcp-servers` masks `env` and `headers` values and OAuth secrets; saving a config with a still-masked value keeps the stored one. `refresh-tools` no longer logs endpoints or command lines.
- **Tool playground.** `POST /api/tools/invoke` answers 409 for tools the framework gates with `requiresApproval` (`code-execute`, `file-write`, `file-edit`, docker, shell) until the body carries `approved: true`; the Tool Workshop asks first.
- **Private storage.** `.cortex/` is created 0700 and the database (and its `-wal` / `-shm`) 0600.
- **Smaller fixes.** `/ws/ingest` frames over 4 MiB are dropped; the markdown sanitizer no longer allows `class` (only the fence `language-*` marker survives); the browser opener uses an argv spawn, not a shell string.
