# Context Window maxTokens Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make context compaction, pressure-gate, auto-checkpoint, and brief/pulse budgets read the *resolved* `profile.maxTokens` (not the usually-undefined caller input), and wire `capability.recommendedNumCtx` into `profile.maxTokens` so local models stop silently overflowing their real context window.

**Architecture:** Two layered bugs. **1b (primary):** five kernel sites read `input.contextProfile?.maxTokens ?? Number.MAX_SAFE_INTEGER` (or `?? 8000`) instead of the resolved `profile`/`context.profile` they already receive — so on the default path (no explicit `contextProfile`) the budget is `MAX_SAFE_INTEGER` and compaction/pressure/checkpoint **never fire for any provider**. **1a (S1.4, never landed):** even with 1b fixed, local tier `maxTokens` is a hardcoded 32_768 that ignores `capability.recommendedNumCtx` (cogito:14b → 8192). Fix 1b first (each site reads resolved profile), then 1a (resolve capability into `profile.maxTokens` in the runner's profile-build block, caller-supplied value still wins). Task 3 threads `environmentContext` + `providerName` + `modelId` into sub-kernels so plan-execute / tree-of-thought steps also get a correct window and custom env.

**Tech Stack:** TypeScript, Effect-TS, Bun test, Turbo

---

## Background — verified findings

- `resolveCapability(provider, model, opts?)` — synchronous, pure, exported from `@reactive-agents/llm-provider` (`index.ts:51`). Three-tier: cache → `STATIC_CAPABILITIES["${provider}/${model}"]` → fallback (`recommendedNumCtx: 2048`). `STATIC_CAPABILITIES["ollama/cogito:14b"].recommendedNumCtx === 8192` (`capability.ts:248-253`). Cloud entries: claude `200_000`, gpt `128_000` (`capability.ts:139/186`).
- `runner.ts:19` already does `import { LLMService, DEFAULT_CAPABILITIES, selectAdapter } from "@reactive-agents/llm-provider";` — add `resolveCapability` to that import.
- `KernelContext.profile: ContextProfile` (`kernel-state.ts:529`) is the *resolved* profile injected into every phase. `KernelInput.providerName?: string` (`:301`), `KernelInput.modelId?: string` (`:413`).
- Profile-build block: `runner.ts:474-496`. `effectiveInput.providerName` (`:478`), `effectiveInput.modelId` (`:492`), resolved `profile` finalized at `:494-496`, all inside `Effect.gen`.
- `context-profile.ts:3` already imports from `@reactive-agents/llm-provider` (`ModelTierSchema`) — adding `resolveCapability` there is dependency-safe.
- No existing context test asserts `maxTokens === 32768` (grep clean across `packages/reasoning/tests/context/`).
- Existing untracked plan `2026-05-19-tool-access-verifier-env-fixes.md` Task 2 (env-context ungate) is already reflected in `context-engine.ts:59` (unconditional `buildEnvironmentContext` call). That plan does **not** cover 1a/1b. This plan is the context-window root-cause fix.
- Deferred (separate plan, UX not correctness): no `withNumCtx()` / `contextWindow` builder API — `withModel({ maxTokens })` maps to output tokens (`LLMConfig.defaultMaxTokens`, num_predict), not the context window.

### The five Bug-1b sites

| File:line | Mechanism | Wrong source | Fallback | In scope |
|---|---|---|---|---|
| `context-utils.ts:139-140` | message-window compaction | `input.contextProfile` | `Number.MAX_SAFE_INTEGER` | `profile` param (`:133`) |
| `think.ts:286` | pressure gate | `input.contextProfile` | `Number.MAX_SAFE_INTEGER` | `profile` (used `:287`) |
| `runner.ts:736` | auto-checkpoint | `effectiveInput.contextProfile` | `Number.MAX_SAFE_INTEGER` | `profile` (used `:737`) |
| `act.ts:179` | brief token budget | `input.contextProfile` | `8000` | `context.profile` |
| `act.ts:209` | pulse token budget | `input.contextProfile` | `8000` | `context.profile` |

---

## File Map

| File | Change |
|------|--------|
| `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts` | `:136-141` read `profile.maxTokens` |
| `packages/reasoning/src/kernel/capabilities/reason/think.ts` | `:286` read `profile.maxTokens` |
| `packages/reasoning/src/kernel/loop/runner.ts` | `:736` read `profile.maxTokens`; `:19` import `resolveCapability`; `:494-496` apply capability helper |
| `packages/reasoning/src/kernel/capabilities/act/act.ts` | `:179`,`:209` read `context.profile.maxTokens` |
| `packages/reasoning/src/context/context-profile.ts` | add pure `applyCapabilityMaxTokens()` helper |
| `packages/reasoning/src/kernel/state/kernel-state.ts` | add `environmentContext`/`providerName`/`modelId` to `ReActKernelInput` |
| `packages/reasoning/src/kernel/loop/react-kernel.ts` | thread the three fields into the built `KernelInput` |
| `packages/reasoning/src/strategies/plan-execute.ts` | `:1268` pass the three fields to `executeReActKernel` |
| `packages/reasoning/src/strategies/tree-of-thought.ts` | `:475` pass the three fields to `runKernel` |
| `apps/examples/spot-test.ts` | remove dead `import { date }` line; used for end-to-end verification |
| Tests (new) | `context/profile-maxtokens-wiring.test.ts`, `context/capability-maxtokens.test.ts`, `strategies/subkernel-env-threading.test.ts` |

---

## Task 1: Bug 1b — all budget sites read the resolved profile

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts:136-141`
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts:286`
- Modify: `packages/reasoning/src/kernel/loop/runner.ts:736`
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts:179,209`
- Test: `packages/reasoning/tests/context/profile-maxtokens-wiring.test.ts` (new)

### Background

Every site already receives the resolved profile (`profile` param or `context.profile`). They incorrectly read the raw, usually-`undefined` caller input `input.contextProfile?.maxTokens`. On the default path the `?? Number.MAX_SAFE_INTEGER` fallback makes `budget = floor(MAX_SAFE_INTEGER * 0.75)` — compaction/pressure/checkpoint can never trigger. Fixing all five together is mandatory: a partial fix still ships a path that never trims.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/tests/context/profile-maxtokens-wiring.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { buildConversationMessages } from "../../src/kernel/capabilities/attend/context-utils.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { KernelState, KernelInput } from "../../src/kernel/state/kernel-state.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";

// A no-op adapter — taskFraming is the only method buildConversationMessages may call.
const stubAdapter = {} as ProviderAdapter;

// Build a message thread that is ~7000 tokens (well over 75% of an 8192 window
// = 6144, but far under 75% of MAX_SAFE_INTEGER).
function bigState(): KernelState {
  const filler = "x".repeat(2000); // ~500 tokens at 4 chars/token
  const messages = [
    { role: "user" as const, content: "Original task: research crypto and report." },
    { role: "assistant" as const, content: "thinking 1", toolCalls: [{ id: "1", name: "web-search", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "1", toolName: "web-search", content: filler },
    { role: "assistant" as const, content: "thinking 2", toolCalls: [{ id: "2", name: "web-search", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "2", toolName: "web-search", content: filler },
    { role: "assistant" as const, content: "thinking 3", toolCalls: [{ id: "3", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "3", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 4", toolCalls: [{ id: "4", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "4", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 5", toolCalls: [{ id: "5", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "5", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 6", toolCalls: [{ id: "6", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "6", toolName: "crypto-price", content: filler },
  ];
  return { messages, steps: [], iteration: 6, tokens: 7000 } as unknown as KernelState;
}

describe("Bug 1b — compaction reads resolved profile.maxTokens, not input.contextProfile", () => {
  it("compacts when state exceeds 75% of resolved profile.maxTokens and NO input.contextProfile is set", () => {
    const state = bigState();
    // Caller passes NO contextProfile — the realistic default path.
    const input = { task: "research crypto", availableToolSchemas: [] } as unknown as KernelInput;
    // Resolved profile carries an 8192 window (e.g. cogito:14b after Task 2).
    const profile = { ...CONTEXT_PROFILES.local, maxTokens: 8192 };

    const out = buildConversationMessages(state, input, profile, stubAdapter);

    // 13 raw messages, 6 turns; local keeps first user + last 2 turns + [Prior:].
    expect(out.length).toBeLessThan(state.messages.length);
    const joined = out.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ");
    expect(joined).toContain("[Prior:");
  });

  it("does NOT compact when resolved profile.maxTokens is large enough for the thread", () => {
    const state = bigState();
    const input = { task: "research crypto", availableToolSchemas: [] } as unknown as KernelInput;
    const profile = { ...CONTEXT_PROFILES.frontier, maxTokens: 128_000 };

    const out = buildConversationMessages(state, input, profile, stubAdapter);
    expect(out.length).toBe(state.messages.length);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/reasoning && bun test tests/context/profile-maxtokens-wiring.test.ts --timeout 15000`

Expected: first test FAILS — `out.length` equals `state.messages.length` (no compaction) because `context-utils.ts:139` reads `input.contextProfile?.maxTokens` → `undefined` → `Number.MAX_SAFE_INTEGER`, so `budget` is astronomically large.

- [ ] **Step 3: Fix `context-utils.ts` — read resolved `profile.maxTokens`**

In `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts`, replace lines 136-141:

```typescript
  const compactedMessages = applyMessageWindowWithCompact(
    state.messages,
    profile.tier ?? "mid",
    profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
  );
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd packages/reasoning && bun test tests/context/profile-maxtokens-wiring.test.ts --timeout 15000`

Expected: both tests PASS — compaction now fires off the resolved 8192 window; the 128_000 case stays uncompacted.

- [ ] **Step 5: Fix `think.ts` pressure gate**

In `packages/reasoning/src/kernel/capabilities/reason/think.ts`, replace line 286:

```typescript
        maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
```

(Lines 285 `estimatedTokens: state.tokens,` and 287 `tier: profile.tier,` are unchanged — `profile` is already in scope and used on 287.)

- [ ] **Step 6: Fix `runner.ts` auto-checkpoint**

In `packages/reasoning/src/kernel/loop/runner.ts`, replace line 736:

```typescript
          maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
```

(Line 737 `tier: profile.tier,` already uses the resolved `profile` — this removes the inconsistency where the same call read `effectiveInput.contextProfile` for maxTokens but `profile` for tier.)

- [ ] **Step 7: Fix `act.ts` brief + pulse budgets**

In `packages/reasoning/src/kernel/capabilities/act/act.ts`, line 179 (inside `handleBriefTool`, which has `context: KernelContext`):

```typescript
      tokenBudget: context.profile.maxTokens ?? 8000,
```

And line 209 (inside `handlePulseTool`, also `context: KernelContext`):

```typescript
      tokenBudget: context.profile.maxTokens ?? 8000,
```

Note: both functions already do `const { input } = context;` — `context` is in scope; read `context.profile.maxTokens`.

- [ ] **Step 8: Verify no budget site still reads the raw caller input**

Run: `grep -rn "contextProfile?\.maxTokens\|contextProfile as { maxTokens" packages/reasoning/src/kernel/`

Expected: **zero** matches for budget reads. (`runner.ts:9` is a comment about profile merging and `react-kernel.ts:117` passes `contextProfile:` through as input plumbing — neither is a budget read. If either appears, confirm it is not a `maxTokens` budget calculation.)

- [ ] **Step 9: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test --timeout 15000`

Expected: all pass, no regressions. (Compaction now fires for tier defaults where it never did before — if a pre-existing test implicitly relied on "compaction never happens" it will surface here; investigate before proceeding.)

- [ ] **Step 10: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/attend/context-utils.ts \
        packages/reasoning/src/kernel/capabilities/reason/think.ts \
        packages/reasoning/src/kernel/loop/runner.ts \
        packages/reasoning/src/kernel/capabilities/act/act.ts \
        packages/reasoning/tests/context/profile-maxtokens-wiring.test.ts
git commit -m "fix(kernel): context budget sites read resolved profile.maxTokens, not raw caller input

Compaction, pressure gate, auto-checkpoint, and brief/pulse budgets read
input.contextProfile?.maxTokens ?? MAX_SAFE_INTEGER. On the default path
(no explicit contextProfile) the budget was MAX_SAFE_INTEGER so they never
fired for any provider. All sites already receive the resolved profile."
```

---

## Task 2: Bug 1a (S1.4) — wire capability.recommendedNumCtx into profile.maxTokens

**Files:**
- Modify: `packages/reasoning/src/context/context-profile.ts` (add pure helper)
- Modify: `packages/reasoning/src/kernel/loop/runner.ts:19` (import), `:494-496` (apply helper)
- Test: `packages/reasoning/tests/context/capability-maxtokens.test.ts` (new)

### Background

`CONTEXT_PROFILES.local.maxTokens = 32_768` (`context-profile.ts:80`) is a placeholder; the comment at `:76-77` says `capability.recommendedNumCtx` "should override this when wired (Sprint 1 S1.4 — see runner.ts profile resolution)". That wiring never landed. cogito:14b's real Ollama `num_ctx` is 8192 (capability static table), so even with Task 1, local-tier compaction fires at `0.75 * 32768 = 24576` while Ollama silently truncates at 8192. The fix resolves the capability in the profile-build block and lowers `profile.maxTokens` to it — unless the caller explicitly set `contextProfile.maxTokens` (their value always wins). Pure helper for unit testability.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/tests/context/capability-maxtokens.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { applyCapabilityMaxTokens, CONTEXT_PROFILES } from "../../src/context/context-profile.js";

describe("applyCapabilityMaxTokens — S1.4 capability wiring", () => {
  it("lowers local-tier maxTokens to cogito:14b recommendedNumCtx (8192) when caller did not set it", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "cogito:14b", undefined);
    expect(out.maxTokens).toBe(8192);
  });

  it("caller-supplied contextProfile.maxTokens always wins over capability", () => {
    const base = { ...CONTEXT_PROFILES.local, maxTokens: 16000 };
    const out = applyCapabilityMaxTokens(base, "ollama", "cogito:14b", 16000);
    expect(out.maxTokens).toBe(16000);
  });

  it("unknown ollama model falls back to capability fallback (2048)", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "private-model:custom", undefined);
    expect(out.maxTokens).toBe(2048);
  });

  it("cloud model gets its large capability window (anthropic claude → 200000)", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.frontier, "anthropic", "claude-sonnet-4-20250514", undefined);
    expect(out.maxTokens).toBe(200_000);
  });

  it("returns profile unchanged when provider or model is missing", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.mid, undefined, undefined, undefined);
    expect(out.maxTokens).toBe(CONTEXT_PROFILES.mid.maxTokens);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/reasoning && bun test tests/context/capability-maxtokens.test.ts --timeout 15000`

Expected: FAIL to compile/run — `applyCapabilityMaxTokens` is not exported from `context-profile.ts`.

- [ ] **Step 3: Add the pure helper to `context-profile.ts`**

In `packages/reasoning/src/context/context-profile.ts`, add to the top imports (the file already imports from `@reactive-agents/llm-provider` on line 3):

```typescript
import { resolveCapability } from "@reactive-agents/llm-provider";
```

Then append this exported function at the end of the file (after `mergeProfile`):

```typescript
/**
 * S1.4 — Wire `capability.recommendedNumCtx` into `profile.maxTokens`.
 *
 * Resolution: the caller-supplied `contextProfile.maxTokens` always wins
 * (passed as `callerProvidedMaxTokens`). Otherwise, when both provider and
 * model are known, resolve the Capability and use its `recommendedNumCtx`
 * as the effective context window. With provider or model missing, the
 * profile is returned unchanged (tier default stands).
 *
 * Pure / synchronous — `resolveCapability` is a sync three-tier lookup
 * (cache → static table → conservative fallback 2048).
 */
export function applyCapabilityMaxTokens(
  profile: ContextProfile,
  providerName: string | undefined,
  modelId: string | undefined,
  callerProvidedMaxTokens: number | undefined,
): ContextProfile {
  if (callerProvidedMaxTokens !== undefined) return profile;
  if (!providerName || !modelId) return profile;
  const cap = resolveCapability(providerName, modelId);
  return { ...profile, maxTokens: cap.recommendedNumCtx };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `cd packages/reasoning && bun test tests/context/capability-maxtokens.test.ts --timeout 15000`

Expected: all 5 PASS.

- [ ] **Step 5: Import `resolveCapability` is NOT needed in runner.ts — use the helper**

In `packages/reasoning/src/kernel/loop/runner.ts`, confirm line 19 currently reads:

```typescript
import { LLMService, DEFAULT_CAPABILITIES, selectAdapter } from "@reactive-agents/llm-provider";
```

Add the helper import near the existing context-profile import in runner.ts (find the line importing `CONTEXT_PROFILES` / `ContextProfile` and add `applyCapabilityMaxTokens` to it). If `CONTEXT_PROFILES` is imported as:

```typescript
import { CONTEXT_PROFILES, type ContextProfile } from "../../context/context-profile.js";
```

change it to:

```typescript
import { CONTEXT_PROFILES, applyCapabilityMaxTokens, type ContextProfile } from "../../context/context-profile.js";
```

(Do not add `resolveCapability` to the llm-provider import — the helper encapsulates it.)

- [ ] **Step 6: Apply the helper in the profile-build block**

In `packages/reasoning/src/kernel/loop/runner.ts`, the block at lines 494-496 currently is:

```typescript
    const profile: ContextProfile = profileOverrides
      ? ({ ...baseProfile, ...profileOverrides } as ContextProfile)
      : baseProfile;
```

Replace it with:

```typescript
    const mergedProfile: ContextProfile = profileOverrides
      ? ({ ...baseProfile, ...profileOverrides } as ContextProfile)
      : baseProfile;
    // S1.4 — derive the effective context window from the model Capability
    // unless the caller explicitly set contextProfile.maxTokens (their value
    // wins). Without this, local tier stays at the 32K placeholder while
    // Ollama silently truncates at the model's real num_ctx (cogito:14b=8192).
    const profile: ContextProfile = applyCapabilityMaxTokens(
      mergedProfile,
      effectiveInput.providerName,
      effectiveInput.modelId,
      effectiveInput.contextProfile?.maxTokens,
    );
```

- [ ] **Step 7: Run the full reasoning suite**

Run: `cd packages/reasoning && bun test --timeout 15000`

Expected: all pass. The pressure/compaction tests from Task 1 still pass; local-tier runs now carry an 8192 (cogito:14b) window end-to-end.

- [ ] **Step 8: Build the workspace (DTS + type check)**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`

Expected: clean build (confirms the new export + import resolve and types are sound).

- [ ] **Step 9: Commit**

```bash
git add packages/reasoning/src/context/context-profile.ts \
        packages/reasoning/src/kernel/loop/runner.ts \
        packages/reasoning/tests/context/capability-maxtokens.test.ts
git commit -m "fix(context): S1.4 — wire capability.recommendedNumCtx into profile.maxTokens

Local tier maxTokens was a hardcoded 32K placeholder; the documented S1.4
wiring never landed. resolveCapability now sets the effective window
(cogito:14b -> 8192) in the runner profile-build block. Caller-supplied
contextProfile.maxTokens still wins."
```

---

## Task 3: Thread environmentContext + providerName + modelId into sub-kernels

**Files:**
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (`ReActKernelInput`)
- Modify: `packages/reasoning/src/kernel/loop/react-kernel.ts:112-128` (KernelInput build)
- Modify: `packages/reasoning/src/strategies/plan-execute.ts:1268` (executeReActKernel call)
- Modify: `packages/reasoning/src/strategies/tree-of-thought.ts:475` (runKernel call)
- Test: `packages/reasoning/tests/strategies/subkernel-env-threading.test.ts` (new)

### Background

`plan-execute.ts:1268` (`executeReActKernel`) and `tree-of-thought.ts:475` (`runKernel`) build sub-kernel inputs that omit `environmentContext`, `providerName`, and `modelId`. The auto-detected date still appears (`buildEnvironmentContext` runs unconditionally per kernel run) but **custom** env fields are dropped, and — post Task 2 — sub-kernels can't resolve the model Capability (no providerName/modelId) so they fall back to the tier default window instead of the real one. `executeReActKernel` (`react-kernel.ts:112-128`) builds the `KernelInput` and never forwards these fields even when its caller supplies them.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/tests/strategies/subkernel-env-threading.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import type { ReActKernelInput } from "../../src/kernel/state/kernel-state.js";

// Compile-level + shape contract: ReActKernelInput must accept the three
// fields so executeReActKernel can forward them. This test fails to compile
// until the type carries them.
describe("ReActKernelInput carries sub-kernel context fields", () => {
  it("accepts environmentContext, providerName, modelId", () => {
    const input: ReActKernelInput = {
      task: "step 1",
      availableToolSchemas: [],
      environmentContext: { Agent: "cortex-desk", RunId: "abc" },
      providerName: "ollama",
      modelId: "cogito:14b",
    } as ReActKernelInput;
    expect(input.environmentContext?.Agent).toBe("cortex-desk");
    expect(input.providerName).toBe("ollama");
    expect(input.modelId).toBe("cogito:14b");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd packages/reasoning && bun test tests/strategies/subkernel-env-threading.test.ts --timeout 15000`

Expected: TypeScript error — `environmentContext` / `providerName` / `modelId` are not assignable to `ReActKernelInput` (depending on how strict the test build is, this surfaces as a type error or a runtime `undefined`).

- [ ] **Step 3: Add the fields to `ReActKernelInput`**

In `packages/reasoning/src/kernel/state/kernel-state.ts`, find the `ReActKernelInput` interface (search `interface ReActKernelInput`). Add these readonly fields alongside the existing optional ones (e.g. next to `priorContext`):

```typescript
  /** Custom environment context key-value pairs — forwarded to the sub-kernel
   *  system prompt (date/time is always auto-injected regardless). */
  readonly environmentContext?: Readonly<Record<string, string>>;
  /** LLM provider name — required for sub-kernel Capability resolution (S1.4). */
  readonly providerName?: string;
  /** Model identifier — required for sub-kernel Capability resolution (S1.4). */
  readonly modelId?: string;
```

- [ ] **Step 4: Forward the fields in `react-kernel.ts`**

In `packages/reasoning/src/kernel/loop/react-kernel.ts`, the `KernelInput` object built at lines 112-128 ends with the `toolCallResolver` spread on line 128 then `} as KernelInput, {` on line 129. Add the three fields just before line 128's `...(input.toolCallResolver ...)`:

```typescript
      environmentContext: input.environmentContext,
      providerName: input.providerName,
      modelId: input.modelId,
```

- [ ] **Step 5: Pass the fields from `plan-execute.ts`**

In `packages/reasoning/src/strategies/plan-execute.ts`, the `executeReActKernel({ ... })` call at lines 1268-1286 currently passes `modelId: input.modelId` on line 1284 but not `environmentContext`/`providerName`. Add after the existing `modelId: input.modelId,` line:

```typescript
    environmentContext: input.environmentContext,
    providerName: input.providerName,
```

(`modelId: input.modelId` is already present — keep it; it now also reaches the KernelInput via Step 4 rather than only KernelRunOptions.)

- [ ] **Step 6: Pass the fields from `tree-of-thought.ts`**

In `packages/reasoning/src/strategies/tree-of-thought.ts`, the `runKernel(reactKernel, { ... })` call begins at line 475. Inside that input object (near where `priorContext` / task fields are set, before the closing `}` of the first argument), add:

```typescript
      environmentContext: input.environmentContext,
      providerName: input.providerName,
      modelId: input.modelId,
```

(If `tree-of-thought.ts`'s strategy `input` type lacks `environmentContext`/`providerName`/`modelId`, confirm the ToT strategy input interface — it extends the shared strategy input which already declares `environmentContext` per `strategy-registry.ts:67` and `providerName` per the reactive path. If a field is genuinely absent on the ToT input type, thread it the same way reactive.ts does: add the readonly field to the ToT input interface and source it from the strategy params.)

- [ ] **Step 7: Run test — expect pass**

Run: `cd packages/reasoning && bun test tests/strategies/subkernel-env-threading.test.ts --timeout 15000`

Expected: PASS — `ReActKernelInput` now accepts all three fields.

- [ ] **Step 8: Run the full reasoning suite + build**

Run: `cd packages/reasoning && bun test --timeout 15000 && bunx turbo run build --filter=@reactive-agents/reasoning`

Expected: all pass, clean build.

- [ ] **Step 9: Commit**

```bash
git add packages/reasoning/src/kernel/state/kernel-state.ts \
        packages/reasoning/src/kernel/loop/react-kernel.ts \
        packages/reasoning/src/strategies/plan-execute.ts \
        packages/reasoning/src/strategies/tree-of-thought.ts \
        packages/reasoning/tests/strategies/subkernel-env-threading.test.ts
git commit -m "fix(strategies): thread environmentContext/providerName/modelId into sub-kernels

plan-execute and tree-of-thought sub-kernels dropped custom env context and
could not resolve the model Capability (no provider/model) — falling back to
the tier-default window instead of the real num_ctx."
```

---

## Task 4: End-to-end verification with cogito:14b + cleanup

**Files:**
- Modify: `apps/examples/spot-test.ts:1` (remove dead import)

### Background

The advisor flagged a blocking risk: Task 1 makes local-tier compaction (`KEEP_FULL_TURNS_BY_TIER.local = 2`, `[Prior: ...]` summaries) **fire for the first time** against real local models. This path may never have been exercised against cogito:14b. Verify the model still produces correct output after compaction kicks in.

- [ ] **Step 1: Remove the dead import in spot-test.ts**

In `apps/examples/spot-test.ts`, delete line 1 entirely:

```typescript
import { date } from 'effect/FastCheck'
```

(It is unused — `date` is never referenced. File starts with the `ReactiveAgents` import on the next line.)

- [ ] **Step 2: Run the spot test against cogito:14b**

Prerequisite: Ollama running locally with `cogito:14b` pulled (`ollama list` shows it).

Run: `cd apps/examples && bun run spot-test.ts 2>&1 | tee /tmp/spot-test-cogito.log`

- [ ] **Step 3: Verify the three success criteria from the log**

Inspect `/tmp/spot-test-cogito.log`:

1. **Output produced** — the run prints a markdown report, not an empty/`null` result and not a verifier hard-fail.
2. **Current date present** — the report's date matches today (env context survived; not a hallucinated 2024/2025 date).
3. **Compaction fired without breaking the model** — with `logModelIO: true` + `verbosity: 'verbose'`, confirm a `[Prior:` summary appears in a later-iteration prompt AND the model still issued correct subsequent tool calls (it did not get confused by the summary and loop or hallucinate tool names).

- [ ] **Step 4: Decision gate**

- If all three pass: proceed to Step 5.
- If criterion 3 fails (model confused by `[Prior: ...]` summaries): **do not commit a workaround silently.** The local-tier summary format needs tuning — append a Task 5 to this plan: adjust `oldSummaryParts` formatting in `message-window.ts:69-91` for the `local` tier (e.g. richer per-turn snippet, or raise `KEEP_FULL_TURNS_BY_TIER.local` from 2 to 3) and re-run Step 2. Re-derive the value from the observed failure, do not guess.

- [ ] **Step 5: Commit the cleanup**

```bash
git add apps/examples/spot-test.ts
git commit -m "chore(examples): drop unused effect/FastCheck date import in spot-test"
```

---

## Task 5: Full-suite + cross-package regression gate

- [ ] **Step 1: Full workspace test**

Run: `bun run test`

Expected: all packages pass. Pay attention to `@reactive-agents/runtime` and `@reactive-agents/llm-provider` — Task 2/3 changed shared types.

- [ ] **Step 2: Full build / type check**

Run: `bunx turbo run build`

Expected: clean across all packages (DTS step is authoritative per project memory — `tsc --noEmit` may false-positive on `ignoreDeprecations`; trust the turbo build).

- [ ] **Step 3: Release dry-run drift gate**

Run: `bun run release:dry 0.11.1`

Expected: no version drift errors (sole drift gate per project memory; no manual `npm publish`).

- [ ] **Step 4: Final commit if any lockfile/version artifacts changed**

Only if Steps 1-3 produced tracked changes:

```bash
git add -A
git commit -m "chore: regression-gate artifacts for context-window maxTokens wiring"
```

---

## Self-Review

**Spec coverage:**
- ✅ Bug 1b (budget sites read resolved profile) — Task 1, all five sites (`context-utils.ts:139`, `think.ts:286`, `runner.ts:736`, `act.ts:179`, `act.ts:209`) + grep guard (Step 8)
- ✅ Bug 1a / S1.4 (capability → profile.maxTokens) — Task 2, pure helper + runner wiring, caller value still wins
- ✅ Bug 2 (sub-kernel env/provider/model drop) — Task 3, type + react-kernel + plan-execute + tree-of-thought
- ✅ Advisor blocking concern (local compaction first-time activation) — Task 4 Step 3-4 explicit decision gate
- ✅ Dead import cleanup — Task 4 Step 1
- ⏸️ Deferred (noted, not in scope): `withNumCtx()`/`contextWindow` builder API — separate UX plan; not a correctness bug
- ➖ Not duplicated: env-context ungate is already live (`context-engine.ts:59`); covered by the separate untracked `2026-05-19-tool-access-verifier-env-fixes.md`

**Task ordering rationale (per advisor):** 1b before 1a. 1b alone makes compaction fire at `0.75 × tier-default` (still wrong for cogito but no longer never). 1a alone is inert because the readers still saw `undefined → MAX_SAFE_INTEGER`. Each task is independently testable; 1a then tightens the value to the real window.

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows the exact replacement text. Test bodies are complete and runnable.

**Type consistency:**
- `applyCapabilityMaxTokens(profile, providerName?, modelId?, callerProvidedMaxTokens?) → ContextProfile` — same signature in Task 2 Step 3 (definition), Step 6 (call), and the Task 2 Step 1 test.
- `profile.maxTokens` is `number | undefined` (`ContextProfileSchema.maxTokens` is `Schema.optional(Schema.Number)`) — every fixed site keeps a `?? Number.MAX_SAFE_INTEGER` (compaction/pressure/checkpoint) or `?? 8000` (brief/pulse) fallback, matching the original fallback semantics.
- `ReActKernelInput` gains `environmentContext?: Readonly<Record<string, string>>`, `providerName?: string`, `modelId?: string` — identical shapes to the existing `KernelInput` fields they forward into (`kernel-state.ts:301/366/413`).
- `resolveCapability(provider: string, model: string) → Capability` (`recommendedNumCtx: number`) — used only inside `applyCapabilityMaxTokens`; runner.ts does not import it directly (helper encapsulates the dependency).

**Risk note:** Task 1 changes long-dormant behavior — compaction/pressure/checkpoint begin firing for every default-path run. The full suite (Task 1 Step 9) plus the real-model spot-test (Task 4) are the safety net; the Task 4 Step 4 gate prevents shipping a model-confusing summary format silently.
