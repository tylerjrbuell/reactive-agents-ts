# Observability Overhaul — Unified Run-Tree Design

**Date:** 2026-07-24
**Status:** DESIGN — approved direction, pending plan
**Scope:** `@reactive-agents/observability` (display path only) + the `@reactive-agents/runtime` call sites that feed it (`execution-engine.ts`, `builder/build-effect/sub-agent-executor.ts`, `engine/finalize/run-finalize.ts`).
**Out of scope:** `RA_DEBUG_ERRORS` / `REACTIVE_AGENTS_DEBUG` env vars (separate, lower-level error-stack mechanism, `runtime/src/errors.ts:426,434-436` — untouched). Adopting a TUI framework (ink) — considered and rejected, see §4. Cross-provider/model-routing concerns — unrelated package.

## 1. Problem, verified by running it

Ran `scratch.ts` (a parent agent dispatching one sub-agent via `spawn-agent`) across all four `.withObservability({ verbosity })` levels — `minimal`, `normal`, `verbose`, `debug` — against a live Ollama model. Four concrete defects, not just aesthetic ones:

| # | Defect | Evidence |
|---|---|---|
| D1 | **`minimal` leaks everything.** Doc comment at `runtime/src/builder/types.ts:627` says minimal = "no output except final result." Actual output at that level dumps the full phase/tool/kernel log stream — same volume as `normal` minus the dashboard. | `out-minimal.log`, 64 lines, full `[phase:think]`/`[tool:*]` trace for both agents. |
| D2 | **Sub-agent prints its own full dashboard mid-parent-stream.** When the sub-agent completes, its entire `═══ Logs ═══` / `═══ Spans ═══` / `═══ Metrics Summary ═══` / Timeline / Reasoning Signal / Alerts block prints inline, unindented — visually identical to a parent-level dashboard — and the parent's own `[phase:think]` line resumes *below* it. | `out-normal.log:58-111`: dashboard block for the sub-agent sits between the parent's `[tool:spawn-agent] call 0` and `✓ [tool:spawn-agent] 8.91s`. |
| D3 | **Duplicate DEBUG lines at `verbose`+.** Every `action`/`obs` event prints twice: once unprefixed, once with a `│   ` prefix. | `out-verbose.log:29-30, 33-34, 42-43, 46-47, 55-56, 59-60` — six paired duplicates in one run. |
| D4 | **Duplicate model-io dumps at `debug`.** Each LLM call is logged under two different labels (`model-io:direct-llm:stream`, `model-io:reactive:main`) with near-identical system+thread content. 74 `model-io` entries total for a 2-agent run. | `out-debug.log:14-40` (paired dump for the same call), `grep -c model-io` = 74. |

## 2. Root cause

Three parallel, independently-maintained render paths consume the same underlying events:

- `ObservableLogger` (`observability/src/logging/observable-logger.ts`) — buffered + live event bus.
- `status-renderer.ts` — hand-rolled ANSI live status line, spinner, raw-mode collapsible panel (`SPINNER` array, `onKey`/`togglePanel` at `:177-226`, cursor-control redraw at `:127-175`).
- `console-exporter.ts` — end-of-run dashboard/summary printer (`printTree()` at `:528-544`, box-drawing via `chalk`+`boxen`).

Plus at least one ad-hoc fourth path: `runtime/src/engine/finalize/run-finalize.ts:150-158` prints its own `console.log("\n═══ Run Summary ═══")` block, outside all three of the above.

Sub-agent depth-prefixing (`buildSubAgentLogPrefix`, `runtime/src/builder/build-effect/sub-agent-executor.ts:42-44`) is applied by wrapping `obs.info/debug/warn/error` in `execution-engine.ts:214-230`, **only when `config.logPrefix` is explicitly set** — a per-call-site opt-in, not a property of the tree structure. Code comments there are dated 2026-07-23, i.e. this is mid-refactor, which is exactly why D2/D3 exist: fixing prefixing in one path doesn't fix the other three.

Every defect (D1-D4) is a variant of the same failure mode: **N independent places decide what to print, instead of one tree deciding what exists and N renderers deciding what to show.**

## 3. Design

### 3.1 Data model — `RunTree` / `RunNode`

One canonical, in-memory hierarchical tree per top-level `agent.run()`, built incrementally as execution events arrive:

```ts
interface RunNode {
  id: string
  kind: 'agent' | 'phase' | 'tool' | 'llm-call' | 'thought'
  name: string
  status: 'running' | 'done' | 'error'
  startTime: number
  endTime?: number
  tokens?: number
  cost?: number
  metadata: Record<string, unknown>   // redacted at write time, see §3.4
  children: RunNode[]
}
```

Two structural decisions that directly fix D2 and D4:

- A `spawn-agent` tool call produces a child `agent` node **nested under that tool node** — never a sibling top-level run. There is structurally nowhere for a sub-agent to print an independent dashboard, because it never becomes its own tree root.
- Each LLM call is **one** `llm-call` node with prompt/response attached as metadata — not two separately-labeled emissions. D4 disappears because there is exactly one write site per call.

`execution-engine.ts`/kernel phases append to or update nodes in this tree instead of calling `console.log`/`formatEvent` directly. The JSONL file-exporter and OTLP exporter (`observability/src/exporters/file-exporter.ts`, `otlp-exporter.ts`) keep consuming raw events for their existing per-line output — unchanged, since they're machine-readable export, not display. (They may gain a `nodeId`/`parentId` field for correlation; additive, not a breaking format change — left for the implementation plan to confirm against current consumers.)

### 3.2 Rendering — two renderers, one filter, over the same tree

- **`LiveRenderer`** (TTY only, `process.stdout.isTTY` checked once at construction, never re-checked mid-render): renders the run as it happens. Each visible node gets one line; updates redraw in place, extending the existing cursor-control approach already in `status-renderer.ts` from "one global panel" to "per-node line." Collapsed sub-agent nodes update live (elapsed time, current tool/token count) while running, freeze on completion.
- **`AppendRenderer`** (non-TTY — piped, redirected, CI; the fallback path our own probes exercised, since redirecting to a file forces non-TTY): no redraw capability exists, so it prints one line per node the moment that node settles. Append-only, matches today's actual piped behavior but without the duplication/leak defects.
- **`DashboardRenderer`**: runs once at the true end of the run, regardless of TTY, walks the **final** tree, and prints exactly one Summary box + Timeline + Reasoning Signal + Alerts for the *entire* run — sub-agent nodes appear as rows inside that single structure (e.g. under Timeline/Tool Execution), never as a separate box. This retires the ad-hoc `run-finalize.ts:150-158` `console.log` path entirely — it becomes one call into `DashboardRenderer`.

Verbosity becomes exactly one filter function, `visibleNodes(tree, verbosity): RunNode[]`, applied at render time — not verbosity checks scattered across log call sites. This is the direct fix for D1: there is one gate, and it is unit-testable independent of any actual terminal output (§3.5).

- `minimal`: top-level agent node + final one-line result only.
- `normal`: phase nodes + tool one-liners + sub-agent nodes collapsed to one line.
- `verbose`: + nested sub-agent detail, truncated content.
- `debug`: everything untruncated; `llm-call` nodes render full prompt/response.

Node failure (`status: 'error'`) forces that node visible regardless of verbosity — an input to the filter (node status), not a bypass of it.

### 3.3 Sub-agent representation

Collapsed line while running (live-updating in the `LiveRenderer` path):

```
├─ spawn-agent → bitcoin-price-finder  ● 4.2s  web-search…
```

Freezes on completion:

```
├─ spawn-agent → bitcoin-price-finder  ✓ 8.9s  6,467 tok
```

On failure: auto-expands in place to the nested detail, indented one level, connected with `│` — same line format as the parent, recursively. No separate dashboard block, no raw JSON dump.

Manual expand/collapse: reuses the raw-mode key handling already built in `status-renderer.ts`, generalized from "toggle the one global thinking panel" to "toggle whichever node is currently selected." Key binding: `t` (kept from the existing `togglePanel` binding at `status-renderer.ts:202`, for continuity). Only meaningful under `LiveRenderer`/TTY — `AppendRenderer` has no interactivity to offer, so failed sub-agents there simply print their nested detail unconditionally (same trigger, no toggle available).

Nesting depth is not special-cased: a sub-agent that spawns its own sub-agent renders as a deeper tree with deeper indentation, same rules recursively.

### 3.4 Error handling + redaction

- ANSI cursor operations (redraw, expand/collapse) only ever run behind the `isTTY` check decided once at `LiveRenderer` construction — never re-attempted or assumed mid-render if the stream's TTY-ness is ambiguous.
- The existing OWASP-aligned secret redactor list applies **once**, at the point content is written into a `RunNode`'s `metadata` — not per-renderer. Every renderer downstream sees already-redacted content by construction, removing the class of bug where one of N renderers forgets to redact.
- A renderer crash never crashes the agent run: rendering is best-effort against a tree that already reflects real execution. A render failure degrades to a plain-text fallback (print the raw event, skip formatting) rather than throwing.

### 3.5 Testing

- `RunTree` construction: given a synthetic event sequence, assert node shape/nesting — specifically that a sub-agent event nests under its parent's tool node, not as a sibling top-level node (regression guard for D2's root cause).
- `visibleNodes(tree, verbosity)` unit tests for all four levels in isolation — regression guard for D1, independent of terminal output.
- Duplicate-emission regression test: feed the same logical event twice into the tree builder, assert one node results, not two — regression guard for D3/D4.
- `DashboardRenderer` snapshot tests against a fixed synthetic tree that includes a nested sub-agent — confirms no separate sub-agent box appears, catches formatting regressions.
- Manual/E2E: rerun `scratch.ts` across all four modes post-implementation, both piped (as this investigation did) and through a real TTY (`script -qc` to fake one) — the live-redraw/expand-key path was never exercised during this investigation, only the non-TTY `AppendRenderer` fallback was observed.

## 4. Alternatives considered

- **Incremental patch** (fix D1-D4 as point bugs, bolt sub-agent-line-collapsing onto `status-renderer.ts` directly): lowest effort, but leaves the 3-parallel-path architecture intact. Rejected — the 2026-07-23 mid-refactor comment in `sub-agent-executor.ts` shows this exact pattern (fix one path, miss the others) is how D2/D3 were introduced; patching again invites the next instance of the same bug class.
- **Adopt ink for the live view**: cleaner long-term component model, but adds a real dependency (React reconciler + yoga-layout) for a CLI tool, doesn't touch the root cause (the data model, not the draw layer, is where D1-D4 live), and pushes the aesthetic toward full-screen-TUI territory the user explicitly wants to avoid (reference point given: clean/minimal CLI + structured tree, not lazygit/k9s-style). Rejected.
