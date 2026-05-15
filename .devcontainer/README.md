# Reactive Agents Devcontainer

One-click runnable dev environment via GitHub Codespaces or VS Code Dev Containers.

## Open in Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/tylerjrbuell/reactive-agents-ts?quickstart=1)

## What's inside

- Node 22 (bookworm)
- Bun (latest) — primary toolchain
- GitHub CLI
- VS Code extensions: Biome, Bun, Effect-TS LSP, Markdown, GitHub Actions

## First steps

```bash
bun test              # 5,128+ tests
bun run build         # build all packages
bun run docs:dev      # docs at :4321
bun run rax --help    # CLI
```

## Forwarded ports

| Port | Service |
|------|---------|
| 4321 | Docs (Astro) |
| 4400 | Cortex Server (Elysia) |
| 5173 | Cortex UI (SvelteKit) |
| 8787 | Examples |

## API keys

Set in Codespaces secrets (Settings → Codespaces → Repository secrets) or `.env`:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`. For zero-API local runs use the Ollama provider against a host-side daemon (`host.docker.internal:11434`).
