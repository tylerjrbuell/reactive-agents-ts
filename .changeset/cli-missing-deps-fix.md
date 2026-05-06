---
"@reactive-agents/a2a": patch
"@reactive-agents/channels": patch
"@reactive-agents/cli": patch
"@reactive-agents/core": patch
"@reactive-agents/cortex": patch
"@reactive-agents/cost": patch
"@reactive-agents/diagnose": patch
"@reactive-agents/eval": patch
"@reactive-agents/gateway": patch
"@reactive-agents/guardrails": patch
"@reactive-agents/health": patch
"@reactive-agents/identity": patch
"@reactive-agents/interaction": patch
"@reactive-agents/llm-provider": patch
"@reactive-agents/memory": patch
"@reactive-agents/observability": patch
"@reactive-agents/orchestration": patch
"@reactive-agents/prompts": patch
"@reactive-agents/react": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/reactive-intelligence": patch
"@reactive-agents/runtime": patch
"@reactive-agents/scenarios": patch
"@reactive-agents/svelte": patch
"@reactive-agents/testing": patch
"@reactive-agents/tools": patch
"@reactive-agents/trace": patch
"@reactive-agents/verification": patch
"@reactive-agents/vue": patch
"reactive-agents": patch
---

fix(cli): resolve runtime dependency cycle and missing imports breaking npm-installed CLI

The CLI imported `reactive-agents` (umbrella) and `@reactive-agents/tools` in `serve`, `playground`, `run`, and `demo` commands. The umbrella import wasn't declared in `dependencies` and would have created a circular dep with the umbrella package (which already includes CLI). Result: every CLI invocation in a clean npm install crashed with `Cannot find package 'reactive-agents'`.

**Fixes:**
- CLI commands now import `ReactiveAgents` directly from `@reactive-agents/runtime` (where it actually lives)
- Added `@reactive-agents/tools` to CLI dependencies
- Added `@reactive-agents/cortex` as optional peerDependency (was already lazy-loaded)

**New CI gates to prevent recurrence:**
- `scripts/validate-cli-externals.ts` upgraded — now also validates that every external workspace import is declared as a dependency in `package.json` (was only checking tsup config), and matches the umbrella `reactive-agents` package (was only matching `@reactive-agents/*`)
- `scripts/test-clean-install.ts` (new) — packs every package as an npm tarball, installs into a fresh project, runs CLI + SDK smoke tests. Wired into `publish.yml` as a pre-publish gate so broken releases fail before hitting npm
- `scripts/check-npm-versions.ts` (new) — flags drift between local versions and npm-published versions

**Lockstep release:** all packages bumped together to keep versions aligned and prevent the manual-publish drift that created earlier release issues.
