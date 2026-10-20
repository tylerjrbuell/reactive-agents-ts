---
type: plan
status: active
created: 2026-10-20
tags: [runtime, decomposition, hS-247, bundle]
---

# Bundle: runtime-reactive-agent-decomp

Date: 2026-10-20
Budget: 90 min (warden execution; parent verification extra)
Issues: #217 (HS-247)
Warden: runtime-warden (dispatched as generic subagent — OpenCode harness has no native warden agent types; definition embedded, deviation recorded in retro)

## Acceptance criteria
- #217: `packages/runtime/src/reactive-agent.ts` reduced to ≤2450 LOC by extracting cohesive private-method clusters into `packages/runtime/src/agent/*` modules (gateway-* factor-out precedent); public class surface unchanged; no test content modified.

## Execution units (ordered)
1. **Unit 1:** judgment cluster (judge / listJudgmentModels / judgeRank + `buildSchemaSteering` + `parseJsonLoose`) → `agent/judgment-facade.ts`
2. **Unit 2:** skills cluster (skills / exportSkill / loadSkill / refineSkills) → `agent/skills-facade.ts`
3. **Unit 3:** durable-run cluster (resumeRun / fork / listRuns / approveRun / denyRun / decideAndResumeRun / listPendingApprovals / getDurableInfo / listPendingInteractions / respondToInteraction) → `agent/durable-facade.ts`
4. **Unit 4 (budget-gated):** `buildRunTaskEffect` (~450-LOC single method) → `agent/run-task-effect.ts`; descope if over budget

## Risk register
- Private-field coupling in extracted clusters → extracted functions take an explicit deps object, class methods delegate; never reach into class internals via casts
- Public surface drift → grep `^export ` stays 4; class method names unchanged; tests unmodified
- Cast-ceiling regression → zero new `as unknown as` sites; ceiling gate run pre/post
- Peer session active on dev locally → all work happens in worktree `/tmp/opencode/bundle-217`, main checkout untouched

## Baseline (captured at branch time, origin/dev = 6f4d51fe3)
- `wc -l packages/runtime/src/reactive-agent.ts` → 3303
- `grep -c "^export "` → 4
- `as unknown as` count in packages/runtime/src → 39
- `bun test packages/runtime/` → 1677 pass / 7 skip / 0 fail (309 files)
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` → 2 pass / 0 fail

## Verification protocol (cross-cutting)
- `bunx turbo run typecheck --filter=@reactive-agents/runtime` — green
- `bun test packages/runtime/` — green, no net-new fails vs baseline
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — green, ceilings untouched
- `grep -c "^export " packages/runtime/src/reactive-agent.ts` == 4
- `wc -l packages/runtime/src/reactive-agent.ts` ≤ 2450

## Out-of-scope (explicit)
- builder.ts (#218) and think.ts (#219) decomposition — named follow-up bundles
- execution-engine.ts (#221) — follow-up
- Any behavioral change to agent methods
