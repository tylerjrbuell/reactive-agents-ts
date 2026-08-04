# Consumer Skills Library — Design Spec

**Date:** 2026-04-09  
**Branch:** chore/skill-library-redesign  
**Status:** Approved, pending implementation

---

## Problem

`apps/docs/skills/` contains 13 consumer-facing skills for agents that want to build with the
reactive-agents-ts framework. These skills are publicly fetchable via the `agentskills.io`
protocol at `https://docs.reactiveagents.dev/.well-known/skills/`. However:

1. They are **invisible from `AGENTS.md`** — zero references in the contributor guide.
2. They are **stale** — written before the native FC harness, composable kernel phases, the
   7-hook provider adapter, `logModelIO`, sandboxed shell execution, auto-checkpoint, and
   output synthesis were shipped.
3. They have **no routing layer** — a meta-agent must read every skill description to know
   what to load. There is no orientation/discovery skill.
4. They have **major capability gaps** — no skills for tool creation, shell sandboxing,
   context continuity, interaction/autonomy modes, LLM-as-judge eval, web framework
   integration, or provider adapter patterns.

The project is increasingly used in a meta-agent pattern: AI agents build agents on behalf
of users. The consumer skill library must be a reliable source of truth for that use case.

---

## Goals

- Every framework capability has a corresponding consumer skill (no holes).
- A meta-agent can orient itself from a single fetch (`reactive-agents`) and know exactly
  which skills to load for any given task.
- All skills are grounded in current code (`v0.9.0`+) — no stale API references.
- Skills are organized so the framework scales naturally: new packages/features map
  cleanly to existing tiers.
- `AGENTS.md` explicitly cross-references the consumer skill library so contributor agents
  can also route users' meta-agents to the right resources.

---

## Architecture: Three Tiers

```
Tier 1 — Discovery (1 skill)
  └── reactive-agents              Entry point, routing, full skill index

Tier 2 — Capabilities (17 skills)
  ├── builder-api-reference        ReactiveAgentBuilder API, Effect layers
  ├── reasoning-strategy-selection Strategies, native FC, output quality pipeline
  ├── context-and-continuity       Context pressure, checkpoint, auto-checkpoint
  ├── tool-creation                defineTool(), required-tools gate, maxCallsPerTool
  ├── shell-execution-sandbox      Sandboxed shell, Docker, allowlist
  ├── mcp-tool-integration         Docker lifecycle, two-phase, transport inference
  ├── memory-patterns              4-layer memory, SQLite/FTS5/vec
  ├── multi-agent-orchestration    Sequential, parallel, pipeline, map-reduce
  ├── gateway-persistent-agents    Heartbeats, crons, webhooks, policy engine
  ├── identity-and-guardrails      RBAC, injection/PII/toxicity, KillSwitch
  ├── observability-instrumentation ThoughtTracer, logModelIO, EventBus tracing
  ├── cost-budget-enforcement      Complexity router, budget enforcer, cache
  ├── quality-assurance            Runtime verification + LLM-as-judge eval + EvalStore
  ├── ui-integration               React/Vue/Svelte hooks, SSE streaming
  ├── interaction-autonomy         Autonomy modes, approval gates, preference learning
  ├── a2a-agent-networking         Agent Cards, JSON-RPC 2.0, A2A server/client
  └── provider-patterns            7 adapter hooks, native FC, per-provider quirks

Tier 3 — Recipes (6 skills)
  ├── recipe-research-agent        Research/analysis agent, memory + verification
  ├── recipe-code-assistant        Code generation + sandboxed execution
  ├── recipe-persistent-monitor    Always-on monitor via gateway
  ├── recipe-orchestrated-workflow Multi-agent pipeline, lead/builder/tester pattern
  ├── recipe-saas-agent            Multi-tenant agent, identity + cost controls
  └── recipe-embedded-app-agent    Agent in React/Vue/Svelte with streaming UI
```

**Total: 24 skills** (1 discovery + 17 capability + 6 recipe)

---

## Existing Skills — Disposition

| Current name | New name | Action |
|---|---|---|
| `reactive-agents-framework` | `reactive-agents` (Tier 1) + `builder-api-reference` (Tier 2) | **Split** — orientation content goes to T1, API reference to T2 |
| `reasoning-strategy-selection` | same | **Major update** — native FC harness, tier awareness, output quality pipeline, task intent |
| `context-engineering-optimization` | `context-and-continuity` | **Major update** — checkpoint tool, auto-checkpoint, context pressure thresholds |
| `mcp-tool-integration` | same | **Major update** — two-phase Docker containers, transport inference, `docker rm -f` pattern |
| `memory-consolidation` | `memory-patterns` | **Refresh** — current 4-layer API, SQLite/FTS5/vec patterns |
| `multi-agent-orchestration` | same | **Refresh** — current orchestration package API |
| `observability-instrumentation` | same | **Refresh** — add `logModelIO`, `ThoughtTracer`, raw response capture |
| `streaming-real-time-agents` | merged into `ui-integration` | **Merge** — combined with new web framework content |
| `a2a-specialized-agents` | `a2a-agent-networking` | **Minor update** — current A2A package API |
| `gateway-persistent-scheduled-agents` | `gateway-persistent-agents` | **Minor update** — current gateway API |
| `identity-and-guardrails` | same | **Minor update** — verify current API accuracy |
| `cost-budget-enforcement` | same | **Minor update** — verify current API accuracy |
| `verification-pipeline-design` | merged into `quality-assurance` | **Merge** — combined with new eval content |

**New skills (no existing counterpart):**
- `tool-creation`
- `shell-execution-sandbox`
- `interaction-autonomy`
- `quality-assurance` (new eval portion)
- `ui-integration` (new web framework portion)
- `provider-patterns`
- All 6 recipe skills

---

## Skill Content Template

Every skill follows this exact structure (sections scaled to complexity):

```markdown
---
name: {skill-name}
description: {one sentence — what an agent can DO after loading this skill}
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "discovery" | "capability" | "recipe"
---

# {Title}

## Agent objective
What the consuming agent should produce when done (output shape, not process).

## When to load this skill
3–5 trigger conditions (bullets).

## Implementation baseline
Smallest correct builder chain for the happy path.
Inline comments explain why each call is present.

## Key patterns
2–5 code blocks covering real decision points.
Not exhaustive — only the patterns agents consistently get wrong.

## Builder API reference
Concise table: method | params | default | notes

## Pitfalls
3–6 gotchas grounded in actual known bugs/mistakes.
```

**Tier 3 recipes add one section after "Pitfalls":**

```markdown
## Complete example
Full end-to-end runnable implementation.
Source from apps/examples/ when an example exists; write from scratch otherwise.
```

**What skills must NOT include:**
- Internal kernel/Effect implementation details (that's `.agents/skills/`)
- Cross-package architecture diagrams
- More than one code style per concept (pick canonical, drop alternatives)
- Stale builder method names or removed options

---

## Public Fetch Protocol

Skills are served via the `agentskills.io` standard, already wired in `astro.config.mjs`:

```
Discovery index:   https://docs.reactiveagents.dev/.well-known/skills/index.json
Fetch a skill:     https://docs.reactiveagents.dev/.well-known/skills/{skill-name}/
```

The `starlightSafeSkillsLoader` in `apps/docs/src/content/skills-loader.ts` reads all
`SKILL.md` files from `apps/docs/skills/`, parses frontmatter, and bundles every file in
the skill directory. Required frontmatter: `name` (string, max 64 chars) and
`description` (string, max 1024 chars).

A meta-agent workflow:
1. Fetch `index.json` to discover available skills (or fetch `reactive-agents` directly)
2. Load `reactive-agents` (Tier 1) for orientation and routing
3. Load relevant Tier 2 capability skills
4. Optionally load a Tier 3 recipe as a complete reference implementation

---

## AGENTS.md Integration

Append this section to the existing **Project Skills Index** in root `AGENTS.md`:

```markdown
## Consumer Skills (Public — for agents building with the framework)

For AI agents using reactive-agents-ts to build agents on behalf of users.
Served from `apps/docs/skills/`, publicly fetchable at:

- **Discover:** `https://docs.reactiveagents.dev/.well-known/skills/index.json`
- **Fetch:** `https://docs.reactiveagents.dev/.well-known/skills/{skill-name}/`

### Tier 1 — Discovery
- `reactive-agents` — start here: framework orientation, builder API, skill routing

### Tier 2 — Capabilities
- `builder-api-reference` — ReactiveAgentBuilder API, layer composition, Effect layers
- `reasoning-strategy-selection` — strategy selection, native FC, output quality pipeline
- `context-and-continuity` — context pressure, windowing, checkpoint, auto-checkpoint
- `tool-creation` — defineTool(), ToolRegistry, required-tools gate, maxCallsPerTool
- `shell-execution-sandbox` — sandboxed shell, Docker sandbox, allowlist config
- `mcp-tool-integration` — Docker lifecycle, transport inference, stdio vs HTTP MCP
- `memory-patterns` — 4-layer memory, SQLite/FTS5/vec, working/episodic/semantic/procedural
- `multi-agent-orchestration` — sequential, parallel, pipeline, map-reduce workflows
- `gateway-persistent-agents` — heartbeats, crons, webhooks, policy engine
- `identity-and-guardrails` — RBAC, injection/PII/toxicity detection, KillSwitch
- `observability-instrumentation` — ThoughtTracer, logModelIO, EventBus tracing
- `cost-budget-enforcement` — complexity router, budget enforcer, semantic cache
- `quality-assurance` — runtime verification, LLM-as-judge eval, EvalStore regression
- `ui-integration` — React/Vue/Svelte hooks, SSE streaming, real-time UI
- `interaction-autonomy` — autonomy modes, approval gates, preference learning
- `a2a-agent-networking` — Agent Cards, JSON-RPC 2.0, A2A server/client
- `provider-patterns` — adapter hooks, native FC patterns, per-provider quirks

### Tier 3 — Recipes
- `recipe-research-agent` — research/analysis agent with memory + verification
- `recipe-code-assistant` — code generation + sandboxed execution agent
- `recipe-persistent-monitor` — always-on monitoring agent via gateway
- `recipe-orchestrated-workflow` — multi-agent pipeline with lead/builder/tester pattern
- `recipe-saas-agent` — multi-tenant production agent with identity + cost controls
- `recipe-embedded-app-agent` — agent embedded in React/Vue/Svelte with streaming UI
```

**Directory distinction (do not conflate):**
- `.agents/skills/` — **contributor skills**: build the framework, used by agents working on this repo
- `apps/docs/skills/` — **consumer skills**: use the framework, publicly fetchable, used by meta-agents

---

## Implementation Priorities

Work ordered by user-facing impact:

**Phase 1 — Foundation (must land first)**
1. `AGENTS.md` — add Consumer Skills section (5 min, unblocks discoverability immediately)
2. `reactive-agents` — Tier 1 orientation + routing skill (new, most-fetched skill)
3. `reasoning-strategy-selection` — highest-traffic capability, most stale

**Phase 2 — New capabilities (no existing skill)**
4. `tool-creation`
5. `shell-execution-sandbox`
6. `context-and-continuity` (major update + checkpoint content)
7. `mcp-tool-integration` (major update)
8. `provider-patterns`

**Phase 3 — Refreshes**
9. `builder-api-reference` (split from old reactive-agents-framework)
10. `memory-patterns`
11. `multi-agent-orchestration`
12. `observability-instrumentation`
13. `quality-assurance` (merge + eval content)
14. `ui-integration` (merge + web framework content)
15. `interaction-autonomy`

**Phase 4 — Minor updates + recipes**
16. `gateway-persistent-agents`
17. `identity-and-guardrails`
18. `cost-budget-enforcement`
19. `a2a-agent-networking`
20–24. All 6 recipe skills

---

## Success Criteria

- `/.well-known/skills/index.json` lists all 24 skills with accurate descriptions
- `reactive-agents` (Tier 1) can fully orient a meta-agent with no prior knowledge
- Every builder method referenced in a skill exists in `packages/runtime/src/builder.ts`
- Every code example in a recipe skill is runnable against current `@reactive-agents/runtime`
- `AGENTS.md` cross-references the consumer skills library
- No capability in the 25-package monorepo is unreachable from the skill library
