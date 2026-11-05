// File: src/all-tasks.ts
import { BENCHMARK_TASKS } from "./task-registry.js";
import { REAL_WORLD_TASKS, ABSTENTION_TRAP_TASKS } from "./tasks/real-world.js"
import { CONTEXT_STRESS_TASKS } from "./tasks/context-stress.js"
import { LONG_HORIZON_TASKS } from "./tasks/long-horizon.js"

// ABSTENTION_TRAP_TASKS was authored and then never referenced: it appeared in
// no ALL_TASKS spread and no session, so `ab-trap-*` was unreachable from any
// bench cell (found 2026-07-09 by the long-horizon arm test). These are the
// only tasks that exercise forced abstention — the path both control-plane
// seam fixes changed — and they are scored deterministically by
// `scoreAbstention` (abstain => 1.0, any answer => 0.0), no LLM judge.
export const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS, ...ABSTENTION_TRAP_TASKS, ...CONTEXT_STRESS_TASKS, ...LONG_HORIZON_TASKS] as const
