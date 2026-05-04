# Living Intelligence System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Living Skills System, Intelligence Control Surface expansion, data enrichment, test model guards, context-aware skill management, and builder/runtime API — everything in the spec except telemetry server changes (separate plan).

**Architecture:** Skills live as `SkillRecord` entities in SQLite (memory package), resolved at bootstrap by `SkillResolver` (reactive-intelligence), evolved via `SkillEvolutionService` (memory) + `SkillDistillerService` (reactive-intelligence). The controller expands from 3→10 decision types. Meta-tools (`activate_skill`, `get_skill_section`) give the model on-demand skill access. Context-aware injection guards prevent skill content from crowding smaller models.

**Tech Stack:** Effect-TS services, bun:sqlite, bun:test, YAML frontmatter parsing (gray-matter or manual), SKILL.md markdown format

**Spec:** `docs/superpowers/specs/2026-03-23-living-intelligence-system-design.md`

**Out of scope (separate plans):**
- Telemetry server schema + endpoints (different repo)
- Effect-TS public API abstraction
- Docs overhaul
- CLI commands (`rax skill export`, `rax skill list`) — deferred to CLI enhancement pass
- Zettelkasten-based skill conflict detection (Section 4.8) — depends on existing graph; tracked for follow-up

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/types/skill.ts` | `SkillRecord`, `SkillVersion`, `SkillVerbosityMode`, `SkillTierBudget` types |
| `packages/core/src/types/intelligence-events.ts` | Skill lifecycle + intelligence control EventBus event types |
| `packages/memory/src/services/skill-store.ts` | `SkillStoreService` — CRUD for SkillRecord, SQLite `skills` + `skill_versions` tables |
| `packages/memory/src/services/skill-evolution.ts` | `SkillEvolutionService` — LLM refinement, version management, rollback, candidate→active promotion |
| `packages/reactive-intelligence/src/skills/skill-registry.ts` | `SkillRegistry` — filesystem scanner for SKILL.md directories, agentskills.io YAML parser |
| `packages/reactive-intelligence/src/skills/skill-resolver.ts` | `SkillResolverService` — unified resolution (SQLite + filesystem), precedence, catalog XML generation |
| `packages/reactive-intelligence/src/skills/skill-distiller.ts` | `SkillDistillerService` — episodic evidence retrieval, per-skill threshold, calls SkillEvolutionService |
| `packages/reactive-intelligence/src/skills/skill-compression.ts` | `compressSkillContent()` — 5-stage compression pipeline for context-aware injection |
| `packages/tools/src/skills/activate-skill.ts` | `activate_skill` meta-tool definition |
| `packages/tools/src/skills/get-skill-section.ts` | `get_skill_section` meta-tool definition |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/core/src/types/index.ts` | Re-export skill types + intelligence event types |
| `packages/core/src/index.ts` | Re-export new types |
| `packages/memory/src/types.ts` | Add `provider?: string` to `DailyLogEntrySchema`; extend `MemoryBootstrapResult` with `activeSkills` |
| `packages/memory/src/database.ts` | Add `skills` + `skill_versions` table DDL |
| `packages/memory/src/services/memory-consolidator.ts` | Wire CONNECT phase to optional `SkillDistillerService` |
| `packages/memory/src/services/index.ts` | Re-export SkillStoreService + SkillEvolutionService |
| `packages/reactive-intelligence/src/types.ts` | Extend `ControllerDecision` union (+7), `ControllerEvalParams` (+8 fields), `RunCompletedData` (+enrichment), enable `skillSynthesis`+`banditSelection` defaults |
| `packages/reactive-intelligence/src/controller/controller-service.ts` | Add 7 new evaluators |
| `packages/reactive-intelligence/src/telemetry/telemetry-client.ts` | Add `isTestRun()` guard, fix notice |
| `packages/reactive-intelligence/src/telemetry/types.ts` | Add new `RunReport` telemetry fields |
| `packages/reactive-intelligence/src/learning/learning-engine.ts` | Add test model guard, pass enriched data |
| `packages/reactive-intelligence/src/learning/skill-synthesis.ts` | Fix 3 TODO stubs |
| `packages/reactive-intelligence/src/runtime.ts` | Wire SkillResolverService + SkillDistillerService into layer |
| `packages/runtime/src/execution-engine.ts` | Wire bootstrap skill resolution, enrich `onRunCompleted`, provider field on episodic entries |
| `packages/runtime/src/builder.ts` | `.withSkills()` builder method, extended `.withReactiveIntelligence()` hooks |
| `packages/tools/src/index.ts` | Export activate_skill + get_skill_section, auto-include logic |

### Test Files (one per new/modified service)

| File | Tests |
|------|-------|
| `packages/core/src/types/__tests__/skill.test.ts` | Type construction + validation |
| `packages/memory/src/services/__tests__/skill-store.test.ts` | CRUD, findByTask, promote, rollback |
| `packages/memory/src/services/__tests__/skill-evolution.test.ts` | Refinement, versioning, candidate→active, locked guard |
| `packages/reactive-intelligence/src/skills/__tests__/skill-registry.test.ts` | Filesystem scan, YAML parse, collision handling |
| `packages/reactive-intelligence/src/skills/__tests__/skill-resolver.test.ts` | Unified resolution, precedence, catalog XML |
| `packages/reactive-intelligence/src/skills/__tests__/skill-distiller.test.ts` | Threshold logic, test-provider filtering, consolidator wiring |
| `packages/reactive-intelligence/src/skills/__tests__/skill-compression.test.ts` | 5-stage compression, tier mapping |
| `packages/reactive-intelligence/src/controller/__tests__/new-evaluators.test.ts` | 7 new evaluators individually |
| `packages/reactive-intelligence/src/telemetry/__tests__/test-guard.test.ts` | isTestRun guard, notice suppression |
| `packages/reactive-intelligence/src/learning/__tests__/enrichment.test.ts` | RunCompletedData enrichment, test guard |
| `packages/tools/src/skills/__tests__/activate-skill.test.ts` | XML output, skill-not-found case |
| `packages/tools/src/skills/__tests__/get-skill-section.test.ts` | Section parsing, section-not-found, auto-include rule |
| `packages/runtime/src/__tests__/skill-wiring.test.ts` | Bootstrap skill resolution, post-run learning wiring |
| `packages/runtime/src/__tests__/builder-skills.test.ts` | .withSkills() config, .withReactiveIntelligence() hooks |

---

## Task 1: Skill Types + Intelligence Event Types

**Files:**
- Create: `packages/core/src/types/skill.ts`
- Create: `packages/core/src/types/intelligence-events.ts`
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/types/__tests__/skill.test.ts`

- [ ] **Step 1: Write test for SkillRecord type construction**

```typescript
// packages/core/src/types/__tests__/skill.test.ts
import { describe, test, expect } from "bun:test";
import type { SkillRecord, SkillVersion, SkillVerbosityMode } from "../skill.js";

describe("SkillRecord types", () => {
  test("SkillRecord can be constructed with all required fields", () => {
    const record: SkillRecord = {
      id: "skill-1",
      name: "data-analysis",
      description: "Analyze data sets",
      agentId: "agent-1",
      source: "learned",
      instructions: "# Steps\n1. Load data\n2. Analyze",
      version: 1,
      versionHistory: [],
      config: {
        strategy: "reactive",
        temperature: 0.7,
        maxIterations: 5,
        promptTemplateId: "default",
        systemPromptTokens: 0,
        compressionEnabled: false,
      },
      evolutionMode: "auto",
      confidence: "tentative",
      successRate: 0,
      useCount: 0,
      refinementCount: 0,
      taskCategories: ["coding"],
      modelAffinities: ["claude-sonnet-4"],
      base: null,
      avgPostActivationEntropyDelta: 0,
      avgConvergenceIteration: 0,
      convergenceSpeedTrend: [],
      conflictsWith: [],
      lastActivatedAt: null,
      lastRefinedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contentVariants: { full: "# Steps\n1. Load data\n2. Analyze", summary: null, condensed: null },
    };
    expect(record.name).toBe("data-analysis");
    expect(record.confidence).toBe("tentative");
  });

  test("SkillVersion tracks candidate/active status", () => {
    const version: SkillVersion = {
      version: 2,
      instructions: "Updated instructions",
      config: { strategy: "plan-execute-reflect", temperature: 0.5, maxIterations: 4, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false },
      refinedAt: new Date(),
      successRateAtRefinement: 0.85,
      status: "candidate",
    };
    expect(version.status).toBe("candidate");
  });

  test("SkillVerbosityMode has correct values", () => {
    const modes: SkillVerbosityMode[] = ["full", "summary", "condensed", "catalog-only"];
    expect(modes).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/core && bun test src/types/__tests__/skill.test.ts
```
Expected: FAIL — `../skill.js` module not found

- [ ] **Step 3: Create skill types file**

Create `packages/core/src/types/skill.ts` with:
- `SkillFragment` type (import from reactive-intelligence or redefine locally — check spec Section 4.3)
- `SkillRecord` type (all fields from spec Section 4.3 + `contentVariants` from Section 4.9)
- `SkillVersion` type
- `SkillVerbosityMode = "full" | "summary" | "condensed" | "catalog-only"`
- `SkillTierBudget = { tier: string; budgetTokens: number; maxActiveSkills: number; defaultVerbosity: SkillVerbosityMode }`
- `SkillSource = "learned" | "installed" | "promoted"`
- `SkillConfidence = "tentative" | "trusted" | "expert"`
- `SkillEvolutionMode = "auto" | "suggest" | "locked"`

Refer to spec Section 4.3 for the full `SkillRecord` shape. Include `contentVariants: { full: string; summary: string | null; condensed: string | null }`.

- [ ] **Step 4: Create intelligence event types file**

Create `packages/core/src/types/intelligence-events.ts` with all event types from spec Section 8:

Skill lifecycle events:
- `SkillActivated`, `SkillRefined`, `SkillRefinementSuggested`, `SkillRolledBack`
- `SkillConflictDetected`, `SkillPromoted`, `SkillSkippedContextFull`, `SkillEvicted`

Intelligence control events:
- `TemperatureAdjusted`, `ToolInjected`, `MemoryBoostTriggered`, `AgentNeedsHuman`

Export a union type `SkillEvent` and `IntelligenceEvent` for EventBus subscription.

- [ ] **Step 5: Update index exports**

Add re-exports in `packages/core/src/types/index.ts` and `packages/core/src/index.ts`.

- [ ] **Step 6: Run test — verify it passes**

```bash
cd packages/core && bun test src/types/__tests__/skill.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/skill.ts packages/core/src/types/intelligence-events.ts packages/core/src/types/index.ts packages/core/src/types/__tests__/skill.test.ts packages/core/src/index.ts
git commit -m "feat(core): add SkillRecord types and intelligence event types"
```

---

## Task 2: DailyLogEntrySchema provider field + MemoryBootstrapResult extension

**Files:**
- Modify: `packages/memory/src/types.ts`
- Test: `packages/memory/src/services/__tests__/skill-store.test.ts` (first few assertions only — store comes in Task 3)

- [ ] **Step 1: Write test for DailyLogEntrySchema accepting provider field**

```typescript
// Add to existing memory types tests or create new file
import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import { DailyLogEntrySchema } from "../../types.js";

describe("DailyLogEntrySchema provider field", () => {
  test("accepts optional provider field", () => {
    const entry = Schema.decodeSync(DailyLogEntrySchema)({
      date: "2026-03-23",
      agentId: "agent-1",
      eventType: "task_completed",
      summary: "Did a thing",
      provider: "anthropic",
    });
    expect(entry.provider).toBe("anthropic");
  });

  test("provider field is optional", () => {
    const entry = Schema.decodeSync(DailyLogEntrySchema)({
      date: "2026-03-23",
      agentId: "agent-1",
      eventType: "task_completed",
      summary: "Did a thing",
    });
    expect(entry.provider).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd packages/memory && bun test src/services/__tests__/daily-log-provider.test.ts
```

- [ ] **Step 3: Add `provider` field to DailyLogEntrySchema**

In `packages/memory/src/types.ts`, add `provider: Schema.optional(Schema.String)` to the `DailyLogEntrySchema` struct.

Also add `activeSkills: readonly SkillRecord[]` to `MemoryBootstrapResult` type (import `SkillRecord` from `@reactive-agents/core`). Default to `[]` where `MemoryBootstrapResult` is constructed.

- [ ] **Step 4: Run test — verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/types.ts packages/memory/src/services/__tests__/daily-log-provider.test.ts
git commit -m "feat(memory): add provider field to DailyLogEntrySchema, extend MemoryBootstrapResult"
```

---

## Task 3: SkillStoreService — SQLite-backed CRUD

**Files:**
- Modify: `packages/memory/src/database.ts`
- Create: `packages/memory/src/services/skill-store.ts`
- Modify: `packages/memory/src/services/index.ts`
- Test: `packages/memory/src/services/__tests__/skill-store.test.ts`

- [ ] **Step 1: Write failing tests for SkillStoreService**

```typescript
// packages/memory/src/services/__tests__/skill-store.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Effect } from "effect";
// ... service imports

describe("SkillStoreService", () => {
  test("store() persists a SkillRecord and get() retrieves it", async () => {
    // Create a skill, store it, retrieve by id, assert fields match
  });

  test("findByTask() returns skills matching taskCategories", async () => {
    // Store 2 skills with different taskCategories, query for one category
  });

  test("findByTask() ranks by successRate * useCount", async () => {
    // Store 3 skills with different successRates/useCounts, verify order
  });

  test("update() modifies fields and increments updatedAt", async () => {
    // Store skill, update successRate, verify change persisted
  });

  test("promote() transitions confidence tentative→trusted→expert", async () => {
    // Store tentative skill, promote, verify confidence changed
  });

  test("rollback() restores previous version atomically", async () => {
    // Store skill with 2 versions, rollback, verify instructions + config restored
  });

  test("rollback() of version 1 is a no-op", async () => {
    // Store skill at version 1, rollback returns error/no-op
  });

  test("listAll() returns all skills for an agentId", async () => {
    // Store 3 skills for agent-1, 1 for agent-2, listAll(agent-1) returns 3
  });

  test("delete() removes skill and its version history", async () => {
    // Store skill with versions, delete, verify gone from both tables
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/memory && bun test src/services/__tests__/skill-store.test.ts
```

- [ ] **Step 3: Add SQLite table DDL to database.ts**

In `packages/memory/src/database.ts`, add `CREATE TABLE IF NOT EXISTS skills (...)` and `CREATE TABLE IF NOT EXISTS skill_versions (...)`.

`skills` table columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `description TEXT`, `agent_id TEXT NOT NULL`, `source TEXT NOT NULL`, `instructions TEXT`, `version INTEGER DEFAULT 1`, `config TEXT` (JSON), `evolution_mode TEXT DEFAULT 'auto'`, `confidence TEXT DEFAULT 'tentative'`, `success_rate REAL DEFAULT 0`, `use_count INTEGER DEFAULT 0`, `refinement_count INTEGER DEFAULT 0`, `task_categories TEXT` (JSON array), `model_affinities TEXT` (JSON array), `base TEXT`, `avg_post_activation_entropy_delta REAL DEFAULT 0`, `avg_convergence_iteration REAL DEFAULT 0`, `convergence_speed_trend TEXT` (JSON array), `conflicts_with TEXT` (JSON array), `content_variants TEXT` (JSON — `{full, summary, condensed}`), `last_activated_at TEXT`, `last_refined_at TEXT`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.

`skill_versions` table: `id TEXT PRIMARY KEY`, `skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE`, `version INTEGER NOT NULL`, `instructions TEXT`, `config TEXT`, `refined_at TEXT`, `success_rate_at_refinement REAL`, `status TEXT DEFAULT 'active'`.

Index: `CREATE INDEX idx_skills_agent ON skills(agent_id)`, `CREATE INDEX idx_skills_task ON skills(agent_id, task_categories)`.

- [ ] **Step 4: Implement SkillStoreService**

Create `packages/memory/src/services/skill-store.ts`:
- Effect-TS service using `Context.Tag` pattern (follow `ProceduralMemoryService` as reference)
- Methods: `store(record: SkillRecord)`, `get(id: string)`, `findByTask(agentId, taskCategories, modelId?)`, `update(id, partial)`, `promote(id, newConfidence)`, `rollback(id)`, `listAll(agentId)`, `delete(id)`
- `rollback()` uses a SQLite transaction to restore both `instructions` and `config` from the previous `skill_versions` entry
- `findByTask()` queries by `agent_id` and JSON array overlap on `task_categories`, ordered by `success_rate * use_count DESC`
- JSON columns serialized/deserialized on read/write

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd packages/memory && bun test src/services/__tests__/skill-store.test.ts
```

- [ ] **Step 6: Export from index**

Add `export { SkillStoreService, SkillStoreServiceLive } from "./skill-store.js"` to `packages/memory/src/services/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/database.ts packages/memory/src/services/skill-store.ts packages/memory/src/services/index.ts packages/memory/src/services/__tests__/skill-store.test.ts
git commit -m "feat(memory): add SkillStoreService with SQLite-backed CRUD"
```

---

## Task 4: SkillEvolutionService — LLM refinement + version management

**Files:**
- Create: `packages/memory/src/services/skill-evolution.ts`
- Test: `packages/memory/src/services/__tests__/skill-evolution.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("SkillEvolutionService", () => {
  test("refine() creates a new candidate version with LLM-refined instructions", async () => {
    // Mock MemoryLLM to return refined instructions
    // Call refine(skill, episodes), verify version incremented, status = "candidate"
  });

  test("refine() skips locked skills", async () => {
    // Create skill with evolutionMode: "locked", call refine, verify no change
  });

  test("refine() preserves base field for installed skills", async () => {
    // Create installed skill, refine, verify base unchanged
  });

  test("promoteCandidateToActive() changes status after N successful activations", async () => {
    // Create skill with candidate version, simulate N activations, verify promotion
  });

  test("rollbackOnRegression() reverts when successRate drops post-refinement", async () => {
    // Create skill with candidate version, lower successRate, verify rollback
  });

  test("refine() generates contentVariants (summary + condensed)", async () => {
    // Mock MemoryLLM for variant generation calls, verify contentVariants populated
  });

  test("refine() falls back to heuristic variants when LLM call fails", async () => {
    // Mock MemoryLLM to throw on variant calls, verify heuristic extraction used
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement SkillEvolutionService**

Create `packages/memory/src/services/skill-evolution.ts`:
- Accepts `MemoryLLM` interface (same pattern as existing in `memory/types.ts`)
- Accepts `SkillStoreService` dependency
- `refine(skill: SkillRecord, recentEpisodes: DailyLogEntry[])`:
  - Guard: if `evolutionMode === "locked"`, return unchanged
  - LLM call: "Given current instructions and these run summaries, produce improved instructions"
  - Create `SkillVersion` with `status: "candidate"`, push to `versionHistory`
  - Generate `contentVariants.summary` + `contentVariants.condensed` via LLM (catch errors → heuristic)
  - Persist via `SkillStoreService.update()`
  - Return updated `SkillRecord`
- `checkRegression(skill: SkillRecord)`:
  - Compare current `successRate` to `versionHistory[last].successRateAtRefinement`
  - If lower → call `SkillStoreService.rollback()`
- `heuristicCondense(instructions: string)`: first sentence of each section heading block → summary; action verb sentences only → condensed

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/services/skill-evolution.ts packages/memory/src/services/__tests__/skill-evolution.test.ts
git commit -m "feat(memory): add SkillEvolutionService with LLM refinement and version management"
```

---

## Task 5: SkillRegistry — filesystem scanner + SKILL.md parser

**Files:**
- Create: `packages/reactive-intelligence/src/skills/skill-registry.ts`
- Test: `packages/reactive-intelligence/src/skills/__tests__/skill-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("SkillRegistry", () => {
  // Use tmp dirs with SKILL.md files for filesystem tests

  test("discover() finds SKILL.md files in standard paths", async () => {
    // Create temp dir with ./skills/my-skill/SKILL.md, call discover, verify found
  });

  test("parseSKILLmd() extracts YAML frontmatter + body", async () => {
    // Create SKILL.md with name, description, metadata in frontmatter
    // Verify parsed name, description, instructions (body), metadata.requires
  });

  test("parseSKILLmd() warns on missing description (lenient)", async () => {
    // SKILL.md with name but no description → warn, still parse
  });

  test("parseSKILLmd() skips unparseable YAML with warning", async () => {
    // SKILL.md with broken YAML → returns null, logs warning
  });

  test("discover() detects name collisions and applies precedence", async () => {
    // Two skills named "my-skill" in project-level and user-level dirs
    // Project-level wins, warning logged
  });

  test("discover() scans agent-specific path before cross-client path", async () => {
    // ./<agentId>/skills/ vs ./.agents/skills/ — agent-specific wins
  });

  test("parseSKILLmd() stores allowed-tools in metadata", async () => {
    // SKILL.md with allowed-tools field → stored in metadata, not enforced
  });

  test("listResources() returns scripts/ and references/ contents", async () => {
    // Skill dir with scripts/check.py and references/guide.md → listed
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement SkillRegistry**

Create `packages/reactive-intelligence/src/skills/skill-registry.ts`:
- `discover(paths: string[], agentId: string)`: scan directories in order, parse each SKILL.md
- `parseSKILLmd(filePath: string)`: read file, split YAML frontmatter (between `---` markers), parse YAML manually or with a lightweight parser (avoid adding a heavy dependency — `gray-matter` is fine if already available, otherwise regex-based YAML frontmatter extraction for the simple fields we need: name, description, license, compatibility, metadata, allowed-tools)
- Collision detection: track seen names, log warning on collision, first-in-precedence-order wins
- Returns `InstalledSkill[]` with `{ name, description, instructions, metadata, filePath, resources }`
- Default scan paths per spec Section 4.4: `./.agents/skills/`, `./.<agentId>/skills/`, `~/.agents/skills/`, `~/.reactive-agents/skills/`

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/skills/skill-registry.ts packages/reactive-intelligence/src/skills/__tests__/skill-registry.test.ts
git commit -m "feat(reactive-intelligence): add SkillRegistry filesystem scanner with SKILL.md parser"
```

---

## Task 6: SkillResolverService — unified resolution + catalog XML

**Files:**
- Create: `packages/reactive-intelligence/src/skills/skill-resolver.ts`
- Test: `packages/reactive-intelligence/src/skills/__tests__/skill-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("SkillResolverService", () => {
  test("resolve() combines SQLite learned skills + filesystem installed skills", async () => {
    // Mock SkillStoreService.findByTask() returning 1 learned skill
    // Mock SkillRegistry.discover() returning 1 installed skill
    // Verify combined list has both
  });

  test("resolve() applies precedence: learned > project-installed > user-installed > promoted", async () => {
    // Same-name skill from learned + installed → learned wins
  });

  test("generateCatalogXml() produces <available_skills> XML", async () => {
    // Pass 3 skills, verify XML structure matches spec Section 4.4
  });

  test("generateCatalogXml() adds context-full hint for catalog-only skills", async () => {
    // Skill with verbosity "catalog-only" gets hint text in XML
  });

  test("resolve() ranks learned skills by successRate * useCount", async () => {
    // 3 learned skills with different scores → verify order
  });

  test("resolve() auto-activates expert skills at bootstrap", async () => {
    // Expert skill in results → marked for auto-injection
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement SkillResolverService**

Create `packages/reactive-intelligence/src/skills/skill-resolver.ts`:
- Effect-TS service with `Context.Tag`
- Dependencies: `SkillStoreService`, `SkillRegistry`
- `resolve({ taskDescription, modelId, agentId })`:
  1. Query `SkillStoreService.findByTask(agentId, taskCategories, modelId)` for learned skills
  2. Call `SkillRegistry.discover(scanPaths, agentId)` for installed skills
  3. Merge into unified list; on name collision, learned wins (log warning)
  4. Sort by: expert first, then trusted, then tentative; within tier by `successRate * useCount`
  5. Return `ResolvedSkills { all: SkillRecord[], autoActivate: SkillRecord[], catalog: SkillRecord[] }`
- `generateCatalogXml(skills: SkillRecord[])`: builds `<available_skills>` XML per spec Section 4.4
  - For `catalog-only` verbosity: adds `[condensed — use get_skill_section("name", "full") to access instructions]`

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/skills/skill-resolver.ts packages/reactive-intelligence/src/skills/__tests__/skill-resolver.test.ts
git commit -m "feat(reactive-intelligence): add SkillResolverService with unified resolution and catalog XML"
```

---

## Task 7: Test Model Exclusion Guards

**Files:**
- Modify: `packages/reactive-intelligence/src/telemetry/telemetry-client.ts`
- Modify: `packages/reactive-intelligence/src/learning/learning-engine.ts`
- Test: `packages/reactive-intelligence/src/telemetry/__tests__/test-guard.test.ts`
- Test: `packages/reactive-intelligence/src/learning/__tests__/enrichment.test.ts`

- [ ] **Step 1: Write failing tests for telemetry guard**

```typescript
describe("TelemetryClient test guard", () => {
  test("send() silently skips when provider is 'test'", async () => {
    // Mock fetch, call send() with report where provider === "test"
    // Verify fetch was NOT called, no notice printed
  });

  test("send() silently skips when modelId starts with 'test-'", async () => {
    // Same pattern with modelId: "test-scenario-1"
  });

  test("send() proceeds normally for real providers", async () => {
    // provider: "anthropic", modelId: "claude-sonnet-4" → fetch called
  });

  test("notice is NOT printed for test runs", async () => {
    // Capture stdout, verify no telemetry notice for test provider
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Add `isTestRun()` guard to TelemetryClient**

In `packages/reactive-intelligence/src/telemetry/telemetry-client.ts`:
- Add private `isTestRun(report)` method checking `provider === "test" || modelId === "test" || modelId.startsWith("test-") || modelTier === "test"`
- Guard `send()`: if `isTestRun(report)` → `return Effect.void` immediately
- Move notice printing BELOW the guard (currently it prints unconditionally)

- [ ] **Step 4: Write failing tests for LearningEngine guard**

```typescript
describe("LearningEngineService test guard", () => {
  test("onRunCompleted() returns no-op result for test provider", async () => {
    // Call with data.provider === "test"
    // Verify result: calibrationUpdated: false, banditUpdated: false, skillSynthesized: false
  });

  test("onRunCompleted() does not update calibration for test runs", async () => {
    // Verify calibration store was not called
  });
});
```

- [ ] **Step 5: Add test guard to LearningEngineService**

In `packages/reactive-intelligence/src/learning/learning-engine.ts`:
- At the top of `onRunCompleted()`, check `data.provider === "test" || data.modelId === "test" || data.modelId.startsWith("test-")`
- If true, return `Effect.succeed({ calibrationUpdated: false, banditUpdated: false, skillSynthesized: false, taskCategory: "test" })`

- [ ] **Step 6: Run all tests — verify they pass**

```bash
cd packages/reactive-intelligence && bun test src/telemetry/__tests__/test-guard.test.ts src/learning/__tests__/enrichment.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/reactive-intelligence/src/telemetry/telemetry-client.ts packages/reactive-intelligence/src/learning/learning-engine.ts packages/reactive-intelligence/src/telemetry/__tests__/test-guard.test.ts packages/reactive-intelligence/src/learning/__tests__/enrichment.test.ts
git commit -m "fix(reactive-intelligence): add test model exclusion guards to telemetry + learning"
```

---

## Task 8: SkillFragment TODO Fixes

**Files:**
- Modify: `packages/reactive-intelligence/src/learning/skill-synthesis.ts`

- [ ] **Step 1: Write test for correct SkillFragment field wiring**

```typescript
describe("extractSkillFragment wiring", () => {
  test("promptTemplateId uses kernelState.meta.promptVariantId", async () => {
    // Call extractSkillFragment with kernelState containing meta.promptVariantId: "variant-A"
    // Verify fragment.promptTemplateId === "variant-A"
  });

  test("systemPromptTokens uses kernelState.meta.systemPromptTokens", async () => {
    // kernelState with meta.systemPromptTokens: 450
    // Verify fragment.systemPromptTokens === 450
  });

  test("compressionEnabled uses controllerConfig.contextCompression", async () => {
    // controllerConfig with contextCompression: true
    // Verify fragment.compressionEnabled === true
  });

  test("fields default gracefully when meta is missing", async () => {
    // kernelState with no meta → defaults: "default", 0, false
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Fix the three TODOs**

In `packages/reactive-intelligence/src/learning/skill-synthesis.ts`, replace the hardcoded stubs:

```typescript
// Before:
promptTemplateId: "default",
systemPromptTokens: 0,
compressionEnabled: false,

// After:
promptTemplateId: kernelState.meta?.promptVariantId ?? "default",
systemPromptTokens: kernelState.meta?.systemPromptTokens ?? 0,
compressionEnabled: controllerConfig?.contextCompression ?? false,
```

Also ensure the function signature accepts the necessary context (add `kernelState` and `controllerConfig` params if not already present).

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/learning/skill-synthesis.ts packages/reactive-intelligence/src/learning/__tests__/skill-synthesis-wiring.test.ts
git commit -m "fix(reactive-intelligence): wire SkillFragment fields from kernel state"
```

---

## Task 9: activate_skill Meta-Tool

**Files:**
- Create: `packages/tools/src/skills/activate-skill.ts`
- Test: `packages/tools/src/skills/__tests__/activate-skill.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("activate_skill tool", () => {
  test("returns <skill_content> XML with full instructions", async () => {
    // Mock SkillStoreService to return a skill with instructions
    // Call tool with { name: "data-analysis" }
    // Verify output is <skill_content name="data-analysis" version="1" source="learned">...</skill_content>
  });

  test("includes skill_resources listing when resources exist", async () => {
    // Skill with resources → XML includes <skill_resources> block
  });

  test("returns error message when skill not found", async () => {
    // Mock store to return null, verify "Skill 'foo' not found" response
  });

  test("emits SkillActivated event on success", async () => {
    // Verify EventBus receives SkillActivated with trigger: "model"
  });

  test("increments skill useCount on activation", async () => {
    // Verify SkillStoreService.update() called with useCount + 1
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement activate_skill tool**

Create `packages/tools/src/skills/activate-skill.ts`:
- Use `defineToolSimple` or `ToolBuilder` (follow existing meta-tool patterns like `final-answer.ts` or `context-status.ts`)
- Parameters: `{ name: string }`
- Execution:
  1. Resolve skill from `SkillStoreService.get()` or in-memory resolved skills
  2. If not found: return "Skill '{name}' not found. Available skills: ..."
  3. Build `<skill_content name="..." version="..." source="...">` XML wrapper
  4. Include instructions body
  5. If skill has filesystem resources: add `<skill_resources>` listing
  6. **Dependency resolution:** if `skill.metadata.requires` is non-empty, auto-activate each listed dependency (one level deep, no transitive chains; ignore self-references and mutual dependencies per spec Section 4.7)
  7. Emit `SkillActivated` event with `trigger: "model"`
  8. Update `lastActivatedAt` and `useCount` via store

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/activate-skill.ts packages/tools/src/skills/__tests__/activate-skill.test.ts
git commit -m "feat(tools): add activate_skill meta-tool for model-driven skill activation"
```

---

## Task 10: get_skill_section Meta-Tool

**Files:**
- Create: `packages/tools/src/skills/get-skill-section.ts`
- Test: `packages/tools/src/skills/__tests__/get-skill-section.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("get_skill_section tool", () => {
  test("returns matching section by heading name", async () => {
    const instructions = "# Steps\n1. Do A\n2. Do B\n\n# Examples\nExample 1\nExample 2\n\n# References\nRef 1";
    // Call with section: "examples" → returns "Example 1\nExample 2"
  });

  test("returns 'section not found' for missing section", async () => {
    // section: "nonexistent" → "section not found"
  });

  test("returns full body when section is 'full'", async () => {
    // section: "full" → complete instructions
  });

  test("section matching is case-insensitive", async () => {
    // section: "EXAMPLES" matches "# Examples"
  });

  test("resolves against contentVariants.full even when condensed is active", async () => {
    // Skill currently injected at condensed, but get_skill_section reads full variant
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement get_skill_section**

Create `packages/tools/src/skills/get-skill-section.ts`:
- Parameters: `{ skillName: string, section: string }`
- `parseSections(body: string)`: split on `# ` or `## ` headings → `Record<string, string>`
- If `section === "full"`: return full body
- Else: case-insensitive lookup in parsed sections
- Not found → return `"section not found"`
- Does NOT inject into persistent context — only returns in tool result

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Update tools/index.ts with auto-include logic**

In `packages/tools/src/index.ts`:
- Export both `activate_skill` and `get_skill_section`
- `get_skill_section` auto-included when skills enabled AND model tier is `local` or `mid`
- `activate_skill` auto-included when skills enabled (any tier)

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/skills/get-skill-section.ts packages/tools/src/skills/__tests__/get-skill-section.test.ts packages/tools/src/index.ts
git commit -m "feat(tools): add get_skill_section meta-tool for on-demand section inspection"
```

---

## Task 11: Controller Decision Type Expansion

**Files:**
- Modify: `packages/reactive-intelligence/src/types.ts`
- Test: (type tests only — evaluator tests in Task 12)

- [ ] **Step 1: Extend ControllerDecision union type**

In `packages/reactive-intelligence/src/types.ts`, add the 7 new decision types from spec Section 5.2:
- `temp-adjust`, `skill-activate`, `prompt-switch`, `tool-inject`, `memory-boost`, `skill-reinject`, `human-escalate`

Also add the 8 new fields to `ControllerEvalParams` from spec Section 5.2:
- `currentTemperature`, `availableSkills`, `activeSkillNames`, `availableToolNames`, `activePromptVariantId`, `activeRetrievalMode`, `priorDecisionsThisRun`, `contextHasSkillContent`

- [ ] **Step 2: Extend RunCompletedData with enrichment fields**

Add all local enrichment fields from spec Section 6.3:
- `thoughtTokenCounts`, `thoughtToActionRatio`, `uncertaintyMarkerCount`, `selfCorrectionCount`
- `toolCallSequence`, `toolRetryCount`, `toolResultCompressionRatios`, `toolErrorCategories`
- `memoryHitCount`, `memoryReferencedCount`, `memoryUtilizationRate`
- `tokensBySection`, `peakContextUtilization`
- `skillsActivated`, `skillActivationIterations`, `postActivationEntropyDeltas`
- `convergenceIteration`

- [ ] **Step 3: Enable default config flags**

Change `defaultReactiveIntelligenceConfig`:
- `skillSynthesis: false` → `skillSynthesis: true`
- `banditSelection: false` → `banditSelection: true`

- [ ] **Step 4: Extend RunReport telemetry types**

In `packages/reactive-intelligence/src/telemetry/types.ts`, add all telemetry-safe fields from spec Section 6.4:
- `trajectoryFingerprint`, `abstractToolPattern`, `iterationsToFirstConvergence`, `tokenEfficiencyRatio`
- `thoughtToActionRatio`, `contextPressurePeak`, `skillsActiveCount`, `skillEffectivenessScores`
- `learnedSkillsContribution`, `taskComplexity`, `failurePattern`

- [ ] **Step 5: Run existing tests to verify no regressions**

```bash
cd packages/reactive-intelligence && bun test
```

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/types.ts packages/reactive-intelligence/src/telemetry/types.ts
git commit -m "feat(reactive-intelligence): expand ControllerDecision to 10 types, add enrichment fields"
```

---

## Task 12: Seven New Controller Evaluators

**Files:**
- Modify: `packages/reactive-intelligence/src/controller/controller-service.ts`
- Test: `packages/reactive-intelligence/src/controller/__tests__/new-evaluators.test.ts`

- [ ] **Step 1: Write failing tests for each evaluator**

```typescript
describe("New controller evaluators", () => {
  test("temp-adjust: fires when semantic entropy diverges", async () => {
    // Provide entropyHistory with rising semantic entropy
    // Verify decision: "temp-adjust" with negative delta
  });

  test("temp-adjust: respects maxTemperatureAdjustment constraint", async () => {
    // Constraint maxTemperatureAdjustment: 0.1, verify delta capped
  });

  test("skill-activate: fires when task matches available skill", async () => {
    // Provide availableSkills with matching taskCategory, verify decision
  });

  test("prompt-switch: fires when bandit suggests better variant", async () => {
    // Mock bandit selection, verify prompt-switch decision
  });

  test("tool-inject: fires when structural entropy signals knowledge gap", async () => {
    // High structural entropy + available tools not in active set
  });

  test("memory-boost: fires when structural entropy shows knowledge gap", async () => {
    // activeRetrievalMode: "recent", high structural entropy → switch to "semantic"
  });

  test("skill-reinject: fires when compaction removed skill content", async () => {
    // contextHasSkillContent: false, activeSkillNames non-empty
  });

  test("human-escalate: fires when all other decisions exhausted", async () => {
    // priorDecisionsThisRun covers all types, entropy still high
  });

  test("human-escalate: respects neverHumanEscalate constraint", async () => {
    // constraint.neverHumanEscalate: true → does not fire
  });

  test("onControllerDecision hook can reject a decision", async () => {
    // Hook returns "reject" → decision suppressed entirely
  });

  test("onControllerDecision hook can replace a decision", async () => {
    // Hook returns different ControllerDecision → original replaced
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement 7 new evaluators**

In `packages/reactive-intelligence/src/controller/controller-service.ts`, add evaluator functions. Each follows the pattern:

```typescript
const evaluateTempAdjust = (params: ControllerEvalParams): ControllerDecision | null => {
  // Check semantic entropy trend
  // If diverging over last 3 iterations → suggest temperature decrease
  // Respect constraints.maxTemperatureAdjustment
  // Return { decision: "temp-adjust", delta: -0.1, reason: "..." } or null
};
```

Wire all 7 into the main `evaluate()` method. Evaluators run in priority order: existing 3 first, then new 7. First non-null decision wins (unless overridden by `onControllerDecision` hook).

Add hook dispatch: after evaluator produces a decision, call `onControllerDecision(decision, context)` if configured. Handle `"accept"`, `"reject"`, or replacement `ControllerDecision`.

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/controller/controller-service.ts packages/reactive-intelligence/src/controller/__tests__/new-evaluators.test.ts
git commit -m "feat(reactive-intelligence): add 7 new controller evaluators with hook dispatch"
```

---

## Task 13: Skill Compression Pipeline

**Files:**
- Create: `packages/reactive-intelligence/src/skills/skill-compression.ts`
- Test: `packages/reactive-intelligence/src/skills/__tests__/skill-compression.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("compressSkillContent", () => {
  const fullBody = `# Overview\nThis skill helps with data analysis.\n\n## Steps\n1. Load the dataset.\nMake sure to validate format first.\n2. Run analysis.\n\n## Examples\nExample 1: Load CSV\n\`\`\`\nload("data.csv")\n\`\`\`\n\nExample 2: Load JSON\n\`\`\`\nload("data.json")\n\`\`\`\n\n## References\nSee data-guide.md for details.\n`;

  test("stage 1: strips ## Examples section", () => {
    const result = compressSkillContent(fullBody, 1);
    expect(result).not.toContain("Example 1");
    expect(result).toContain("## Steps");
  });

  test("stage 2: strips ## References section", () => {
    const result = compressSkillContent(fullBody, 2);
    expect(result).not.toContain("References");
    expect(result).not.toContain("Example 1");
  });

  test("stage 3: condenses multi-sentence paragraphs to first sentence", () => {
    const result = compressSkillContent(fullBody, 3);
    expect(result).toContain("Load the dataset.");
    expect(result).not.toContain("Make sure to validate");
  });

  test("stage 4: keeps only imperative sentences", () => {
    const result = compressSkillContent(fullBody, 4);
    expect(result).toContain("Load the dataset");
    expect(result).toContain("Run analysis");
    expect(result).not.toContain("This skill helps");
  });

  test("stage 5: returns empty string (catalog-only)", () => {
    const result = compressSkillContent(fullBody, 5);
    expect(result).toBe("");
  });

  test("getDefaultCompressionStage returns correct stage for tier", () => {
    expect(getDefaultCompressionStage("frontier")).toBe(0);
    expect(getDefaultCompressionStage("large")).toBe(1);
    expect(getDefaultCompressionStage("mid")).toBe(2);
    expect(getDefaultCompressionStage("local")).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement compression pipeline**

Create `packages/reactive-intelligence/src/skills/skill-compression.ts`:
- `compressSkillContent(body: string, stage: number): string`
  - Stage 0: no compression (return as-is)
  - Stage 1: regex remove `## Examples` / `### Examples` section (everything from heading to next same-level heading or EOF)
  - Stage 2: stage 1 + remove `## References` / `### References` / `## See Also`
  - Stage 3: stage 2 + for each paragraph, keep only first sentence
  - Stage 4: stage 3 + keep only sentences starting with action verbs (Load, Run, Create, Check, Verify, Return, Parse, etc.)
  - Stage 5: return `""` (catalog-only — body not injected)
- `getDefaultCompressionStage(tier: string): number` — tier→stage mapping per spec Section 4.9
- `estimateTokens(text: string): number` — simple `text.length / 4` heuristic (consistent with existing codebase pattern)

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/reactive-intelligence/src/skills/skill-compression.ts packages/reactive-intelligence/src/skills/__tests__/skill-compression.test.ts
git commit -m "feat(reactive-intelligence): add 5-stage skill compression pipeline"
```

---

## Task 14: SkillDistillerService + MemoryConsolidator Wiring

**Files:**
- Create: `packages/reactive-intelligence/src/skills/skill-distiller.ts`
- Modify: `packages/memory/src/services/memory-consolidator.ts`
- Test: `packages/reactive-intelligence/src/skills/__tests__/skill-distiller.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("SkillDistillerService", () => {
  test("distill() triggers refinement when episodic count >= threshold", async () => {
    // Mock episodic memory with 6 entries since skill.lastRefinedAt
    // refinementThreshold = 5
    // Verify SkillEvolutionService.refine() called
  });

  test("distill() skips when episodic count < threshold", async () => {
    // Only 3 entries → refine() NOT called
  });

  test("distill() filters out test-provider episodic entries", async () => {
    // 6 entries total, 4 with provider: "test" → only 2 real → below threshold → skip
  });

  test("distill() skips locked skills", async () => {
    // Skill with evolutionMode: "locked" → not even checked for threshold
  });

  test("distill() processes multiple skills independently", async () => {
    // Skill A has 7 entries (qualifies), Skill B has 2 (doesn't)
    // Only Skill A refined
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement SkillDistillerService**

Create `packages/reactive-intelligence/src/skills/skill-distiller.ts`:
- Dependencies (injected): `EpisodicMemoryService` (for entry retrieval), `SkillEvolutionService`, `SkillStoreService`
- `distill(agentId: string)`:
  1. Get all non-locked skills: `SkillStoreService.listAll(agentId).filter(s => s.evolutionMode !== "locked")`
  2. For each skill, count episodic entries since `skill.lastRefinedAt` (or `createdAt`)
  3. Filter out entries with `provider === "test"` or `provider?.startsWith("test-")`
  4. If remaining count >= `refinementThreshold` (default 5):
     - Retrieve the N most recent qualifying entries
     - Call `SkillEvolutionService.refine(skill, entries)`
  5. Return `{ refined: number, skipped: number }`

- [ ] **Step 4: Wire into MemoryConsolidator CONNECT phase**

In `packages/memory/src/services/memory-consolidator.ts`:
- Accept optional `SkillDistillerService` via the same pattern as `MemoryLLM` (optional interface injection)
- In the CONNECT phase (currently `const connect = (_agentId) => Effect.succeed(0)`):
  - If `SkillDistillerService` is provided, call `distiller.distill(agentId)`
  - Return the `refined` count as the CONNECT result
  - If not provided, keep existing no-op behavior

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add packages/reactive-intelligence/src/skills/skill-distiller.ts packages/reactive-intelligence/src/skills/__tests__/skill-distiller.test.ts packages/memory/src/services/memory-consolidator.ts
git commit -m "feat: add SkillDistillerService and wire CONNECT phase in MemoryConsolidator"
```

---

## Task 15: Execution Engine — Bootstrap Skill Resolution + Post-Run Enrichment

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`
- Test: `packages/runtime/src/__tests__/skill-wiring.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Execution engine skill wiring", () => {
  test("bootstrap phase resolves skills via SkillResolverService", async () => {
    // Build agent with skills enabled + mock SkillResolverService
    // Run agent, verify SkillResolverService.resolve() called during bootstrap
  });

  test("expert skills are auto-injected into system prompt at bootstrap", async () => {
    // SkillResolver returns an expert skill → verify its instructions are in system prompt
  });

  test("catalog XML is added to system prompt for non-expert skills", async () => {
    // SkillResolver returns a trusted skill → verify catalog XML in system prompt
  });

  test("onRunCompleted receives provider field", async () => {
    // Verify the data passed to LearningEngineService.onRunCompleted includes provider
  });

  test("onRunCompleted receives enriched fields", async () => {
    // Run agent with tools, verify skillsActivated, toolCallSequence, convergenceIteration in data
  });

  test("episodic entries include provider field", async () => {
    // Verify episodic log entries written during run include provider
  });

  test("skill resolution skipped when SkillResolverService not available", async () => {
    // Agent without skills enabled → no errors, no skill resolution
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Wire bootstrap skill resolution**

In the bootstrap phase of `execution-engine.ts`:
1. Check if `SkillResolverService` is available via `Effect.serviceOption`
2. If available, call `resolve({ taskDescription, modelId, agentId })`
3. For `autoActivate` skills (expert confidence): inject `<skill_content>` XML into system prompt
4. For all skills: inject catalog XML into system prompt
5. Store resolved skills in execution context for later reference

- [ ] **Step 4: Enrich onRunCompleted data**

In the complete phase, extend the data object passed to `onRunCompleted()`:
- Add `provider` field from `ctx.provider`
- Add `skillsActivated` from execution context tracking
- Add `toolCallSequence` from tool call log
- Add `convergenceIteration` from entropy trace
- Add other enrichment fields that can be derived from existing execution context
- **Important:** Also update per-skill fields: push `convergenceIteration` to `skill.convergenceSpeedTrend` (trailing 10), update `avgConvergenceIteration` and `avgPostActivationEntropyDelta` on each activated skill via `SkillStoreService.update()`

- [ ] **Step 5: Add provider to episodic entries**

Where `EpisodicMemoryService.log()` is called, add `provider: String(ctx.provider ?? "unknown")` to the entry.

- [ ] **Step 6: Run tests — verify they pass**

```bash
cd packages/runtime && bun test src/__tests__/skill-wiring.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/src/__tests__/skill-wiring.test.ts
git commit -m "feat(runtime): wire bootstrap skill resolution and enrich post-run learning data"
```

---

## Task 16: Skill Injection Guard + Eviction + Compaction Protection

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (or create a helper in reactive-intelligence)
- Test: `packages/runtime/src/__tests__/skill-injection.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Skill injection guard", () => {
  test("injects at full verbosity when budget allows", async () => {
    // frontier tier, plenty of context → full instructions injected
  });

  test("degrades verbosity when budget is tight", async () => {
    // mid tier, limited budget → summary variant used
  });

  test("skips injection and emits SkillSkippedContextFull when impossible", async () => {
    // local tier, budget exhausted → event emitted, skill in catalog only
  });

  test("wraps injected content in <skill_content> XML tags", async () => {
    // Verify output contains <skill_content name="..." version="..." source="...">
  });

  test("compaction treats <skill_content> blocks as importance 1.0", async () => {
    // If context compaction module is accessible, verify skill blocks not decayed
  });
});

describe("Skill eviction priority", () => {
  test("evicts tentative skills first", async () => {
    // 3 skills: tentative, trusted, expert → tentative evicted first
  });

  test("expert skills are re-injected via skill-reinject decision", async () => {
    // After eviction, context pressure drops → expert re-injected
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement injection guard**

Create helper function (in `skill-resolver.ts` or a new `skill-injection.ts` module):
- `injectSkill(skill, modelTier, remainingTokens, safetyMargin)`:
  1. Determine verbosity mode from tier mapping
  2. Estimate tokens for that verbosity (using `contentVariants`)
  3. If fits: return `<skill_content>` XML wrapper
  4. If doesn't fit: try next lower verbosity
  5. If nothing fits: emit `SkillSkippedContextFull` event, return catalog-only note
- Eviction priority: implement as a sort function on active skills, used when `compress` decision fires

- [ ] **Step 4: Wire compaction protection**

In `packages/reasoning/src/context/compaction.ts` (the existing context compaction module):
- When scanning content for decay/compression, detect `<skill_content>` XML tags
- Assign `importance = 1.0` to these blocks (skip from normal decay)
- Only remove via explicit skill eviction path

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/src/__tests__/skill-injection.test.ts packages/reactive-intelligence/src/skills/skill-injection.ts
git commit -m "feat: add skill injection guard, eviction priority, and compaction protection"
```

---

## Task 17: RI Runtime Layer Wiring

**Files:**
- Modify: `packages/reactive-intelligence/src/runtime.ts`

- [ ] **Step 1: Wire SkillResolverService into createReactiveIntelligenceLayer**

In `packages/reactive-intelligence/src/runtime.ts`:
- Import `SkillResolverService`, `SkillRegistry`
- Create `SkillResolverService` layer that depends on `SkillStoreService` + `SkillRegistry`
- Pass `SkillDistillerService` to `MemoryConsolidatorService` when creating memory layer
- Export `SkillResolverService` as part of the RI layer so runtime can access it

- [ ] **Step 2: Export new skill modules from package index**

In `packages/reactive-intelligence/src/index.ts`, add exports for:
- `SkillResolverService`
- `SkillRegistry`
- `SkillDistillerService`
- `compressSkillContent`, `getDefaultCompressionStage`

- [ ] **Step 3: Run existing RI tests to verify no regressions**

```bash
cd packages/reactive-intelligence && bun test
```

- [ ] **Step 4: Commit**

```bash
git add packages/reactive-intelligence/src/runtime.ts packages/reactive-intelligence/src/index.ts
git commit -m "feat(reactive-intelligence): wire skill services into RI runtime layer"
```

---

## Task 18: Builder API — .withSkills() + Extended .withReactiveIntelligence()

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Test: `packages/runtime/src/__tests__/builder-skills.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe(".withSkills() builder", () => {
  test("withSkills() enables skill resolution with default config", async () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills();
    // Verify internal config has skills enabled with defaults
  });

  test("withSkills() accepts custom paths and evolution config", async () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills({
      paths: ["./custom-skills/"],
      evolution: { mode: "suggest", refinementThreshold: 10 },
    });
    // Verify config reflects custom values
  });

  test("withSkills() accepts per-skill evolution overrides", async () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills({
      overrides: { "my-skill": { evolutionMode: "locked" } },
    });
    // Verify override stored
  });
});

describe("Extended .withReactiveIntelligence() hooks", () => {
  test("accepts onEntropyScored callback", async () => {
    const scores: any[] = [];
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ onEntropyScored: (s) => scores.push(s) });
    // Verify callback stored in config
  });

  test("accepts onControllerDecision callback", async () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({
        onControllerDecision: () => "accept",
      });
    // Verify callback stored
  });

  test("accepts constraints object", async () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({
        constraints: { maxTemperatureAdjustment: 0.1, neverEarlyStop: true },
      });
    // Verify constraints stored
  });

  test("accepts autonomy level", async () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ autonomy: "observe" });
    // Verify autonomy set to "observe"
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement .withSkills()**

In `packages/runtime/src/builder.ts`:
- Add `withSkills(config?: SkillsConfig)` method
- `SkillsConfig` type: `{ paths?: string[], packages?: string[], evolution?: { mode?, refinementThreshold?, rollbackOnRegression? }, overrides?: Record<string, { evolutionMode? }> }`
- Store config in builder state
- At `build()` time: create `SkillRegistry` with configured paths, wire into RI layer

- [ ] **Step 4: Extend .withReactiveIntelligence()**

Extend the existing `withReactiveIntelligence()` overload to accept:
- `onEntropyScored`, `onControllerDecision`, `onSkillActivated`, `onSkillRefined`, `onSkillConflict`, `onMidRunAdjustment`
- `constraints: { allowedStrategySwitch?, maxTemperatureAdjustment?, neverEarlyStop?, neverHumanEscalate?, protectedSkills?, lockedSkills? }`
- `autonomy: "full" | "suggest" | "observe"`

Pass these through to the RI config layer at build time.

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/__tests__/builder-skills.test.ts
git commit -m "feat(runtime): add .withSkills() builder and extend .withReactiveIntelligence() hooks"
```

---

## Task 19: Agent Runtime API — skills(), exportSkill(), loadSkill()

**Files:**
- Modify: `packages/runtime/src/` (wherever `ReactiveAgent` facade is defined)
- Test: `packages/runtime/src/__tests__/agent-skills-api.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
describe("Agent skills API", () => {
  test("agent.skills() returns all loaded SkillRecords", async () => {
    // Build agent with skills, verify .skills() returns the list
  });

  test("agent.exportSkill() writes SKILL.md to disk", async () => {
    // Build agent, load a learned skill, export to tmp dir
    // Verify SKILL.md file created with correct frontmatter + body
  });

  test("agent.loadSkill() loads a SKILL.md directory at runtime", async () => {
    // Create tmp SKILL.md, call agent.loadSkill(path)
    // Verify skill appears in agent.skills()
  });

  test("agent.refineSkills() triggers manual distillation pass", async () => {
    // Mock SkillDistillerService, call refineSkills(), verify distill() called
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement agent API methods**

Add to the `ReactiveAgent` facade:
- `skills(): Promise<SkillRecord[]>` — delegates to `SkillStoreService.listAll(agentId)` + `SkillResolverService` in-memory cache
- `exportSkill(name: string, outputPath?: string): Promise<string>` — reads skill, writes `SKILL.md` with YAML frontmatter to `outputPath ?? "./.agents/skills/<name>/SKILL.md"`
- `loadSkill(path: string): Promise<SkillRecord>` — calls `SkillRegistry.parseSKILLmd()`, stores in `SkillStoreService`, returns record
- `refineSkills(): Promise<{ refined: number }>` — calls `SkillDistillerService.distill()` manually

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/*.ts packages/runtime/src/__tests__/agent-skills-api.test.ts
git commit -m "feat(runtime): add agent.skills(), exportSkill(), loadSkill(), refineSkills() API"
```

---

## Task 20: Full Integration Test

**Files:**
- Test: `packages/runtime/src/__tests__/living-intelligence-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
describe("Living Intelligence System integration", () => {
  test("end-to-end: skill loaded at bootstrap → activated → post-run learning → refinement", async () => {
    // 1. Create temp SKILL.md on disk
    // 2. Build agent with .withSkills() pointing to temp dir
    // 3. Run agent with test scenario that calls activate_skill
    // 4. Verify SkillActivated event emitted
    // 5. Verify post-run onRunCompleted called with skillsActivated
    // 6. Verify skill useCount incremented
  });

  test("test provider does not contaminate intelligence data", async () => {
    // Build agent with test provider + RI enabled
    // Run agent, verify: no telemetry sent, no calibration updated, no skills synthesized
  });

  test("controller decision hooks receive and can reject decisions", async () => {
    // Build agent with onControllerDecision: () => "reject"
    // Trigger conditions for a decision, verify it was suppressed
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd packages/runtime && bun test src/__tests__/living-intelligence-integration.test.ts
```

- [ ] **Step 3: Fix any failures discovered during integration**

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/__tests__/living-intelligence-integration.test.ts
git commit -m "test(runtime): add Living Intelligence System integration tests"
```

---

## Task 21: Run Full Test Suite + Final Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: All existing tests pass + new tests pass.

- [ ] **Step 2: Run full build**

```bash
bun run build
```

Expected: All 22 packages build successfully.

- [ ] **Step 3: Verify no type errors**

```bash
cd packages/core && bunx tsc --noEmit
cd packages/memory && bunx tsc --noEmit
cd packages/reactive-intelligence && bunx tsc --noEmit
cd packages/tools && bunx tsc --noEmit
cd packages/runtime && bunx tsc --noEmit
```

- [ ] **Step 4: Final commit with updated test counts**

Update `CLAUDE.md` with new test counts and any new package map entries.

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Living Intelligence System test counts"
```
