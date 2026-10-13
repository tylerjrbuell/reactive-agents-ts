---
"@reactive-agents/cli": patch
---

Scaffolder unification (Local-Tier Reliability W0.6): `rax init` now delegates project generation to the `create-reactive-agent` template engine instead of apps/cli's private duplicate generator. Template names come from the engine's `listTemplates()` (minimal, with-tools, streaming, with-structured-output, with-approval-gates, with-memory, cloudflare-worker); the old `standard`/`full` names are removed with no compat aliases (rax init is pre-1.0). Invalid `--template` values error with the real names. Generated projects inherit the engine's W0.1 own-version pin and W0.2 `.env` guard for free. The duplicated `src/generators/project-generator.ts` is deleted; `apps/cli/src/templates/*` (deploy-file templates, consumed by `rax deploy`) are untouched.
