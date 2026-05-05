---
aliases: [Package Directory, 29-Package Map]
tags: [packages, architecture, index]
---

# Package Index

**Purpose:** Central reference for all 29 packages and 5 apps, organized by architectural layer.

**Quick Navigation:** [[MOCs/Packages MOC|Packages MOC]] for complete layer breakdown

---

## Foundation Layer (3 packages)

### 1. core
- **Purpose:** EventBus, AgentService, TaskService, base types
- **Key Files:** `event-bus.ts`, `services/`, `types.ts`
- **Tests:** 145 tests, 100% pass
- **Owner:** Architecture team
- **Dependents:** All other packages
- **Status:** ✅ Stable (v0.10.0)

### 2. llm-provider
- **Purpose:** 6 LLM providers (Anthropic, OpenAI, Google, Ollama, Groq, AWS), streaming, tool calling
- **Key Files:** `providers/`, `abstract-provider.ts`, `hooks.ts`
- **Providers:** Anthropic, OpenAI, Gemini, Ollama, Groq, AWS Bedrock
- **Tests:** 142 tests, 100% pass
- **Owner:** Provider team
- **Validation:** ✅ M12 provider adapters (7/7 hooks wired)
- **Status:** ✅ Stable (v0.10.0)

### 3. memory
- **Purpose:** 4-layer memory system (Working/Semantic/Episodic/Procedural)
- **Key Files:** `layers/`, `memory-service.ts`, `persistence.ts`
- **Tests:** 127 tests, 100% pass
- **Owner:** Memory team
- **Validation:** ✅ M10 memory system validation
- **Status:** 🔄 Stable with Phase 1.5 multi-session expansion

---

## Composition Layer (5 packages)

### 4. reasoning
- **Purpose:** Cognitive kernel (12 phases), 5 strategies, state machine
- **Key Files:** `kernel/`, `strategies/`, `kernel-state.ts`
- **Strategies:** raw, naive, todo, plan-execute, tree-of-thought
- **Tests:** 287 tests, 100% pass
- **Owner:** Reasoning team
- **Validation:** ✅ M1, M2, M9 validation complete
- **Debt:** builder.ts 6,082 LOC needs decomposition (Phase 2)
- **Status:** ✅ Stable (v0.10.0)

### 5. tools
- **Purpose:** ToolService, 11 built-in tools, MCP client
- **Key Files:** `tool-service.ts`, `tools/`, `mcp-client.ts`
- **Built-in Tools:** read, write, bash, grep, find, ls, etc.
- **Tests:** 163 tests, 100% pass
- **Owner:** Tools team
- **Validation:** ✅ M4 healing pipeline, M13 guards validated
- **Status:** ✅ Stable (v0.10.0)

### 6. prompts
- **Purpose:** Template engine, tier-adaptive variants
- **Key Files:** `engine.ts`, `templates/`, `tiers/`
- **Tiers:** frontier, local, minimal
- **Tests:** 94 tests, 100% pass
- **Owner:** Prompts team
- **Status:** ✅ Stable (v0.10.0)

### 7. orchestration
- **Purpose:** Sequential, parallel, pipeline workflows
- **Key Files:** `workflows.ts`, `coordinator.ts`, `lane-controller.ts`
- **Tests:** 87 tests, 100% pass
- **Owner:** Orchestration team
- **Debt:** Phase 2 decomposition of execution-engine.ts (4,499 LOC)
- **Status:** ✅ Stable (v0.10.0)

### 8. skills
- **Purpose:** Learnable capabilities, activation, refinement
- **Key Files:** `skill-service.ts`, `lifecycle.ts`, `persistence.ts`
- **Tests:** 76 tests, 100% pass
- **Owner:** Skills team
- **Validation:** ✅ M6 lifecycle works; Phase 1.5 persistence pending
- **Status:** 🔄 Lifecycle stable; persistence layer pending

---

## Quality & Control Layer (6 packages)

### 9. guardrails
- **Purpose:** 6 guards (injection, PII, toxicity, schema, trust, compliance) + KillSwitch meta-tool
- **Key Files:** `guards/`, `guard-service.ts`, `meta-tools.ts`
- **Tests:** 118 tests, 100% pass
- **Owner:** Safety team
- **Validation:** ✅ M13 guards (100% accuracy, 0.001ms latency)
- **Status:** ✅ Stable (v0.10.0)

### 10. verification
- **Purpose:** Semantic entropy, NLI, hallucination detection, evidence grounding
- **Key Files:** `verifier.ts`, `evidence-grounding.ts`, `quality-utils.ts`
- **Tests:** 96 tests, 100% pass
- **Owner:** Verification team
- **Validation:** ✅ M3 verifier shipped, M11 diagnostic shipped
- **Status:** ✅ Stable (v0.10.0)

### 11. cost
- **Purpose:** Token counting, budget enforcement, complexity routing
- **Key Files:** `cost-service.ts`, `complexity-router.ts`, `budget-enforcer.ts`
- **Tests:** 82 tests, 100% pass
- **Owner:** Cost team
- **Status:** ✅ Stable (v0.10.0)

### 12. identity
- **Purpose:** RBAC, Ed25519 certs, permission enforcement
- **Key Files:** `rbac.ts`, `cert-service.ts`, `permissions.ts`
- **Tests:** 74 tests, 100% pass
- **Owner:** Security team
- **Status:** ✅ Stable (v0.10.0)

### 13. observability
- **Purpose:** Distributed tracing (ThoughtTracer), metrics collection, real-time diagnostics
- **Key Files:** `tracer.ts`, `metrics-collector.ts`, `diagnostic-service.ts`
- **Tests:** 103 tests, 100% pass
- **Owner:** Observability team
- **Validation:** ✅ M11 diagnostic system (100% TP, 0% FP, 0.02ms latency)
- **Status:** ✅ Stable (v0.10.0)

### 14. interaction
- **Purpose:** Autonomy modes, checkpoints, approval gates, manual intervention
- **Key Files:** `autonomy-service.ts`, `checkpoint.ts`, `approval-gate.ts`
- **Tests:** 68 tests, 100% pass
- **Owner:** Interaction team
- **Status:** ✅ Stable (v0.10.0)

---

## Specialized Layer (5 packages)

### 15. eval
- **Purpose:** LLM-as-judge evaluation, benchmark harness, comparison metrics
- **Key Files:** `runtime.ts`, `judge.ts`, `harness.ts`
- **Tests:** 91 tests, 4 skip (pending frozen judge)
- **Owner:** Benchmarking team
- **Blocker:** 🔴 Rule 4 frozen-judge validation (Phase 0)
- **Status:** 🟡 Pending (unfair judge validation)

### 16. gateway
- **Purpose:** Persistent harness, webhooks, heartbeats, session history, chat mode
- **Key Files:** `gateway-service.ts`, `session-storage.ts`, `webhook-handler.ts`
- **Tests:** 71 tests, 100% pass
- **Owner:** Gateway team
- **Features:** Per-sender SQLite history, 40-turn/8k-char windowing, episodic context injection
- **Status:** ✅ Shipped chat mode (May 1, 2026)

### 17. a2a
- **Purpose:** Agent-to-agent networking, delegation protocol, multi-agent coordination
- **Key Files:** `dispatcher.ts`, `protocol.ts`, `handoff.ts`
- **Tests:** 54 tests, 100% pass
- **Owner:** Orchestration team
- **Validation:** 🔄 M8 sub-agent delegation (test harness ready, metrics pending Phase 1.5)
- **Status:** 🔄 Green phase; metrics pending

### 18. testing
- **Purpose:** Mock services, test harnesses, fixtures, reproducer patterns
- **Key Files:** `mocks/`, `harness.ts`, `fixtures.ts`
- **Tests:** 134 tests, 100% pass
- **Owner:** QA team
- **Status:** ✅ Stable (v0.10.0)

### 19. calibration
- **Purpose:** Model-specific behavior profiling, tier-adaptive configuration
- **Key Files:** `calibration-service.ts`, `profiles/`, `persistence.ts`
- **Tests:** 87 tests, 100% pass
- **Owner:** Calibration team
- **Validation:** ✅ M7 calibration (14 fields defined); Phase 1.5 activation (8+ consumers) pending
- **Status:** 🔄 Stable with Phase 1.5 consumer activation

---

## Public APIs Layer (2 packages)

### 20. runtime
- **Purpose:** ExecutionEngine, ReactiveAgentBuilder, session management, orchestration facade
- **Key Files:** `execution-engine.ts` (4,499 LOC), `builder.ts` (6,082 LOC), `gateway-chat.ts`
- **Tests:** 156 tests, 100% pass
- **Owner:** Runtime team
- **Debt:** Orchestration decomposition into 3 focused components (Phase 2)
- **Status:** ✅ Stable (v0.10.0)

### 21. reactive-agents
- **Purpose:** Public umbrella facade, re-exports, primary public API
- **Key Files:** `index.ts`, `exports.ts`
- **Published:** ✅ v0.9.0 on npm; v0.10.0 pending publish
- **Owner:** API team
- **Status:** ✅ Stable (v0.10.0)

---

## Apps (5 applications)

### 22. cortex
- **Purpose:** Multi-mode agent application with web UI (task, chat, autonomous)
- **Location:** `apps/cortex`
- **Key Files:** `src/`, `public/`, `routes.ts`
- **Owner:** Demo team
- **Status:** ✅ Shipping with v0.10.0

### 23. examples
- **Purpose:** Code examples, tutorials, reference implementations
- **Location:** `apps/examples`
- **Key Files:** `src/`, `demos/`
- **Owner:** Developer relations
- **Status:** ✅ Maintained for v0.10.0

### 24. docs
- **Purpose:** Astro documentation site, user-facing API docs
- **Location:** `apps/docs`
- **Key Files:** `src/content/docs/`
- **Owner:** Documentation team
- **Features:** Messaging channels guide shipped
- **Status:** ✅ Maintained for v0.10.0

### 25. judge-server
- **Purpose:** Standalone evaluation server (Rule 4 frozen judge)
- **Location:** `apps/judge-server`
- **Key Files:** `Dockerfile`, `src/`
- **Owner:** Benchmarking team
- **Blocker:** 🔴 Phase 0 frozen-judge validation
- **Status:** 🟡 Pending validation

### 26. benchmarks
- **Purpose:** Performance and accuracy benchmarks, harness reports
- **Location:** `apps/benchmarks`
- **Key Files:** `src/`, `wiki/Research/Harness-Reports/`
- **Owner:** Performance team
- **Results:** Frontier 100%, bare-llm 85% (pending frozen judge)
- **Status:** ✅ Shipping with v0.10.0

---

## Metadata

**Total Packages:** 21  
**Total Apps:** 5  
**Total Tests:** 4,672 passing across 527 files  
**Failed Tests:** 4 (pre-existing in untracked `packages/benchmarks/parseDate.test.ts`)  
**Skipped Tests:** 23 (pending frozen judge validation)

---

## How to Navigate

1. **Want to understand a package?** → Click its name to open detailed page
2. **Want to find code by feature?** → See [[MOCs/Packages MOC|Packages MOC]] (layer organization)
3. **Want to see dependencies?** → See [[MOCs/Architecture MOC|Architecture MOC]] (dependency graph)
4. **Want to debug an error?** → See [[AGENTS.md]] (symptom → file path mapping)

---

**See also:** [[MOCs/Packages MOC|Packages MOC]] (complete breakdown by layer)

**Last Updated:** 2026-05-04  
**Phase:** v0.10.0 release preparation  
**Next:** Package detail pages in Phase 1.5
