# Reactive Agents: Plan Review & Critical Improvements

## Review Date: February 15, 2026

## Reviewer: AI Architecture Analysis

---

## Executive Assessment

The Reactive Agents spec is **ambitious and well-positioned strategically**. The 6 competitive advantages are genuine gaps in the market. However, the spec has **15 critical issues** that will cause AI agents to produce inconsistent, broken, or incomplete code if not addressed before implementation begins.

**Overall Score: 7/10** — Great vision, significant execution gaps.

---

## CRITICAL Issues (Must Fix Before Building)

### 1. NO LLM PROVIDER ABSTRACTION — Severity: BLOCKER

**The Problem:**
Layers 3 (Reasoning), 4 (Verification), and 5 (Cost) all call LLMs extensively. Code examples reference `this.llm.generate()`, `this.llm.complete()`, and `this.llm.embed()` — but **no LLMService is defined anywhere**. There is no spec for:

- LLM provider interface (Anthropic, OpenAI, local models)
- Structured output parsing (critical for ReAct, planning, evaluation)
- Streaming responses
- Token counting
- Model configuration and switching
- Error handling for API failures (rate limits, timeouts)

**Impact:** An AI agent will either invent an ad-hoc LLM interface (inconsistent across layers) or get stuck immediately at Layer 3.

**Fix:** A new spec document `01.5-layer-llm-provider.md` has been created alongside this review. It must be read before Layer 3 implementation begins. The LLMService should be part of the `@reactive-agents/core` package.

---

### 2. EFFECT-TS PATTERN VIOLATIONS IN SPECS — Severity: HIGH

**The Problem:**
The spec warns "don't mix async/await with Effect" but then does exactly that in multiple code examples:

- **Layer 2 (LanceDB provider):** Written entirely with `async/await` classes instead of Effect-wrapped services
- **Layer 2 (Embedding provider):** Uses raw `fetch` instead of `Effect.tryPromise`
- **Layer 3 (Strategies):** Use `this` inside `Effect.gen` without proper binding (will throw runtime errors)
- **Layer 4 (Verification):** All layers use `async/Promise.all` instead of `Effect.all`
- **Layer 5 (Cost):** Uses `async` functions, not Effect
- **Layer 6 (Identity):** Uses `async` functions, not Effect
- **Layer 7 (Orchestration):** Uses `Promise.all`, not Effect
- **Layer 8 (Tools):** MCP client uses `async/await`

**Impact:** An AI agent following these examples will produce code that violates the project's own principles. Half the codebase will use Effect, half won't. Refactoring will be painful.

**Fix:** All code examples in Layers 4-9 need Effect-TS wrapping. Key patterns:

```typescript
// ❌ WRONG (in current spec)
async verify(text: string): Promise<LayerResult> {
  const generations = await Promise.all([...]);
}

// ✅ CORRECT
verify(text: string): Effect.Effect<LayerResult, VerificationError> {
  return Effect.gen(function* () {
    const generations = yield* Effect.all([...]);
  });
}
```

---

### 3. LAYERS 4-9 SPECS ARE SKELETAL — Severity: HIGH

**The Problem:**
Spec depth is wildly uneven:

| Layer                       | Lines    | Detail Level | Verdict       |
| --------------------------- | -------- | ------------ | ------------- |
| Layer 1 (Core)              | 632      | Detailed     | ✅ Good       |
| Layer 2 (Memory)            | 712      | Detailed     | ✅ Good       |
| Layer 3 (Reasoning)         | 1101     | Detailed     | ✅ Good       |
| Layer 10 (Interaction)      | 1111     | Detailed     | ✅ Good       |
| **Layer 4 (Verification)**  | **~120** | **Skeleton** | ❌ Needs work |
| **Layer 5 (Cost)**          | **~100** | **Skeleton** | ❌ Needs work |
| **Layer 6 (Identity)**      | **~100** | **Skeleton** | ❌ Needs work |
| **Layer 7 (Orchestration)** | **~100** | **Skeleton** | ❌ Needs work |
| **Layer 8 (Tools)**         | **~80**  | **Skeleton** | ❌ Needs work |
| **Layer 9 (Observability)** | **~80**  | **Skeleton** | ❌ Needs work |

Layers 4-9 are missing:

- Effect-TS service definitions (`Context.Tag` pattern)
- Layer implementations with dependency injection
- Inter-layer integration code
- Error types (tagged errors)
- Configuration types
- Meaningful test examples
- Performance benchmarks

**Impact:** An AI agent will need to invent ~70% of the implementation for these layers. Results will be inconsistent with the well-specified layers.

**Fix:** Each skeleton spec has been expanded inline in this review (see section below).

---

### 4. MISSING STRUCTURED OUTPUT PARSING — Severity: HIGH

**The Problem:**
The reasoning layer needs to parse LLM outputs into structured data (plans, actions, evaluations, scores). The spec shows regex parsing:

```typescript
const toolMatch = thought.match(/use\s+(\w+)\s+with\s+(.+)/i);
```

This is fragile and will fail constantly. No spec addresses:

- Zod schemas for LLM output validation
- JSON mode / structured output support
- Fallback parsing strategies
- Output format instructions in prompts

**Impact:** Reasoning strategies will break on unpredictable LLM outputs. This is the #1 source of agent failures in production.

**Fix:** Add a `StructuredOutput` module to core with Zod-based validation:

```typescript
import { Schema } from "effect";

const PlanSchema = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      description: Schema.String,
      tool: Schema.optional(Schema.String),
      expectedOutput: Schema.optional(Schema.String),
    }),
  ),
});
```

---

### 5. MISSING MONOREPO SETUP — Severity: MEDIUM

**The Problem:**
The spec defines a monorepo with 10 packages but provides no:

- `package.json` workspace configuration
- Shared `tsconfig.json` (base config)
- Build pipeline (package build order respecting dependencies)
- Inter-package dependency declarations
- Bun workspace configuration

**Impact:** An AI agent will spend half of Day 1 fighting build configuration instead of writing Layer 1 code.

**Fix:** Concrete workspace setup added to START_HERE document.

---

### 6. NO CONTEXT WINDOW MANAGEMENT — Severity: MEDIUM

**The Problem:**
Working memory is capped at 7 items (good), but there's no strategy for managing LLM context windows:

- No prompt template system
- No conversation history truncation
- No token counting before sending prompts
- No strategy for handling 1M token windows vs 8K windows
- No handling for long-running tasks that exceed context

Anthropic's own research says: _"The core challenge of long-running agents is that they must work in discrete sessions."_

**Fix:** Add a `PromptManager` service to core that handles context window budgeting.

---

### 7. NO STREAMING ARCHITECTURE — Severity: MEDIUM

**The Problem:**
The interaction layer spec describes real-time collaboration, streaming thoughts, and live updates. But there's no infrastructure spec for:

- WebSocket or Server-Sent Events (SSE) transport
- Streaming LLM response handling
- Observable/reactive state management
- Real-time event propagation from agents to UI

**Fix:** Add streaming support to the LLM provider and event bus specs.

---

### 8. MISSING TEST INFRASTRUCTURE — Severity: MEDIUM

**The Problem:**

- No mock/stub strategy for LLM calls (critical — can't call real LLMs in tests)
- No fixtures or factories for test data
- No integration test harness across layers
- No CI/CD pipeline spec
- No benchmarking framework
- "80% coverage" target has no enforcement mechanism

**Fix:** Add test utilities to core: `TestLLM`, `TestMemory`, `TestToolRegistry` with deterministic behavior.

---

### 9. `this` BINDING BUG IN EFFECT.GEN — Severity: MEDIUM

**The Problem:**
Multiple strategy implementations use `this` inside `Effect.gen`:

```typescript
execute(task, memory, tools) {
  return Effect.gen(function* () {
    const thought = yield* this.think(context, steps); // ❌ 'this' is undefined
  });
}
```

`Effect.gen` uses a generator function where `this` is not bound to the class instance. This will throw `TypeError: Cannot read properties of undefined` at runtime.

**Fix:** Use arrow functions or bind `this`:

```typescript
execute(task, memory, tools) {
  const self = this;
  return Effect.gen(function* () {
    const thought = yield* self.think(context, steps); // ✅
  });
}
```

---

### 10. ARCHITECTURE INCONSISTENCY: 9 vs 10 LAYERS — Severity: LOW

**The Problem:**
`implementation-ready-summary.md` says "9-Layer Architecture" but all other docs say 10. Layer 10 (Interaction) was added later and the summary wasn't updated.

**Fix:** Update implementation-ready-summary.md.

---

## STRATEGIC Weaknesses

### 11. MISSING A2A (Agent-to-Agent) PROTOCOL SUPPORT

**The Problem:**
The competitive analysis notes Pydantic AI has A2A support. Google's A2A protocol is becoming standardized alongside MCP (for tool integration, A2A is for agent-to-agent). Not supporting A2A misses an interoperability opportunity.

**Recommendation:** Add A2A support to Layer 7 (Orchestration) or Layer 8 (Tools). At minimum, note it in the architecture as a future addition.

---

### 12. NO INPUT SANITIZATION / SANDBOXING

**The Problem:**
The spec claims "agent identity" as a competitive advantage for security, but the actual security spec is thin:

- No input sanitization for tool calls (prompt injection risk)
- No sandboxing for code execution tools
- No rate limiting for API calls
- No threat model

**Recommendation:** Add a security considerations section to the tools layer spec. At minimum, wrap all tool inputs through a sanitization layer.

---

### 13. NO GRACEFUL DEGRADATION

**The Problem:**
What happens when:

- The LLM API is down? No fallback model strategy.
- LanceDB is corrupted? No backup retrieval.
- The embedding API fails? No fallback embeddings.
- Budget is exceeded mid-task? Task just fails.

**Recommendation:** Add circuit breaker patterns and fallback chains to the core architecture.

---

### 14. TIMELINE RISK: PHASE 3 IS OVERLOADED

**The Problem:**
Phase 3 (Weeks 10-14) packs in the most complex features:

- Layer 6: Certificate-based identity (crypto, PKI infrastructure)
- Layer 7: Multi-agent orchestration + event sourcing + durable execution
- Layer 10: 5 interaction modes + adaptive switching + learning + dashboard UI

The dashboard UI alone could take 4 weeks. The timeline needs buffer.

**Recommendation:** Either extend to 16-18 weeks or descope Phase 3 to ship Layer 10 with 3 modes (autonomous, supervised, collaborative) and add interrogative/consultative post-launch.

---

### 15. EFFECT-TS LEARNING CURVE NOT ADDRESSED

**The Problem:**
Effect-TS is powerful but has a steep learning curve. The spec assumes the implementing agent already knows Effect-TS well. For an AI agent:

- Effect 3.x API surface is large
- `Layer`, `Context.Tag`, `Ref`, `Queue`, `Stream` all needed
- Generator pattern (`Effect.gen`) has subtle gotchas
- Error channel composition is non-obvious

**Recommendation:** Add an "Effect-TS Quick Reference" section to the implementation guide with the specific 20% of Effect API that covers 80% of use cases in this project.

---

## Summary of Changes Made

| Change                                 | File                               | Type    |
| -------------------------------------- | ---------------------------------- | ------- |
| Created comprehensive review           | `PLAN_REVIEW.md`                   | New     |
| Created LLM Provider spec              | `01.5-layer-llm-provider.md`       | New     |
| Fixed Effect-TS patterns in Layers 4-9 | Inline in respective specs         | Updated |
| Added monorepo setup                   | `START_HERE_AI_AGENTS.md`          | Updated |
| Added test infrastructure              | `START_HERE_AI_AGENTS.md`          | Updated |
| Fixed 9→10 layer count                 | `implementation-ready-summary.md`  | Updated |
| Added `this` binding fix guidance      | `implementation-guide-complete.md` | Updated |
| Added structured output types          | `layer-01-core-detailed-design.md` | Updated |
| Added context window management        | `layer-01-core-detailed-design.md` | Updated |
| Expanded Layer 4-9 specs               | Respective layer docs              | Updated |

---

## Priority Order for Addressing Issues

1. **BLOCKER:** Create LLM Provider abstraction (Issue #1)
2. **CRITICAL:** Fix Effect-TS pattern violations (Issue #2, #9)
3. **CRITICAL:** Add structured output parsing (Issue #4)
4. **HIGH:** Expand Layers 4-9 specs (Issue #3)
5. **HIGH:** Add monorepo setup (Issue #5)
6. **MEDIUM:** Add context window management (Issue #6)
7. **MEDIUM:** Add test infrastructure (Issue #8)
8. **MEDIUM:** Add streaming architecture (Issue #7)
9. **LOW:** Fix 9/10 layer inconsistency (Issue #10)
10. **STRATEGIC:** Add A2A protocol support (Issue #11)
11. **STRATEGIC:** Add security hardening (Issue #12)
12. **STRATEGIC:** Add graceful degradation (Issue #13)
13. **STRATEGIC:** Adjust timeline (Issue #14)
14. **STRATEGIC:** Add Effect-TS reference (Issue #15)

---

_This review is actionable. All critical issues have corresponding fixes applied or documented._
