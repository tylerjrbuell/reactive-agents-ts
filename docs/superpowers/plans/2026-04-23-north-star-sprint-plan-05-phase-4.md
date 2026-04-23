# North Star Sprint Plan — Part 5: Phase 4 (Closed Learning Loop — Conditional)

**Duration:** 2 sprints (2 weeks, weeks 9-10 of the plan). **GATED** on the Phase 0 debrief-quality spike (S0.7) result.
**Goal:** the self-improvement snowball from north-star §12.7 closes. Successful tasks produce typed Skills; next-run tasks retrieve matching Skills and use fewer iterations for the same outcome.
**Preconditions:**
- Phase 3 closed (v1.0 cut-ready)
- **Phase 0 debrief-quality spike (S0.7) graded ≥6/10 probe traces as A or B** (distillable into skills)
- Typed Skill schema fully expanded (P2.S2.3)
- Passive skill capture accumulating skills (P1.S3.6)

**North-star reference:** §14 Phase 4, §12.4 typed Skill, §12.7 compound chain diagram, Q3 resolution, Q12 claim-extraction policy.

---

## Gating decision

Before Phase 4 kicks off, the Lead must verify:

1. **Phase 0 spike result:** read `harness-reports/debrief-quality-spike-2026-04-23.md`. If ≥6 of 10 traces graded A or B → proceed. Else:
   - Option A: re-scope Phase 4 as a separate ~3-week project "build distillation pipeline first"
   - Option B: descope Phase 4b (active retrieval) for v1.0, keep only Phase 4a (passive capture, already shipped in P1)

2. **Skill corpus size:** after Phase 1-3 ran, ≥100 typed Skills in memory store. If under that, run a seeding pass (replay 50 canonical probes with recording-on) to accumulate a baseline corpus.

3. **Advisor open question (from v2.3 review):** "§12.4 Skill retrieval assumes Task similarity, which is undefined." — this question is answered in P4.S1.1 below. If the team doesn't accept the default (embedding cosine on task.text), reset and decide before sprint start.

---

## Sprint structure

| Sprint | Week | Theme | Stories |
|---|---|---|---|
| **P4.S1** | 9 | TaskSimilarity + Skill retrieval + Active injection | 4 stories |
| **P4.S2** | 10 | Skill decay + composition + probe validation + metrics | 4 stories |

---

## Sprint P4.S1 — TaskSimilarity + Skill retrieval + Active injection

**Goal:** the ContextCurator (from P1) retrieves matching Skills at task start and injects them into the system-prompt guidance. Second-run tasks benefit from first-run learnings.

**Success gate:** `skill-reuse-iteration-delta` probe shows ≥30% iteration reduction on local tier, ≥40% on mid tier, on a canonical repeat-task corpus.

### Story P4.S1.1 — `TaskSimilarity` service

**Intent:** answer the advisor's open question. How does Skill retrieval match Tasks? Decision: **hybrid — embedding cosine on `task.text` (primary) + structural bonus for matching `task.intent` and `task.deliverables`**.

**Files:**
- `packages/core/src/task-similarity/service.ts` (NEW) — `TaskSimilarityService` interface
- `packages/reasoning/src/strategies/kernel/utils/task-similarity-embedding.ts` (NEW) — default adapter
- `packages/core/tests/task-similarity.test.ts`
- Probe: `task-similarity-precision` (NEW) — synthetic tasks with known similarity grades
- Changeset: required (minor, new public API)

**RED:**

```ts
describe("TaskSimilarity", () => {
  it("returns 1.0 for identical tasks", async () => {
    const t1: Task = { id: "a", text: "extract top 10 languages", intent: "extract", ... }
    const t2: Task = { ...t1, id: "b" }
    const svc = makeTaskSimilarityService()
    const score = await Effect.runPromise(svc.similarity(t1, t2))
    expect(score).toBeGreaterThan(0.95)
  })

  it("returns near-0 for unrelated tasks", async () => {
    const t1: Task = { id: "a", text: "extract top 10 languages", intent: "extract", ... }
    const t2: Task = { id: "b", text: "summarize the weather report", intent: "summarize", ... }
    const score = await Effect.runPromise(svc.similarity(t1, t2))
    expect(score).toBeLessThan(0.4)
  })

  it("structural bonus when intent + deliverables match", async () => {
    // two tasks with same intent + deliverables but different text
    const a = { intent: "extract", deliverables: [{ name: "markdown-table" }], text: "top languages" }
    const b = { intent: "extract", deliverables: [{ name: "markdown-table" }], text: "top frameworks" }
    const score = await similarity(a, b)
    // score should be higher than a similar text-only comparison would suggest
    expect(score).toBeGreaterThan(0.6)
  })

  it("retrieveMatching returns top-K above threshold", async () => {
    // seed 20 tasks; retrieve top 3 for a query
    const matches = await svc.retrieveMatching(queryTask, 3, 0.5)
    expect(matches.length).toBeLessThanOrEqual(3)
    expect(matches.every((m) => m.score > 0.5)).toBe(true)
  })
})
```

**GREEN:**

```ts
// packages/reasoning/src/strategies/kernel/utils/task-similarity-embedding.ts
export const makeEmbeddingTaskSimilarity = (
  embedder: EmbeddingService,
): TaskSimilarityService => ({
  similarity: (a, b) =>
    Effect.gen(function* () {
      const [ea, eb] = yield* Effect.all([embedder.embed(a.text), embedder.embed(b.text)])
      const textCosine = cosine(ea, eb)
      const intentBonus = a.intent === b.intent ? 0.1 : 0
      const deliverableBonus = overlappingDeliverables(a, b) > 0 ? 0.05 : 0
      return Math.min(1, textCosine + intentBonus + deliverableBonus)
    }),
  retrieveMatching: (query, k, threshold) =>
    // embeddings retrieved from Skill store; filter by threshold; top-k
})
```

**Acceptance:** 4 tests green. Probe `task-similarity-precision` on curated synthetic corpus: precision@3 ≥ 0.7, recall@3 ≥ 0.6.

**Effort:** 5. **Risk:** MEDIUM (similarity quality matters for Phase 4 outcomes). **Dependencies:** P1.S3.5 (Task primitive), P3 Budget<T> if we gate embedding calls.

---

### Story P4.S1.2 — Skill retrieval in ContextCurator

**Intent:** curator calls `AgentMemory.retrieveSkills(task, k=3)` at task start; matching Skills rendered into system-prompt guidance.

**Files:**
- `packages/memory/src/adapters/sqlite-vec/adapter.ts` — add `retrieveSkills(task, k, threshold)` method using `TaskSimilarityService`
- `packages/reasoning/src/context/context-curator.ts` — wire skill retrieval at task start
- `packages/reasoning/src/context/skill-rendering.ts` (NEW) — renders a list of Skills into a prompt fragment
- `packages/reasoning/tests/curator-skill-retrieval.test.ts`
- Probe: `skill-retrieval-on-task-start` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("ContextCurator skill retrieval", () => {
  it("calls retrieveSkills at task start", async () => {
    const spy = spyOnRetrieveSkills()
    await agent.run(task)
    expect(spy.callCount).toBeGreaterThanOrEqual(1)
  })

  it("respects config.memory.skillsTopK (default 3)", async () => {
    const agent = makeAgent({ memory: { skillsTopK: 5 } })
    await agent.run(task)
    expect(lastRetrieveSkillsCall.k).toBe(5)
  })

  it("injects retrieved skills into system-prompt guidance block", async () => {
    const seededSkill: Skill = { ..., knowledge: { content: "Prefer markdown tables for extraction tasks.", ... } }
    await seedSkill(seededSkill)
    const prompt = await buildSystemPromptForTask(extractionTask)
    expect(prompt).toContain("Prefer markdown tables for extraction tasks.")
  })

  it("excludes retired skills", async () => {
    await seedSkill({ ..., status: "retired" })
    const matches = await curator.getActiveSkillsForTask(task)
    expect(matches.every((s) => s.status !== "retired")).toBe(true)
  })
})
```

**GREEN:** `ContextCurator.buildSystemPrompt()` gains a skill-block section:

```ts
const skills = yield* memory.retrieveSkills(task, config.memory.skillsTopK ?? 3, 0.5)
const active = skills.filter((s) => s.status !== "retired")
const skillBlock = active.length > 0 ? renderSkills(active) : ""
systemPrompt += skillBlock
```

**Acceptance:** 4 tests green. Probe `skill-retrieval-on-task-start` green.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P4.S1.1, P2.S2.3 (Skill expansion), P1.S3.4 (Curator).

---

### Story P4.S1.3 — Skill metrics update on activation

**Intent:** when a Skill is retrieved + injected, increment `metrics.activations`. When the task completes, update `metrics.successes` / `metrics.failures` based on verification result. Compute `metrics.averageIterationDelta` vs. control baseline.

**Files:**
- `packages/memory/src/adapters/sqlite-vec/skill-metrics.ts` (NEW) — metrics update on write
- `packages/reasoning/src/strategies/kernel/utils/skill-activation-tracker.ts` (NEW)
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — track which skills were active; on task end, update metrics
- `packages/memory/tests/skill-metrics.test.ts`
- Probe: `skill-metrics-update` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("Skill metrics", () => {
  it("activations increment when skill injected", async () => {
    const before = await getSkill("s1")
    await agent.run(task)  // retrieves s1
    const after = await getSkill("s1")
    expect(after.metrics.activations).toBe(before.metrics.activations + 1)
    expect(after.metrics.lastUsed).toBeGreaterThan(before.metrics.lastUsed)
  })

  it("successes increment on verification-passing task end", async () => {
    await agent.run(task)  // verifies ok
    const s = await getSkill("s1")
    expect(s.metrics.successes).toBeGreaterThan(0)
  })

  it("failures increment on verification-failing task end", async () => {
    await agent.run(hardTask)
    const s = await getSkill("s1")
    expect(s.metrics.failures).toBeGreaterThan(0)
  })

  it("averageIterationDelta computed vs. baseline", async () => {
    // run same task with skill active vs. skill inactive; delta = control_iters - skill_iters
    const delta = await getSkill("s1").then((s) => s.metrics.averageIterationDelta)
    expect(delta).toBeGreaterThanOrEqual(0)  // skill should not hurt
  })
})
```

**GREEN:** straightforward metric updates. Baseline for delta computed by running the same task with `config.memory.skillsTopK: 0` periodically (control runs).

**Acceptance:** 4 tests green. Probe `skill-metrics-update` green.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P4.S1.2, P2.S2.1 (verification for success/failure).

---

### Story P4.S1.4 — Negative skill matching (failure-pattern-match)

**Intent:** debrief on a FAILED task stores a Skill with `trigger.kind: "failure-pattern-match"` and `errorTag` from the failing error. Next run retrieves both positive and negative skills; curator renders "avoid this pattern" guidance from negative skills.

**Files:**
- `packages/reasoning/src/strategies/kernel/utils/debrief.ts` — emit negative skill on task failure
- `packages/memory/src/adapters/sqlite-vec/adapter.ts` — `retrieveSkills` considers both positive and negative
- `packages/reasoning/src/context/skill-rendering.ts` — render negative skills distinctly (`avoid:` prefix)
- `packages/reasoning/tests/negative-skill.test.ts`
- Probe: `negative-skill-avoidance` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("negative skills (failure patterns)", () => {
  it("failed task emits failure-pattern Skill", async () => {
    const memSpy = spyOnStoreMemory()
    await agent.run(failingTask)
    const negSkill = memSpy.calls.find((c) =>
      c.taxonomy === "skill" && c.content.trigger.kind === "failure-pattern-match",
    )
    expect(negSkill).toBeDefined()
    expect(negSkill!.content.trigger.errorTag).toBeDefined()
  })

  it("retrieveSkills returns both positive and negative", async () => {
    const matches = await memory.retrieveSkills(similarFailedTask, 5)
    expect(matches.some((m) => m.status === "active")).toBe(true)
    // at least one negative skill in matches
  })

  it("curator renders 'avoid:' block for negative skills", async () => {
    const prompt = await buildSystemPromptForTask(similarFailedTask)
    expect(prompt).toMatch(/avoid:.*previously\s+failed/i)
  })

  it("probe: negative-skill-avoidance — task that failed last time succeeds this time", async () => {
    await agent.run(task1)  // fails
    await agent.run(task1)  // should succeed OR at least not repeat the same error
  })
})
```

**GREEN:** debrief branches on task outcome; writes negative skill when `verification.ok === false` or status === "failed".

**Acceptance:** 4 tests green. Probe `negative-skill-avoidance` green.

**Effort:** 5. **Risk:** MEDIUM. **Dependencies:** P4.S1.2, P2.S2.1 (verification determines failure).

---

### Sprint P4.S1 close

**Demo:**
- `skill-retrieval-on-task-start` green
- `skill-metrics-update` green
- `negative-skill-avoidance` green
- A live agent run shows retrieved skills in the system prompt

**Retro:**
- Any false-positive skill retrieval causing task drift? Tune similarity threshold.
- Metrics update overhead visible in microbench? Consider batching.

---

## Sprint P4.S2 — Decay + composition + probe validation + metrics

**Goal:** skills that stop working are retired. Skills can compose. The headline `skill-reuse-iteration-delta` probe validates the loop closes.

**Success gate:** `skill-reuse-iteration-delta` probe shows ≥30% iteration reduction on local tier, ≥40% on mid, on a 10-task repeat corpus.

### Story P4.S2.1 — Skill decay worker

**Intent:** a scheduled task (or on-write hook) that recomputes `skill.status`. If success rate drops below 0.5 for ≥10 activations → `decaying`. If sustained for 5 runs while decaying → `retired`.

**Files:**
- `packages/memory/src/adapters/sqlite-vec/skill-decay.ts` (NEW)
- `packages/memory/tests/skill-decay.test.ts`
- Probe: `skill-decay-lifecycle` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("skill decay worker", () => {
  it("active → decaying when success rate <0.5 over 10+ activations", async () => {
    const s = seed({ activations: 15, successes: 5, failures: 10, status: "active" })
    await runDecayWorker()
    const updated = await getSkill(s.id)
    expect(updated.status).toBe("decaying")
  })

  it("decaying → retired when sustained decay", async () => {
    // skill marked decaying 5 runs ago; still decaying; retire
  })

  it("retired skill not returned by retrieveSkills", async () => {
    const retired = seed({ status: "retired" })
    const matches = await memory.retrieveSkills(task, 10)
    expect(matches.map((s) => s.id)).not.toContain(retired.id)
  })

  it("decay worker is idempotent", async () => {
    await runDecayWorker()
    await runDecayWorker()
    // no double-transition
  })
})
```

**GREEN:** simple computation over metrics; run on-write + periodic.

**Acceptance:** 4 tests green. Probe `skill-decay-lifecycle` green.

**Effort:** 3. **Risk:** Low. **Dependencies:** P4.S1.3 (metrics populated).

---

### Story P4.S2.2 — Skill composition (composite protocol kind)

**Intent:** a Skill's `protocol` can be `{ kind: "composite", skills: SkillRef[] }`. Retrieval pulls the composite; curator recursively renders referenced skills.

**Files:**
- `packages/core/src/skill.ts` — composite protocol already defined from P2.S2.3; wire expansion
- `packages/reasoning/src/context/skill-rendering.ts` — recursive expansion
- `packages/reasoning/tests/skill-composition.test.ts`
- Probe: `skill-composition` (NEW)
- Changeset: required (minor)

**RED:**

```ts
describe("skill composition", () => {
  it("composite skill expands to referenced skills in rendering", async () => {
    const s1: Skill = { id: "leaf-1", knowledge: { content: "Rule A" }, ... }
    const s2: Skill = { id: "leaf-2", knowledge: { content: "Rule B" }, ... }
    const composite: Skill = {
      id: "comp",
      protocol: { kind: "composite", skills: [{ skillId: "leaf-1" }, { skillId: "leaf-2" }] },
      knowledge: { content: "Combined research protocol." },
      ...
    }
    const rendered = await renderSkills([composite])
    expect(rendered).toContain("Combined research protocol.")
    expect(rendered).toContain("Rule A")
    expect(rendered).toContain("Rule B")
  })

  it("cycles detected and broken", async () => {
    // composite A refs B, B refs A; expect no infinite loop
  })

  it("missing referenced skill handled gracefully (log warning, continue)", async () => {})
})
```

**GREEN:** recursive walk with cycle detection (visited set).

**Acceptance:** 3 tests green. Probe `skill-composition` green.

**Effort:** 3. **Risk:** Low. **Dependencies:** P4.S1.2 (retrieval + rendering).

---

### Story P4.S2.3 — `skill-reuse-iteration-delta` probe validation

**Intent:** the HEADLINE probe for Phase 4. Validates the compound chain closes.

**Files:**
- `.agents/skills/harness-improvement-loop/scripts/probes/skill-reuse-iteration-delta.ts` (NEW)
- `.agents/skills/harness-improvement-loop/scripts/probes/fixtures/repeat-task-corpus.json` (NEW) — 10 canonical tasks
- Changeset: required (documentation update)

**Activity:**

1. Seed memory store empty.
2. Run each of the 10 tasks fresh → record `control_iterations[task]`.
3. Clear memory? No — keep the skills produced during step 2.
4. Run each of the 10 tasks again → record `reuse_iterations[task]`.
5. Compute `delta[task] = (control - reuse) / control`.
6. Assert: median(delta) ≥ 0.30 on local tier, ≥ 0.40 on mid tier, ≥ 0.20 on frontier (frontier has less headroom — it converges fast already).

**RED:**

```ts
describe("skill-reuse-iteration-delta probe", () => {
  it("local tier: median iteration reduction ≥30%", async () => {
    const result = await runSkillReuseProbe({ tier: "local" })
    expect(result.medianReduction).toBeGreaterThanOrEqual(0.30)
  }, { timeout: 600000 })  // 10 min for full probe

  it("same answer quality on reuse (judge delta ≤5%)", async () => {
    const result = await runSkillReuseProbe({ tier: "local" })
    expect(result.qualityDelta).toBeLessThanOrEqual(0.05)
  }, { timeout: 600000 })
})
```

**GREEN:** straightforward probe runner.

**Acceptance:** probe green on local tier AND mid tier. Frontier is aspirational at this phase.

**Effort:** 5. **Risk:** HIGH (if probe fails, Phase 4 ships with a visible gap). **Dependencies:** everything in P4.S1 + S2.1 + S2.2.

**If this probe fails:**
- Run diagnostics on the top-3 tasks with smallest delta
- Check: was the retrieved skill relevant? (inspect `TaskSimilarity` score)
- Check: did the model actually use the skill? (inspect `InterventionDispatched` / `SkillActivated` events)
- Root cause one of: (a) bad similarity scoring, (b) bad skill content quality, (c) model ignoring injected guidance
- Each root cause has a specific fix; the Lead decides whether to patch-and-retry or descope to Phase 4.5

---

### Story P4.S2.4 — Metrics dashboard / inspection

**Intent:** expose skill metrics via CLI + memory inspection. Developers want to see which skills are working without running probes.

**Files:**
- `apps/cli/src/commands/skills.ts` (NEW) — `rax skills list`, `rax skills show <id>`, `rax skills metrics`
- `packages/runtime/src/agent-config.ts` — expose `ReactiveAgent.listSkills()` method
- `apps/cli/tests/skills-command.test.ts`
- `apps/docs/src/content/docs/reference/cli.md` — document
- Changeset: required (minor; CLI addition)

**RED:**

```ts
describe("rax skills CLI", () => {
  it("list returns active skills with metrics", async () => {
    const out = await runCli(["skills", "list"])
    expect(out).toContain("activations")
    expect(out).toContain("status")
  })

  it("show <id> dumps full skill JSON", async () => {})
  it("metrics shows aggregated health", async () => {})
})
```

**GREEN:** thin CLI wrappers over `memory.listSkills` + formatters.

**Acceptance:** 3 tests green. CLI command documented.

**Effort:** 3. **Risk:** Low. **Dependencies:** P4.S2.1 (decay status displayable).

---

### Sprint P4.S2 close

**Demo:**
- `skill-reuse-iteration-delta` probe green: ≥30% iteration reduction on local tier
- Skill decay lifecycle visible in memory via CLI
- `skill-composition` probe green
- Dashboard/CLI inspection working

**Retro:**
- Is 30%/40% the right target, or was it too easy/too hard? Feed back into north-star §11.3 concrete expectations.
- Any skill retrieval unexpectedly pulling irrelevant content? Tune similarity threshold; consider stricter intent-matching.

---

## Phase 4 close — success-gate recap (north-star §14)

| Gate | Verified by |
|---|---|
| Same task run twice → second run uses fewer iterations with same answer quality | `skill-reuse-iteration-delta` probe |
| At least 30% iter reduction on local tier | probe median |
| Quality delta ≤ 5% vs. control runs | probe quality check |

Plus shared gates:
- `bun test` + `bun run build` + `bun run typecheck` all green
- `/review-patterns` 9/9 on every PR
- Changesets added; docs synced
- All P0-P3 probes still green (no regressions)

---

## Full plan close — v1.1 release

If Phase 4 ships green:

1. Run full benchmark + probe suite on the canonical task corpus.
2. Commit `harness-reports/quarterly-benchmark-2026-06-<date>.json` with per-tier expectation verification (north-star §11.3).
3. `bun run changeset` → minor release (v1.1.0 — "closed learning loop").
4. Update `ROADMAP.md`: move "Phase 4" from target → ✅ Released.
5. Update MEMORY.md + Claude memory with "v1.1 shipped closed learning loop on <date>".
6. Cut `v1.1.0` tag.

Phase 4 outputs available for v1.2+:
- `TaskSimilarity` port (pluggable; default embedding-based)
- `SkillMetrics` structure (enables future skill-quality dashboards)
- Negative skills (enables failure-pattern preemption)
- Composite skills (enables domain skill libraries)

---

## Post-Phase-4 ideas (explicitly NOT in scope)

These came up during Phase 4 planning; recorded here for future-sprint consideration but NOT implemented now:

- **Skill marketplace / portability.** Not a v1.x concern; post-Pi-evaluation decision.
- **Multi-agent Skill sharing.** Belongs in the multi-agent orchestration spec (saved to memory).
- **User-curated Skills.** Developer writes a Skill by hand, imports via `.withSkills([...])`. Minor addition; can slip to a v1.2 sprint.
- **Skill A/B testing harness.** Randomize skill retrieval on/off across runs; measure delta. Nice-to-have.

---

## Contingency plans

**If `skill-reuse-iteration-delta` probe fails after Sprint 2:**

Option 1 — **Extend Phase 4 by 1 sprint** (total 3 weeks). Diagnose + fix the weakest link. Most likely: the similarity score is too permissive (pulls irrelevant skills). Fix: raise threshold, tighten intent matching.

Option 2 — **Ship Phase 4 partial** with probe flagged as "aspirational" in north-star §11.3. Update the target from 30% → measured baseline + 5% for v1.1; aim for 30% in v1.2.

Option 3 — **Descope to passive-only (Phase 4a already shipped in P1).** v1.0 has passive capture; v1.1 becomes smaller (just UX polish, CLI, etc.); active retrieval moves to a separate project.

Lead decides which option at the end of Sprint 2 based on probe diagnostics.

---

## Summary — Phase 4 value proposition

If Phase 4 ships green:

- The compound chain from north-star §12.7 closes structurally
- Local-tier agents improve measurably with usage (the vision's "evolutionary intelligence" pillar)
- Repeat tasks get faster, not just more consistent
- Negative skills prevent re-running into known failure modes
- Framework has a compelling "learns from experience" marketing claim backed by measurable probes

If Phase 4 ships with the probe aspirational:

- v1.0 still ships clean (Phases 0-3)
- Active retrieval becomes a visible roadmap item for v1.1 or v1.2
- No broken promises — the north-star §11.4 honest-limits section already says "not solving novel research problems" so expectations are calibrated
