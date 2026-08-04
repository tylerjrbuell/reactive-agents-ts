# Tool Result Compression — Design

**Date:** 2026-02-27
**Status:** Approved
**Scope:** `packages/reasoning`, `packages/tools`, `packages/runtime`

---

## Problem

Large tool results (e.g. MCP `list_commits` returning 31K chars) are currently handled by blind head+tail truncation at 800 chars. This produces two distinct failures:

1. **Garbled data** — the model receives a JSON fragment that cuts off mid-object, making it impossible to reason correctly on the result
2. **Context bloat** — even at 800 chars, large results consume the context budget even when only a small slice is relevant

The existing `normalizeObservation()` handles specific built-in tools (file-write, web-search, http-get) but has no strategy for dynamic MCP tool results or large generic responses.

---

## Goals

- Agent always receives **accurate** data (never garbled/truncated mid-JSON)
- Agent uses context budget **efficiently** (only what's relevant enters context)
- Agent has **full control** — can be selective about what it keeps
- **No extra LLM calls** or latency in the default path
- **User-configurable** — power users and MCP-heavy agents can tune behavior

---

## Design

### Layer 1 — Auto-Preview with Scratchpad Overflow

When a tool result exceeds the configured `budget`, instead of truncating, the framework:

1. Detects the result type (JSON array, JSON object, plain text)
2. Generates a **structured preview** — compact, accurate, fits within budget
3. Stores the **full result** in scratchpad under `_tool_result_<n>`
4. Injects the preview + storage key into context

**Example — JSON array (github/list_commits, 30 items, 31K chars):**

```
[STORED: _tool_result_1 | github/list_commits]
Type: Array(30) | Schema: sha, commit.message, author.login, date
Preview (first 3):
  [0] sha=e255a5d  msg="chore: update bun.lock"        date=2026-02-27
  [1] sha=59bae87  msg="feat(examples): unified runner" date=2026-02-27
  [2] sha=efc816e  msg="fix(examples): maxIterations"   date=2026-02-27
  ...27 more — use scratchpad-read("_tool_result_1") or pipe transform
```

**Preview generation rules by type:**

| Type | Preview |
|------|---------|
| JSON array | Count + schema (top-level keys) + first N items as compact `key=val` lines |
| JSON object | Top-level keys + values (strings truncated to 60 chars, nested objects shown as `{...}`) |
| Plain text | First N lines + line count |

**Schema extraction** — for arrays, inspect the first item's keys and flatten one level (e.g. `commit.message`, `author.login`) to show useful nested fields.

**Counter** — `_tool_result_<n>` where `n` is a per-execution monotonic counter, so multiple stored results don't collide.

---

### Layer 2 — Code-Transform Pipe

A new pipe action syntax lets the agent transform a tool result **before it enters context** — in the same reasoning step. The full result never touches the context window.

**Syntax:**

```
ACTION: tool_name(args) | transform: <js_expression>
```

Where `<js_expression>` is evaluated with `result` bound to the parsed tool output (or raw string if not JSON).

**Example:**

```
ACTION: github/list_commits({"owner":"tylerjrbuell","repo":"reactive-agents-ts"}) | transform: result.slice(0,3).map(c => ({sha: c.sha.slice(0,7), msg: c.commit.message.split('\n')[0], date: c.commit.author.date}))
```

The framework:
1. Parses the pipe — splits on ` | transform: `, extracts the expression
2. Executes the tool normally
3. Evaluates the transform **in-process** via `new Function('result', 'return (' + expr + ')')` — no subprocess, synchronous, `result` is the parsed output
4. Serializes the transform output and injects it as the observation
5. Stores the original full result in scratchpad as `_tool_result_<n>` for follow-up access

**Transform errors** — if the expression throws, the framework falls back to Layer 1 preview behavior and includes the error message in the observation so the agent can correct its transform.

**In-process vs subprocess** — transforms are pure expressions (no side effects, no file I/O). Running in-process via `new Function()` is appropriate and consistent with how the framework already evaluates built-in tools. The existing `code-execute` tool (Bun.spawn subprocess) remains for agent-initiated code with side effects.

---

### Layers Working Together

The two layers are independent and complementary:

| Mode | When | Benefit |
|------|------|---------|
| A only | Agent calls tool, gets preview | Reactive — agent reacts to what's returned |
| C only | Agent anticipates response shape | Proactive — agent expresses intent upfront |
| A then C | Step N: see preview; step N+1: pipe transform using schema | Best of both — discover then refine |

When a pipe transform is used (C), Layer 1 auto-store still runs so `_tool_result_<n>` is always available for follow-up if the agent needs more.

---

### ReAct Prompt Updates

The system prompt is updated to explain both mechanisms with concise examples:

```
TOOL RESULTS:
Large results are stored automatically. You will see a preview:
  [STORED: _tool_result_1] Array(30) | sha, commit.message, author.login, date
  Preview: [0] sha=e255a5d msg="..." ...
  Use scratchpad-read("_tool_result_1") to access the full result.

PIPE TRANSFORMS (optional):
To get exactly what you need in one step, add | transform: <expr> after any ACTION:
  ACTION: github/list_commits({...}) | transform: result.slice(0,3).map(c => c.commit.message)
Only the transform output enters context. result = parsed tool output.
```

---

## User Configuration

Exposed on `.withTools()` as `resultCompression`:

```typescript
.withTools({
  resultCompression: {
    budget: 1200,        // chars before overflow triggers (default: 800)
    previewItems: 5,     // array items shown in preview (default: 3)
    autoStore: true,     // auto-store overflow in scratchpad (default: true)
    codeTransform: true, // enable | transform: pipe syntax (default: true)
  }
})
```

Also integrates with `ContextProfile` tier defaults:

| Tier | Default budget | Default previewItems |
|------|---------------|---------------------|
| `local` | 800 | 3 |
| `mid` | 1200 | 5 |
| `large` | 2000 | 8 |
| `frontier` | 3000 | 10 |

When `resultCompression` is set on `.withTools()`, it overrides the tier default.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/reactive.ts` | `compressToolResult()` replaces `truncateToolResult()`; pipe parser in `parseToolRequest()`; scratchpad counter; prompt update |
| `packages/runtime/src/builder.ts` | `ToolsOptions.resultCompression` field; pass config into execution context |
| `packages/tools/src/types.ts` | `ResultCompressionConfig` schema + type |
| `packages/reasoning/tests/strategies/reactive-compression.test.ts` | New test file — preview generation, pipe transforms, error fallback, config |

---

## Out of Scope

- LLM-based summarization (adds latency/cost, not needed given structural preview quality)
- FIELDS hint syntax (agent-declared field selection upfront — less reliable than code)
- Scratchpad expiry (out of scope for v1 — scratchpad is already per-execution scoped)
- Non-ReAct strategies (Plan-Execute, ToT etc. — follow-up if needed)
