# Living Intelligence System — Design Spec

**Date:** 2026-03-23
**Status:** Draft — spec review pass 1 complete, issues resolved
**Author:** Tyler Buell + Claude
**Packages:** `@reactive-agents/reactive-intelligence`, `@reactive-agents/memory`, `@reactive-agents/runtime`, `@reactive-agents/tools`, `@reactive-agents/core`
**External:** `reactive-telemetry` server (private repo, `api.reactiveagents.dev`)

---

## 1. Thesis

The intelligence layer of Reactive Agents is not a black box. It is a transparent, observable, steerable nervous system built on a principled brain model. Every decision it makes is hookable by the agent creator. Every signal it scores is observable through the EventBus. Every skill it learns is inspectable, evolvable, and exportable on demand.

The agent is **self-aware** because the harness — not the LLM — monitors execution quality. The LLM does not need to know it is being observed. Entropy sensing happens at the framework level, controller decisions are made by typed evaluators, and skill evolution is driven by accumulated evidence. The agent gets smarter over time not because the LLM improves, but because the harness learns what works.

**Skills** are the actionable distillation of that learning. Memory is what the agent has experienced. Skills are what it has learned to do with that experience. The two are connected through a memory distillation pipeline that runs in the background, continuously refining skills from accumulated episodic evidence — like a brain consolidating experience into expertise during sleep.

---

## 2. Scope

This spec defines:

1. **The Neural Architecture** — brain-region model mapping each system to a clear, single responsibility
2. **The Living Skills System** — SKILL.md integration, `SkillRecord`, evolution lifecycle, memory distillation pipeline
3. **The Intelligence Control Surface** — 10 mid-run influence points, creator hooks, autonomy dial
4. **Intelligence Data Enrichment** — local signal additions and telemetry-safe additions
5. **Test Model Exclusion** — guard all intelligence systems from test provider data
6. **Telemetry Server Changes** — schema additions and new aggregation endpoints

**Not in scope:**
- Cortex visual UI (post-V1.0)
- Node.js platform adapters
- Effect-TS public API abstraction (separate spec)
- Docs overhaul (separate spec)

---

## 3. Neural Architecture

Each intelligence system maps to a brain region with a single, named responsibility. Systems communicate exclusively through the EventBus (the thalamus). No subsystem has direct dependencies on another's internals.

```
┌──────────────────────────────────────────────────────────────────┐
│                    REACTIVE AGENT BRAIN                          │
├────────────────────┬─────────────────────────────────────────────┤
│ SENSORY CORTEX     │ EntropySensorService                        │
│                    │ Monitors 5 signal sources per iteration:    │
│                    │ token · structural · semantic ·             │
│                    │ behavioral · context-pressure               │
│                    │ Scores composite entropy + trajectory shape │
├────────────────────┼─────────────────────────────────────────────┤
│ PREFRONTAL CORTEX  │ ReactiveControllerService                   │
│ (executive)        │ Evaluates entropy signals → decisions:      │
│                    │ early-stop · compress · switch-strategy ·   │
│                    │ temp-adjust · skill-activate ·              │
│                    │ prompt-switch · tool-inject ·               │
│                    │ memory-boost · skill-reinject ·             │
│                    │ human-escalate                              │
├────────────────────┼─────────────────────────────────────────────┤
│ ANTERIOR CINGULATE │ TerminationOracle + BehavioralEntropy        │
│ (conflict monitor) │ Detects loops, flat trajectories,          │
│                    │ contradictions, reasoning failure           │
├────────────────────┼─────────────────────────────────────────────┤
│ BASAL GANGLIA      │ LearningEngineService                       │
│ (habit / reward)   │ Calibration — per-model entropy thresholds  │
│                    │ Bandit — prompt variant selection           │
│                    │ SkillSynthesis — success patterns → habits  │
├────────────────────┼─────────────────────────────────────────────┤
│ HIPPOCAMPUS        │ Memory Layer                                │
│ (memory)           │ ProceduralMemory → learned / loaded skills  │
│                    │ EpisodicMemory → what happened (daily log)  │
│                    │ SemanticMemory → what is known (RAG)        │
│                    │ WorkingMemory → in-process context          │
├────────────────────┼─────────────────────────────────────────────┤
│ AMYGDALA           │ GuardrailsService + KillSwitch              │
│ (threat response)  │ Injection · PII · toxicity · emergency stop │
├────────────────────┼─────────────────────────────────────────────┤
│ CEREBELLUM         │ ToolService + ContextEngine                 │
│ (execution)        │ Precise tool coordination, context budgets  │
├────────────────────┼─────────────────────────────────────────────┤
│ THALAMUS           │ EventBus                                    │
│ (relay)            │ All signals route here. No subsystem talks  │
│                    │ directly to another — events only.          │
└────────────────────┴─────────────────────────────────────────────┘
```

### 3.1 Self-Awareness Loop

The agent is self-aware because the harness detects and responds to its own execution quality:

```
Each LLM response:
  EntropySensorService scores 5 signal sources
        ↓
  TerminationOracle + BehavioralEntropy check for failure patterns
        ↓
  ReactiveControllerService evaluates decisions (up to 10 action types)
        ↓
  Decision executed (or offered to creator via hook)
        ↓
  LearningEngineService records outcome
        ↓
  If run succeeds with converging trajectory:
    SkillSynthesis extracts SkillFragment
    MemoryConsolidatorService (background) distills episodes → skill instructions
        ↓
  Next run: agent starts with the config and instructions that worked before
```

The LLM observes none of this. The harness operates below the LLM's awareness, adjusting the conditions under which the LLM reasons rather than interfering with its reasoning directly.

---

## 4. Living Skills System

### 4.1 Concept

Skills are the **actionable distillation of memory**. Memory (episodic) records what happened. Skills record what to do about it. The connection is the distillation pipeline: episodic evidence accumulates, and when enough evidence exists, the skill is refined — its instructions sharpened, its config updated — to reflect what was learned.

Skills do not need to be exported to be used. They live internally in `ProceduralMemory` and are active from the moment they are synthesized or loaded. Export to `SKILL.md` is always available but never required.

### 4.2 Skill Sources (three, unified through SkillResolver)

`SkillResolver.resolve({ taskDescription, modelId, agentId })` combines two independent queries, then applies precedence:

1. **SQLite query** — `ProceduralMemoryService.findByTags([taskCategory, modelId])` for learned skills
2. **Filesystem scan** — `SkillRegistry.discover()` for installed and promoted skills

Both results are merged into a unified list and the precedence rule applied on name collision. Learned skills always win over installed/promoted because they are tuned to the specific model and task pattern.

```
SkillResolver
├── Source A: Learned  (ProceduralMemory, SQLite — queried directly)
│   Synthesized from successful runs via LearningEngineService
│   Tagged by [taskCategory, modelId, strategy]
│   Ranked by successRate × useCount
│   evolutionMode: "auto" by default
│
├── Source B: Installed  (SkillRegistry, filesystem scan)
│   SKILL.md directories discovered at bootstrap from:
│     ./.agents/skills/          — project-level (cross-client standard)
│     ./.<agentId>/skills/       — agent-specific project-level
│     ~/.agents/skills/          — user-level (cross-client standard)
│     ~/.reactive-agents/skills/ — RA-native user-level
│     Bundled @reactive-agents/skill-* packages
│   evolutionMode: "locked" by default (installed skills don't mutate)
│   Can override to "suggest" or "auto" per skill via builder
│
└── Source C: Promoted  (api.reactiveagents.dev, opt-in)
    Community-validated skill fragments promoted by telemetry server
    Distributed as @reactive-agents/skill-* packages
    Treated as installed skills on arrival (evolutionMode: "locked")
    source field value: "promoted"
```

**Precedence on name collision:** Learned > Project-level installed > User-level installed > Promoted.
Within project-level installed, agent-specific path (`./<agentId>/skills/`) takes precedence over cross-client path (`./.agents/skills/`). Log a warning when any collision is silently resolved.

### 4.3 SkillRecord — The Living Entity

`ProceduralEntry` is extended into `SkillRecord`. The existing `pattern` field (JSON blob) becomes the serialization format for `SkillRecord`. All existing `ProceduralMemory` queries remain compatible.

```typescript
type SkillRecord = {
  // Identity
  readonly id: string
  readonly name: string                                    // kebab-case, agentskills.io compatible
  readonly description: string                             // when to use this skill
  readonly agentId: string
  readonly source: "learned" | "installed" | "promoted"   // origin (see bottom of section for definitions)

  // Track 1: Instructions (the living SKILL.md body — what to do)
  readonly instructions: string                            // Markdown, evolves over time
  readonly version: number                                 // increments on each LLM refinement
  readonly versionHistory: readonly SkillVersion[]         // rollback capability

  // Track 2: Config recipe (how to run — automated updates from SkillFragment)
  readonly config: SkillFragment

  // Evolution control (creator sets this)
  readonly evolutionMode: "auto" | "suggest" | "locked"
  // "auto"    — agent refines freely; good for personal/long-running agents
  // "suggest" — emits SkillRefinementSuggested event; creator approves
  // "locked"  — read-only; installed community skills, curated skills

  // Confidence lifecycle
  readonly confidence: "tentative" | "trusted" | "expert"
  // tentative: < 5 activations or successRate < 0.8
  // trusted:   5–20 activations, successRate ≥ 0.8
  // expert:    > 20 activations, successRate ≥ 0.9

  // Provenance and metrics
  readonly successRate: number                             // EWMA across all activations
  readonly useCount: number
  readonly refinementCount: number
  readonly taskCategories: readonly string[]               // task types this skill handles
  readonly modelAffinities: readonly string[]              // models this works best with
  readonly base: string | null                             // original SKILL.md body (immutable for installed)
  readonly avgPostActivationEntropyDelta: number           // mean entropy improvement from activation
  readonly avgConvergenceIteration: number                 // mean convergence iteration across activations
  readonly convergenceSpeedTrend: readonly number[]        // convergenceIteration per last 10 activations
  readonly conflictsWith: readonly string[]                // skill names with detected conflicts
  readonly lastActivatedAt: Date | null
  readonly lastRefinedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

type SkillVersion = {
  readonly version: number
  readonly instructions: string
  readonly config: SkillFragment
  readonly refinedAt: Date
  readonly successRateAtRefinement: number
  // "candidate" = newly refined, awaiting N activations before becoming canonical
  // "active"    = proven version (or initial version with no refinements yet)
  readonly status: "candidate" | "active"
}

// Issue 1 resolution: "source" values
// "learned"   — synthesized by LearningEngineService from successful runs (refinementCount === 0)
// "installed" — loaded from a SKILL.md file on disk or bundled package (evolutionMode: "locked" by default)
// "promoted"  — distributed as @reactive-agents/skill-* from community telemetry (treated as installed)
// Note: a "learned" skill that has undergone LLM refinement is still source "learned"; use
//       refinementCount > 0 to distinguish. No fourth "evolved" state exists.
```

**Installed skill inheritance rule:** When a `SKILL.md` is loaded from disk, its body is stored as `base` (immutable). The agent's learned amendments extend `instructions` additively. The original content is never overwritten. `evolutionMode: "locked"` prevents any amendments.

### 4.4 SKILL.md Loading and agentskills.io Compatibility

Reactive Agents implements the agentskills.io progressive disclosure specification.

**Discovery (bootstrap phase):**

Scan directories in precedence order:
1. `./.agents/skills/` — project-level (cross-client standard)
2. `./.<agentId>/skills/` — agent-specific project-level
3. `~/.agents/skills/` — user-level (cross-client standard)
4. `~/.reactive-agents/skills/` — RA-native user-level
5. Bundled packages (`node_modules/@reactive-agents/skill-*`)

For each subdirectory containing `SKILL.md`:
- Parse YAML frontmatter: `name` (required), `description` (required), `license`, `compatibility`, `metadata`, `allowed-tools`
- Lenient validation: warn on non-blocking issues, skip on missing description or unparseable YAML
- Detect name collisions; project-level wins, log warning

**Progressive disclosure — three tiers:**

| Tier | What's loaded | When | Token cost |
|------|---------------|------|-----------|
| 1. Catalog | name + description | Session bootstrap | ~50–100 tokens/skill |
| 2. Instructions | Full SKILL.md body | On activation | < 5,000 tokens (recommended) |
| 3. Resources | scripts/, references/, assets/ | When instructions reference them | Varies |

**Catalog injection (Tier 1) — system prompt XML:**
```xml
<available_skills>
  <skill>
    <name>github-review</name>
    <description>Review GitHub PRs for correctness, style, and security. Use when the user asks to review or analyze a pull request.</description>
    <source>installed</source>
    <confidence>trusted</confidence>
  </skill>
  <skill>
    <name>data-analysis:claude-sonnet-4:coding</name>
    <description>Learned: converged in 2.1 iter avg on coding+data tasks with claude-sonnet-4. Applies plan-execute-reflect with temperature 0.4.</description>
    <source>learned</source>
    <confidence>expert</confidence>
  </skill>
</available_skills>
```

**Activation (Tier 2) — two parallel paths:**

1. **Model-driven:** Agent calls `activate_skill({ name })` tool → harness returns SKILL.md body wrapped in `<skill_content>` XML, protected from context compaction.

2. **Harness-driven (RI integration):** The ReactiveControllerService can pre-activate a skill when entropy signals match a pattern associated with a high-confidence skill — before the agent decides it's relevant. `expert`-confidence skills matching the task description are pre-activated at bootstrap (Tier 1 → 2 automatically).

**Skill content injection structure:**
```xml
<skill_content name="github-review" version="3" source="installed">

[SKILL.md body content]

Skill directory: /home/user/.agents/skills/github-review
<skill_resources>
  <file>scripts/check-security.py</file>
  <file>references/review-checklist.md</file>
</skill_resources>
</skill_content>
```

**Resource handling (Tier 3):**
- `scripts/*` → registered as callable tools for the agent
- `references/*.md` → added to `SemanticMemory` for RAG retrieval; agent accesses via semantic search
- `assets/*` → available for file reads on demand
- All skill content is protected from context compaction pruning

### 4.5 Memory → Skill Distillation Pipeline

The memory consolidation pipeline gains a second pass: **skill distillation**. This is how episodic experience becomes refined skill instructions.

```
MemoryConsolidatorService consolidation cycle:

REPLAY phase (existing):
  Count new episodic entries since last consolidation

CONNECT phase (currently stub → becomes SKILL DISTILLATION):
  Note: the outer consolidation cycle fires when MemoryConsolidatorService.notifyEntry()
  threshold is reached (default: 10 new episodic entries). The distillation pass runs
  inside every CONNECT cycle but applies its own per-skill threshold check:

  For each skill with evolutionMode ≠ "locked":
    Count episodic entries created since skill.lastRefinedAt (or createdAt if never refined)
    If count < refinementThreshold (default: 5): skip this skill
    // The two thresholds are independent. The outer threshold (10) triggers the cycle;
    // the per-skill inner threshold (5) controls which skills actually get refined.
    // A skill accumulates evidence across multiple consolidation cycles if needed.

    SkillDistillerService.distill(skill, recentEpisodes):
      Retrieves N most relevant episodic entries for this skill's taskCategories
      Calls SkillEvolutionService.refine(skill, recentEpisodes):
        LLM call: "Given this skill's current instructions and these N run summaries,
                   produce improved instructions. Be more specific about edge cases,
                   better approaches, and failure patterns observed."
        If LLM call fails (network/timeout/provider error):
          Skill instructions and version unchanged. No SkillRefined event emitted.
          Log at warn level. Next CONNECT cycle retries if threshold still met.
          Return early.
        Create new SkillVersion with status: "candidate"
        // "candidate" = newly refined version, not yet proven
        // Becomes "active" after N successful activations (default: 3)
        // If successRate drops below versionHistory[last].successRateAtRefinement
        // after those activations → auto-rollback, version-- (atomically in SQLite)
      version++, push to versionHistory, update instructions
      Emit: SkillRefined event on EventBus
      If evolutionMode === "suggest": emit SkillRefinementSuggested (pause, await approval)

COMPRESS phase (existing):
  Decay + prune low-importance semantic entries
```

**Skill config track (automated, no LLM, runs at run completion):**

Separately from the LLM refinement, the config track (`SkillFragment`) is updated after every successful run that activates the skill:
- Strategy, temperature, maxIterations updated as weighted average with prior config
- `successRate` updated via EWMA (α = 0.1)
- Confidence threshold check → possible promotion (tentative → trusted → expert)
- If a "candidate" version is active and `successRate` >= `versionHistory[last].successRateAtRefinement` after N activations: promote candidate to "active"
- If `successRate` drops below `versionHistory[last].successRateAtRefinement` after a refinement: rollback both config and instructions to prior version atomically (SQLite transaction)

### 4.6 Skill Evolution Lifecycle (end-to-end)

```
1. BOOTSTRAP
   SkillResolver.resolve({ taskDescription, modelId, agentId })
   → Returns ranked list of matching skills

   Per skill by confidence:
   "expert"    → inject instructions into system prompt + apply config silently
   "trusted"   → add to catalog; harness pre-activates when entropy matches
   "tentative" → add to catalog only; model decides when to activate

2. DURING RUN
   Model calls activate_skill(name) → instructions injected as <skill_content>
   OR: controller detects matching entropy pattern → harness pre-activates
   Skill content protected from context compaction

3. POST-RUN (immediate, sync)
   LearningEngineService.onRunCompleted() wired in execution engine complete phase
   → Checks if a skill was active this run
   → Updates skill.config (SkillFragment) weighted average
   → Updates skill.successRate (EWMA)
   → Confidence check → possible promotion
   → If regression detected → auto-rollback to previous config version

4. BACKGROUND (async, MemoryConsolidatorService CONNECT phase)
   Triggered when notifyEntry() threshold hit (default: 10 new episodic entries — the outer cycle threshold)
   // Note: the per-skill inner threshold is 5 entries since lastRefinedAt (see Section 4.5)
   → LLM refinement of instructions for qualifying skills (evolutionMode ≠ "locked")
   → version++, versionHistory updated
   → Regression check on instructions refinement

5. EXPORT (always optional)
   agent.exportSkill(name, path?) → writes SKILL.md to .agents/skills/<name>/
   agent.skills() → inspect all loaded skills with confidence/source/version
   rax skill export <name> → CLI export
   rax skill list → show all loaded skills
```

### 4.7 Skill Composability

Skills can declare dependencies in their frontmatter `metadata`:

```yaml
---
name: deep-research
description: Conduct multi-source research with citations. Use for thorough research tasks.
metadata:
  requires: web-search citation-formatter
---
```

When `deep-research` is activated, the harness auto-activates `web-search` and `citation-formatter` if available. Dependency resolution is one level deep (no transitive chains at V1.0). Self-references and mutual dependencies are silently ignored with a `warn` log; see Section 11 Open Question 6.

### 4.8 Conflict Detection

When two skills have overlapping `taskCategories` and the Zettelkasten graph creates a `"contradicts"` link between their semantic representations:
- Emit `SkillConflictDetected` event with both skill names
- For `evolutionMode: "auto"`: schedule LLM merge pass in next CONNECT cycle
- For `evolutionMode: "suggest"` or `"locked"`: surface to creator via event only

### 4.9 Context-Aware Skill Management

Skill content injection must be budget-aware. Smaller and local models have limited context windows — loading even a few full SKILL.md bodies can crowd out working memory, episodic context, and tool results. The framework must respect the model tier's token budget and degrade gracefully rather than silently consuming context.

#### Skill token budgets by model tier

The existing model-adaptive context system (4 tiers in `@reactive-agents/context`) defines tier-aware limits. Skill content is allocated a reserved budget within those limits:

| Model tier | Context limit (typical) | Skill budget | Max active skills |
|---|---|---|---|
| `local` | 2K–8K tokens | 512 tokens | 1–2 |
| `mid` | 8K–32K tokens | 1,500 tokens | 3 |
| `large` | 32K–128K tokens | 4,000 tokens | 5 |
| `frontier` | 128K+ tokens | 8,000 tokens | 10 |

Budgets are soft limits. If the agent has remaining context headroom after all other content is placed, the skill budget expands proportionally. If context pressure is high, skill budget shrinks first (before working memory or system prompt).

#### Skill verbosity modes

Each skill is injected at a verbosity level appropriate to the model tier. Verbosity levels are derived from the instruction body at load time and cached on the `SkillRecord`:

| Mode | Token target | Content |
|---|---|---|
| `full` | Up to 5,000 tokens | Complete SKILL.md body |
| `summary` | ~500 tokens | Key instructions only, strip examples and reference detail |
| `condensed` | ~150 tokens | Essential directives only — the minimum useful instruction set |
| `catalog-only` | ~75 tokens | Name + description in catalog; body never injected (skill too large for tier) |

**Tier → mode mapping (defaults, overridable per skill):**
- `frontier`: `full`
- `large`: `full` if budget allows, else `summary`
- `mid`: `summary`
- `local`: `condensed`, or `catalog-only` if skill body > 300 tokens

The `SkillEvolutionService` pre-generates `summary` and `condensed` variants when it refines a skill, so lower-tier injection never requires an on-demand LLM call. For newly-loaded SKILL.md files without pre-generated variants, the first run uses simple heuristic extraction (first N lines of each section heading block). Full LLM-quality variants are generated in the next CONNECT phase.

**Variants stored on SkillRecord:**
```typescript
readonly contentVariants: {
  readonly full: string           // complete instructions (= instructions field)
  readonly summary: string | null // LLM-condensed, ~500 tokens; null until first refinement
  readonly condensed: string | null // heuristic or LLM-condensed, ~150 tokens
}
```

#### Skill injection guard

Before injecting a skill (Tier 2 activation), the harness checks the remaining context budget:

```
remainingTokens = modelContextLimit - estimatedCurrentContextTokens
skillTokens     = tokenCountForVerbosityMode(skill, tier)

if skillTokens > remainingTokens - SKILL_INJECTION_SAFETY_MARGIN:
  try next lower verbosity mode
  if still too large:
    skip injection, emit SkillSkippedContextFull event
    add to catalog section with note: "[context full — activate manually if needed]"
```

`SKILL_INJECTION_SAFETY_MARGIN` defaults to 10% of the model's context limit, ensuring the agent retains headroom for its next reasoning step.

#### Skill eviction priority

When the context compression controller decision fires (`compress`), skills are evicted in this priority order (lowest priority evicted first):
1. `tentative` confidence skills (newest, least proven)
2. Skills not referenced by the agent in the last N iterations
3. `summary` verbosity skills (already condensed; swap to `condensed` before full eviction)
4. `trusted` confidence skills activated longest ago
5. `expert` confidence skills — evicted last; immediately re-injected via `skill-reinject` decision once pressure drops

After eviction, the skill remains in the catalog. The agent can re-activate via `activate_skill` tool at any time, or the harness auto-reinjjects when context pressure drops (`skill-reinject` controller decision).

#### Compaction protection (Open Question 5 — Resolved)

Skill content is protected from context compaction by tagging injected content with `<skill_content>` XML wrappers (Option A). The compaction service identifies these blocks and assigns them `importance = 1.0`, exempt from decay. When eviction is necessary (budget exceeded), the skill eviction priority order above governs which skill blocks are removed first — not the general compaction algorithm.

This requires no inter-service coupling: the compaction service recognises the sentinel tag format without needing to know about `SkillRecord` or `SkillResolver`. New skill types (including future custom skill formats) are automatically protected as long as they use the `<skill_content>` wrapper.

#### Skill compression pipeline (parallel to tool schema collapsing)

The framework already collapses tool schemas for smaller models — stripping optional fields, shortening descriptions, and removing examples when context pressure is high. Skill content follows the same pattern.

**Compression stages applied in order when budget is tight:**

1. **Strip examples** — remove any `### Examples` or `## Examples` section from the skill body (~30–60% token reduction for example-heavy skills)
2. **Strip references** — remove `### References`, `### See Also`, and similar appendix sections
3. **Condense step descriptions** — replace multi-sentence step explanations with single-line summaries (heuristic: keep first sentence of each paragraph)
4. **Collapse to directives** — keep only imperative sentences (starting with action verbs); discard all explanatory prose
5. **Catalog-only** — drop body entirely; retain name + description + tags

The `SkillEvolutionService` pre-generates the `summary` and `condensed` variants during each CONNECT cycle using LLM calls (strips examples → LLM quality condensation). For newly-installed skills without pre-generated variants, stage 1–2 are applied heuristically (regex section stripping) until the first CONNECT cycle generates LLM-quality variants.

**Model tier → default compression stage:**
| Model tier | Default stage | Expansion trigger |
|---|---|---|
| `local` | Stage 4 (directives) or Stage 5 | Context headroom > 200 tokens |
| `mid` | Stage 2 (no references) | Context headroom > 500 tokens |
| `large` | Stage 1 (no examples) | Context headroom > 1,000 tokens |
| `frontier` | No compression | N/A |

#### On-demand skill section inspection (meta-tools)

When a skill is injected in `condensed` or `catalog-only` mode, the agent loses access to examples, reference material, and detailed explanations. Rather than force-injecting the full body (crowding context), the agent can query skill sections on demand using the `get_skill_section` meta-tool.

This mirrors how the `activate_skill` tool allows model-driven full activation — but at section granularity, allowing the agent to fetch only the part it needs.

**`get_skill_section` tool:**
```typescript
// Tool available when skills are enabled and model tier is local or mid
{
  name: "get_skill_section",
  description: "Retrieve a specific section from a skill's full instructions",
  parameters: {
    skillName: string,         // skill to query
    section: string,           // "examples" | "steps" | "references" | "full" | <custom heading>
  },
  returns: string              // requested section content, or "section not found"
}
```

The tool resolves against the `SkillRecord.contentVariants.full` body (always stored), parses section headings, and returns the matching section. It does **not** inject the content into the persistent context — the return value appears in the tool result slot only, and is available for that iteration's reasoning without expanding the base context.

**Auto-include rule:** `get_skill_section` is automatically added to the agent's tool list when:
- `withSkills()` is enabled, AND
- Model tier is `local` or `mid` (frontier/large have enough budget to load full content directly)

This is the same auto-include pattern used for `context-status` and `final-answer` meta-tools.

**Skill catalog note:** When a skill is in `catalog-only` mode, the catalog entry includes a hint: `[condensed — use get_skill_section("skill-name", "full") to access instructions]`. This surfaces the tool to the model without prompting it explicitly.

---

## 5. Intelligence Control Surface

### 5.1 Mid-Run Influence Points (10 total)

The ReactiveControllerService is extended from 3 decision types to 10. Each maps to a specific entropy signal pattern.

| Decision | Trigger Signal | What Changes |
|----------|---------------|--------------|
| `early-stop` | Entropy converged, high confidence | Terminates loop, returns answer |
| `compress` | contextPressure > threshold | Compacts history; preserves skill content |
| `switch-strategy` | Flat/oscillating trajectory N iterations | Changes reasoning strategy |
| `temp-adjust` | Semantic entropy diverging (hallucination risk) | Lowers/raises temperature ±0.1–0.2 |
| `skill-activate` | Task-type + entropy pattern matches skill | Injects skill instructions into context |
| `prompt-switch` | Bandit selects better variant for model+task | Replaces system prompt variant next iteration |
| `tool-inject` | Structural entropy signals knowledge gap | Adds a tool mid-run (e.g., web-search) |
| `memory-boost` | Structural entropy: knowledge gap pattern | Switches retrieval: recent → semantic RAG |
| `skill-reinject` | Context compaction removed skill content | Re-injects skill instructions |
| `human-escalate` | All decisions exhausted, entropy still high | Emits `AgentNeedsHuman` event, pauses |

### 5.2 ControllerDecision type additions

```typescript
// Additions to existing ControllerDecision union type in types.ts:
| { readonly decision: "temp-adjust"; readonly delta: number; readonly reason: string }
| { readonly decision: "skill-activate"; readonly skillName: string; readonly trigger: "entropy-match" | "task-match"; readonly confidence: string }
| { readonly decision: "prompt-switch"; readonly fromVariant: string; readonly toVariant: string; readonly reason: string }
| { readonly decision: "tool-inject"; readonly toolName: string; readonly reason: string }
| { readonly decision: "memory-boost"; readonly from: "recent" | "keyword"; readonly to: "semantic"; readonly reason: string }
| { readonly decision: "skill-reinject"; readonly skillName: string; readonly reason: string }
| { readonly decision: "human-escalate"; readonly reason: string; readonly decisionsExhausted: readonly string[] }
```

**`ControllerEvalParams` additions** (new fields appended to the existing struct in `types.ts`):

```typescript
// Additions to existing ControllerEvalParams type — required by the 7 new evaluators:
readonly currentTemperature: number                          // for temp-adjust evaluator
readonly availableSkills: readonly {                         // for skill-activate evaluator
  name: string
  confidence: "tentative" | "trusted" | "expert"
  taskCategories: readonly string[]
}[]
readonly activeSkillNames: readonly string[]                 // currently injected skill names (for skill-reinject)
readonly availableToolNames: readonly string[]               // for tool-inject evaluator
readonly activePromptVariantId: string                       // for prompt-switch evaluator (bandit)
readonly activeRetrievalMode: "recent" | "keyword" | "semantic"  // for memory-boost evaluator
readonly priorDecisionsThisRun: readonly string[]            // decision types already fired (for human-escalate)
readonly contextHasSkillContent: boolean                     // for skill-reinject: did compaction remove skill content?
```

### 5.3 Creator Control API

```typescript
const agent = await ReactiveAgents.create()
  .withReactiveIntelligence({
    // Observe every intelligence signal
    onEntropyScored: (score: EntropyScore, iteration: number) => void,

    // Inspect and optionally override controller decisions
    // Return "accept" to allow, "reject" to suppress, or a modified decision
    onControllerDecision: (
      decision: ControllerDecision,
      context: { iteration: number; entropyHistory: EntropyScore[] }
    ) => "accept" | "reject" | ControllerDecision,

    // Skill lifecycle hooks
    onSkillActivated: (skill: SkillRecord, trigger: "model" | "harness" | "bootstrap") => void,
    onSkillRefined: (skill: SkillRecord, previousVersion: SkillVersion) => void,
    onSkillConflict: (a: SkillRecord, b: SkillRecord) => "merge" | "surface" | "ignore",

    // Full mid-run adjustment observer
    onMidRunAdjustment: (type: ControllerDecision["decision"], before: unknown, after: unknown) => void,

    // Hard constraints — intelligence never overrides these
    constraints: {
      allowedStrategySwitch?: string[]           // whitelist of allowed target strategies
      maxTemperatureAdjustment?: number          // cap on temp delta (default: 0.2)
      neverEarlyStop?: boolean
      neverHumanEscalate?: boolean
      protectedSkills?: string[]                 // always active, never evicted from context
      lockedSkills?: string[]                    // prevent evolution on specific skills
    },

    // Autonomy level — how much does RI act vs. observe?
    autonomy: "full" | "suggest" | "observe"
    // "full"    — RI acts on all decisions automatically (default)
    // "suggest" — RI emits events; onControllerDecision fires for every decision
    // "observe" — RI scores and logs; takes no action; useful for debugging
  })
  .build();
```

### 5.4 Skill Builder API

```typescript
const agent = await ReactiveAgents.create()
  .withSkills({
    paths: ["./my-skills/", "~/.agents/skills/"],   // additional scan paths
    packages: ["@reactive-agents/skill-github"],     // pre-installed skill packages
    evolution: {
      mode: "suggest",            // default evolutionMode for all loaded skills
      refinementThreshold: 5,     // episodic entries before refinement triggers
      rollbackOnRegression: true, // auto-rollback if successRate drops post-refinement
    },
    // Override evolutionMode per skill
    overrides: {
      "my-critical-skill": { evolutionMode: "locked" },
      "experimental-skill": { evolutionMode: "auto" },
    }
  })
  .build();

// Runtime skill inspection
const skills = await agent.skills();
// Returns: SkillRecord[] with id, name, confidence, source, version, successRate, useCount

// Export a skill to SKILL.md format
await agent.exportSkill("data-analysis", "./.agents/skills/data-analysis/");

// Load a skill at runtime
await agent.loadSkill("./new-skill/");

// Force a skill refinement pass (manual trigger)
await agent.refineSkills();
```

---

## 6. Intelligence Data Enrichment

### 6.1 Test Model Exclusion

All intelligence systems must skip processing when the run is on the test provider. Three guard points:

**Guard 1 — TelemetryClient.send():**
```typescript
private isTestRun(report: RunReport): boolean {
  return (
    report.provider === "test" ||
    report.modelId === "test" ||
    report.modelId.startsWith("test-") ||
    report.modelTier === "test"
  )
}
// If isTestRun: return immediately, no notice printed, no fetch call
```

**Guard 2 — LearningEngineService.onRunCompleted():**
```typescript
// If data.provider === "test" or data.modelId === "test" or starts with "test-":
// Return { calibrationUpdated: false, banditUpdated: false, skillSynthesized: false, taskCategory: "test" }
// Do not update calibration store, bandit store, or synthesize skills
```

**Guard 3 — SkillEvolutionService refinement:**
```typescript
// Never trigger LLM-based skill refinement when episodic evidence was generated by a test run.
// DailyLogEntrySchema gains an optional `provider?: string` field (added to memory/types.ts).
// The execution engine sets provider on every episodic entry it creates.
// SkillDistillerService filters out test-provider entries before counting toward refinementThreshold.
// If ALL entries since lastRefinedAt are from the test provider, the skill is not refined.
```

**Also fix:** The telemetry notice currently always prints on first send. It should check `isTestRun` before printing.

### 6.2 SkillFragment TODO Fixes

Two fields in `extractSkillFragment()` are hardcoded stubs:

```typescript
// Current (broken):
promptTemplateId: "default",   // TODO: wire when bandit selects variants
systemPromptTokens: 0,         // TODO: wire from kernel state
compressionEnabled: false,      // TODO: wire from controller config

// Fixed — wire from execution context:
promptTemplateId: kernelState.meta?.promptVariantId ?? "default",
systemPromptTokens: kernelState.meta?.systemPromptTokens ?? 0,
compressionEnabled: controllerConfig.contextCompression ?? false,
```

`kernelState.meta` (type `EntropyMeta`) needs two new optional fields:
- `promptVariantId?: string` — set by bandit when selecting a prompt variant
- `systemPromptTokens?: number` — set at bootstrap from system prompt token count

### 6.3 Local-Only Enrichment

These signals are captured during execution and stored in `RunCompletedData` and the local `SkillRecord`. They never leave the device.

**New fields for `RunCompletedData`:**
```typescript
// Thought-level signals (from kernel state per iteration)
readonly thoughtTokenCounts: readonly number[]        // token count per thought step
readonly thoughtToActionRatio: number                  // thinking tokens / action tokens
readonly uncertaintyMarkerCount: number                // hedging phrases per run
readonly selfCorrectionCount: number                   // mid-thought plan revisions

// Tool execution patterns
readonly toolCallSequence: readonly string[]           // ["web-search","web-search","file-write"]
readonly toolRetryCount: number                        // retried calls (schema confusion signal)
readonly toolResultCompressionRatios: readonly number[] // per-tool-call compression 0–1
readonly toolErrorCategories: readonly ("schema" | "network" | "timeout" | "empty" | "permission")[]

// Memory effectiveness
readonly memoryHitCount: number                       // retrievals during bootstrap
readonly memoryReferencedCount: number                // items referenced in reasoning
readonly memoryUtilizationRate: number                // referenced / retrieved

// Context budget distribution
readonly tokensBySection: {
  systemPrompt: number
  history: number
  toolResults: number
  currentTurn: number
  skillContent: number
}
readonly peakContextUtilization: number               // max utilization % during run

// Skill usage
readonly skillsActivated: readonly string[]           // skill names activated this run
readonly skillActivationIterations: readonly number[] // which iterations triggered activation
readonly postActivationEntropyDeltas: readonly number[] // entropy before vs after activation

// Convergence — single per-run value (trailing trend lives on SkillRecord, not RunCompletedData)
readonly convergenceIteration: number | null          // iteration at which trajectory first went "converging" this run
```

**New fields for `SkillRecord` (local SQLite):**
```typescript
readonly avgPostActivationEntropyDelta: number  // mean improvement from activation
readonly avgConvergenceIteration: number        // how fast this skill helps agent converge
readonly lastActivatedAt: Date | null
readonly conflictsWith: readonly string[]       // skill names with detected conflicts
```

### 6.4 Telemetry-Safe Enrichment

These additions to `RunReport` are behavioral patterns only. No prompts, no tool arguments, no content. All values are statistical, hashed, or bucketed.

**New fields for `RunReport` (sent to `api.reactiveagents.dev`):**

```typescript
// Trajectory fingerprint — abstract shape, not values
readonly trajectoryFingerprint: string
// Format: "{shape}-{count}" segments joined by ":", e.g. "flat-2:converging-3"
// Computed from entropyTrace.trajectory.shape per iteration

// Tool pattern (anonymized)
readonly abstractToolPattern: readonly ("search" | "write" | "read" | "compute" | "communicate" | "unknown")[]
// Tool names bucketed into abstract action types — no tool names sent

// Convergence signals
readonly iterationsToFirstConvergence: number | null  // first iteration with "converging" trajectory
readonly tokenEfficiencyRatio: number                 // outputTokens / inputTokens
readonly thoughtToActionRatio: number                 // non-identifying reasoning depth signal
readonly contextPressurePeak: number                  // max utilization % (not content)

// Skill signals (no skill names — count and effectiveness only)
readonly skillsActiveCount: number
readonly skillEffectivenessScores: readonly number[]  // postActivationEntropyDeltas (not skill names)
readonly learnedSkillsContribution: boolean           // at least one learned (not installed) skill fired

// Task complexity (bucketed)
readonly taskComplexity: "trivial" | "moderate" | "complex" | "expert"
// Derived from: toolCount, totalIterations, strategySwitched, contextPressurePeak

// Failure pattern (bucketed, only on non-success outcomes)
readonly failurePattern?:
  | "loop-detected"
  | "context-overflow"
  | "tool-cascade-failure"
  | "strategy-exhausted"
  | "guardrail-halt"
  | "timeout"
  | "unknown"
```

**Payload size impact:** The new fields add ~200–400 bytes per report. The 10KB limit remains safe. The existing `entropyTrace` array (already the largest field) is unchanged.

---

## 7. Telemetry Server Changes

### 7.1 Schema Additions

New columns on `run_reports` table (all nullable for backward compatibility with older clients):

```sql
ALTER TABLE run_reports ADD COLUMN trajectory_fingerprint TEXT;
ALTER TABLE run_reports ADD COLUMN abstract_tool_pattern TEXT;       -- JSON array of action types
ALTER TABLE run_reports ADD COLUMN iterations_to_convergence INTEGER;
ALTER TABLE run_reports ADD COLUMN token_efficiency_ratio REAL;
ALTER TABLE run_reports ADD COLUMN thought_to_action_ratio REAL;
ALTER TABLE run_reports ADD COLUMN context_pressure_peak REAL;
ALTER TABLE run_reports ADD COLUMN skills_active_count INTEGER;
ALTER TABLE run_reports ADD COLUMN skill_effectiveness_scores TEXT;  -- JSON array of deltas
ALTER TABLE run_reports ADD COLUMN learned_skills_contribution INTEGER DEFAULT 0;
ALTER TABLE run_reports ADD COLUMN task_complexity TEXT;
ALTER TABLE run_reports ADD COLUMN failure_pattern TEXT;

-- Indexes for aggregation queries
CREATE INDEX IF NOT EXISTS idx_reports_complexity ON run_reports(task_complexity);
CREATE INDEX IF NOT EXISTS idx_reports_trajectory ON run_reports(trajectory_fingerprint);
CREATE INDEX IF NOT EXISTS idx_reports_failure ON run_reports(failure_pattern) WHERE failure_pattern IS NOT NULL;
```

New table for skill effectiveness tracking:

```sql
CREATE TABLE IF NOT EXISTS skill_effectiveness (
  id TEXT PRIMARY KEY,
  skill_fragment_hash TEXT NOT NULL,       -- SHA256 of skill_fragment JSON
  model_id TEXT NOT NULL,
  task_category TEXT NOT NULL,
  task_complexity TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  mean_entropy_delta REAL,                 -- mean postActivationEntropyDelta
  mean_convergence_improvement REAL,       -- mean reduction in convergence iterations
  success_rate REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(skill_fragment_hash, model_id, task_category)
);

CREATE INDEX IF NOT EXISTS idx_skill_eff_model ON skill_effectiveness(model_id);
CREATE INDEX IF NOT EXISTS idx_skill_eff_category ON skill_effectiveness(task_category);
```

### 7.2 Aggregation Additions (`services/aggregation.ts`)

**Extended `model_profiles` fields:**

```sql
ALTER TABLE model_profiles ADD COLUMN avg_convergence_iteration REAL;
ALTER TABLE model_profiles ADD COLUMN p50_context_pressure REAL;
ALTER TABLE model_profiles ADD COLUMN p90_context_pressure REAL;
ALTER TABLE model_profiles ADD COLUMN common_trajectory_fingerprints TEXT; -- JSON: [{fingerprint, count}]
ALTER TABLE model_profiles ADD COLUMN complexity_breakdown TEXT;           -- JSON: {trivial,moderate,complex,expert: count}
ALTER TABLE model_profiles ADD COLUMN failure_pattern_breakdown TEXT;      -- JSON: {pattern: count}
ALTER TABLE model_profiles ADD COLUMN skill_improvement_rate REAL;        -- % of runs where a skill fired + improved entropy
```

**New aggregation query — trajectory pattern analysis:**
```sql
SELECT trajectory_fingerprint, COUNT(*) as count, AVG(total_tokens) as avg_tokens,
       AVG(total_iterations) as avg_iters,
       SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate
FROM run_reports
WHERE model_id = ? AND task_category = ? AND trajectory_fingerprint IS NOT NULL
GROUP BY trajectory_fingerprint
ORDER BY count DESC
LIMIT 10;
```

### 7.3 New API Endpoints

**`GET /v1/profiles/:modelId/trajectories`**

Returns the most common entropy trajectory fingerprints for a model with outcome statistics.

```json
{
  "modelId": "claude-sonnet-4",
  "trajectories": [
    {
      "fingerprint": "flat-1:converging-2",
      "count": 1204,
      "successRate": 0.94,
      "avgIterations": 3.1,
      "avgTokens": 8200
    }
  ]
}
```

**`GET /v1/profiles/:modelId/complexity`**

Returns performance breakdown by task complexity tier.

```json
{
  "modelId": "cogito:14b",
  "complexity": {
    "trivial":  { "count": 847, "successRate": 0.98, "avgIterations": 1.4, "avgTokens": 2100 },
    "moderate": { "count": 612, "successRate": 0.87, "avgIterations": 3.2, "avgTokens": 7400 },
    "complex":  { "count": 203, "successRate": 0.71, "avgIterations": 5.8, "avgTokens": 14200 },
    "expert":   { "count": 44,  "successRate": 0.52, "avgIterations": 8.1, "avgTokens": 21000 }
  }
}
```

**`GET /v1/skills/effectiveness`**

Returns skill effectiveness statistics aggregated across community runs.

Query params: `modelId`, `taskCategory`, `complexity`, `limit` (default 20)

```json
{
  "skills": [
    {
      "skillFragmentHash": "a3f9...",
      "modelId": "claude-sonnet-4",
      "taskCategory": "coding",
      "taskComplexity": "complex",
      "sampleCount": 89,
      "meanEntropyDelta": -0.18,
      "meanConvergenceImprovement": 1.4,
      "successRate": 0.91
    }
  ]
}
```

**`GET /v1/stats`** — extended response:

```json
{
  "totalRuns": 12847,
  "totalInstalls": 342,
  "modelsTracked": 14,
  "skillsValidated": 23,
  "learnedSkillContributionRate": 0.34,
  "avgEntropyImprovement": 0.12,
  "topFailurePatterns": [
    { "pattern": "context-overflow", "count": 412 },
    { "pattern": "loop-detected", "count": 287 }
  ],
  "complexityDistribution": { "trivial": 0.41, "moderate": 0.36, "complex": 0.17, "expert": 0.06 },
  "topModels": [...],
  "since": "2026-03-23T00:00:00Z"
}
```

### 7.4 Validation Changes

`POST /v1/reports` validation additions:
- Accept new fields; all nullable (old clients without new fields are still valid)
- Reject if `trajectoryFingerprint` is present but malformed (not matching `{word}-{n}` pattern)
- Reject if `taskComplexity` is present but not one of the four allowed values
- Reject if `failurePattern` is present but not one of the seven allowed values
- Body size limit remains 10KB. New fields add ~200–400 bytes per report, well within the existing limit. The `entropyTrace` array (already the largest field) is unchanged. Limit increase not required.

---

## 8. New EventBus Events

Add to `@reactive-agents/core` event types:

```typescript
// Skill lifecycle
type SkillActivated = { _tag: "SkillActivated"; skillName: string; version: number; trigger: "model" | "harness" | "bootstrap"; iteration: number; confidence: string }
type SkillRefined = { _tag: "SkillRefined"; skillName: string; previousVersion: number; newVersion: number; taskCategory: string }
type SkillRefinementSuggested = { _tag: "SkillRefinementSuggested"; skillName: string; newInstructions: string; reason: string }
type SkillRolledBack = { _tag: "SkillRolledBack"; skillName: string; fromVersion: number; toVersion: number; reason: "regression" | "manual" }
type SkillConflictDetected = { _tag: "SkillConflictDetected"; skillA: string; skillB: string; conflictType: "instruction" | "config" | "task-overlap" }
type SkillPromoted = { _tag: "SkillPromoted"; skillName: string; fromConfidence: string; toConfidence: string }
type SkillSkippedContextFull = { _tag: "SkillSkippedContextFull"; skillName: string; requiredTokens: number; availableTokens: number; modelTier: string }
type SkillEvicted = { _tag: "SkillEvicted"; skillName: string; reason: "budget" | "low-priority"; verbosityAtEviction: string }

// Intelligence control surface
type TemperatureAdjusted = { _tag: "TemperatureAdjusted"; delta: number; reason: string; iteration: number }
type ToolInjected = { _tag: "ToolInjected"; toolName: string; reason: string; iteration: number }
type MemoryBoostTriggered = { _tag: "MemoryBoostTriggered"; from: string; to: string; iteration: number }
// Merged from HumanEscalationRequested + AgentNeedsHuman — single event, all fields:
type AgentNeedsHuman = { _tag: "AgentNeedsHuman"; agentId: string; taskId: string; reason: string; decisionsExhausted: readonly string[]; context: string }
```

---

## 9. File Changes

### New Files

| Package | File | Responsibility |
|---------|------|---------------|
| `memory` | `src/services/skill-store.ts` | `SkillStore` Effect-TS service: CRUD for `SkillRecord`, SQLite-backed `skills` table, `findByTask()`, `resolve()`, `promote()`, `rollback()` |
| `memory` | `src/services/skill-evolution.ts` | `SkillEvolutionService`: LLM call + version management + regression check + candidate→active promotion. Accepts `MemoryLLM` interface (same pattern as existing `MemoryLLM` in `memory/types.ts`). |
| `reactive-intelligence` | `src/skills/skill-resolver.ts` | Unified resolver: combines `ProceduralMemoryService` SQLite query + `SkillRegistry` filesystem scan; applies precedence; generates catalog XML |
| `reactive-intelligence` | `src/skills/skill-registry.ts` | Filesystem scanner for SKILL.md directories, agentskills.io parser, name collision handling |
| `reactive-intelligence` | `src/skills/skill-distiller.ts` | `SkillDistillerService`: episodic evidence retrieval + per-skill threshold logic. Calls `SkillEvolutionService` (injected). Injected into `MemoryConsolidatorService` via optional interface (same pattern as `MemoryLLM`). Package dependency direction: `reactive-intelligence` depends on `memory` interfaces only — no reverse dependency. |
| `tools` | `src/skills/activate-skill.ts` | `activate_skill` tool definition — returns `<skill_content>` XML for model-driven activation |
| `tools` | `src/skills/get-skill-section.ts` | `get_skill_section` tool definition — on-demand section retrieval (examples, steps, references, full); auto-included for local/mid tiers; result injected in tool result slot only (does not expand base context) |
| `core` | `src/events/skill-events.ts` | New EventBus event types (SkillActivated, SkillRefined, SkillConflictDetected, etc.) |
| `core` | `src/events/intelligence-events.ts` | New EventBus event types (TemperatureAdjusted, ToolInjected, AgentNeedsHuman, etc.) |

### Modified Files

| Package | File | What Changes |
|---------|------|-------------|
| `memory` | `src/types.ts` | Add `SkillRecord`, `SkillVersion` types; extend `MemoryBootstrapResult` with `activeSkills: SkillRecord[]`; add `provider?: string` optional field to `DailyLogEntrySchema` (used by test guard in Guard 3) |
| `memory` | `src/services/memory-consolidator.ts` | Wire CONNECT phase to `SkillDistillerService`; accept optional `SkillEvolutionService` dependency |
| `memory` | `src/database.ts` | Add `skills` table DDL and `skill_versions` table DDL |
| `reactive-intelligence` | `src/types.ts` | Extend `ControllerDecision` union with 7 new decision types; add `RunCompletedData` local enrichment fields |
| `reactive-intelligence` | `src/telemetry/types.ts` | Add all new `RunReport` telemetry fields |
| `reactive-intelligence` | `src/telemetry/telemetry-client.ts` | Add `isTestRun()` guard; fix notice to check guard before printing |
| `reactive-intelligence` | `src/learning/learning-engine.ts` | Add test model guard; wire to `SkillStore` (replace loose `SkillStore` interface with typed one) |
| `reactive-intelligence` | `src/learning/skill-synthesis.ts` | Fill `promptTemplateId`, `systemPromptTokens`, `compressionEnabled` TODOs; wire from kernel state |
| `reactive-intelligence` | `src/types.ts` | Enable `skillSynthesis: true` and `banditSelection: true` in `defaultReactiveIntelligenceConfig` |
| `reactive-intelligence` | `src/controller/controller-service.ts` | Add 7 new evaluators: temp-adjust, skill-activate, prompt-switch, tool-inject, memory-boost, skill-reinject, human-escalate |
| `reactive-intelligence` | `src/runtime.ts` | Wire `SkillResolver` into layer; pass `SkillEvolutionService` to consolidator |
| `runtime` | `src/execution-engine.ts` | Wire `LearningEngineService.onRunCompleted()` in complete phase; wire `SkillResolver` into bootstrap phase; collect local enrichment data; add test provider guard |
| `runtime` | `src/builder.ts` | Add `.withSkills()` builder method; extend `.withReactiveIntelligence()` to accept creator hooks and constraints |
| `tools` | `src/index.ts` | Export `activate_skill` and `get_skill_section` tools; auto-include in agent tool list when skills are enabled (both tools) or tier is local/mid (`get_skill_section`) |

---

## 10. Behavior Contracts

- Intelligence systems **must not** affect an agent that has `withReactiveIntelligence` disabled or not called
- Skills **must not** be synthesized or refined for runs using the test provider (`provider === "test"` or `modelId === "test"` or `modelId.startsWith("test-")`)
- Telemetry **must not** fire for test provider runs (silent skip, no notice printed)
- Skill instructions **must not** be evicted from context by the compaction algorithm; skill content is identified by its `<skill_content>` XML wrapper tag
- `evolutionMode: "locked"` skills **must not** have their `instructions` or `base` modified under any circumstances
- `onControllerDecision` returning `"reject"` **must** suppress the decision entirely — the controller does not retry
- `onControllerDecision` returning a `ControllerDecision` value **must** replace the original decision entirely; the returned `decision` field may differ from the input (e.g., hook may convert a `skill-activate` to an `early-stop`); the controller executes the returned decision without type validation
- Skill version rollback **must** restore both `instructions` and `config` to the prior version atomically (single SQLite transaction)
- `SkillConflictDetected` events **must** be emitted before any merge attempt, giving hooks a chance to handle the conflict
- If the distillation LLM call in the CONNECT phase fails for any reason: skill `instructions` and `version` are unchanged, no `SkillRefined` event is emitted, the failure is logged at `warn` level, the next consolidation cycle retries if the threshold is still met
- A "candidate" skill version **must not** trigger harness-driven pre-activation (only "active" versions qualify); model-driven activation via `activate_skill` tool is still permitted for candidates
- `get_skill_section` **must not** inject content into the persistent base context — the result appears only in the tool result slot for that iteration; the skill's `<skill_content>` block in base context is never mutated by this tool
- `get_skill_section` **must** resolve against `SkillRecord.contentVariants.full`; if the skill is not found or the section heading does not exist, return the string `"section not found"` rather than an error

---

## 11. Open Questions (pre-implementation)

1. **SkillDistillerService LLM dependency** — **Resolved:** `SkillEvolutionService` (in `@reactive-agents/memory`) accepts `MemoryLLM` as an optional injected interface, same pattern as existing `MemoryLLM` in `memory/types.ts`. `SkillDistillerService` (in `@reactive-agents/reactive-intelligence`) handles episodic retrieval and threshold logic, calling `SkillEvolutionService` for the LLM pass. `MemoryConsolidatorService` accepts `SkillDistillerService` as an optional injected interface. Package dependency direction is strictly `reactive-intelligence → memory interfaces`, never reversed.

2. **Skill SQLite table location** — **Resolved:** `skills` and `skill_versions` tables live in the same memory database as `procedural_memory`, enabling atomic transactions during distillation and rollback.

3. **agentskills.io `allowed-tools` field** — **Resolved for V1.0:** Parse and store the field value in `SkillRecord.metadata` but do not enforce tool permission gating. Log the field at `debug` level. Enforcement tracked for V1.1.

4. **Telemetry server deployment** — **Resolved:** All new `run_reports` columns are `ALTER TABLE ... ADD COLUMN ... NULL` — backward-compatible with existing rows. No data migration required. A `migrations/` directory with numbered migration files is recommended for the server repo.

5. **Skill content compaction protection** — **Resolved:** Option A selected. Skill content injected inside `<skill_content>` XML tags is marked `importance = 1.0` (exempt from compaction decay) by the compaction service on tag detection. When budget must be reduced, the skill eviction priority order in Section 4.9 governs which skill blocks are removed first. No inter-service coupling required. See Section 4.9 for full context-aware skill management design including model-tier budgets, verbosity modes, and the injection guard.

6. **Skill dependency cycles** — If Skill A's `metadata.requires` contains Skill A itself (self-reference) or creates a two-skill mutual dependency, the harness logs a warning and ignores the dependency link. No transitive resolution is attempted. Resolution is one level only.
