---
type: decision
status: accepted
created: 2026-11-12
tags: [decision, workflows, plugins, compose, c5, owner-ruling]
---

# Workflows, plugins and the C5 "teams wait for perception" ruling

**Decided by the owner, 2026-11-12.** Ratification event for an amendment to [[../Architecture/Specs/09-UNIFIED-PROGRAM|09]] §3 C5 and to the Plan 9 plugin-packaging deferral.

## Context
- C5 holds back multi-agent topology work until RunAssessment ships (WIP=1, §8). Plan 9 defers plugin packaging until after Phase 4.
- Two specs now exist: [[../Architecture/Design-Specs/2026-11-12-cortex-workflows]] and [[../Architecture/Design-Specs/2026-11-12-plugin-system]]. Both reconcile with the 2026-09-08 multi-agent draft and the 2026-07-20 deletion of `@reactive-agents/orchestration`.

## Ruling
1. **Workflows are not "orchestration topology" under C5.** A workflow is an author-drawn, durable graph of single-agent runs. It adds no kernel change, no delegation API and no supervisor logic. It is authorized now, built on existing services (durable runs, HumanGate, judgment, scheduler, channels).
2. **Plugins are authorized now for the trust layer and the already-converged extension points:** hooks, tools, skills, slash commands, declarative panels, workflow nodes, judgment backends and channel adapters. Strategy, kernel-operation, guidance and dialect extension points stay held until their phases land. Plugins may never add termination logic (pitfall 12); they propose through typed rails.
3. **Combinators:** `Member` programs live in `packages/compose`; combinators lower to the workflow graph, not the reverse (durable waits, approvals and triggers cannot be expressed in-process). The earlier 2026-09-08 draft's single-surface proposal is superseded on this point. In-run delegation combinators that need Arc 3 (supervisor, debate, topology selection) remain behind C5.
4. **Packages:** `@reactive-agents/workflow` (runtime-warden) and `@reactive-agents/plugin` (contracts only, depends on core, runtime-warden) are approved as new packages.
5. **Lessons applied from the deleted orchestration package:** no in-memory durability claims, no package without a consumer, no dormant breadth, no public API before proof. Each package ships with its first consumer in the same slice.
6. **Autotune** ships first as a diagnose-only skeleton plugin; the full propose-test-apply loop follows later.

## Consequences
- 09 §3 C5 gets a pointer to this decision; the Decision Index entry "Multi-Agent Orchestration & Teamwork" (DEFERRED) is annotated as partly superseded.
- WIP=1 still applies to Arc work; workflows and plugins are DX and platform tracks the owner has explicitly sequenced. Phase 0 (ScheduleRegistry, canonical ChannelAdapter, webhook ingress, inbound queue) precedes the first workflow slice.
