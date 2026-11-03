---
type: reference
status: active
created: 2026-11-03
tags: [reference, agents, workflow, documentation, meta]
---

# Agents Extended Reference

> Detail moved out of root `AGENTS.md` on 2026-11-03 so the contract file stays under its 22 KB budget.
> `AGENTS.md` is still the entry point and wins on conflict. Read a section here only when the task touches it:
> docs or stats updates, wiki writes, new packages, multi-agent handoffs, calibration/telemetry, or warden-routing history.
> Find a section with `bun run repo find "<heading>" --wiki` or `bun run repo outline wiki/Development/Agents-Extended-Reference.md`.

## Package Dependency Tree (annotated)

`AGENTS.md` keeps the dependency arrows; this is the per-package description that was trimmed from it.

| Package | What it holds |
| --- | --- |
| core | EventBus, AgentService, TaskService, all shared types |
| llm-provider | LLMService, 8 provider adapters (Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Groq, xAI, test), streaming, tool calling |
| memory | 4-layer memory (Working/Semantic/Episodic/Procedural), SQLite/FTS5/vec |
| reasoning | 8 registered strategies (core: reactive, direct; router: adaptive; promote-candidate: code-action; maintained: plan-execute-reflect, reflexion, tree-of-thought, blueprint; aliases react→reactive, rewoo→blueprint) + ThoughtKernel, KernelRunner, Structured Plan Engine (uses PlanStoreService from memory, ToolService from tools) |
| tools | ToolService, ToolRegistry, built-in tools (9 capability: web-search, crypto-price, http-get, file-read, file-write, code-execute, git-cli, gh-cli, gws-cli; 9 meta: context-status, final-answer, brief, find, pulse, recall, checkpoint, discover-tools, todo; shell-execute gated via `.withTools({ terminal: true })`), MCP client, sandbox |
| guardrails | injection/PII/toxicity detection, judgment battery, KillSwitch, BehavioralContracts |
| verification | semantic entropy, fact decomposition, NLI, hallucination detection |
| cost | complexity router, budget enforcer, semantic cache |
| identity | Ed25519 certs, RBAC, delegation, audit trail (direct use; no builder wither; full AuditLogger wiring deferred) |
| judgment | calibrated typed judgment primitive (Choice/Score/Noul) over a provider-abstracted JudgmentBackend (TypeSafe/Jev + LLM-emulation + Ollama System One backend) |
| observability | distributed tracing, metrics, structured logging, MetricsCollector |
| interaction | 5 autonomy modes, checkpoints, preference learning, approval gates |
| prompts | template engine, version control, tier-adaptive prompt variants |
| eval | Jev-judge (default) + LLM-as-judge (secondary), EvalStore (SQLite), 5 scoring dimensions, regression checks |
| a2a | Agent Cards, JSON-RPC 2.0, SSE streaming, A2A server/client |
| gateway | persistent harness: heartbeats, crons, webhooks, policy engine |
| channels | external channel layer: webhooks, bot transports, triggers, session bridging (`.withChannels()`; gateway config field is `accessControl`) |
| testing | mock LLMService, mock ToolService, mock EventBus, assertion helpers |
| runtime-shim | Bun/Node unified primitives (Database, spawn, serve, glob, hash); consumed by memory, tools, health, judge-server |
| ui-core | headless UI core: wire protocol, resumable stream client, run state machines, fixture testing; consumed by react, svelte, vue |
| trace | structured execution traces: TraceEvent schema, recorders, span helpers |
| health | health-check primitives + readiness probes |
| reactive-intelligence | entropy sensing, adaptive control, learning pipeline |
| judge-server | LLM-as-judge HTTP server backing eval (private) |
| compose | harness composition + 5 killswitches (maxIterations, budgetLimit, timeoutAfter, watchdog, requireApprovalFor) |
| replay | deterministic trace replay: loadRecordedRun, makeReplayController, makeReplayToolLayer, diffTraces |
| diagnose | trace diagnostics + replay-driven root-cause analysis (rax-diagnose CLI) |
| benchmarks | benchmark task suites + tier-aware runners (private) |
| observe | OpenTelemetry/OpenInference span exporter: OpenInferenceTracerLayer, setupOpenInferenceExporter, autoConfigureExporter |
| react / svelte / vue | hooks+components / stores / composables (useRun, useAgentStream, useAgent, createRun, agentStream, ...); peer-depend on their framework |
| runtime | ExecutionEngine, ReactiveAgentBuilder, createRuntime() |
| reactive-agents | public API facade, re-exports builder + types |
| create-reactive-agent | `npm create reactive-agent` scaffold CLI (bundles templates + post-install) |

## Detail trimmed from kept AGENTS.md sections

- **Efficiency rule 7 evidence:** verified 2026-11-03, `grep -c export packages/reasoning/src/kernel/assessment/assess.ts` printed nothing in Claude Code's shell (cause unknown). Rules 1–8 came from a 9-session analysis: subagents were about 2/3 of token spend; `browser_take_screenshot` results were the largest per-call sink.
- **Runtime policy:** the shim's primitives are `Database`, `spawn`, `serve`, `glob`, `hash`; prefer `node:crypto`, `node:fs/promises`, `node:child_process`. Bun supports all `node:` modules, so each file stays one import-swap from Node compatibility.
- **Debugging:** gateway won't start → also check `.withGateway()` in the builder; chat history missing → also check SessionStoreService wiring.
- **Release:** `dev` exists because local `main` once diverged silently from `origin/main` (local-only commits never reached origin). Bump types: `patch` (fixes), `minor` (features), `major` (breaking). `scripts/release.ts` stamps versions at tag time; workspace package.json files stay at the 0.10.6 baseline by design.
- **Git hooks:** no husky/lefthook dependency; `postinstall` runs `git config core.hooksPath .githooks`. The commit-msg hook is the deterministic backstop because some harnesses auto-append co-author trailers. The pre-commit secret grep covers Anthropic, OpenAI, AWS, GitHub and Slack prefixes and is not a substitute for a real secret scanner.
- **Golden rule 3:** types are public API; keep IDE IntelliSense rich and accurate.

## Adaptive Calibration (Live Learning)

Three-tier calibration resolves per-model behavior at runtime:

1. **Shipped prior** — pre-baked probe results in `packages/llm-provider/src/calibrations/`
2. **Community prior** — fetched from `GET /v1/profiles/:modelId` (daily-aggregated from all opt-in users)
3. **Local posterior** — observations stored at `~/.reactive-agents/observations/<model>.json`

After 5+ runs, empirical observations override shipped priors for `parallelCallCapability` and `classifierReliability`. When classifier reliability is `"low"`, the LLM classifier call is skipped entirely (saves a round-trip).

Calibration drift detection compares each run's entropy distribution with the stored baseline and emits a drift event when model behavior shifts significantly.

**Env vars for self-hosted deployments:**

- `REACTIVE_AGENTS_TELEMETRY_BASE_URL` — configures both read (`/v1/profiles`) and write (`/v1/reports`) endpoints
- `REACTIVE_AGENTS_TELEMETRY_PROFILES_URL` / `REACTIVE_AGENTS_TELEMETRY_REPORTS_URL` — per-endpoint overrides

## Before Starting Work (long form)

`bun run repo status` replaces most of this; the long form for sessions that need it:

1. Read `AGENTS.md` for build commands, architecture and workflow rules.
2. Query the wiki (`claude-obsidian:wiki-query` or `bun run repo find "<q>" --wiki`) for prior Decisions, Experiments, Running Issues Log and concept notes touching your work.
3. Read the relevant spec in `wiki/Architecture/Specs/` for the feature you are implementing.
4. Check `wiki/Planning/Implementation-Plans/` for active plans relevant to your work.
5. Load relevant skills (`effect-ts-patterns`, `architecture-reference`, `llm-api-contract`).

## Team-Ownership Dev Contract — history and warden table

The 2026-05-23 → 2026-06-15 ablation pilot (`wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md`) concluded with a **CANONICALIZE verdict (2026-06-15)**: domain-scoped wardens proved useful and are kept, not reverted. Owner: Tyler. Evaluator: `ablation-warden`, applying its own lift rule to the aggregate. The old pilot / expiry / default-revert framing is retired.

Path-to-warden routing is machine-readable in `tools/repo/ownership.json` (`bun run repo scope <files>` prints the owner). The table as it stood when it was moved:

| Primary scope | Warden |
|---|---|
| `packages/reasoning/src/kernel/**` | `kernel-warden` |
| `packages/llm-provider/**` | `provider-warden` |
| `packages/tools/**` | `tools-warden` |
| `packages/memory/**` | `memory-warden` |
| `packages/runtime/**` | `runtime-warden` |
| `packages/compose/**` | `compose-warden` |
| Framework probes, `wiki/Research/Harness-Reports/**` | `harness-warden` |
| Default-on toggles, new mechanisms, ablation matrices | `ablation-warden` |
| Pre-tag audit, version-drift check, release pipeline | `release-warden` |
| Post-merge AAR, debrief file in `wiki/Research/Debriefs/**` | `debrief-scribe` |

**Logging requirement:** every task routed through any warden appends one YAML block to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` per the format documented there, including a `warden: <name>` field.

## Plans, Specs & Knowledge Storage — rationale

### For superpowers `writing-plans` Skill Users

Despite the skill's default suggestion of `docs/superpowers/plans/`, always override to `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md` in this repo. The override is the project convention, not a per-session choice. `bun run repo place --kind plan` prints the canonical location.

### Why This Matters

- **Token optimization**: one vault, one index, one query; agents do not search multiple directories.
- **Cross-agent continuity**: Cursor finds Claude's plan, Codex finds Aider's debrief; no agent-specific silos.
- **Obsidian graph**: wikilinks make knowledge navigable; scattered files break the graph.
- **Reduced clutter**: root holds conventions and entry points; all knowledge lives in `wiki/`.
- **Single source of truth**: no "is the spec in docs/ or wiki/?" confusion.

### Canonical Wiki Workflow (for All Agents)

Read `wiki/Development/Wiki-Workflow.md` before any session that touches `wiki/`. The standard 4-step pattern:

```
1. ORIENT  — claude-obsidian:wiki-query before forming hypotheses
2. CAPTURE — claude-obsidian:obsidian-markdown for any wiki write
3. PERSIST — claude-obsidian:save / wiki-ingest for durable artifacts
4. MAINTAIN — claude-obsidian:wiki-lint + wiki-fold periodically
```

**claude-obsidian skill family:**

| Skill | One-liner |
|-------|-----------|
| `wiki-query` | Smart query (hot cache + index + drill-down). |
| `wiki-ingest` | Ingest URL/file/transcript → structured wiki page with entities + concepts |
| `wiki-lint` | Health check: orphans, dead links, stale frontmatter |
| `wiki-fold` | Roll up high-volume logs into compact meta-pages |
| `save` | Save current conversation/insight as wiki page with frontmatter |
| `obsidian-markdown` | Validate OFM correctness (wikilinks, callouts, properties) |
| `obsidian-bases` | Create `.base` files for dynamic database views |
| `canvas` | Visual canvas for spatial layouts |
| `autoresearch` | Autonomous web research → wiki ingest synthesis |
| `defuddle` | Strip web clutter before wiki-ingest |
| `wiki` | Bootstrap/check vault structure |

**Existing dynamic Bases** (`.base` files for filtered views):

- `wiki/Planning/active-plans.base` — all plans with `status: active`
- `wiki/Experiments/by-verdict.base` — M-series grouped by KEEP/IMPROVE/REMOVE
- `wiki/Failure-Modes/by-severity.base` — FMs sorted by impact
- `wiki/Research/Harness-Reports/recent.base` — reports from last 30 days

Skills that integrate with this workflow: `harness-improvement-loop`, `update-docs`, `architecture-audit`, `architecture-reference`, `effect-abstraction-audit`, `prepare-release`.

At session close, regenerate `wiki/Hot.md` and append to `wiki/Log.md`.

## Documentation Workflow

`bun run repo scope <files>` lists the docs a change touches. The full trigger table:

### When to Update What

| Trigger | Files to Update |
| --- | --- |
| **New package created** | `AGENTS.md` (package map), `README.md` (packages table), `CHANGELOG.md`, architecture-reference skill, docs site sidebar, `tools/repo/ownership.json` row |
| **New/changed builder method** | `README.md` (quick start + capabilities), `apps/docs/src/content/docs/reference/builder-api.md` |
| **New CLI command** | `README.md` (CLI section), `apps/docs/src/content/docs/reference/cli.md` |
| **Test count changed** | Bump `tests` in `apps/docs/src/data/metrics-cache.json`, then `bun run --cwd apps/docs metrics:sync-readme` |
| **New reasoning strategy** | `README.md` (strategies table), `apps/docs/src/content/docs/guides/reasoning.mdx` |
| **New LLM provider** | `README.md` (providers table), `apps/docs/src/content/docs/features/llm-providers.md` |
| **New feature page needed** | `apps/docs/src/content/docs/features/<name>.md` or `guides/<name>.md` |
| **API signature change** | `bun run repo find "oldMethod"` and update every doc hit |
| **Version bump / release** | Add a changeset (`bun run changeset`); versions and release notes are produced at tag time |

### Docs Site (Starlight/Astro)

Location: `apps/docs/`. `bun run docs:dev` (preview; auto-runs metrics generator), `bun run docs:build`, `bun run docs:preview`.

Key files:

- `astro.config.mjs` — sidebar structure (autogenerated from directories)
- `src/content/docs/` — all documentation pages
- `src/content.config.ts` — content collections (Astro 6 Content Layer: `docsLoader()` + schemas)
- `src/data/metrics.json` — build-time generated, single source of truth for stat numbers (gitignored)
- `src/data/metrics-cache.json` — committed snapshot of the latest `bun test` pass count (manually editable)
- `apps/docs/scripts/generate-metrics.ts` — derives counts from filesystem + canonical source

### Drift-Prone Stats Are Now Dynamic

Do not hand-edit test, package, phase, strategy or provider counts anywhere in the docs. They are derived at build time from the filesystem and `packages/runtime/src/types.ts`. Pages read them via:

```mdx
import metrics from '../../data/metrics.json'
{metrics.grandTotal} {metrics.tests.toLocaleString()} {metrics.providers}
```

| You did this | Refresh by running |
| --- | --- |
| Added / removed / privatized a package or app; added a strategy, provider or lifecycle phase | `bun run --cwd apps/docs metrics` (auto on next docs build) |
| Ran `bun test` locally and the pass count changed | edit `apps/docs/src/data/metrics-cache.json` → bump `tests`, then the metrics command above |
| Want README in sync with the generated `metrics.json` | `bun run --cwd apps/docs metrics:sync-readme` (or `metrics:check` for a CI dry-run) |

Adding a new dynamic stat: edit `apps/docs/scripts/generate-metrics.ts`, add the field to the JSON output, then reference it in any `.mdx` page via `{metrics.yourField}`. See `apps/docs/scripts/README.md`.

### README.md

The README is the public face: badge row, architecture diagram matching actual layers, packages table listing all published packages, code examples using real API signatures (test them). Never hand-edit counts; run `bun run --cwd apps/docs metrics:sync-readme`.

### ROADMAP.md

Root `ROADMAP.md` is the forward-looking plan. Update when a milestone ships, scope changes for a future version, or new competitive intelligence changes priorities.

### Documentation Cross-Reference Rules

When any capability changes, update all three: `CHANGELOG.md` (release history), `README.md` (overview and quickstart), `apps/docs/src/content/docs/` (API and behavior details). Do not maintain feature truth in internal guides; keep API truth in the Starlight docs.

## Honest-claims guard: v0.14 truth classes

Split v0.14 meta-loop work into two truth-classes when documenting or releasing (full list: `CHANGELOG.md` `[0.14.0]`):

- **Default-on + verified**: append-only evidence ledger (rides crash-resume), deliverable-truth (typed contract + contract-driven terminal gate + `result.receipt.deliverables[]`), honest compaction, recall round-trip, per-iteration run `assessment` trace event, Phase 3.6 reliability fixes.
- **Opt-in + experimental** (NOT default, NOT "better"): `.withLongHorizon()` (finishes long runs, not lift-gated for default-on) and `.withAdaptiveHarness()` (cross-tier ablation INCONCLUSIVE, n=1). Do not describe this pair as recommended or default, and do not claim the adaptive harness improves results.

## Multi-Agent Coordination (Large Features)

**Build order:** `core` → `llm-provider` → `{memory, tools, reasoning}` → `runtime` (turbo derives the full order from `package.json` dependencies).

**Handoff protocol:**

1. What completed (files created/modified)
2. What verified (tests passed, build clean)
3. What's next (unblocked dependent work)
4. Blockers/deviations

## New Package Checklist

1. `packages/<name>/{package.json, tsconfig.json, tsup.config.ts}`
2. `src/{types.ts, errors.ts, services/*, runtime.ts, index.ts}`
3. Tests in `tests/`; ensure all pass
4. Declare deps in `package.json` (turbo derives build order)
5. `bun run repo verify packages/<name>` + `bun run build` pass
6. Update `AGENTS.md` package map, `README.md` table, architecture-reference skill, `tools/repo/ownership.json` row

The `build-package` skill carries the full procedure.

## Quality Gates

**Before PR:** tests pass, build clean, patterns pass (`/review-patterns`), docs accurate.

**Before release:** all above + changeset added, docs site builds, README/ROADMAP updated. Never manually bump versions or edit CHANGELOG.

## Key File Paths

| Category | Path |
| --- | --- |
| Agent onboarding | `AGENTS.md`; repo structure map + task patterns: `wiki/Development/Repo-Navigation.md` |
| Memory | `.agents/MEMORY.md` — cross-session project context (read before starting; update after significant features) |
| Knowledge vault | `wiki/` — Architecture, Concepts, Planning, Reference, Research, Development |
| Canonical specs | `wiki/Architecture/Specs/` — `NN-NAME.md`; `DOCUMENT_INDEX.md` gives the authority hierarchy |
| Implementation plans | `wiki/Planning/Implementation-Plans/` |
| Design specs | `wiki/Architecture/Design-Specs/` |
| Debriefs | `wiki/Research/Debriefs/` |
| Audit reports | `wiki/Research/Audit-Reports-*/` |
| Harness reports | `wiki/Research/Harness-Reports/` (REPORTS_DIR in gate runner) |
| Spike prototypes | `wiki/Research/Prototypes/` — pNN spike scripts + RESULTS-pNN.md + RESEARCH_LOG.md |
| Cortex app | `apps/cortex/AGENTS.md` — read before changing |
| Skills | `.agents/skills/` (contributor), `apps/docs/skills/` (consumer) |
| CLI | `apps/cli/` |
| Public docs | `apps/docs/src/content/docs/` (docs.reactiveagents.dev) |
| Examples | `apps/examples/` |

## Consumer Skills (Public)

Served from `apps/docs/skills/`; discover at `https://docs.reactiveagents.dev/.well-known/skills/index.json`, fetch at `https://docs.reactiveagents.dev/.well-known/skills/{skill-name}/`.

- **Tier 1 — Discovery:** `reactive-agents` — framework orientation, builder API shape, skill routing decision tree.
- **Tier 2 — Capabilities:** `builder-api-reference` (builder API, layer composition), `reasoning-strategy-selection` (strategies, native FC harness, output quality), `context-and-continuity` (context pressure, checkpoints), `tool-creation` (`defineTool()`, required-tools gate, `maxCallsPerTool`), `shell-execution-sandbox` (sandboxed shell, Docker sandbox, allowlist), `mcp-tool-integration` (Docker lifecycle, transport inference), `memory-patterns` (4-layer memory, SQLite/FTS5/vec), `multi-agent-orchestration` (sequential, parallel, pipeline, map-reduce), `gateway-persistent-agents` (heartbeats, crons, webhooks, policy), `identity-and-guardrails` (Ed25519 RBAC, injection/PII/toxicity, KillSwitch), `observability-instrumentation` (ThoughtTracer, `logModelIO`, EventBus tracing), `cost-budget-enforcement` (complexity router, budgets, semantic cache), `quality-assurance` (verification, LLM-as-judge, EvalStore), `ui-integration` (React/Vue/Svelte hooks, SSE), `interaction-autonomy` (autonomy modes, approval gates), `a2a-agent-networking` (Agent Cards, JSON-RPC 2.0, SSE), `provider-patterns` (adapter hooks, native FC, streaming quirks).
- **Tier 3 — Recipes:** `recipe-research-agent`, `recipe-code-assistant`, `recipe-persistent-monitor`, `recipe-orchestrated-workflow`, `recipe-saas-agent`, `recipe-embedded-app-agent`.

## Architecture Debt (history)

The row-by-row Apr–May 2026 debt table that once lived in `AGENTS.md` was deleted; it predates and is superseded by the ratchet-based `wiki/Architecture/DEBT-REGISTER.md`, the only debt list. Query it rather than reading it whole.
