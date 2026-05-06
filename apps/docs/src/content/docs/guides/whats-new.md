---
title: What's New
description: Latest features and changes to Reactive Agents across recent releases
sidebar:
  order: 2
---

A quick-scan guide to what has landed in each major release. Start here when returning after time away — each bullet links to the relevant documentation.

---

## v0.10.x — Phase 1 Validation Release (May 2026)

The largest release to date. **22-wave overhaul**, **full empirical validation of all 13 harness mechanisms** (8 KEEP / 5 IMPROVE / 0 REMOVE), and a complete adaptive tool-calling pipeline that makes local models dramatically more reliable. Read the full [v0.10.0 changelog](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md) for the long form.

### Highlights

- **Healing Pipeline (M4)** — 4-stage closed-loop FC recovery (tool-name → param-name → path resolution → type coercion). **86.7% recovery rate**, **+80pp accuracy lift**, **90% token savings** vs LLM reprompt fallback. Ships on every tool call by default — see [LLM Providers](/features/llm-providers/) and [Resilience](/features/resilience/).
- **Composable kernel architecture** — `kernel/` reorganized into capability-grouped subdirs (`act/`, `attend/`, `comprehend/`, `decide/`, `reason/`, `reflect/`, `sense/`, `verify/` + `loop/` + `state/`). Single-owner termination via `kernel/loop/terminate.ts` with CI-enforced lint guard — see [Composable Kernel](/concepts/composable-kernel/).
- **Reactive Intelligence dispatcher fully wired** — 6 intervention handlers active (early-stop, temp-adjust, switch-strategy, context-compress, tool-inject, skill-activate); budget threading fixed; suppression gates reachable — see [Reactive Intelligence](/features/reactive-intelligence/).
- **Three-stage context curation** — `tool-execution` compress-and-stash → curator render-from-stash → optional RI-driven trim. **60.7% context reduction**, **38.6% token savings** (44.1% aggressive), **0.16ms latency** — see [Intelligent Context Synthesis](/features/intelligent-context-synthesis/).
- **Calibration system** — 3-tier resolver (shipped prior → community profile → local observations); `parallelCallCapability`, `classifierReliability`, and `toolCallDialect` adapt empirically after 5 runs; auto-enabled when `.withReasoning()` is active.
- **Adaptive tool calling** — `toolCallDialect` FC probe routes models to `NativeFCDriver` or 3-tier `TextParseDriver` (XML / JSON / pseudo-code cascade); `ToolCallObservation` closes the ExperienceStore feedback loop with N≥3 alias frequency gate.
- **`@reactive-agents/diagnose`** — standalone npm package for output-leak detection. **100% true positive, 0% false positive, 0.02ms detection latency**; 25 regex patterns + 4 FP filters across system-prompt, api-key, credential, and internal-instruction leaks.
- **Gateway chat mode** (May 1) — per-sender SQLite session history, episodic context injection, daily compaction, `channels.mode: 'chat' | 'task'` — see [Gateway](/features/gateway/) and [Messaging Channels](/guides/messaging-channels/).
- **`@reactive-agents/cortex`** — Cortex Studio is now an installable npm package with Beacon, Thalamus, Lab, and living-skills views. Run via `bunx @reactive-agents/cortex` or `rax cortex` — see [Cortex](/features/cortex/).
- **Frontier benchmarks: 100% pass on `ra-full`** — verified across `claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-4o-mini`, and `gemini-2.5-pro` (W21, Apr 30 2026). Bare LLM only achieves 85% under the same harness.
- **5,028 tests** across 556 files (5,002 pass / 26 skip / 0 fail in ~65s) — verified by `bun test` on every PR.

### Phase 1 Mechanism Verdicts

| Mechanism | Verdict | Headline |
|-----------|---------|----------|
| M1 RI Dispatcher | ✅ KEEP | Measurement infra in place; budget threading fixed |
| M2 Strategy Switching | ✅ KEEP | 20 tests passing; ToT outer-loop early-stop fixed |
| M3 Verifier + Retry | 🔄 IMPROVE | Core works; retry context tuning needed for cogito:14b |
| M4 Healing Pipeline | ✅ KEEP | 86.7% recovery, +80pp accuracy |
| M5 Context Curation | ✅ KEEP | 60.7% compression, 38.6% token savings |
| M6 Skills System | 🔄 IMPROVE | Lifecycle works; cross-session persistence pending |
| M7 Calibration | 🔄 IMPROVE | 3-tier resolver works; ≥8 of 14 fields to activate |
| M8 Sub-Agent Delegation | 🔄 IMPROVE | Test harness ready; effectiveness metrics pending |
| M9 Termination Oracle | ✅ KEEP | 100% path coverage; CI-enforced |
| M10 Memory System | 🔄 IMPROVE | Recall functional; multi-session scenarios pending |
| M11 Diagnostic System | ✅ KEEP | 100% TP, 0% FP, 0.02ms latency |
| M12 Provider Adapters | ✅ KEEP | All 7 hooks fire, 254/254 tests pass |
| M13 Guards + Meta-tools | ✅ KEEP | 100% accuracy, 0.001ms latency |

### Breaking Changes

None. All existing `ReactiveAgents.create().with*()` builder chains continue to work unchanged. New fields on `ModelCalibrationSchema` are forward-compatible.

---

## v0.9.x — MCP Production Hardening + Pre-v0.10 Polish

- **MCP client rewritten on `@modelcontextprotocol/sdk`** — smart auto-detection between stdio and HTTP-only containers, two-phase docker lifecycle — see [Orchestration](/features/orchestration/)
- **Composable kernel architecture (initial)** — `react-kernel.ts` reduced from ~1,700 to ~197 lines via `makeKernel({ phases })` factory — see [Composable Kernel](/concepts/composable-kernel/)
- **Permanently-failed required tools fix** — tools that always error no longer cause loop-until-maxIterations — see [Harness Control Flow](/features/harness-control-flow/)
- **Cortex MCP CRUD + JSON import** — import Cursor/Claude-style MCP configs directly into Cortex — see [Cortex](/features/cortex/)
- **StatusRenderer TUI** — live terminal display with collapsible think panel (`t` key toggles), `mode: 'stream' | 'status'`
- **3 new terminal tools** — `git-cli`, `gh-cli`, and `gws-cli` are now built-in
- **Web-search provider Serper.dev** — third web-search backend alongside Tavily
- **`crypto-price` built-in tool** — CoinGecko price lookup, no API key required
- **Observability on by default** — minimal verbosity is now enabled out of the box
- **Sub-agent `maxIterations` fully honored** — the silent cap of 3 has been removed

---

## v0.9.0 — MCP Production Hardening

- **MCP client rewritten on `@modelcontextprotocol/sdk`** — smart auto-detection between stdio and HTTP-only containers, two-phase docker lifecycle — see [Orchestration](/features/orchestration)
- **Composable kernel architecture** — `react-kernel.ts` reduced from ~1,700 to ~197 lines via `makeKernel({ phases })` factory; phases are now individually swappable — see [Composable Kernel](/concepts/composable-kernel)
- **Permanently-failed required tools fix** — tools that always error no longer cause loop-until-maxIterations; framework detects and stops early — see [Harness Control Flow](/features/harness-control-flow)
- **Cortex MCP CRUD + JSON import** — import Cursor/Claude-style MCP configs directly into Cortex — see [Cortex](/features/cortex)
- **`effect` moved to `peerDependencies`** — add `effect` explicitly if you import from it directly — see [Installation](/guides/installation)

---

## v0.8.5 — Native FC Hardening + Web Framework Adapters

- **React, Vue, and Svelte adapters** — `useAgentStream()` and `useAgent()` hooks/composables/stores for all three frameworks, consuming SSE endpoints — see [Web Integration](/guides/web-integration) and [Streaming](/features/streaming)
- **7-hook provider adapter system** — `taskFraming`, `toolGuidance`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`, `continuationHint`, `systemPromptPatch` fully wired — see [Reactive Intelligence](/features/reactive-intelligence)
- **Dynamic stopping (3-layer)** — novelty signal (Jaccard overlap), budget exhaustion phase transition, and per-tool call cap (`maxCallsPerTool`) — see [Harness Control Flow](/features/harness-control-flow)
- **Full prompt observability** — `logModelIO: true` logs the complete FC conversation thread with no truncation — see [Observability](/features/observability)
- **Actionable failure messages** — loop detection, required-tools, and stall detection all emit `Fix:` suggestions with specific builder options — see [Troubleshooting](/guides/troubleshooting)

---

## v0.8.0 — Reactive Intelligence Layer

- **Entropy-aware intelligence pipeline** — 5-source composite entropy sensor, trajectory classifier, and reactive controller that takes corrective action automatically — see [Reactive Intelligence](/features/reactive-intelligence)
- **Thompson Sampling strategy learner** — SQLite-backed bandit learns which reasoning strategy wins per task category across runs — see [Reactive Intelligence](/features/reactive-intelligence)
- **Builder hardening** — `withStrictValidation()`, `withTimeout()`, `withRetryPolicy()`, `withFallbacks()`, `withHealthCheck()`, and `withErrorHandler()` — see [Builder API](/reference/builder-api)
- **Automatic strategy switching** — when entropy analysis detects a stuck loop, the agent switches reasoning strategy without user intervention — see [Choosing Strategies](/guides/choosing-strategies)
- **Observability dashboard upgrade** — chalk/boxen terminal UI with entropy grade (A–F), sparklines, and entropy-informed alerts — see [Observability](/features/observability)

---

## v0.5.0 — A2A Protocol + Observability Foundation

- **Full A2A (Agent-to-Agent) protocol** — JSON-RPC 2.0 server, streaming SSE, client, discovery, and capability matching based on Google's A2A spec — see [A2A Protocol](/features/a2a-protocol)
- **Agent-as-tool pattern** — wrap any local or remote A2A agent as a callable tool with `createAgentTool()` / `createRemoteAgentTool()` — see [Sub-agents](/guides/sub-agents)
- **Live observability streaming** — `withObservability({ live: true, verbosity })` writes structured phase logs to stdout as each step fires — see [Observability](/features/observability)
- **`rax serve`** — expose any agent as an A2A-compliant HTTP server with a single CLI command — see [CLI](/reference/cli)
- **EventBus reasoning events** — all 5 strategies publish `ReasoningStepCompleted`; subscribe with `agent.on()` for custom monitoring — see [Observability](/features/observability)
