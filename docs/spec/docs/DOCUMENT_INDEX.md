# Reactive Agents Documentation Index

## Canonical Sources

Use these as source of truth in this order:

1. `AGENTS.md` (root) — operational workflow, quality gates, package map, build/test commands
2. `README.md` — public product overview and quickstart
3. `apps/docs/src/content/docs/` — API and behavior truth (Starlight docs)
4. `CHANGELOG.md` — release-level capability history and migration context

`CLAUDE.md` is a compatibility pointer only and should not be treated as a separate canonical guide.

---

## Recommended Reading Order for AI Agents

### 1) Entry and Orientation

| # | File | Why read it |
|---|---|---|
| 0 | `AGENTS.md` | Build workflow, architecture quick reference, mandatory quality gates |
| 1 | `README.md` | Public-facing framework capabilities and examples |
| 2 | `START_HERE_AI_AGENTS.md` | Spec build sequencing and agent team launch workflow |
| 3 | `00-master-architecture.md` | Layered architecture and system data flow |
| 4 | `FRAMEWORK_USAGE_GUIDE.md` | API usage patterns and end-to-end framework examples |

### 2) Core Specs

| # | File | Layer / Package |
|---|---|---|
| 5 | `layer-01-core-detailed-design.md` | L1 core (`@reactive-agents/core`) |
| 6 | `01.5-layer-llm-provider.md` | L1.5 llm-provider (`@reactive-agents/llm-provider`) |
| 7 | `02-layer-memory.md` | L2 memory (`@reactive-agents/memory`) |
| 8 | `03-layer-reasoning.md` | L3 reasoning (`@reactive-agents/reasoning`) |
| 9 | `04-layer-verification.md` | L4 verification (`@reactive-agents/verification`) |
| 10 | `05-layer-cost.md` | L5 cost (`@reactive-agents/cost`) |
| 11 | `06-layer-identity.md` | L6 identity (`@reactive-agents/identity`) |
| 12 | `07-layer-orchestration.md` | L7 orchestration (`@reactive-agents/orchestration`) |
| 13 | `08-layer-tools.md` | L8 tools (`@reactive-agents/tools`) |
| 14 | `09-layer-observability.md` | L9 observability (`@reactive-agents/observability`) |
| 15 | `layer-10-interaction-revolutionary-design.md` | L10 interaction (`@reactive-agents/interaction`) |
| 16 | `layer-01b-execution-engine.md` | Runtime execution (`@reactive-agents/runtime`) |

### 3) Enhancement and Evolution Specs

| # | File | Focus |
|---|---|---|
| 17 | `11-missing-capabilities-enhancement.md` | guardrails, eval, prompts, CLI enhancement path |
| 18 | `14-v0.5-comprehensive-plan.md` | A2A + MCP + harness hardening roadmap history |
| 19 | `00-VISION.md` | Product philosophy and strategic direction |
| 20 | `09-ROADMAP.md` | Roadmap framing and evolution context |

### 4) Historical Context (Reference Only)

| # | File | Purpose |
|---|---|---|
| 21 | `12-market-validation-feb-2026.md` | Market validation snapshot |
| 22 | `reactive-agents-complete-competitive-analysis-2026.md` | Competitive analysis |
| 23 | `implementation-ready-summary.md` | Historical synthesis |
| 24 | `PLAN_REVIEW.md`, `SPEC_REVIEW.md` | Audit trail and historical corrections |

---

## Starlight Docs Map (Current API Truth)

Primary docs live under `apps/docs/src/content/docs/`:

- `reference/` — builder API, CLI API, configuration defaults
- `guides/` — quickstart, reasoning, tools, memory, local models, security, troubleshooting
- `features/` — reactive intelligence, streaming, providers, gateway, orchestration, verification
- `concepts/` — architecture, lifecycle, composable kernel, Effect-TS model
- `cookbook/` — practical, copy-paste patterns

When API behavior changes, update Starlight docs and then align `README.md` + `AGENTS.md` summaries.

---

## Spec Format Convention

Most layer specs follow this pattern:

1. Overview
2. Package structure
3. Build order
4. Types (`Schema.Struct`)
5. Errors (`Data.TaggedError`)
6. Services (`Context.Tag` + `Layer.effect`)
7. Runtime layer factory
8. Tests
9. Package dependencies

---

## Current Project Scale (v0.9.0)

| Category | Count |
|---|---|
| Workspace packages | 25 |
| Publishable packages | 20 |
| Apps | 2 |
| Test suite | 3,472 tests / 409 files |

For current release details, use `CHANGELOG.md`.
