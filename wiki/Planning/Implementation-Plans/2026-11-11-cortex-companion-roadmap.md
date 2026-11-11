---
type: plan
status: active
created: 2026-11-11
tags: [cortex, roadmap, skills, memory, dogfooding]
---

# Cortex companion roadmap (2026-11-11)

Goal: Cortex is the full companion studio for Reactive Agents. Every feature
renders or drives a framework seam; a Cortex pain a builder would share is
fixed in the framework package first (see `feedback_cortex_fixes_are_builder_features`).

Evidence: framework-vs-Cortex coverage audit, 2026-11-11 (session), Cortex
Bench QA log `wiki/Research/Audit-Reports-2026-11-11/cortex-bench-qa.md`.
Related: skills spec draft [[../../Architecture/Design-Specs/2026-11-06-skills-and-extension-model]]
(C5/C7 must honour it; its 3 owner questions are still open), token streaming plan
[[2026-11-07-token-usage-streaming-visualization]] (C4 extends it).

## Known defects found by the audit

| Defect | Where | Owner |
|---|---|---|
| Memory tab opens cwd-relative `.reactive-agents/memory/<agentId>/memory.db`, not `$HOME/...` (`defaultUserMemoryPath`) | `apps/cortex/server/api/memory.ts` | cortex |
| Skills list scans server cwd, not the session workspace; `withSkills` only applied when `skills.paths` non-empty | `server/services/skill-directories.ts`, `build-cortex-agent.ts` | cortex |
| Pinned skill roots written cwd-relative, framework resolves against run workspace: pin silently fails when they differ | `chat-config-patch.ts`, `chat-proposal-service.ts` | cortex |
| Lab "SQLite skills" live in `cortex.db`, never reach agents; learned skills (`memory.db skills`) never shown | `db/schema.ts`, `api/skills.ts` | cortex + memory |
| `SkillActivated/Refined/Promoted/RolledBack/Conflict/Evicted` declared, never published; `onSkillActivated` never fires | `core/intelligence-events.ts`, kernel skill activation | kernel |
| `SkillStore` useCount/successRate/lastActivatedAt never updated, so tentative skills never promote | `finalize/local-learning.ts` | runtime/reasoning |
| `SkillEvolutionService`, `SkillDistillerService` unwired; `agent.refineSkills()` always `{refined:0}` | `memory/skill-evolution.ts`, `runtime-skills-layer.ts` | memory + runtime |
| `runStream()` has no `skills` option; Cortex rebuilds the agent per pinned turn | `reactive-agent.ts` | runtime |
| No provenance on semantic/procedural memory (no task/run column) | `memory/database.ts` | memory |
| No public agent memory API (list/search/edit/delete) | runtime facade | runtime |

## Ordered missions

Framework prerequisites run in parallel with Cortex missions (different packages);
Cortex missions run one at a time.

| # | Mission | Framework seam | Status |
|---|---|---|---|
| C1 | Approval rules editor, run-view Approve/Deny, abstained ending | approvalPolicy config (d25ae951a) | ✅ e3eeb1e28 |
| C2 | Tooltips + narrow Run trace | — | ✅ 072c19ae1 |
| C3 | API keys in Settings (server-side encrypted, masked, test key) + dynamic version | provider config (d1955526c) | ✅ be62ec82b |
| C4 | Streaming rate (live tok/s, TTFT, model medians) | `firstTokenMs`, `outputTokensPerSecond` (a589e3bbc, 277744e19, 16c5c5f8a) | ✅ eff31a63d |
| C5 | Workspace skills: discover from session workspace, list in chat, `/skill` pin by name, activation timeline | `discoverSkills`, `AgentStarted.config.skills`, `skill-activated` ledger, `runStream({skills})` | ✅ e78cc1f48 (+ f43ef8e97 session pins) |
| C6 | Memory studio: fix path, search (FTS), edit/delete, links, provenance link to run | `agent.memory()` facade, provenance columns | ✅ 4900faa09, 81fc7fe68 (episodic list still unfiltered by run) |
| C7 | Living skills panel: versions, confidence, promote/rollback, export to SKILL.md; fold cortex.db skills into framework store | `SkillStoreService`, evolution/distiller | ✅ f43ef8e97, 81fc7fe68 (manual refine event capture unproven live) |
| C8 | "Why it ended" card | `@reactive-agents/trace` `analyzeCause`, `attributeFailure` | ready |
| C9 | Run compare + replay rerun | `replay` `diffTraces`, `snapshotFromRecordedRun`, replay layers | ready |
| C10 | Safety lane in run view (interventions, guardrail violations, verifier verdicts, budget, context warnings, calibration drift) | events already ingested | ready |
| C11 | Export as builder code | `toConfig` → code | ready |
| C12 | Evals tab (save turn as case, suite runs, regression badge) | `EvalService`, `checkRegression` | ready |
| C13 | Model page calibration + cost; durable "resume crashed run" / fork | `resolveCalibration`, bandit stats, `resumeRun`, `fork()` | ready |

## Framework prerequisites

| # | Change | Owner |
|---|---|---|
| F1 | Publish `SkillActivated` from the activation commit | ✅ 4db8afda8, 085c977bf, 940763b52 |
| F2 | `runStream(task, { skills })` per-turn pins | ✅ 085c977bf, 823ea7b74 (chat session) |
| F3 | `task_id`/`run_id` provenance on semantic + procedural memory, plus procedural delete | ✅ 72f26c562, d53c64776 |
| F4 | `agent.memory()` facade: list/search/update/delete across layers | ✅ 5858652c6, 3b590fa73 |
| F5 | Living skills: update SkillStore stats on outcome, wire evolution + distiller, publish Refined/Promoted/RolledBack | ✅ e08b37bb0, 38ec47d16, c803c3d31, 3058c426e, 3b590fa73 (stays opt-in; default-on needs ablation) |

## Later (Cortex Cloud direction)

Decision doc pending owner go-ahead: free-vs-paid boundary, multi-tenant seams
(org/project ids, store interface, authenticated ingest), opt-in calibration
network via `community-profile-client.ts`.
