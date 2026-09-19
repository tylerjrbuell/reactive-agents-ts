---
"create-reactive-agent": minor
---

Add a `cloudflare-worker` template: scaffolds a deployable Cloudflare Worker (edge) agent.

- `wrangler.toml` with `compatibility_flags = ["nodejs_compat"]` (required for the framework's Node built-ins on workerd) and a `.dev.vars` secret stub
- Worker `fetch` handler wired to OpenAI, with the API key injected from the Worker env binding (no `process.env` on the edge)
- `dev` / `deploy` scripts (`wrangler dev` / `wrangler deploy`) and the `wrangler` devDependency
- Provider is pinned to OpenAI for this template (fetch-based, edge-safe); persistent memory and shell/filesystem tools are unavailable on the edge

Templates can now supply `extraDevDependencies`, `extraScripts`, and `gitignoreLines`, and template-specific files override shared ones at the same path.
