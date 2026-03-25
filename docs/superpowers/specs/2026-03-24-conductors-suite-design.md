# The Conductor's Suite — Design Spec

**Date:** 2026-03-24
**Status:** Draft v3 — spec review pass 2 issues resolved
**Author:** Tyler Buell + Claude
**Packages:** `@reactive-agents/tools`, `@reactive-agents/reactive-intelligence`, `@reactive-agents/reasoning`, `@reactive-agents/runtime`, `@reactive-agents/memory`

---

## 1. Thesis

A Reactive Agent should feel like a conductor of its craft — fully aware of every instrument at its disposal, able to take the pulse of a performance in progress, gather exactly what it needs without wading through noise, and store insights for precise recall. Today the agent is a subject of its own intelligence layer: the reactive intelligence system monitors it, detects entropy, fires controller decisions, and redirects — all without the agent's knowledge or participation.

This spec closes that gap. The Conductor's Suite gives the agent **four tools** that together form a closed cognitive loop: orientation, search, introspection, and working memory. The tools are designed under a single constraint — minimal input, rich output, no reasoning overhead added. They expose what the framework already knows. The harness skill teaches the agent how to use them.

---

## 2. Scope

This spec defines:

1. **`brief`** — situational awareness: tools, documents, skills, memory, recall index, entropy grade
2. **`find`** — unified intent-driven search: routes across documents, web, memory; auto-stores to recall
3. **`pulse`** — reactive intelligence made accessible: entropy, behavior, context pressure, controller decisions, recommendations
4. **`recall`** — selective working memory: droplet retrieval, keyword search within session, replaces scratchpad
5. **The Harness Skill** — built-in living skill teaching the conductor's workflow
6. **Builder integration** — `.withMetaTools()` configuration API
7. **Backward compatibility** — scratchpad aliases preserved

**Not in scope:**
- Multi-agent monitoring or parent/child signaling (post-V1.0)
- Persistent cross-session recall (separate spec)
- Visual Cortex introspection UI (post-V1.0)

---

## 3. Design Principles

**Glass box, not black box.** Every default in this suite is visible, overrideable, and moldable. The harness skill is a seed — developers can replace it, extend it, or evolve it. The `pulse` signals are the same signals the reactive controller already uses — they are exposed, not invented. The routing logic inside `find` is configurable. Nothing is hardcoded for the developer's convenience at the cost of their control.

**Sensible defaults that slay problems out of the box.** A developer who calls `.withMetaTools()` with no arguments should get an agent that orients itself, searches intelligently, self-monitors, and manages context without any configuration. The defaults are not placeholders — they are production-ready choices that solve the most common failure modes (orientation blindness, source confusion, reasoning loops, context floods).

**Every default is a starting point, not a constraint.** The harness skill can be replaced by a custom skill or evolved by the living skills system. The `find` routing order can be overridden. The `pulse` recommendation rules can be extended. The `recall` preview length is configurable. Developers building specialized agents should be able to mold every behavior to their will.

**Minimal surface, rich output.** Each tool takes 0–2 arguments. Every response is structured and drillable. The agent expresses intent; the tool figures out how.

**Droplet not waterfall.** Default responses are compact. Depth is available on demand via drill parameters. The agent always knows depth exists without having to consume it.

**No new reasoning overhead.** Each tool returns data the framework already has. No LLM calls happen inside these tools except for `pulse` recommendations on frontier models. Any LLM call failure silently falls back to deterministic rules — the tool never errors.

**Composable cognitive loop.** The tools are designed to feed each other: `find` populates `recall`, `brief` surfaces `recall`, `pulse` reads both. Running one tool improves the value of the next.

**Conductor language.** Names are short authoritative verbs — the agent commands, not requests.

---

## 4. Tool Definitions

### 4.1 `brief(section?)`

**Purpose:** Full situational awareness in a single call. The pre-performance briefing.

**Parameters:**
| Name | Type | Required | Default |
|------|------|----------|---------|
| `section` | `"tools" \| "documents" \| "skills" \| "memory" \| "recall" \| "signal" \| "all"` | No | compact overview |

**Default output (no section):**
```
tools: 8 available [search, code, file, rag, meta]
documents: MEMORY.md (12 chunks) · README.md (8 chunks)
skills: 3 available [build-package, validate-build, implement-service]
memory: 16 semantic · 2 episodic
recall: 4 keys [_tool_result_1, findings, plan, notes]
context: ████████░░ 78% · moderate pressure · 2,100 tokens remaining
signal: ⚠ flat trajectory · Grade C · entropy 0.65
```

If reactive intelligence is disabled, the `signal` line is omitted entirely from the compact view.

**Drillable sections:**
- `brief("tools")` — full tool schemas with usage guidance, categories, risk levels
- `brief("documents")` — source paths, chunk counts, format, first 80-char snippet per doc
- `brief("skills")` — skill names, one-line purpose, activation instructions. **Resolved lazily at call time** by querying `SkillResolverService` (filesystem + SQLite); if no resolver is available, returns empty array with a note.
- `brief("memory")` — semantic lines with relevance scores, episodic entry summaries
- `brief("recall")` — all recall keys with sizes, types, and 100-char previews
- `brief("signal")` — full entropy breakdown: composite, per-source scores, trajectory shape, momentum, controller decisions fired this run. Returns `{ available: false, reason: "reactive intelligence disabled" }` if RI is off.
- `brief("all")` — all sections expanded; `brief("skills")` lazy resolution fires here too

**State requirements:** `BriefState` injected at construction time. Skill list is deliberately excluded from construction-time state — it is resolved lazily at call time inside the Effect handler to avoid async calls during synchronous kernel setup:

```typescript
interface BriefState {
  availableTools: readonly ToolSchema[];
  indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
  // Skills are NOT pre-resolved — handler calls skillResolver lazily when brief("skills") is requested
  skillResolver: SkillResolverService | undefined;
  task: string;          // passed to SkillResolverService.resolve() when skills are requested
  modelId: string;       // passed to SkillResolverService.resolve()
  agentId: string;       // passed to SkillResolverService.resolve()
  memoryBootstrap: { semanticLines: number; episodicEntries: number };
  recallStore: () => ReadonlyMap<string, string>;  // reads scratchpadStoreRef, not KernelState.scratchpad
  entropySnapshot: () => EntropySnapshotLike | undefined;
  contextPressure: () => ContextPressureLike | undefined;
  tokens: () => number;          // state.tokens (not state.tokensUsed — field is `tokens` on KernelState)
  tokenBudget: number;           // derived from contextProfile.hardBudget ?? model token limit
}
```

**`makeBriefHandler` signature and lazy resolution:** The handler is an Effect-valued function, consistent with `makeFinalAnswerHandler`. When `section === "skills"` or `section === "all"`, it yields the skill resolution Effect inline:

```typescript
export const makeBriefHandler =
  (state: BriefState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const section = args.section as string | undefined;
      // ... compact output for default case ...
      if (section === "skills" || section === "all") {
        const skills = state.skillResolver
          ? yield* state.skillResolver.resolve({
              taskDescription: state.task,
              modelId: state.modelId,
              agentId: state.agentId,
            }).pipe(Effect.catchAll(() => Effect.succeed({ skills: [] })))
          : { skills: [] };
        // ... format skills ...
      }
      // ...
    });
```

Skill resolution errors are swallowed with an empty list (same error-swallowing pattern used throughout the meta-tool layer).

**Design notes:**
- `brief()` with no args targets ~150 tokens. Drill sections target ~400 tokens each.
- `brief("signal")` reads live RI state via `entropySnapshot()` and `controllerDecisionLog()` at call time. `brief("signal")` also shows the accumulated `controllerDecisionLog` entries — see Section 7.
- The entropy grade (A–F) maps from composite score: A ≤0.3, B ≤0.45, C ≤0.60, D ≤0.75, F >0.75.
- `recallStore` reads from the module-level `scratchpadStoreRef` (the live in-process store), not from `KernelState.scratchpad` (which is a per-iteration snapshot). This matches what `recall` and the scratchpad tools read — see Section 7.

---

### 4.2 `find(query, scope?)`

**Purpose:** Unified intent-driven search. Routes intelligently across all available sources. Eliminates the rag-search vs web-search decision.

**Parameters:**
| Name | Type | Required | Default |
|------|------|----------|---------|
| `query` | `string` | Yes | — |
| `scope` | `"auto" \| "documents" \| "web" \| "memory" \| "all"` | No | `"auto"` |

**Routing logic for `scope: "auto"`:**
1. Search indexed documents via RAG (`makeInMemorySearchCallback`)
2. If results ≥ 1 with score > `minRagScore` (default: 0.1) → return with `source: "documents"`
3. Else search semantic memory
4. If memory results ≥ 1 → return with `source: "memory"`
5. Else, if `webFallback: true` and `web-search` is in the available tools list → call web search
6. Return web results with `source: "web"`, or empty results if web is also unavailable

**Empty-results case:** If all sources are searched and none return results, return:
```typescript
{ query, results: [], totalResults: 0, sourcesSearched: ["documents", "memory", "web"] }
```
No error is thrown. The agent should try rephrasing or call `pulse()` to diagnose.

**Output:**
```typescript
{
  query: string;
  results: Array<{
    content: string;
    source: "documents" | "web" | "memory";
    identifier: string;      // file path, URL, or memory key
    score: number;
    chunkIndex?: number;
  }>;
  totalResults: number;
  sourcesSearched: string[];  // which scopes were actually tried
  storedAs?: string;           // recall key if results were large enough to auto-store
}
```

**Auto-store behavior:** If total result content exceeds `autoStoreThreshold` (default: 800 chars), results are written to `recall` under `_find_<n>` and the response includes `storedAs`. Inline results contain only the top-3 previews.

**`scope: "all"` deduplication:** Results from all sources are merged and deduplicated by exact content hash. After deduplication, results are sorted by score descending. No embedding-based similarity is used for dedup — exact-hash only to avoid LLM calls.

**Design notes:**
- `scope: "documents"` — RAG only, no fallback, returns empty if no documents indexed
- `scope: "web"` — web only regardless of indexed documents
- `scope: "memory"` — semantic + episodic memory only
- `find` is a router over existing `ragMemoryStore`, `web-search` handler, and memory services. No new search engine is introduced.
- Web fallback is disabled when `web-search` is not in `availableTools` or when `webFallback: false`.

**FindConfig on builder:**
```typescript
interface FindConfig {
  autoStoreThreshold?: number;   // chars before auto-storing (default: 800)
  minRagScore?: number;          // minimum RAG score for a hit to count (default: 0.1)
  webFallback?: boolean;         // whether auto scope falls back to web (default: true)
  preferredScope?: "documents" | "memory" | "web"; // bias auto-routing order
}
```

---

### 4.3 `pulse(question?)`

**Purpose:** Reactive intelligence made accessible. The agent takes its own pulse — entropy state, behavioral signals, context pressure, controller decisions, and an actionable recommendation. Makes the agent a co-pilot of its own intelligence rather than a passive subject.

**Parameters:**
| Name | Type | Required | Default |
|------|------|----------|---------|
| `question` | `string` | No | general self-assessment |

**No-entropy-data fallback:** When `pulse` is called before any entropy data exists (RI disabled, or iteration 0 before first scoring), the signal section returns safe defaults:
```typescript
signal: {
  grade: "unknown",
  composite: -1,
  shape: "unknown",
  momentum: 0,
  confidence: "low"
}
```
The `recommendation` still fires (using behavioral/context signals if available) and notes "Entropy data not yet available — proceeding with behavioral signals only."

**Output:**
```typescript
{
  // Entropy signals (defaults to "unknown" values if RI not enabled or iteration 0)
  signal: {
    grade: "A" | "B" | "C" | "D" | "F" | "unknown";
    composite: number;           // 0–1, lower is better; -1 if unavailable
    shape: "converging" | "flat" | "diverging" | "oscillating" | "v-recovery" | "unknown";
    momentum: number;            // rate of change; 0 if unavailable
    confidence: "high" | "medium" | "low";
  };

  // Behavioral analysis (derived from KernelState.steps; always available)
  behavior: {
    loopScore: number;           // 0–1, higher = more looping
    toolSuccessRate: number;     // fraction of tool calls that succeeded
    repeatedActions: string[];   // "tool(args)" combos called >1 time
    actionDiversity: number;     // unique tools / total tool calls
  };

  // Context state (always available)
  context: {
    iterationsUsed: number;
    iterationsRemaining: number;
    tokens: number;              // state.tokens — KernelState field name
    pressureLevel: "low" | "moderate" | "high" | "critical";
    headroomTokens: number;
    atRiskSections: string[];    // context sections approaching token limit
  };

  // Controller activity (empty arrays if RI disabled)
  controller: {
    decisionsThisRun: string[];  // from controllerDecisionLog: "decision: reason" strings
    pendingDecisions: string[];  // always [] in this release; reserved for future spec
  };

  // Actionable guidance (always present)
  recommendation: string;
  readyToAnswer: boolean;        // true only if final-answer would be accepted RIGHT NOW
  blockers: string[];            // exact reasons final-answer would be rejected
}
```

**`readyToAnswer` definition:** `readyToAnswer = detectCompletionGaps(task, toolsUsed, allToolSchemas, steps).length === 0 && shouldShowFinalAnswer({ requiredToolsCalled, requiredTools, iteration, hasErrors, hasNonMetaToolCalled })`. Both conditions must pass — gap detection AND the visibility gate. `blockers` is the union of gap descriptions and unmet visibility conditions, giving the agent the exact same information the `final-answer` gate uses.

**Question routing:**
- `pulse()` → full assessment, all sections populated
- `pulse("am I ready to answer?")` → full assessment with `readyToAnswer` + `blockers` highlighted
- `pulse("should I change approach?")` → focuses on `behavior.loopScore`, `signal.shape`, strategy recommendation
- `pulse("how much context do I have left?")` → returns `context` section only (faster, no LLM call)

**Recommendation generation:**
- Frontier models (`useLLMRecommendation: true`): one LLM call with the signal snapshot → 1–2 sentence plain-language recommendation. If the LLM call fails for any reason, silently falls back to deterministic rules with no error surfaced to the agent.
- Local/small models or `useLLMRecommendation: false`: deterministic rules only (no LLM call).
- **Deterministic rules (priority order):**
  1. `loopScore > 0.7` → "You may be repeating the same actions — try a different approach or rephrase your query."
  2. `signal.shape === "flat" && iteration > 3` → "Entropy is not decreasing. Your current approach may not be working. Consider pivoting strategy."
  3. `signal.shape === "oscillating"` → "Oscillating reasoning detected. Commit to one approach rather than switching back and forth."
  4. `pressureLevel === "critical"` → "Context is nearly full. Finalize your answer soon or key history will be compressed away."
  5. `pressureLevel === "high"` → "Context pressure is high. Avoid large tool results — use recall for storage."
  6. Default → "Execution is on track. Continue with your current approach."

**PulseConfig on builder:**
```typescript
interface PulseConfig {
  useLLMRecommendation?: boolean;       // default: auto (true for frontier, false for local)
  includeControllerDecisions?: boolean; // default: true
  includeBehavior?: boolean;            // default: true
}
```

---

### 4.4 `recall(key?, content?, query?)`

**Purpose:** Selective working memory. Replaces `scratchpad-write` and `scratchpad-read`. Stores rich data, returns smart previews by default (the droplet). Supports keyword search within stored data.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `key` | `string` | No | Storage key for write or targeted read. |
| `content` | `string` | No | Content to store. Presence triggers write mode (requires `key`). |
| `query` | `string` | No | Keyword search query. Triggers search mode. Mutually exclusive with `content`. |
| `full` | `boolean` | No | If `true` on a key read, returns full content instead of preview. Default: `false`. |

**Mode dispatch by parameter presence** (no `null` values required — LLM-friendly):
- `key` + `content` present → **write**
- `key` present, `content` absent, `query` absent → **read** (preview or full)
- `query` present → **search** across all stored entries
- No parameters → **list** all keys

The handler detects mode via `args.key !== undefined`, `args.content !== undefined`, `args.query !== undefined`. Each mode has a non-overlapping parameter signature.

**Write:** `recall(key="plan", content="1. Do X\n2. Do Y...")`
```typescript
{ saved: true, key: "plan", bytes: 240, preview: "1. Do X\n2. Do Y (first 200 chars)..." }
```
Content is never truncated on write. The write confirmation includes only a 200-char preview.

**Read:** `recall(key="plan")`
```typescript
// Default (preview — the droplet):
{ key: "plan", preview: "1. Do X\n2. Do Y...", bytes: 240, truncated: true }

// Full mode (full: true):
{ key: "plan", content: "1. Do X\n2. Do Y...(complete)", bytes: 240, truncated: false }
```
Entries smaller than `autoFullThreshold` (default: 300 chars) always return full content regardless of the `full` flag.

**List:**
```typescript
{ entries: [{ key, bytes, preview, type: "agent" | "auto" }], totalEntries: 4, totalBytes: 1840 }
```
`type: "auto"` marks entries written by the framework (`_tool_result_N`, `_find_N`). `type: "agent"` marks entries the agent wrote itself.

**Search:** Uses TF keyword scoring — the same algorithm as `makeInMemorySearchCallback` in `rag-search.ts`, applied over the in-session recall store. **No embedding calls.** The recall store is a flat `Map<string, string>` and does not have a vector index; keyword scoring is the correct approach here and consistent with the "no new reasoning overhead" principle.

```typescript
{
  query: "...",
  matches: Array<{ key: string; excerpt: string; score: number }>,
  totalMatches: number
}
```

**Underlying store:** `recall` reads and writes the module-level `scratchpadStoreRef` (`Ref<Map<string, string>>`) defined in `packages/tools/src/skills/scratchpad.ts`. It does NOT read from `KernelState.scratchpad`, which is a per-iteration snapshot synced after tool execution. The `recall` handler, `scratchpad-write`, and `scratchpad-read` all operate on the same live `scratchpadStoreRef`. The existing sync from `scratchpadStoreRef` into `KernelState.scratchpad` (used by context compaction) is unchanged.

**Backward compatibility:**
- `scratchpad-write` and `scratchpad-read` remain registered and visible to the LLM
- They delegate to `recall` internally (write → `recall(key, content)`, read → `recall(key, full: true)`)
- `_tool_result_N` keys continue to be written and readable as before
- Agents using the old tools continue to work without change
- When `recall` is registered, `scratchpad-write` and `scratchpad-read` remain in the tool list as labeled aliases so the LLM can use either; their descriptions are updated to say "alias for recall"

**RecallConfig on builder:**
```typescript
interface RecallConfig {
  previewLength?: number;        // chars in default preview (default: 200)
  autoFullThreshold?: number;    // entries smaller than this always return full (default: 300)
  maxEntries?: number;           // evict oldest non-auto entries when exceeded (default: 50)
  maxTotalBytes?: number;        // evict largest non-auto entries when exceeded (default: 200_000)
}
```

---

## 5. The Harness Skill

**The harness skill is a default, not a constraint.** It ships with the framework as a seed — a production-ready starting point. Developers can replace it entirely, extend it, disable it, or let the living skills system evolve it into something tuned to their specific agent and use patterns. The framework owns the seed; the developer owns the outcome.

### 5.1 Built-in Seed

**Files:**
- `packages/runtime/assets/harness.skill.md` — frontier tier (Claude, GPT-4, Gemini)
- `packages/runtime/assets/harness.skill.condensed.md` — local tier (cogito, llama, mistral etc.)

Bundled with `@reactive-agents/runtime`. Always available regardless of user skill configuration. Tier selection uses the same model-tier detection already used by the context engine.

**Purpose:** A built-in living skill that every agent receives. It teaches the conductor's workflow — how to use `brief`, `find`, `pulse`, and `recall` effectively for different task types. It is the agent's operating manual written in its own language.

**Activation:** Injected as a system-prompt prefix for non-trivial tasks. Triviality is detected by: task description length < 80 chars AND no tool requirements AND no documents indexed. Trivial tasks skip it to save tokens.

**Tier-adaptive content:**
- **Frontier:** Full conductor's workflow — all four tools explained with decision trees and key patterns
- **Local/small:** Condensed — 2–3 bullet points per tool, no decision trees
- **Disabled (`harnessSkill: false`):** Tools remain available; no guidance injected

### 5.2 Override Mechanism

Developers can supersede the built-in harness at any level of granularity:

```typescript
// Use the built-in default (recommended starting point)
.withMetaTools({ harnessSkill: true })

// Replace with a custom harness skill file
.withMetaTools({ harnessSkill: "./my-agent-harness.md" })

// Replace with inline content
.withMetaTools({ harnessSkill: "# My Agent's Workflow\n..." })

// Disable entirely — tools available, no guidance injected
.withMetaTools({ harnessSkill: false })

// Provide tier-specific overrides while keeping the other tier as the built-in default
.withMetaTools({
  harnessSkill: {
    frontier: "./harness-frontier.md",  // custom for large models
    local: true,                         // built-in condensed for small models
  }
})
```

Custom harness files follow the same SKILL.md format used by the living skills system — they are immediately compatible with `SkillEvolutionService` for future refinement.

### 5.3 Precedence Order

When the harness skill is resolved at runtime (highest to lowest):

1. **Developer override** — explicit path, inline content, or `false` from `.withMetaTools()`
2. **Evolved version** — a `SkillRecord` with `id: "harness"` stored by `SkillEvolutionService`, if one exists and evolution is not disabled
3. **Built-in seed** — the framework asset files, tier-selected by model

This means the developer always wins. If `true` is passed (the default), the living skills system can evolve the harness over time. If a custom file is provided, the living skills system can still evolve it (unless `evolution.mode: "off"` is set in `.withSkills()`).

Developers can inspect, export, or reset the current harness via the standard skills runtime API:
```typescript
agent.skills()                           // see current harness version and metadata
agent.exportSkill("harness")             // export the current evolved version
agent.loadSkill("harness", seedContent)  // reset to a specific version
agent.refineSkills()                     // trigger an evolution cycle
```

**Frontier skill content:**

```markdown
# Conductor's Workflow

You are a reactive agent with four meta-tools. Use them to orient, gather, self-check, and remember.

## Before Starting (complex tasks)
1. Call `brief()` — see your tools, documents, skills, recall index, context budget, and signal grade.
2. If signal grade is C or below at any point, call `pulse()` to understand why.
3. Use `find(query)` instead of choosing between rag-search and web-search — it routes automatically.

## During Execution
- `find(query)` — gather information from any source. Specify `scope` only if you need to.
- `recall(key, content)` — store anything worth keeping across steps.
- `recall(key)` — retrieve a stored entry. Default is a compact preview; use `full: true` for complete content.
- `recall(query=...)` — search across all stored entries by keyword when you forget key names.
- `pulse()` — take your own pulse when stuck, unsure, or about to repeat yourself.

## Before Answering
- If uncertain whether you're ready, call `pulse("am I ready to answer?")`.
- The `readyToAnswer` field and `blockers` list tell you exactly what final-answer needs.

## Key Patterns
- Same tool called 3+ times with no progress → `pulse()` to diagnose.
- Large tool result → auto-stored to recall. Use `recall(key)` to retrieve selectively.
- Complex new task → `brief()` first.
- Unsure which source to search → `find(query)` with default scope, it decides for you.
```

**Condensed skill content (local tier):**

```markdown
# Meta-Tools Quick Reference
- `brief()` — see all tools, documents, context, signal grade
- `find(query)` — search documents, memory, or web automatically
- `pulse()` — check your progress; `pulse("am I ready?")` before final-answer
- `recall(key, content)` to store · `recall(key)` to retrieve · `recall(query=...)` to search notes
```

**Evolvability:** The harness skill participates in the living skills system. `SkillEvolutionService` can refine it based on episodic evidence of when agents followed/deviated from the workflow and the outcomes. Evolved versions are stored as `SkillRecord` entries with the `id: "harness"` and versioned via `SkillEvolutionService`. The framework-asset files serve as the seed version.

---

## 6. Builder Integration

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools()
  .withMetaTools({
    brief: true,                          // orientation tool
    find: true,                           // unified search
    pulse: true,                          // RI introspection
    recall: true,                         // enhanced working memory
    harnessSkill: true,                   // inject conductor's workflow skill
    // Per-tool config (all optional):
    findConfig: {
      webFallback: true,
      minRagScore: 0.1,
      autoStoreThreshold: 800,
    },
    pulseConfig: {
      useLLMRecommendation: true,
      includeControllerDecisions: true,
    },
    recallConfig: {
      previewLength: 200,
      maxTotalBytes: 200_000,
    },
  })
  .build();
```

**`MetaToolsConfig` type:**
```typescript
type HarnessSkillConfig =
  | boolean                          // true = built-in default, false = disabled
  | string                           // file path or inline SKILL.md content
  | { frontier?: boolean | string; local?: boolean | string };  // per-tier override

interface MetaToolsConfig {
  brief?: boolean;
  find?: boolean;
  pulse?: boolean;
  recall?: boolean;
  harnessSkill?: HarnessSkillConfig; // default: true when .withMetaTools() called
  findConfig?: FindConfig;
  pulseConfig?: PulseConfig;
  recallConfig?: RecallConfig;
}
```

**Shorthand:** `.withMetaTools()` with no args enables all four tools + harness skill with defaults.

**Defaults when `.withTools()` is called:** `recall` is automatically enabled. It registers alongside (not replacing) `scratchpad-write` and `scratchpad-read`, which become aliases. The LLM sees all three but their descriptions indicate `scratchpad-*` are aliases for `recall`. `brief`, `find`, and `pulse` require explicit opt-in.

---

## 7. State Threading

All four tools require state objects injected at construction time by the react-kernel (same pattern as `makeFinalAnswerHandler`, `makeContextStatusHandler`). All state is captured via closures over live references — tools always see current values, not values at construction time.

### `controllerDecisionLog` — new field on `KernelState`

`pulse` requires access to the list of controller decisions fired during the run. This data does not currently exist on `KernelState` as an accumulated list (the existing `state.meta.controllerDecisions` is overwritten each iteration). A new additive field is added, keeping the existing field for backward compatibility with the termination oracle:

```typescript
// packages/reasoning/src/strategies/shared/kernel-state.ts
interface KernelState {
  // ... existing fields including state.meta (unchanged) ...
  controllerDecisionLog: readonly string[];  // NEW — accumulated across all iterations
}

const initialKernelState: KernelState = {
  // ...
  controllerDecisionLog: [],
};
```

**String format for each entry:** `"${decision.decision}: ${decision.reason}"` — e.g. `"compress: context pressure at 0.91"`, `"strategy-switch: entropy flat for 4 iterations"`. Human-readable, directly presentable to the LLM in `pulse` output. No JSON serialization.

**Accumulation in KernelRunner:** After each reactive controller evaluation, new decisions are appended:
```typescript
// After: state = transitionState(state, { meta: { ...state.meta, controllerDecisions: decisions } })
// Add:
state = transitionState(state, {
  controllerDecisionLog: [
    ...state.controllerDecisionLog,
    ...decisions.map(d => `${d.decision}: ${d.reason}`),
  ],
});
```

**`state.meta.controllerDecisions` is kept** (additive change). The termination oracle at `TerminationContext.controllerDecisions` and the two read sites in `react-kernel.ts` (lines 534 and 932) continue to use the existing path unchanged. `controllerDecisionLog` is the new field for `pulse` only.

**`pendingDecisions` in `pulse` output:** Always returns `[]` in this release. The infrastructure for a queued-but-not-executed decision concept does not currently exist. The field is present in the output type to reserve the API shape for a future spec.

### State interfaces

```typescript
// BriefState — constructed once; skill list resolved lazily at call time
const briefState: BriefState = {
  availableTools: input.availableToolSchemas ?? [],
  indexedDocuments: ragStore ? getRagDocumentIndex(ragStore) : [],
  skillResolver,
  task: input.task,
  modelId: input.modelId ?? "unknown",
  agentId: input.agentId ?? "unknown",
  memoryBootstrap: { semanticLines, episodicEntries },
  recallStore: () => /* Ref.get(scratchpadStoreRef) resolved synchronously via unsafe read */,
  // Entropy paths use (state.meta as any).entropy — same pattern as existing kernel-runner code
  entropySnapshot: () => (state.meta as any).entropy?.latest,
  contextPressure: () => (state.meta as any).entropy?.contextPressure,
  tokens: () => state.tokens,                         // KernelState field is `tokens`, not `tokensUsed`
  tokenBudget: input.contextProfile?.hardBudget ?? DEFAULT_TOKEN_BUDGET,
};

// PulseState — all closures over live KernelState
const pulseState: PulseState = {
  entropyHistory: () => ((state.meta as any).entropy?.entropyHistory as EntropyScore[]) ?? [],
  controllerDecisionLog: () => state.controllerDecisionLog,
  steps: () => state.steps,
  iteration: () => state.iteration,
  maxIterations: input.maxIterations,
  tokens: () => state.tokens,
  tokenBudget: input.contextProfile?.hardBudget ?? DEFAULT_TOKEN_BUDGET,
  task: input.task,
  allToolSchemas: input.availableToolSchemas ?? [],
  toolsUsed: () => state.toolsUsed,
  requiredTools: input.requiredTools ?? [],
};

// RecallState — reads/writes scratchpadStoreRef directly
const recallState: RecallState = {
  store: scratchpadStoreRef,  // module-level Ref<Map<string, string>> from scratchpad.ts
  config: recallConfig,
};
```

**Entropy access pattern:** All entropy reads use `(state.meta as any).entropy` — this is the existing pattern already used in `react-kernel.ts`. `KernelState.meta` is typed as `Readonly<Record<string, unknown>>` and the entropy data is stored there under the `"entropy"` key by the reactive intelligence layer. No new typed field is added to `KernelState.meta` in this spec.

### Scratchpad store clarification

The live store is `scratchpadStoreRef: Ref<Map<string, string>>` (exported from `builtin.ts`, injected into scratchpad handlers). `KernelState.scratchpad` is a per-iteration snapshot synced after each tool execution by the kernel runner — used for context compaction and observability, not for live reads. `recall`, `scratchpad-write`, and `scratchpad-read` all read/write `scratchpadStoreRef` directly. The sync into `KernelState.scratchpad` is unchanged.

---

## 8. Tool Registration

Meta-tools are exported from `packages/tools/src/skills/builtin.ts` in the `metaToolDefinitions` array alongside existing meta-tool definitions. They are NOT in the `builtinTools` auto-registration array (which is for state-free tools). Registration happens in the react-kernel when enabled:

```typescript
// packages/tools/src/skills/builtin.ts
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  taskCompleteTool,
  finalAnswerTool,
  briefTool,      // NEW
  findTool,       // NEW
  pulseTool,      // NEW
  recallTool,     // NEW
];

// react-kernel.ts — conditional registration block
if (metaToolsConfig.brief) {
  yield* toolService.register(briefTool, makeBriefHandler(briefState));
}
if (metaToolsConfig.find) {
  yield* toolService.register(findTool, makeFindHandler(findState));
}
if (metaToolsConfig.pulse) {
  yield* toolService.register(pulseTool, makePulseHandler(pulseState));
}
if (metaToolsConfig.recall) {
  yield* toolService.register(recallTool, makeRecallHandler(recallState));
  // Update scratchpad-write/read descriptions to indicate they are aliases
}
```

---

## 9. Affected Files

| File | Change |
|------|--------|
| `packages/tools/src/skills/brief.ts` | New — tool definition + `BriefState` + `makeBriefHandler` |
| `packages/tools/src/skills/find.ts` | New — tool definition + `FindState` + `makeFindHandler` |
| `packages/tools/src/skills/pulse.ts` | New — tool definition + `PulseState` + `makePulseHandler` |
| `packages/tools/src/skills/recall.ts` | New — tool definition + `RecallState` + `makeRecallHandler` |
| `packages/tools/src/skills/scratchpad.ts` | Updated — `scratchpad-write/read` delegate to `recall` internally |
| `packages/tools/src/skills/builtin.ts` | Add `brief/find/pulse/recallTool` to `metaToolDefinitions` export |
| `packages/tools/src/index.ts` | Export new types and factories |
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `controllerDecisionLog: readonly string[]` to `KernelState`; `state.meta.controllerDecisions` is kept unchanged |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Wire `BriefState`, `PulseState`, `RecallState`, `FindState`; register tools; append to `controllerDecisionLog` after each controller evaluation |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Append formatted decision strings to `controllerDecisionLog` after `ReactiveControllerService` evaluation |
| `packages/runtime/src/builder.ts` | Add `.withMetaTools(config)` builder method |
| `packages/runtime/src/types.ts` | Add `MetaToolsConfig`, `HarnessSkillConfig`, `FindConfig`, `PulseConfig`, `RecallConfig` |
| `packages/runtime/assets/harness.skill.md` | New — frontier tier harness skill (seed version) |
| `packages/runtime/assets/harness.skill.condensed.md` | New — local/small model tier harness skill (seed version) |
| `packages/runtime/src/harness-resolver.ts` | New — resolves `HarnessSkillConfig` to final skill content: reads file/inline/tier, falls back to seed asset |
| `packages/tools/tests/brief.test.ts` | New unit tests (flat, consistent with existing test layout) |
| `packages/tools/tests/find.test.ts` | New unit tests |
| `packages/tools/tests/pulse.test.ts` | New unit tests |
| `packages/tools/tests/recall.test.ts` | New unit tests |

---

## 10. Testing Strategy

**Unit tests** (per tool, using mock state objects):
- `brief` — compact format, drill sections, entropy-unavailable fallback, lazy skill resolution, signal line omitted when RI off
- `find` — routing: RAG hit → stops; RAG miss → memory; memory miss → web; all miss → empty; `scope` overrides; `minRagScore` threshold; auto-store above threshold; deduplication in `all` scope
- `pulse` — entropy-unavailable defaults, `readyToAnswer` mirrors both `detectCompletionGaps` + `shouldShowFinalAnswer`, deterministic rules fire in correct priority order, LLM failure falls back to rules silently
- `recall` — write/read/list/search modes, preview truncation, `autoFullThreshold`, backward compat: `_tool_result_N` keys readable via `recall`, `scratchpad-read` returns same result as `recall(key, full: true)`

**Integration tests** (using `withTestScenario`):
- Agent calls `brief()` → `find()` → `recall(key, content)` → `pulse("am I ready?")` → `final-answer`
- `find` falls back from RAG → web when zero documents indexed
- `pulse` correctly detects loop: same tool + args called 3 times
- `pulse.readyToAnswer` false when required tool not yet called; true after calling it
- `scratchpad-write` + `scratchpad-read` + `recall(key)` all operate on same store

---

## 11. Non-Goals

- **Real-time sub-agent monitoring** — `pulse` surfaces only the current agent's signals; parent/child coordination is post-V1.0
- **Cross-session recall persistence** — `recall` is in-session only; cross-session learning goes through the memory system
- **`find` replacing rag-search/web-search** — existing tools stay; `find` is additive
- **Automatic orientation phase** — the harness skill teaches the pattern; no forced pre-execution orientation hook is added to the kernel
- **`brief` reading live LLM state** — no LLM calls inside `brief`; all data is pre-computed or lazily resolved from services
- **Embedding-based search in recall** — keyword scoring only; no vector index for the in-session store
