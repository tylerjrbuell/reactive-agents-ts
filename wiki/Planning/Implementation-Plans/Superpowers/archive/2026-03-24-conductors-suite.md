# Conductor's Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four meta-tools (`brief`, `find`, `pulse`, `recall`) + a harness skill that give agents a closed cognitive loop for orientation, search, introspection, and working memory.

**Architecture:** All four tools (`recall`, `find`, `brief`, `pulse`) are registered conditionally in `react-kernel.ts` when `metaTools` config enables them — NOT via `builtinTools` (which is unconditional). `brief` and `pulse` schemas are also dynamically injected into `augmentedToolSchemas` (same pattern as `final-answer`), and their tool calls are handled inline in the react-kernel acting phase — bypassing `ToolService.execute()` to avoid async Effect overhead for these lightweight introspection tools. This is an intentional departure from the spec's factory-handler pattern: the spec's `makeBriefHandler`/`makePulseHandler` are not implemented; instead `buildBriefResponse`/`buildPulseResponse` are pure functions called inline. The spec will be updated to reflect this. A new `controllerDecisionLog` field on `KernelState` accumulates controller decisions across iterations for `pulse`. The builder gets `.withMetaTools()` which resolves the harness skill and threads static context through `ReActKernelInput` → `StrategyFn` → `react-kernel`. `metaTools` must be added to `StrategyFn`'s input type and threaded through execution-engine.ts.

**Tech Stack:** Effect-TS (`Ref`, `Effect.gen`), bun:test, `@reactive-agents/tools`, `@reactive-agents/reasoning`, `@reactive-agents/runtime`

**Spec:** `docs/superpowers/specs/2026-03-24-conductors-suite-design.md`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `packages/tools/src/skills/recall.ts` | RecallTool definition + `makeRecallHandler` (stateless, wraps scratchpadStoreRef) |
| `packages/tools/src/skills/find.ts` | FindTool definition + `makeFindHandler` (stateless, uses ragMemoryStore + webSearchHandler) |
| `packages/tools/src/skills/brief.ts` | briefTool definition + `buildBriefResponse` helper (called inline from react-kernel) |
| `packages/tools/src/skills/pulse.ts` | pulseTool definition + `buildPulseResponse` helper (called inline from react-kernel) |
| `packages/runtime/src/harness-resolver.ts` | `resolveHarnessSkill()` — resolves HarnessSkillConfig to skill text |
| `packages/runtime/assets/harness.skill.md` | Frontier-tier harness skill content |
| `packages/runtime/assets/harness.skill.condensed.md` | Local-tier harness skill content |
| `packages/tools/tests/recall.test.ts` | Unit tests for recall tool |
| `packages/tools/tests/find.test.ts` | Unit tests for find tool |
| `packages/tools/tests/brief.test.ts` | Unit tests for buildBriefResponse |
| `packages/tools/tests/pulse.test.ts` | Unit tests for buildPulseResponse |
| `packages/runtime/tests/meta-tools-integration.test.ts` | End-to-end integration tests |

### Modified Files
| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `controllerDecisionLog: readonly string[]` to `KernelState` + `initialKernelState` |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Append decisions to `controllerDecisionLog` after controller evaluation |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | Add `metaTools?` to `ReActKernelInput`; inject brief/pulse schemas; inline-handle all four tool calls; register recall+find via ToolService when enabled; inject harness into system prompt |
| `packages/reasoning/src/services/strategy-registry.ts` | Add `metaTools?` to `StrategyFn` input type |
| `packages/runtime/src/execution-engine.ts` | Pass `metaTools` through `strategy.execute()` call |
| `packages/tools/src/skills/builtin.ts` | Add brief/pulse/recall/find to `metaToolDefinitions` only (NOT `builtinTools`) |
| `packages/tools/src/skills/scratchpad.ts` | Update descriptions to note they are aliases for `recall` |
| `packages/tools/src/index.ts` | Export recall, find, brief, pulse tools + types |
| `packages/runtime/src/builder.ts` | Add `.withMetaTools(config?)` method; compute `staticBriefInfo`; resolve harness; thread into kernel input |
| `packages/runtime/src/types.ts` | Add `MetaToolsConfig`, `HarnessSkillConfig`, `FindConfig`, `PulseConfig`, `RecallConfig`, `StaticBriefInfo` |

---

## Task 1: `controllerDecisionLog` on KernelState

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts`
- Test: `packages/reasoning/tests/strategies/shared/react-kernel.test.ts` (add to existing)

- [ ] **Step 1: Write the failing test**

Add to `packages/reasoning/tests/strategies/shared/react-kernel.test.ts`:

```typescript
it("controllerDecisionLog starts empty and is a KernelState field", () => {
  const state = initialKernelState({ taskId: "t1", strategy: "reactive" });
  expect(state.controllerDecisionLog).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts --test-name-pattern "controllerDecisionLog"
```

Expected: FAIL — `controllerDecisionLog` not defined on state

- [ ] **Step 3: Add field to KernelState**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, find the `KernelState` interface and add after the `meta` field:

```typescript
/** Accumulated controller decisions this run, formatted as "decision: reason" strings. */
readonly controllerDecisionLog: readonly string[];
```

In `initialKernelState` factory function (around line 193), add to the returned object:

```typescript
controllerDecisionLog: [],
```

In `serializeKernelState` (if it serializes all fields, add): `controllerDecisionLog: state.controllerDecisionLog`
In `deserializeKernelState`: `controllerDecisionLog: (raw.controllerDecisionLog as string[]) ?? []`

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts --test-name-pattern "controllerDecisionLog"
```

Expected: PASS

- [ ] **Step 5: Write the failing test for accumulation in kernel-runner**

Add to the same test file:

```typescript
it("controllerDecisionLog accumulates across transitionState calls", () => {
  // Simulate what kernel-runner does: append decision strings to the log
  let state = initialKernelState({ taskId: "t1", strategy: "reactive" });
  state = transitionState(state, {
    controllerDecisionLog: [...state.controllerDecisionLog, "early-stop: entropy converged"],
  });
  state = transitionState(state, {
    controllerDecisionLog: [...state.controllerDecisionLog, "compress: context at 0.92"],
  });
  expect(state.controllerDecisionLog).toHaveLength(2);
  expect(state.controllerDecisionLog[0]).toBe("early-stop: entropy converged");
  expect(state.controllerDecisionLog[1]).toBe("compress: context at 0.92");
});
```

- [ ] **Step 6: Run to verify it passes immediately** (this tests `transitionState`, which already works)

```bash
bun test packages/reasoning/tests/strategies/shared/react-kernel.test.ts --test-name-pattern "accumulates"
```

Expected: PASS (no code change needed — `transitionState` merges all fields)

- [ ] **Step 7: Wire accumulation into kernel-runner**

In `packages/reasoning/src/strategies/shared/kernel-runner.ts`, find the block that stores controller decisions (around line 237-242):

```typescript
// EXISTING (keep):
if (decisions.length > 0) {
  state = transitionState(state, {
    meta: { ...state.meta, controllerDecisions: decisions },
  });
}
```

Add AFTER the existing block:

```typescript
// NEW: accumulate into controllerDecisionLog for pulse tool access
if (decisions.length > 0) {
  const formatted = decisions.map(
    (d: { decision: string; reason: string }) => `${d.decision}: ${d.reason}`,
  );
  state = transitionState(state, {
    controllerDecisionLog: [...state.controllerDecisionLog, ...formatted],
  });
}
```

- [ ] **Step 8: Run full reasoning test suite**

```bash
bun test packages/reasoning/ 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-state.ts \
        packages/reasoning/src/strategies/shared/kernel-runner.ts \
        packages/reasoning/tests/strategies/shared/react-kernel.test.ts
git commit -m "feat(kernel): add controllerDecisionLog to KernelState for pulse tool"
```

---

## Task 2: `recall` Tool

**Files:**
- Create: `packages/tools/src/skills/recall.ts`
- Create: `packages/tools/tests/recall.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/tools/tests/recall.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Ref } from "effect";
import { makeRecallHandler, recallTool } from "../src/skills/recall.js";

let storeRef: Ref.Ref<Map<string, string>>;
let handler: ReturnType<typeof makeRecallHandler>;

beforeEach(() => Effect.runSync(Effect.gen(function* () {
  storeRef = yield* Ref.make(new Map<string, string>());
  handler = makeRecallHandler(storeRef, {});
})));

describe("recall tool definition", () => {
  it("has name 'recall'", () => expect(recallTool.name).toBe("recall"));
  it("has all four parameters", () => {
    const names = recallTool.parameters.map(p => p.name);
    expect(names).toContain("key");
    expect(names).toContain("content");
    expect(names).toContain("query");
    expect(names).toContain("full");
  });
});

describe("recall write mode", () => {
  it("stores content and returns preview", async () => {
    const result = await Effect.runPromise(handler({ key: "plan", content: "Step 1\nStep 2" })) as any;
    expect(result.saved).toBe(true);
    expect(result.key).toBe("plan");
    expect(result.bytes).toBe(13);
    expect(result.preview).toContain("Step 1");
  });

  it("stores large content in full without truncation", async () => {
    const big = "x".repeat(2000);
    await Effect.runPromise(handler({ key: "big", content: big }));
    const store = await Effect.runPromise(Ref.get(storeRef));
    expect(store.get("big")).toBe(big);
  });
});

describe("recall read mode", () => {
  it("returns preview by default for large entries", async () => {
    const big = "a".repeat(500);
    await Effect.runPromise(handler({ key: "data", content: big }));
    const result = await Effect.runPromise(handler({ key: "data" })) as any;
    expect(result.truncated).toBe(true);
    expect(result.preview.length).toBeLessThanOrEqual(210); // 200 + buffer
  });

  it("returns full content when full: true", async () => {
    const big = "a".repeat(500);
    await Effect.runPromise(handler({ key: "data", content: big }));
    const result = await Effect.runPromise(handler({ key: "data", full: true })) as any;
    expect(result.truncated).toBe(false);
    expect(result.content.length).toBe(500);
  });

  it("always returns full for entries below autoFullThreshold", async () => {
    await Effect.runPromise(handler({ key: "small", content: "tiny" }));
    const result = await Effect.runPromise(handler({ key: "small" })) as any;
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("tiny");
  });

  it("returns found: false for missing key", async () => {
    const result = await Effect.runPromise(handler({ key: "missing" })) as any;
    expect(result.found).toBe(false);
  });
});

describe("recall list mode", () => {
  it("returns all entries with metadata", async () => {
    await Effect.runPromise(handler({ key: "a", content: "hello" }));
    await Effect.runPromise(handler({ key: "_tool_result_1", content: "auto result" }));
    const result = await Effect.runPromise(handler({})) as any;
    expect(result.totalEntries).toBe(2);
    const aEntry = result.entries.find((e: any) => e.key === "a");
    expect(aEntry?.type).toBe("agent");
    const autoEntry = result.entries.find((e: any) => e.key === "_tool_result_1");
    expect(autoEntry?.type).toBe("auto");
  });
});

describe("recall search mode", () => {
  it("finds entries by keyword", async () => {
    await Effect.runPromise(handler({ key: "react", content: "TypeScript React components" }));
    await Effect.runPromise(handler({ key: "python", content: "Python data science numpy" }));
    const result = await Effect.runPromise(handler({ query: "TypeScript React" })) as any;
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].key).toBe("react");
  });

  it("returns zero matches for unrelated query", async () => {
    await Effect.runPromise(handler({ key: "data", content: "apples oranges" }));
    const result = await Effect.runPromise(handler({ query: "quantum neutron" })) as any;
    expect(result.totalMatches).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test packages/tools/tests/recall.test.ts 2>&1 | tail -10
```

Expected: FAIL — `recall.js` not found

- [ ] **Step 3: Implement recall.ts**

Create `packages/tools/src/skills/recall.ts`:

```typescript
import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export interface RecallConfig {
  previewLength?: number;
  autoFullThreshold?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
}

export const recallTool: ToolDefinition = {
  name: "recall",
  description:
    "Selective working memory. Write: recall(key, content). Read: recall(key). " +
    "Search: recall(query=...). List: recall() with no args. " +
    "Large reads return a preview by default — use full: true for complete content. " +
    "Aliases: scratchpad-write and scratchpad-read delegate to this tool.",
  parameters: [
    {
      name: "key",
      type: "string",
      description: "Storage key for write or read.",
      required: false,
    },
    {
      name: "content",
      type: "string",
      description: "Content to store. Presence of both key+content triggers write mode.",
      required: false,
    },
    {
      name: "query",
      type: "string",
      description: "Keyword search across all stored entries. Triggers search mode.",
      required: false,
    },
    {
      name: "full",
      type: "boolean",
      description: "Return full content on read (default: compact preview).",
      required: false,
      default: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "builtin",
  category: "memory",
};

export const makeRecallHandler =
  (storeRef: Ref.Ref<Map<string, string>>, config?: RecallConfig) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const previewLength = config?.previewLength ?? 200;
      const autoFullThreshold = config?.autoFullThreshold ?? 300;

      const key = args.key as string | undefined;
      const content = args.content as string | undefined;
      const query = args.query as string | undefined;
      const full = args.full as boolean | undefined;

      // ── Write mode ───────────────────────────────────────────────────────
      if (key !== undefined && content !== undefined) {
        yield* Ref.update(storeRef, (m) => {
          const next = new Map(m);
          next.set(key, content);
          return next;
        });
        return {
          saved: true,
          key,
          bytes: content.length,
          preview: content.slice(0, previewLength),
        };
      }

      const store = yield* Ref.get(storeRef);

      // ── Search mode ──────────────────────────────────────────────────────
      if (query !== undefined) {
        const terms = query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2);
        if (terms.length === 0) return { query, matches: [], totalMatches: 0 };

        const matches = [...store.entries()]
          .map(([k, v]) => {
            const lower = v.toLowerCase();
            let score = 0;
            for (const term of terms) {
              let idx = 0;
              while ((idx = lower.indexOf(term, idx)) !== -1) {
                score++;
                idx += term.length;
              }
            }
            const norm = v.length > 0 ? score / Math.sqrt(v.length) : 0;
            return { key: k, excerpt: v.slice(0, previewLength), score: norm };
          })
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score);

        return { query, matches, totalMatches: matches.length };
      }

      // ── Read mode ────────────────────────────────────────────────────────
      if (key !== undefined) {
        const value = store.get(key);
        if (value === undefined) return { found: false, key };

        const returnFull = full || value.length <= autoFullThreshold;
        if (returnFull) {
          return { key, content: value, bytes: value.length, truncated: false };
        }
        return {
          key,
          preview: value.slice(0, previewLength),
          bytes: value.length,
          truncated: true,
        };
      }

      // ── List mode (no args) ──────────────────────────────────────────────
      const entries = [...store.entries()].map(([k, v]) => ({
        key: k,
        bytes: v.length,
        preview: v.slice(0, 100),
        type: k.startsWith("_") ? "auto" : "agent",
      }));
      return {
        entries,
        totalEntries: entries.length,
        totalBytes: entries.reduce((s, e) => s + e.bytes, 0),
      };
    });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/tools/tests/recall.test.ts 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/recall.ts packages/tools/tests/recall.test.ts
git commit -m "feat(tools): add recall meta-tool with write/read/search/list modes"
```

---

## Task 3: `find` Tool

**Files:**
- Create: `packages/tools/src/skills/find.ts`
- Create: `packages/tools/tests/find.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/tools/tests/find.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Ref } from "effect";
import { makeFindHandler, findTool } from "../src/skills/find.js";
import type { FindConfig } from "../src/skills/find.js";
import type { RagMemoryStore } from "../src/skills/rag-ingest.js";
import { makeRagIngestHandler, makeInMemoryStoreCallback } from "../src/skills/rag-ingest.js";
import { ToolExecutionError } from "../src/errors.js";

async function buildHandler(opts: {
  ragStore?: RagMemoryStore;
  webHandler?: (a: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
  config?: FindConfig;
}) {
  const recallRef = await Effect.runPromise(Ref.make(new Map<string, string>()));
  return makeFindHandler({
    ragStore: opts.ragStore ?? new Map(),
    webSearchHandler: opts.webHandler,
    recallStoreRef: recallRef,
    config: opts.config ?? {},
  });
}

describe("find tool definition", () => {
  it("has name 'find'", () => expect(findTool.name).toBe("find"));
  it("has query and scope parameters", () => {
    const names = findTool.parameters.map(p => p.name);
    expect(names).toContain("query");
    expect(names).toContain("scope");
  });
});

describe("find scope: documents", () => {
  it("returns results from RAG store when docs are indexed", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "TypeScript is a typed superset of JavaScript.", source: "ts.txt" }));

    const handler = await buildHandler({ ragStore });
    const result = await Effect.runPromise(handler({ query: "TypeScript", scope: "documents" })) as any;
    expect(result.totalResults).toBeGreaterThanOrEqual(1);
    expect(result.results[0].source).toBe("documents");
    expect(result.sourcesSearched).toContain("documents");
  });

  it("returns empty when no docs match", async () => {
    const handler = await buildHandler({ ragStore: new Map() });
    const result = await Effect.runPromise(handler({ query: "quantum", scope: "documents" })) as any;
    expect(result.totalResults).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("find scope: auto fallback", () => {
  it("falls back to web when RAG returns no results", async () => {
    const mockWeb = (_args: Record<string, unknown>) =>
      Effect.succeed({ results: [{ title: "Web result", url: "https://example.com", snippet: "web content" }] });

    const handler = await buildHandler({ webHandler: mockWeb as any, config: { webFallback: true } });
    const result = await Effect.runPromise(handler({ query: "obscure topic" })) as any;
    expect(result.sourcesSearched).toContain("web");
    expect(result.totalResults).toBeGreaterThanOrEqual(1);
    expect(result.results[0].source).toBe("web");
  });

  it("returns empty array when all sources return nothing", async () => {
    const handler = await buildHandler({ config: { webFallback: false } });
    const result = await Effect.runPromise(handler({ query: "nothing" })) as any;
    expect(result.totalResults).toBe(0);
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("stops at documents when RAG score exceeds minRagScore", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "React React React is great", source: "react.md" }));

    let webCalled = false;
    const mockWeb = () => { webCalled = true; return Effect.succeed({ results: [] }); };

    const handler = await buildHandler({ ragStore, webHandler: mockWeb as any, config: { minRagScore: 0.01 } });
    await Effect.runPromise(handler({ query: "React" }));
    expect(webCalled).toBe(false);
  });
});

describe("find scope: web", () => {
  it("calls web handler directly without checking RAG", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "React components", source: "react.txt" }));

    let webCalled = false;
    const mockWeb = () => {
      webCalled = true;
      return Effect.succeed({ results: [{ title: "Web", url: "https://x.com", snippet: "web" }] });
    };

    const handler = await buildHandler({ ragStore, webHandler: mockWeb as any });
    await Effect.runPromise(handler({ query: "React", scope: "web" }));
    expect(webCalled).toBe(true);
  });
});

describe("find auto-store", () => {
  it("stores results in recall when content exceeds threshold", async () => {
    const recallRef = await Effect.runPromise(Ref.make(new Map<string, string>()));
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    // Ingest a large document to produce large results
    const bigContent = Array(20).fill("TypeScript JavaScript important feature").join(". ");
    await Effect.runPromise(ingest({ content: bigContent, source: "big.txt" }));

    const handler = makeFindHandler({ ragStore, recallStoreRef: recallRef, config: { autoStoreThreshold: 50 } });
    const result = await Effect.runPromise(handler({ query: "TypeScript" })) as any;

    if (result.storedAs) {
      const store = await Effect.runPromise(Ref.get(recallRef));
      expect(store.has(result.storedAs)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test packages/tools/tests/find.test.ts 2>&1 | tail -5
```

Expected: FAIL — `find.js` not found

- [ ] **Step 3: Implement find.ts**

Create `packages/tools/src/skills/find.ts`:

```typescript
import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import type { RagMemoryStore } from "./rag-ingest.js";
import { makeInMemorySearchCallback } from "./rag-search.js";

export interface FindConfig {
  autoStoreThreshold?: number;
  minRagScore?: number;
  webFallback?: boolean;
  preferredScope?: "documents" | "web";
}

export interface FindState {
  ragStore: RagMemoryStore;
  webSearchHandler?: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
  bootstrapMemoryContent?: string;  // semantic memory lines from bootstrap (for scope: "memory")
  recallStoreRef: Ref.Ref<Map<string, string>>;
  config: FindConfig;
}

export const findTool: ToolDefinition = {
  name: "find",
  description:
    "Unified intelligent search. Finds information from any available source. " +
    "scope defaults to 'auto': tries indexed documents first, falls back to web if no results. " +
    "scope options: 'auto' | 'documents' | 'web' | 'memory' | 'all'. " +
    "'memory' searches the bootstrapped semantic memory lines (already in your context). " +
    "Use this instead of choosing between rag-search and web-search.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "What you are looking for.",
      required: true,
    },
    {
      name: "scope",
      type: "string",
      description: "Where to search: 'auto' (default), 'documents', 'web', 'all'.",
      required: false,
      default: "auto",
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
  category: "search",
};

export const makeFindHandler =
  (state: FindState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const query = args.query as string | undefined;
      if (!query || typeof query !== "string") {
        return yield* Effect.fail(
          new ToolExecutionError({ message: 'find requires a "query" parameter', toolName: "find" }),
        );
      }

      const scope = (args.scope as string | undefined) ?? "auto";
      const minRagScore = state.config.minRagScore ?? 0.1;
      const autoStoreThreshold = state.config.autoStoreThreshold ?? 800;
      const webFallback = state.config.webFallback ?? true;

      const sourcesSearched: string[] = [];
      const allResults: Array<{
        content: string;
        source: "documents" | "web";
        identifier: string;
        score: number;
        chunkIndex?: number;
      }> = [];

      // ── Documents (RAG) search ─────────────────────────────────────────
      const shouldSearchDocs = scope === "auto" || scope === "documents" || scope === "all";
      if (shouldSearchDocs && state.ragStore.size > 0) {
        sourcesSearched.push("documents");
        const searchCallback = makeInMemorySearchCallback(state.ragStore);
        const ragResults = yield* searchCallback(query, 5, undefined).pipe(
          Effect.catchAll(() => Effect.succeed([])),
        );
        const hits = ragResults.filter((r) => r.score >= minRagScore);
        for (const r of hits) {
          allResults.push({
            content: r.content,
            source: "documents",
            identifier: r.source,
            score: r.score,
            chunkIndex: r.chunkIndex,
          });
        }
        // Short-circuit for auto if we got RAG hits
        if (scope === "auto" && hits.length > 0) {
          return buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
        }
      }

      // ── Memory search (bootstrapped semantic context) ────────────────
      const shouldSearchMemory = scope === "memory" || scope === "all";
      if (shouldSearchMemory && state.bootstrapMemoryContent) {
        sourcesSearched.push("memory");
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const lines = state.bootstrapMemoryContent.split("\n").filter(l => l.trim().length > 0);
        const memMatches = lines.filter(line =>
          terms.some(term => line.toLowerCase().includes(term))
        ).slice(0, 5);
        for (const line of memMatches) {
          allResults.push({ content: line, source: "memory", identifier: "memory-bootstrap", score: 0.4 });
        }
        if (scope === "memory") {
          return yield* buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
        }
      }

      // ── Web search ────────────────────────────────────────────────────
      const shouldSearchWeb =
        scope === "web" ||
        scope === "all" ||
        (scope === "auto" && webFallback && allResults.length === 0);

      if (shouldSearchWeb && state.webSearchHandler) {
        sourcesSearched.push("web");
        const webResult = yield* state.webSearchHandler({ query }).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (webResult && typeof webResult === "object") {
          const results = (webResult as any).results ?? [];
          for (const r of results) {
            allResults.push({
              content: r.snippet ?? r.content ?? "",
              source: "web",
              identifier: r.url ?? r.link ?? "",
              score: 0.5,
            });
          }
        }
      }

      return yield* buildFindResponse(query, allResults, sourcesSearched, autoStoreThreshold, state.recallStoreRef);
    });

function buildFindResponse(
  query: string,
  results: Array<{ content: string; source: string; identifier: string; score: number; chunkIndex?: number }>,
  sourcesSearched: string[],
  autoStoreThreshold: number,
  recallStoreRef: Ref.Ref<Map<string, string>>,
): Effect.Effect<unknown, never> {
  return Effect.gen(function* () {
    const totalContent = results.map((r) => r.content).join(" ");
    let storedAs: string | undefined;

    if (totalContent.length > autoStoreThreshold && results.length > 0) {
      const key = `_find_${Date.now()}`;
      yield* Ref.update(recallStoreRef, (m) => {
        const next = new Map(m);
        next.set(key, JSON.stringify({ query, results }));
        return next;
      });
      storedAs = key;
      // Return top-3 previews inline
      const preview = results.slice(0, 3).map((r) => ({
        ...r,
        content: r.content.slice(0, 200),
      }));
      return { query, results: preview, totalResults: results.length, sourcesSearched, storedAs };
    }

    return { query, results, totalResults: results.length, sourcesSearched, storedAs };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/tools/tests/find.test.ts 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/find.ts packages/tools/tests/find.test.ts
git commit -m "feat(tools): add find meta-tool with unified auto-routing search"
```

---

## Task 4: `brief` Tool

**Files:**
- Create: `packages/tools/src/skills/brief.ts`
- Create: `packages/tools/tests/brief.test.ts`

`brief` has no factory handler — instead it exports a `buildBriefResponse` helper that `react-kernel.ts` calls inline.

- [ ] **Step 1: Write failing tests**

Create `packages/tools/tests/brief.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { buildBriefResponse, briefTool, computeEntropyGrade } from "../src/skills/brief.js";
import type { BriefInput } from "../src/skills/brief.js";

const baseInput: BriefInput = {
  section: undefined,
  availableTools: [
    { name: "web-search", description: "Search the web", parameters: [] },
    { name: "rag-search", description: "Search docs", parameters: [] },
  ],
  indexedDocuments: [
    { source: "./.agents/MEMORY.md", chunkCount: 12, format: "markdown" },
  ],
  availableSkills: [{ name: "build-package", purpose: "Scaffold a new package" }],
  memoryBootstrap: { semanticLines: 16, episodicEntries: 2 },
  recallKeys: ["findings", "_tool_result_1"],
  tokens: 1200,
  tokenBudget: 8000,
  entropy: undefined,
  controllerDecisionLog: [],
};

describe("briefTool definition", () => {
  it("has name 'brief'", () => expect(briefTool.name).toBe("brief"));
  it("has section parameter", () => {
    const names = briefTool.parameters.map(p => p.name);
    expect(names).toContain("section");
  });
});

describe("computeEntropyGrade", () => {
  it("returns A for low entropy", () => expect(computeEntropyGrade(0.2)).toBe("A"));
  it("returns B for 0.40", () => expect(computeEntropyGrade(0.40)).toBe("B"));
  it("returns C for 0.55", () => expect(computeEntropyGrade(0.55)).toBe("C"));
  it("returns D for 0.70", () => expect(computeEntropyGrade(0.70)).toBe("D"));
  it("returns F for 0.80", () => expect(computeEntropyGrade(0.80)).toBe("F"));
  it("returns unknown for undefined", () => expect(computeEntropyGrade(undefined)).toBe("unknown"));
});

describe("buildBriefResponse — compact (no section)", () => {
  it("includes tool count", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("2");
    expect(result).toContain("tools");
  });

  it("includes document source", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("MEMORY.md");
  });

  it("includes skill name", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("build-package");
  });

  it("includes memory stats", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("16");
    expect(result).toContain("semantic");
  });

  it("includes recall keys", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("findings");
  });

  it("omits signal line when entropy is undefined", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).not.toContain("Grade");
  });

  it("includes signal line when entropy is present", () => {
    const input: BriefInput = {
      ...baseInput,
      entropy: { composite: 0.65, shape: "flat", momentum: 0 },
    };
    const result = buildBriefResponse(input);
    expect(result).toContain("Grade C");
  });
});

describe("buildBriefResponse — signal section", () => {
  it("returns not-available when entropy is absent", () => {
    const result = buildBriefResponse({ ...baseInput, section: "signal" });
    expect(result).toContain("not available");
  });

  it("returns entropy details when present", () => {
    const input: BriefInput = {
      ...baseInput,
      section: "signal",
      entropy: { composite: 0.72, shape: "oscillating", momentum: 0.05 },
      controllerDecisionLog: ["compress: context at 0.91"],
    };
    const result = buildBriefResponse(input);
    expect(result).toContain("oscillating");
    expect(result).toContain("compress");
  });
});

describe("buildBriefResponse — documents section", () => {
  it("lists documents with chunk counts", () => {
    const result = buildBriefResponse({ ...baseInput, section: "documents" });
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("12");
    expect(result).toContain("markdown");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test packages/tools/tests/brief.test.ts 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: Implement brief.ts**

Create `packages/tools/src/skills/brief.ts`:

```typescript
import type { ToolDefinition } from "../types.js";

export interface BriefInput {
  section: string | undefined;
  availableTools: readonly { name: string; description: string; parameters: readonly unknown[] }[];
  indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
  availableSkills: readonly { name: string; purpose: string }[];
  memoryBootstrap: { semanticLines: number; episodicEntries: number };
  recallKeys: readonly string[];
  tokens: number;
  tokenBudget: number;
  entropy: { composite: number; shape: string; momentum: number } | undefined;
  controllerDecisionLog: readonly string[];
}

export const briefTool: ToolDefinition = {
  name: "brief",
  description:
    "Full situational briefing. Zero args for compact overview. " +
    "Drill with section: 'tools', 'documents', 'skills', 'memory', 'recall', 'signal', 'all'. " +
    "Call this at the start of complex tasks to understand your full environment.",
  parameters: [
    {
      name: "section",
      type: "string",
      description:
        "Drill into a section: tools | documents | skills | memory | recall | signal | all. Omit for compact overview.",
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  category: "meta",
};

export function computeEntropyGrade(composite: number | undefined): string {
  if (composite === undefined) return "unknown";
  if (composite <= 0.3) return "A";
  if (composite <= 0.45) return "B";
  if (composite <= 0.6) return "C";
  if (composite <= 0.75) return "D";
  return "F";
}

/** Called inline from react-kernel.ts when the agent calls the "brief" tool. */
export function buildBriefResponse(input: BriefInput): string {
  const { section } = input;

  if (section === "documents") return formatDocuments(input);
  if (section === "skills") return formatSkills(input);
  if (section === "tools") return formatTools(input);
  if (section === "memory") return formatMemory(input);
  if (section === "recall") return formatRecall(input);
  if (section === "signal") return formatSignal(input);
  if (section === "all") {
    return [
      formatTools(input),
      formatDocuments(input),
      formatSkills(input),
      formatMemory(input),
      formatRecall(input),
      formatSignal(input),
    ].join("\n\n");
  }

  return formatCompact(input);
}

function formatCompact(input: BriefInput): string {
  const { availableTools, indexedDocuments, availableSkills, memoryBootstrap, recallKeys, tokens, tokenBudget, entropy } = input;
  const used = Math.round((tokens / tokenBudget) * 100);
  const bar = "█".repeat(Math.round(used / 10)) + "░".repeat(10 - Math.round(used / 10));
  const pressure = used >= 90 ? "critical" : used >= 75 ? "high" : used >= 50 ? "moderate" : "low";
  const remaining = tokenBudget - tokens;

  const lines: string[] = [
    `tools: ${availableTools.length} available [${[...new Set(availableTools.map(t => t.name.split("-")[0]))].join(", ")}]`,
    indexedDocuments.length > 0
      ? `documents: ${indexedDocuments.map(d => `${d.source.split("/").pop()} (${d.chunkCount} chunks)`).join(" · ")}`
      : "documents: none indexed",
    availableSkills.length > 0
      ? `skills: ${availableSkills.length} available [${availableSkills.map(s => s.name).join(", ")}]`
      : "skills: none loaded",
    `memory: ${memoryBootstrap.semanticLines} semantic · ${memoryBootstrap.episodicEntries} episodic`,
    recallKeys.length > 0
      ? `recall: ${recallKeys.length} keys [${recallKeys.slice(0, 5).join(", ")}]`
      : "recall: empty",
    `context: ${bar} ${used}% · ${pressure} pressure · ${remaining} tokens remaining`,
  ];

  if (entropy) {
    const grade = computeEntropyGrade(entropy.composite);
    const icon = grade === "A" || grade === "B" ? "✅" : grade === "C" ? "⚠" : "🔴";
    lines.push(`signal: ${icon} ${entropy.shape} trajectory · Grade ${grade} · entropy ${entropy.composite.toFixed(2)}`);
  }

  return lines.join("\n");
}

function formatTools(input: BriefInput): string {
  const lines = ["=== Tools ==="];
  for (const t of input.availableTools) {
    lines.push(`• ${t.name}: ${t.description.slice(0, 100)}`);
  }
  return lines.join("\n");
}

function formatDocuments(input: BriefInput): string {
  if (input.indexedDocuments.length === 0) return "=== Documents ===\nNo documents indexed.";
  const lines = ["=== Documents ==="];
  for (const d of input.indexedDocuments) {
    lines.push(`• ${d.source} — ${d.chunkCount} chunks (${d.format})`);
  }
  return lines.join("\n");
}

function formatSkills(input: BriefInput): string {
  if (input.availableSkills.length === 0) return "=== Skills ===\nNo skills loaded.";
  const lines = ["=== Skills ==="];
  for (const s of input.availableSkills) {
    lines.push(`• ${s.name}: ${s.purpose}`);
  }
  return lines.join("\n");
}

function formatMemory(input: BriefInput): string {
  const { memoryBootstrap } = input;
  return [
    "=== Memory ===",
    `Semantic: ${memoryBootstrap.semanticLines} lines bootstrapped`,
    `Episodic: ${memoryBootstrap.episodicEntries} recent entries`,
  ].join("\n");
}

function formatRecall(input: BriefInput): string {
  if (input.recallKeys.length === 0) return "=== Recall ===\nEmpty.";
  const lines = ["=== Recall ==="];
  for (const k of input.recallKeys) {
    lines.push(`• ${k} (${k.startsWith("_") ? "auto" : "agent"})`);
  }
  return lines.join("\n");
}

function formatSignal(input: BriefInput): string {
  if (!input.entropy) {
    return "=== Signal ===\nReactive intelligence not available — enable .withReactiveIntelligence().";
  }
  const { entropy, controllerDecisionLog } = input;
  const grade = computeEntropyGrade(entropy.composite);
  const lines = [
    "=== Signal ===",
    `Grade: ${grade}  Composite: ${entropy.composite.toFixed(3)}  Shape: ${entropy.shape}  Momentum: ${entropy.momentum.toFixed(3)}`,
  ];
  if (controllerDecisionLog.length > 0) {
    lines.push("Controller decisions this run:");
    for (const d of controllerDecisionLog) lines.push(`  • ${d}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/tools/tests/brief.test.ts 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/brief.ts packages/tools/tests/brief.test.ts
git commit -m "feat(tools): add brief meta-tool for agent situational awareness"
```

---

## Task 5: `pulse` Tool

**Files:**
- Create: `packages/tools/src/skills/pulse.ts`
- Create: `packages/tools/tests/pulse.test.ts`

`pulse` exports `buildPulseResponse` — a pure function called inline from react-kernel.ts.

- [ ] **Step 1: Write failing tests**

Create `packages/tools/tests/pulse.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { buildPulseResponse, pulseTool } from "../src/skills/pulse.js";
import type { PulseInput } from "../src/skills/pulse.js";

const baseSteps = [
  { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: { toolUsed: "rag-search" } },
  { type: "observation", content: "results: []", metadata: { observationResult: { success: true } } },
];

const baseInput: PulseInput = {
  question: undefined,
  entropy: undefined,
  controllerDecisionLog: [],
  steps: baseSteps as any,
  iteration: 2,
  maxIterations: 10,
  tokens: 800,
  tokenBudget: 8000,
  task: "Find information about TypeScript.",
  allToolSchemas: [{ name: "web-search", description: "Search web", parameters: [] }],
  toolsUsed: new Set(["rag-search"]),
  requiredTools: [],
};

describe("pulseTool definition", () => {
  it("has name 'pulse'", () => expect(pulseTool.name).toBe("pulse"));
  it("has question parameter", () => {
    const names = pulseTool.parameters.map(p => p.name);
    expect(names).toContain("question");
  });
});

describe("buildPulseResponse — entropy unavailable", () => {
  it("returns unknown grade and -1 composite when no entropy", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(result.signal.grade).toBe("unknown");
    expect(result.signal.composite).toBe(-1);
    expect(result.signal.shape).toBe("unknown");
  });

  it("still populates behavior and context sections", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(typeof result.behavior.toolSuccessRate).toBe("number");
    expect(typeof result.context.iterationsUsed).toBe("number");
    expect(result.context.iterationsUsed).toBe(2);
    expect(result.context.iterationsRemaining).toBe(8);
  });

  it("always has recommendation string", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(typeof result.recommendation).toBe("string");
    expect(result.recommendation.length).toBeGreaterThan(0);
  });
});

describe("buildPulseResponse — with entropy", () => {
  const withEntropy: PulseInput = {
    ...baseInput,
    entropy: { composite: 0.72, shape: "flat", momentum: 0.01, history: [0.70, 0.71, 0.72] },
  };

  it("returns correct grade D for 0.72", () => {
    const result = buildPulseResponse(withEntropy) as any;
    expect(result.signal.grade).toBe("D");
  });

  it("flat entropy triggers appropriate recommendation", () => {
    const stuckInput: PulseInput = {
      ...withEntropy,
      iteration: 5,
      entropy: { composite: 0.6, shape: "flat", momentum: 0, history: [0.6, 0.6, 0.6, 0.6] },
    };
    const result = buildPulseResponse(stuckInput) as any;
    expect(result.recommendation.toLowerCase()).toContain("pivot");
  });
});

describe("buildPulseResponse — loopScore", () => {
  it("detects loop when same tool+args called multiple times", () => {
    const loopSteps = [
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
    ];
    const result = buildPulseResponse({ ...baseInput, steps: loopSteps as any }) as any;
    expect(result.behavior.loopScore).toBeGreaterThan(0.5);
    expect(result.recommendation.toLowerCase()).toMatch(/repeat|approach|stuck/);
  });
});

describe("buildPulseResponse — readyToAnswer", () => {
  it("is false when no non-meta tool has been called", () => {
    const result = buildPulseResponse({ ...baseInput, toolsUsed: new Set(), iteration: 0 }) as any;
    expect(result.readyToAnswer).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("is true when conditions are met (no required tools, some tool called, iteration >= 1)", () => {
    const result = buildPulseResponse({
      ...baseInput,
      toolsUsed: new Set(["rag-search"]),
      iteration: 2,
      requiredTools: [],
    }) as any;
    expect(result.readyToAnswer).toBe(true);
  });

  it("is false when required tool not called", () => {
    const result = buildPulseResponse({
      ...baseInput,
      toolsUsed: new Set(["rag-search"]),
      requiredTools: ["web-search"],
      iteration: 2,
    }) as any;
    expect(result.readyToAnswer).toBe(false);
    expect(result.blockers.some((b: string) => b.includes("web-search"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test packages/tools/tests/pulse.test.ts 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: Implement pulse.ts**

Create `packages/tools/src/skills/pulse.ts`:

```typescript
import type { ToolDefinition } from "../types.js";

export interface PulseInput {
  question: string | undefined;
  entropy: { composite: number; shape: string; momentum: number; history?: readonly number[] } | undefined;
  controllerDecisionLog: readonly string[];
  steps: readonly { type: string; content: string; metadata?: Record<string, unknown> }[];
  iteration: number;
  maxIterations: number;
  tokens: number;
  tokenBudget: number;
  task: string;
  allToolSchemas: readonly { name: string; description: string; parameters: readonly unknown[] }[];
  toolsUsed: ReadonlySet<string>;
  requiredTools: readonly string[];
}

export const pulseTool: ToolDefinition = {
  name: "pulse",
  description:
    "Take the pulse of your current execution. Returns entropy signal, behavioral analysis, " +
    "context pressure, and an actionable recommendation. " +
    "Optional question: 'am I ready to answer?', 'should I change approach?', 'how much context do I have left?'. " +
    "Call when stuck, unsure, or before calling final-answer.",
  parameters: [
    {
      name: "question",
      type: "string",
      description:
        "Optional focus question: 'am I ready to answer?' | 'should I change approach?' | 'how much context do I have left?'",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  category: "meta",
};

const META_TOOLS = new Set([
  "final-answer", "task-complete", "context-status",
  "scratchpad-write", "scratchpad-read", "brief", "pulse", "find", "recall",
]);

/** Called inline from react-kernel.ts when the agent calls "pulse". */
export function buildPulseResponse(input: PulseInput): unknown {
  const signal = buildSignal(input.entropy);
  const behavior = buildBehavior(input.steps);
  const context = buildContext(input);
  const controller = { decisionsThisRun: [...input.controllerDecisionLog], pendingDecisions: [] };
  const { readyToAnswer, blockers } = checkReadiness(input);
  const recommendation = buildRecommendation(signal, behavior, context, blockers, input.iteration);

  return { signal, behavior, context, controller, recommendation, readyToAnswer, blockers };
}

function buildSignal(entropy: PulseInput["entropy"]) {
  if (!entropy) {
    return { grade: "unknown", composite: -1, shape: "unknown", momentum: 0, confidence: "low" };
  }
  const grade = computeGrade(entropy.composite);
  return { grade, composite: entropy.composite, shape: entropy.shape, momentum: entropy.momentum, confidence: "medium" };
}

function computeGrade(composite: number): string {
  if (composite <= 0.3) return "A";
  if (composite <= 0.45) return "B";
  if (composite <= 0.6) return "C";
  if (composite <= 0.75) return "D";
  return "F";
}

function buildBehavior(steps: PulseInput["steps"]) {
  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");

  // Loop score: repeated (tool+args) combos
  const actionCounts = new Map<string, number>();
  for (const a of actions) {
    try {
      const parsed = JSON.parse(a.content) as { tool?: string; input?: string };
      const key = `${parsed.tool}::${parsed.input ?? ""}`;
      actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
    } catch { /* ignore */ }
  }
  const repeatedActions = [...actionCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key.split("::")[0] ?? key);
  const loopScore = actions.length > 0
    ? repeatedActions.length / actions.length
    : 0;

  // Tool success rate
  const successCount = observations.filter(
    (o) => (o.metadata as any)?.observationResult?.success !== false,
  ).length;
  const toolSuccessRate = observations.length > 0 ? successCount / observations.length : 1;

  // Action diversity
  const uniqueTools = new Set(actions.map((a) => {
    try { return (JSON.parse(a.content) as any).tool ?? ""; } catch { return ""; }
  }));
  const actionDiversity = actions.length > 0 ? uniqueTools.size / actions.length : 1;

  return { loopScore, toolSuccessRate, repeatedActions, actionDiversity };
}

function buildContext(input: PulseInput) {
  const { tokens, tokenBudget, iteration, maxIterations } = input;
  const pressurePct = tokens / tokenBudget;
  const pressureLevel =
    pressurePct >= 0.9 ? "critical" : pressurePct >= 0.75 ? "high" : pressurePct >= 0.5 ? "moderate" : "low";
  return {
    iterationsUsed: iteration,
    iterationsRemaining: Math.max(0, maxIterations - iteration),
    tokens,
    pressureLevel,
    headroomTokens: Math.max(0, tokenBudget - tokens),
    atRiskSections: pressurePct >= 0.75 ? ["history"] : [],
  };
}

// NOTE: pulse.ts imports detectCompletionGaps and shouldShowFinalAnswer from react-kernel.ts.
// These must be exported from react-kernel.ts (detectCompletionGaps was already exported in
// a prior fix; shouldShowFinalAnswer is already exported from final-answer.ts).
// pulse.ts import line:
//   import { detectCompletionGaps } from "../../../reasoning/src/strategies/shared/react-kernel.js";
//   import { shouldShowFinalAnswer } from "./final-answer.js";
//
// Since pulse.ts is in @reactive-agents/tools and react-kernel.ts is in @reactive-agents/reasoning,
// use cross-package import: import { detectCompletionGaps } from "@reactive-agents/reasoning/react-kernel"
// OR extract detectCompletionGaps to a shared utility in @reactive-agents/tools/skills/completion-gaps.ts
// that both react-kernel.ts and pulse.ts can import. The latter avoids a circular dep.
//
// IMPLEMENTATION DECISION: Extract detectCompletionGaps to
// packages/tools/src/skills/completion-gaps.ts (no existing deps), import from both
// react-kernel.ts and pulse.ts.

function checkReadiness(input: PulseInput): { readyToAnswer: boolean; blockers: string[] } {
  const blockers: string[] = [];
  const { toolsUsed, requiredTools, iteration, steps } = input;

  // Required tools must all be called (mirrors shouldShowFinalAnswer condition 1)
  const missingRequired = requiredTools.filter((t) => !toolsUsed.has(t));
  if (missingRequired.length > 0) {
    blockers.push(`Required tools not yet called: ${missingRequired.join(", ")}`);
  }

  // Must have completed at least 1 iteration (mirrors shouldShowFinalAnswer condition 2)
  if (iteration < 1) {
    blockers.push("Need at least 1 iteration before finalizing.");
  }

  // At least one non-meta tool must have been used (mirrors shouldShowFinalAnswer condition 3)
  const hasRealWork = [...toolsUsed].some((t) => !META_TOOLS.has(t));
  if (!hasRealWork && requiredTools.length === 0) {
    blockers.push("No tools have been used yet — do some work before answering.");
  }

  // Run the same completion gap detection as the final-answer gate.
  // detectCompletionGaps is imported from packages/tools/src/skills/completion-gaps.ts
  // (extracted shared utility — see Task 6 Step 1b).
  const gaps = detectCompletionGaps(input.task, toolsUsed, input.allToolSchemas, steps);
  for (const gap of gaps) blockers.push(gap);

  return { readyToAnswer: blockers.length === 0, blockers };
}

function buildRecommendation(
  signal: ReturnType<typeof buildSignal>,
  behavior: ReturnType<typeof buildBehavior>,
  context: ReturnType<typeof buildContext>,
  blockers: string[],
  iteration: number,
): string {
  if (behavior.loopScore > 0.7) {
    return "You may be repeating the same actions — try a different approach or rephrase your query.";
  }
  if (signal.shape === "flat" && iteration > 3) {
    return "Entropy is not decreasing. Your current approach may not be working. Consider pivoting strategy.";
  }
  if (signal.shape === "oscillating") {
    return "Oscillating reasoning detected. Commit to one approach rather than switching back and forth.";
  }
  if (context.pressureLevel === "critical") {
    return "Context is nearly full. Finalize your answer soon or key history will be compressed away.";
  }
  if (context.pressureLevel === "high") {
    return "Context pressure is high. Avoid large tool results — use recall() for storage.";
  }
  if (blockers.length > 0) {
    return `Not ready to finalize: ${blockers[0]}`;
  }
  return "Execution is on track. Continue with your current approach.";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/tools/tests/pulse.test.ts 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/pulse.ts packages/tools/tests/pulse.test.ts
git commit -m "feat(tools): add pulse meta-tool for reactive intelligence introspection"
```

---

## Task 6: Wire into `builtin.ts` and `index.ts`

**Files:**
- Modify: `packages/tools/src/skills/builtin.ts`
- Modify: `packages/tools/src/skills/scratchpad.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Update builtin.ts — metaToolDefinitions only (NOT builtinTools)**

`recall`, `find`, `brief`, and `pulse` are conditionally registered by `react-kernel.ts` (see Task 7). They must NOT be added to `builtinTools` (which unconditionally auto-registers everything on ToolService startup, bypassing `.withMetaTools()` opt-in).

In `packages/tools/src/skills/builtin.ts`, add imports at the top:

```typescript
import { recallTool, makeRecallHandler, type RecallConfig } from "./recall.js";
import { findTool, makeFindHandler, type FindConfig, type FindState } from "./find.js";
import { briefTool, buildBriefResponse, computeEntropyGrade, type BriefInput } from "./brief.js";
import { pulseTool, buildPulseResponse, type PulseInput } from "./pulse.js";
```

Add to `metaToolDefinitions` array (schema-only, no handlers — for documentation and LLM schema injection):

```typescript
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  taskCompleteTool,
  finalAnswerTool,
  briefTool,      // NEW
  findTool,       // NEW
  pulseTool,      // NEW
  recallTool,     // NEW
];
```

Add re-exports for new tools (after existing re-exports):

```typescript
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./recall.js";
export {
  findTool,
  makeFindHandler,
  type FindConfig,
  type FindState,
} from "./find.js";
export {
  briefTool,
  buildBriefResponse,
  computeEntropyGrade,
  type BriefInput,
} from "./brief.js";
export {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "./pulse.js";
```

- [ ] **Step 1b: Extract `detectCompletionGaps` to shared utility**

`detectCompletionGaps` currently lives in `react-kernel.ts` but `pulse.ts` also needs it. Circular package deps (tools → reasoning) are not allowed. Extract it:

Create `packages/tools/src/skills/completion-gaps.ts`:

```typescript
import type { ToolSchema } from "../types.js";

/** Detect gaps between what the task requires and what tools were called. */
export function detectCompletionGaps(
  task: string,
  toolsUsed: ReadonlySet<string>,
  allToolSchemas: readonly { name: string }[],
  steps?: readonly { type: string; content: string }[],
): string[] {
  // Copy the implementation from react-kernel.ts lines 64-135 exactly.
  // (This avoids duplication by having react-kernel.ts import from here too.)
}
```

Update `react-kernel.ts` to import `detectCompletionGaps` from `@reactive-agents/tools/completion-gaps` instead of defining it locally. Update `pulse.ts` to import from the same location.

- [ ] **Step 2: Update scratchpad descriptions**

In `packages/tools/src/skills/scratchpad.ts`, update `scratchpadWriteTool.description` and `scratchpadReadTool.description` to note they are aliases:

```typescript
// scratchpadWriteTool description:
"Write a note to working memory. Alias for recall(key, content). Prefer recall() for new code.",

// scratchpadReadTool description:
"Read a note from working memory. Alias for recall(key, full: true). Prefer recall() for new code.",
```

- [ ] **Step 3: Add exports to index.ts**

In `packages/tools/src/index.ts`, add after existing skills exports:

```typescript
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./skills/recall.js";
export {
  findTool,
  makeFindHandler,
  type FindConfig,
  type FindState,
} from "./skills/find.js";
export {
  briefTool,
  buildBriefResponse,
  computeEntropyGrade,
  type BriefInput,
} from "./skills/brief.js";
export {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "./skills/pulse.js";
```

- [ ] **Step 4: Run the full tools test suite**

```bash
bun test packages/tools/ 2>&1 | tail -5
```

Expected: all pass (including existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/skills/builtin.ts \
        packages/tools/src/skills/scratchpad.ts \
        packages/tools/src/index.ts
git commit -m "feat(tools): register recall+find in builtinTools, export all conductor tools"
```

---

## Task 7: `react-kernel.ts` — Schema Injection + Inline Handling + Harness

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

This task wires `brief` and `pulse` into the kernel the same way `final-answer` is handled.

- [ ] **Step 1: Add `metaTools` to `ReActKernelInput`**

In `ReActKernelInput` interface (around line 198), add:

```typescript
/** Meta-tool configuration and pre-computed static data for brief/pulse. */
metaTools?: {
  brief?: boolean;
  find?: boolean;
  pulse?: boolean;
  recall?: boolean;
  staticBriefInfo?: {
    indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
    availableSkills: readonly { name: string; purpose: string }[];
    memoryBootstrap: { semanticLines: number; episodicEntries: number };
  };
  harnessContent?: string;
};
```

- [ ] **Step 2: Add imports**

At the top of react-kernel.ts, add:

```typescript
import {
  briefTool,
  buildBriefResponse,
  type BriefInput,
} from "@reactive-agents/tools";
import {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "@reactive-agents/tools";
```

- [ ] **Step 3: Inject harness skill into system prompt**

In the `executeReActKernel` function, find the system prompt construction block (around line 327 where `buildStaticContext` is called). Before that block, add:

```typescript
// ── Harness skill injection ─────────────────────────────────────────────
// Prepend the resolved harness skill content to the system prompt for
// non-trivial tasks so the agent knows how to use the conductor's tools.
const harnessContent = input.metaTools?.harnessContent;
const isNonTrivial =
  input.task.length >= 80 ||
  (input.requiredTools?.length ?? 0) > 0 ||
  (input.metaTools?.staticBriefInfo?.indexedDocuments.length ?? 0) > 0;

const effectiveSystemPrompt =
  harnessContent && isNonTrivial && (input.metaTools?.brief || input.metaTools?.pulse)
    ? `${harnessContent}\n\n${input.systemPrompt ?? ""}`
    : input.systemPrompt;
```

Then replace `input.systemPrompt` with `effectiveSystemPrompt` in the `buildStaticContext` call.

- [ ] **Step 4: Inject brief + pulse schemas into augmentedToolSchemas**

Find the `augmentedToolSchemas` definition (around line 313). Extend it:

```typescript
const augmentedToolSchemas: readonly import("./tool-utils.js").ToolSchema[] = [
  ...(input.availableToolSchemas ?? []),
  ...(finalAnswerVisible ? [{
    name: finalAnswerTool.name,
    description: finalAnswerTool.description,
    parameters: finalAnswerTool.parameters,
  }] : []),
  ...(input.metaTools?.brief ? [{
    name: briefTool.name,
    description: briefTool.description,
    parameters: briefTool.parameters,
  }] : []),
  ...(input.metaTools?.pulse ? [{
    name: pulseTool.name,
    description: pulseTool.description,
    parameters: pulseTool.parameters,
  }] : []),
];
```

- [ ] **Step 5: Update META_TOOL_NAMES sets**

Find all three locations where `META_TOOL_NAMES` / `META_TOOLS` sets are defined (lines 296, 670, 709) and add the new tools:

```typescript
// At line 296 (hasNonMetaToolCalledForThink filter):
(t) => t !== "final-answer" && t !== "task-complete" && t !== "context-status"
  && t !== "scratchpad-write" && t !== "scratchpad-read"
  && t !== "brief" && t !== "pulse" && t !== "find" && t !== "recall"

// At line 670 (META_TOOL_NAMES set):
const META_TOOL_NAMES = new Set([
  "final-answer", "task-complete", "context-status",
  "scratchpad-write", "scratchpad-read",
  "brief", "pulse", "find", "recall",   // NEW
]);

// At line 709 (META_TOOLS inside final-answer gate):
const META_TOOLS = new Set([
  "final-answer", "task-complete", "context-status",
  "scratchpad-write", "scratchpad-read",
  "brief", "pulse", "find", "recall",   // NEW
]);
```

- [ ] **Step 6: Add inline handling for `brief`**

In the acting phase, after the `final-answer` inline handler block (around line 815), add:

```typescript
// ── BRIEF INLINE HANDLER ─────────────────────────────────────────────────
if (toolRequest.tool === "brief" && input.metaTools?.brief && !isBlocked) {
  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(toolRequest.input) as Record<string, unknown>; } catch { /* ok */ }

  // Read from scratchpadStoreRef (live in-process store), NOT state.scratchpad (stale snapshot)
  const { scratchpadStoreRef } = await import("@reactive-agents/tools");
  const liveStore = Effect.runSync(Ref.get(scratchpadStoreRef));
  const recallKeys = [...liveStore.keys()];
  const briefInput: BriefInput = {
    section: parsedArgs.section as string | undefined,
    availableTools: input.availableToolSchemas ?? [],
    indexedDocuments: input.metaTools.staticBriefInfo?.indexedDocuments ?? [],
    availableSkills: input.metaTools.staticBriefInfo?.availableSkills ?? [],
    memoryBootstrap: input.metaTools.staticBriefInfo?.memoryBootstrap ?? { semanticLines: 0, episodicEntries: 0 },
    recallKeys,
    tokens: state.tokens,
    tokenBudget: input.contextProfile?.hardBudget ?? 8000,
    entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number } | undefined,
    controllerDecisionLog: state.controllerDecisionLog,
  };

  observationContent = buildBriefResponse(briefInput);
  obsResult = makeObservationResult("brief", true, observationContent);
  // continue to normal observation recording...
}
```

Note: the `// continue to normal observation recording...` part means you should NOT use `else if` — instead fall through to the existing observation-recording code at the end of the acting block. Structure it as early returns or use a flag, matching the pattern used by `final-answer` rejection handling.

- [ ] **Step 7: Add inline handling for `pulse`**

After the `brief` inline handler, add:

```typescript
// ── PULSE INLINE HANDLER ─────────────────────────────────────────────────
if (toolRequest.tool === "pulse" && input.metaTools?.pulse && !isBlocked) {
  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(toolRequest.input) as Record<string, unknown>; } catch { /* ok */ }

  const pulseInput: PulseInput = {
    question: parsedArgs.question as string | undefined,
    entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number; history?: readonly number[] } | undefined,
    controllerDecisionLog: state.controllerDecisionLog,
    steps: state.steps,
    iteration: state.iteration,
    maxIterations: input.maxIterations ?? 10,  // maxIterations is on input, NOT state.meta
    tokens: state.tokens,
    tokenBudget: input.contextProfile?.hardBudget ?? 8000,
    task: input.task,
    allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
    toolsUsed: state.toolsUsed,
    requiredTools: input.requiredTools ?? [],
  };

  observationContent = JSON.stringify(buildPulseResponse(pulseInput), null, 2);
  obsResult = makeObservationResult("pulse", true, observationContent);
}
```

- [ ] **Step 8: Run the reasoning test suite**

```bash
bun test packages/reasoning/ 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 9: Thread `metaTools` through StrategyFn → execution-engine**

`metaTools` is on `ReActKernelInput` but it must reach there from the builder → execution-engine → strategy. Two files need changes:

**`packages/reasoning/src/services/strategy-registry.ts`**: Find the `StrategyFn` type definition and add `metaTools?` to its input:

```typescript
// In the StrategyFn input type / StrategyInput interface:
metaTools?: {
  brief?: boolean;
  find?: boolean;
  pulse?: boolean;
  recall?: boolean;
  staticBriefInfo?: { indexedDocuments: readonly any[]; availableSkills: readonly any[]; memoryBootstrap: { semanticLines: number; episodicEntries: number } };
  harnessContent?: string;
};
```

**`packages/runtime/src/execution-engine.ts`**: Find the `reasoningOpt.value.execute({...})` call (around line 1074) and add:

```typescript
metaTools: (config as any).metaTools,   // passed from builder via ExecutionConfig
```

Also add `metaTools` to the ExecutionConfig type (wherever it is defined — search for `interface.*Config` or `type.*Config` in the execution engine or its types file).

- [ ] **Step 10: Run reasoning + runtime tests**

```bash
bun test packages/reasoning/ packages/runtime/ 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 11: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts \
        packages/reasoning/src/services/strategy-registry.ts \
        packages/runtime/src/execution-engine.ts
git commit -m "feat(kernel): wire brief+pulse inline handling, inject schemas, thread metaTools through strategy"
```

---

## Task 8: Builder `.withMetaTools()` + Harness Resolver

**Files:**
- Create: `packages/runtime/assets/harness.skill.md`
- Create: `packages/runtime/assets/harness.skill.condensed.md`
- Create: `packages/runtime/src/harness-resolver.ts`
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 1: Write harness.skill.md (frontier tier)**

Create `packages/runtime/assets/harness.skill.md`:

```markdown
# Conductor's Workflow

You are a reactive agent with four meta-tools. Use them to orient, gather, self-check, and remember.

## Before Starting (complex tasks)
1. Call `brief()` — see your tools, documents, skills, recall index, context budget, and signal grade.
2. If signal grade is C or below at any point, call `pulse()` to understand why.
3. Use `find(query)` instead of choosing between rag-search and web-search — it routes automatically.

## During Execution
- `find(query)` — gather information from any source. Specify scope only if you need to.
- `recall(key, content)` — store anything worth keeping across steps.
- `recall(key)` — retrieve a stored entry. Default is a compact preview; add full: true for complete content.
- `recall(query=...)` — keyword search across all stored entries when you forget key names.
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

- [ ] **Step 2: Write harness.skill.condensed.md (local tier)**

Create `packages/runtime/assets/harness.skill.condensed.md`:

```markdown
# Meta-Tools Quick Reference
- `brief()` — see all tools, documents, context budget, signal grade
- `find(query)` — search documents, memory, or web automatically (no need to choose)
- `pulse()` — check progress; `pulse("am I ready?")` before calling final-answer
- `recall(key, content)` to store · `recall(key)` to retrieve · `recall(query=...)` to search notes
```

- [ ] **Step 3: Implement harness-resolver.ts**

Create `packages/runtime/src/harness-resolver.ts`:

```typescript
import { readFile } from "fs/promises";
import { createRequire } from "module";

export type HarnessSkillConfig =
  | boolean
  | string
  | { frontier?: boolean | string; local?: boolean | string };

/** Resolve harness skill config to the final string content to inject. */
export async function resolveHarnessSkill(
  config: HarnessSkillConfig | undefined,
  modelTier: "frontier" | "local",
): Promise<string | null> {
  if (config === false) return null;
  if (config === undefined || config === true) {
    return loadSeedAsset(modelTier);
  }

  // Per-tier object
  if (typeof config === "object") {
    const tierConfig = modelTier === "frontier" ? config.frontier : config.local;
    if (tierConfig === false) return null;
    if (tierConfig === undefined || tierConfig === true) return loadSeedAsset(modelTier);
    return resolveStringConfig(tierConfig);
  }

  // Plain string: file path or inline content
  return resolveStringConfig(config);
}

async function resolveStringConfig(value: string): Promise<string> {
  // If it looks like a path, try to read it; otherwise treat as inline content
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("~")) {
    try {
      return await readFile(value, "utf8");
    } catch {
      // Fall through: treat as inline content
    }
  }
  return value;
}

async function loadSeedAsset(modelTier: "frontier" | "local"): Promise<string | null> {
  const filename =
    modelTier === "frontier" ? "harness.skill.md" : "harness.skill.condensed.md";
  try {
    // Using import.meta.url to locate the assets directory relative to this file
    const assetUrl = new URL(`../assets/${filename}`, import.meta.url);
    return await readFile(assetUrl, "utf8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add types to runtime/src/types.ts**

In `packages/runtime/src/types.ts`, add the new configuration types:

```typescript
export type HarnessSkillConfig =
  | boolean
  | string
  | { frontier?: boolean | string; local?: boolean | string };

export interface RecallConfig {
  previewLength?: number;
  autoFullThreshold?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
}

export interface FindConfig {
  autoStoreThreshold?: number;
  minRagScore?: number;
  webFallback?: boolean;
  preferredScope?: "documents" | "web";
}

export interface PulseConfig {
  useLLMRecommendation?: boolean;
  includeControllerDecisions?: boolean;
  includeBehavior?: boolean;
}

export interface MetaToolsConfig {
  brief?: boolean;
  find?: boolean;
  pulse?: boolean;
  recall?: boolean;
  harnessSkill?: HarnessSkillConfig;
  findConfig?: FindConfig;
  pulseConfig?: PulseConfig;
  recallConfig?: RecallConfig;
}
```

- [ ] **Step 5: Add `.withMetaTools()` to builder**

In `packages/runtime/src/builder.ts`, add a private field after other `_` fields (around where `_skillsConfig` is declared):

```typescript
private _metaTools?: import("./types.js").MetaToolsConfig;
```

Add the builder method (following the pattern of `withSkills`):

```typescript
/**
 * Enable the Conductor's Suite meta-tools: brief, find, pulse, recall.
 * Also injects the harness skill into the agent's operating context.
 *
 * @example
 * ```typescript
 * // Enable all with defaults
 * builder.withMetaTools()
 *
 * // Custom harness skill
 * builder.withMetaTools({ harnessSkill: "./my-harness.md" })
 *
 * // Selective enablement
 * builder.withMetaTools({ brief: true, pulse: true, find: false, recall: true })
 * ```
 */
withMetaTools(config?: import("./types.js").MetaToolsConfig): this {
  this._metaTools = config ?? {
    brief: true,
    find: true,
    pulse: true,
    recall: true,
    harnessSkill: true,
  };
  return this;
}
```

- [ ] **Step 6: Thread metaTools into kernel input during build**

In the `build()` method (inside the Effect.gen that assembles the runtime), find the section that builds the kernel input (where `modelId`, `agentId`, `systemPrompt` are assembled). Add harness resolution and static brief info computation:

```typescript
// Resolve meta-tools configuration
let kernelMetaTools: ReActKernelInput["metaTools"] | undefined;
if (this._metaTools) {
  const mt = this._metaTools;

  // Determine model tier for harness selection
  const tier: "frontier" | "local" =
    provider === "ollama" || provider === "litellm" ? "local" : "frontier";

  // Resolve harness content (async)
  let harnessContent: string | null = null;
  if (mt.harnessSkill !== false) {
    const { resolveHarnessSkill } = await import("./harness-resolver.js");
    harnessContent = await resolveHarnessSkill(mt.harnessSkill ?? true, tier);
  }

  // Build static brief info from already-computed values
  const indexedDocuments = ragStore
    ? [...(ragStore as Map<string, unknown[]>).entries()].map(([source, chunks]) => ({
        source,
        chunkCount: chunks.length,
        format: (chunks[0] as any)?.metadata?.format ?? "text",
      }))
    : [];

  kernelMetaTools = {
    brief: mt.brief,
    find: mt.find,
    pulse: mt.pulse,
    recall: mt.recall,
    staticBriefInfo: {
      indexedDocuments,
      availableSkills: [],   // populated by react-kernel lazily via brief("skills")
      memoryBootstrap: { semanticLines: 0, episodicEntries: 0 }, // updated at run time
    },
    harnessContent: harnessContent ?? undefined,
  };
}
```

Then pass `kernelMetaTools` into the kernel input where the strategy executes:

```typescript
// In the strategy.execute() call (execution-engine.ts or wherever kernel input is built):
metaTools: kernelMetaTools,
```

Since the metaTools flows through the strategy → react-kernel path, add `metaTools` to the strategy input type or the execution engine's strategy call. The field passes through `ReActKernelInput` which already exists in `react-kernel.ts`.

- [ ] **Step 7: Run the runtime test suite**

```bash
bun test packages/runtime/ 2>&1 | tail -5
```

Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/harness-resolver.ts \
        packages/runtime/src/types.ts \
        packages/runtime/src/builder.ts \
        packages/runtime/assets/harness.skill.md \
        packages/runtime/assets/harness.skill.condensed.md
git commit -m "feat(runtime): add .withMetaTools() builder, harness resolver, asset skill files"
```

---

## Task 9: Integration Tests

**Files:**
- Create: `packages/runtime/tests/meta-tools-integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `packages/runtime/tests/meta-tools-integration.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../../runtime/src/index.js";

describe("Conductor's Suite — integration", () => {
  it("recall write and read within a run round-trips correctly", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "plan", content: "Step 1. Step 2. Step 3." } } },
        { toolCall: { name: "recall", args: { key: "plan" } } },
        { text: "I found my plan." },
      ])
      .withMetaTools({ recall: true })
      .build();

    const result = await agent.run("Store a plan and read it back.");
    expect(result.output).toBeTruthy();
  });

  it("scratchpad-write and recall read the same underlying store", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "scratchpad-write", args: { key: "note", content: "hello from scratchpad" } } },
        { toolCall: { name: "recall", args: { key: "note" } } },
        { text: "Both access the same store." },
      ])
      .withMetaTools({ recall: true })
      .build();

    const result = await agent.run("Test backward compatibility.");
    expect(result.output).toBeTruthy();
  });

  it("find returns empty results without erroring when no docs indexed", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "find", args: { query: "anything", scope: "documents" } } },
        { text: "No documents found." },
      ])
      .withMetaTools({ find: true })
      .build();

    const result = await agent.run("Search for documents.");
    expect(result.output).toBeTruthy();
  });

  it("find searches indexed documents when withDocuments is used", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "find", args: { query: "Reactive Agents" } } },
        { text: "Found information about Reactive Agents." },
      ])
      .withDocuments([{ content: "Reactive Agents is a TypeScript framework for building AI agents.", source: "intro.md" }])
      .withMetaTools({ find: true })
      .build();

    const result = await agent.run("Find information about Reactive Agents.");
    expect(result.output).toBeTruthy();
  });

  it("brief tool produces orientation output", async () => {
    // brief is handled inline — verify the observation is recorded
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "brief", args: {} } },
        { text: "I have my briefing." },
      ])
      .withMetaTools({ brief: true })
      .build();

    const result = await agent.run("Get a briefing.");
    expect(result.output).toBeTruthy();
  });

  it("pulse tool returns structured response", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "work", content: "some work done" } } },
        { toolCall: { name: "pulse", args: {} } },
        { text: "Pulse checked." },
      ])
      .withMetaTools({ pulse: true, recall: true })
      .build();

    const result = await agent.run("Do some work then check pulse.");
    expect(result.output).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
bun test packages/runtime/tests/meta-tools-integration.test.ts 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 3: Run full suite to ensure no regressions**

```bash
bun test 2>&1 | tail -8
```

Expected: all existing tests pass, new tests pass

- [ ] **Step 4: Final commit**

```bash
git add packages/runtime/tests/meta-tools-integration.test.ts
git commit -m "test(runtime): add integration tests for conductor's suite meta-tools"
```

---

## Completion Checklist

Before marking done:

- [ ] `bun test` passes fully (all packages, no regressions)
- [ ] `brief`, `find`, `pulse`, `recall` tools all have passing unit tests
- [ ] `controllerDecisionLog` accumulates in kernel-runner
- [ ] `scratchpad-write` and `scratchpad-read` share the same store as `recall`
- [ ] `.withMetaTools()` is callable on the builder with no errors
- [ ] Harness skill asset files exist and are readable
- [ ] `find` auto-routes: hits RAG, falls back to web when configured
- [ ] `pulse` returns `readyToAnswer: true` when conditions are met
- [ ] `brief` omits signal line when reactive intelligence is off
- [ ] `META_TOOL_NAMES` updated in all three react-kernel locations
