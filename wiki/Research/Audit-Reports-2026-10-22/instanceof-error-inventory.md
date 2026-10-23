---
type: inventory
status: shipped
created: 2026-10-22
tags: [audit, error-algebra, phase-2, gate]
---

# instanceof-error inventory (2026-10-22)

Companion artifact for quality-program Task 3. Metric = exactly what
`scripts/check-string-errors.sh` scans: occurrences of
`instanceof (Error|[A-Za-z]*Error)` under `packages/**/src`, excluding
`*.test.ts` / `*.spec.ts` / node_modules / dist.

**129 occurrences / 128 lines** (one line carries two matches). Pinned as
`INSTANCEOF_BASELINE=129`; the gate FAILS on growth and on shrink without a
deliberate ledger edit (same law as the string-throw counter above it).

## Why this list exists (Phase-2 blast radius)

Each site depends on rejection **identity** (`instanceof`), which
`Data.TaggedError` instances do not satisfy by default. Before D3 converts
nearby throws to typed errors, each site is classified: framework-internal
catch paths may flip to `_tag` dispatch freely; sites on public rejection
paths are what the Promise-to-Effect facade migration must carry deliberately.
No site is retired from this list without an audit line in its PR.

## Per-file distribution (worst first)

```
      9 packages/tools/src/mcp/mcp-client.ts
      7 packages/judgment/src/backends/jev-backend.ts
      6 packages/runtime/src/errors.ts
      5 packages/tools/src/define-tool.ts
      4 packages/tools/src/skills/file-operations.ts
      4 packages/reasoning/src/kernel/loop/iterate-pass.ts
      4 packages/reasoning/src/kernel/capabilities/act/tool-execution.ts
      4 packages/judgment/src/backends/systemone/engine.ts
      4 packages/benchmarks/src/runner.ts
      3 packages/tools/src/skills/code-execution.ts
      2 packages/vue/src/use-structured-object.ts
      2 packages/vue/src/use-agent-stream.ts
      2 packages/ui-core/src/stream/connect.ts
      2 packages/tools/src/skills/relate.ts
      2 packages/tools/src/execution/docker-sandbox.ts
      2 packages/tools/src/adapters/agent-tool-adapter.ts
      2 packages/runtime/src/reactive-agent.ts
      2 packages/runtime/src/engine/finalize/extract-object.ts
      2 packages/reasoning/src/structured-output/pipeline.ts
      2 packages/reasoning/src/structured-output/grounded/grounded-extract.ts
      2 packages/reasoning/src/strategies/plan-execute.ts
      2 packages/reasoning/src/strategies/code-action/sandbox.ts
      2 packages/create-reactive-agent/src/cli.ts
      2 packages/core/src/services/error-swallowed.ts
      2 packages/benchmarks/src/tau-bench/adapter.ts
      1 packages/vue/src/use-agent.ts
      1 packages/ui-core/src/interaction/controller.ts
      1 packages/tools/src/tool-service.ts
      1 packages/tools/src/skills/web-search.ts
      1 packages/tools/src/skills/shell-execution.ts
      1 packages/tools/src/skills/grep.ts
      1 packages/tools/src/skills/cli/gws-cli.ts
      1 packages/tools/src/skills/cli/git-cli.ts
      1 packages/tools/src/skills/cli/gh-cli.ts
      1 packages/tools/src/skills/activate-skill.ts
      1 packages/tools/src/mcp/registry/docker-hub.ts
      1 packages/tools/src/errors.ts
      1 packages/tools/src/define-tool-simple.ts
      1 packages/svelte/src/run.ts
      1 packages/svelte/src/interactions.ts
      1 packages/runtime/src/server/journal.ts
      1 packages/runtime/src/gateway-context-formatting.ts
      1 packages/runtime/src/execution-engine.ts
      1 packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts
      1 packages/runtime/src/engine/finalize/debrief-synthesis.ts
      1 packages/runtime/src/create-agent.ts
      1 packages/runtime/src/builder/api-surface.ts
      1 packages/runtime/src/agent-stream.ts
      1 packages/runtime/src/agent/run-task-effect.ts
      1 packages/runtime/src/agent/gateway-tick.ts
      1 packages/runtime/src/agent/gateway-bootstrap.ts
      1 packages/runtime/src/agent/execute-event.ts
      1 packages/reasoning/src/strategies/plan-execute/step-executor.ts
      1 packages/reasoning/src/strategies/code-action/sandbox-worker.ts
      1 packages/reasoning/src/kernel/utils/tool-parsing.ts
      1 packages/reasoning/src/kernel/state/kernel-codec.ts
      1 packages/reasoning/src/kernel/capabilities/act/tool-observe.ts
      1 packages/reasoning/src/errors/errors.ts
      1 packages/react/src/hooks/use-task-inbox.ts
      1 packages/react/src/hooks/use-run.ts
      1 packages/reactive-intelligence/src/learning/learning-engine.ts
      1 packages/observability/src/logging/structured-logger.ts
      1 packages/observability/src/logging/logger-service.ts
      1 packages/judgment/src/backends/llm-backend.ts
      1 packages/eval/src/services/eval-service.ts
      1 packages/benchmarks/src/tasks/graded-check.ts
      1 packages/benchmarks/src/replay-lane.ts
      1 packages/benchmarks/src/judge.ts
      1 packages/benchmarks/src/competitors/vercel-ai-runner.ts
      1 packages/benchmarks/src/competitors/openai-agents-runner.ts
      1 packages/benchmarks/src/competitors/mastra-runner.ts
      1 packages/benchmarks/src/competitors/llamaindex-runner.ts
      1 packages/benchmarks/src/competitors/langchain-runner.ts
      1 packages/benchmarks/src/ci.ts
```

## Full site list (file : line : match)

```
packages/benchmarks/src/ci.ts:125:instanceof Error
packages/benchmarks/src/competitors/langchain-runner.ts:89:instanceof Error
packages/benchmarks/src/competitors/llamaindex-runner.ts:71:instanceof Error
packages/benchmarks/src/competitors/mastra-runner.ts:69:instanceof Error
packages/benchmarks/src/competitors/openai-agents-runner.ts:63:instanceof Error
packages/benchmarks/src/competitors/vercel-ai-runner.ts:54:instanceof Error
packages/benchmarks/src/judge.ts:318:instanceof Error
packages/benchmarks/src/replay-lane.ts:144:instanceof Error
packages/benchmarks/src/runner.ts:1584:instanceof Error
packages/benchmarks/src/runner.ts:258:instanceof Error
packages/benchmarks/src/runner.ts:285:instanceof Error
packages/benchmarks/src/runner.ts:957:instanceof Error
packages/benchmarks/src/tasks/graded-check.ts:46:instanceof Error
packages/benchmarks/src/tau-bench/adapter.ts:326:instanceof Error
packages/benchmarks/src/tau-bench/adapter.ts:450:instanceof Error
packages/core/src/services/error-swallowed.ts:157:instanceof Error
packages/core/src/services/error-swallowed.ts:97:instanceof Error
packages/create-reactive-agent/src/cli.ts:219:instanceof Error
packages/create-reactive-agent/src/cli.ts:226:instanceof Error
packages/eval/src/services/eval-service.ts:323:instanceof BenchmarkError
packages/judgment/src/backends/jev-backend.ts:24:instanceof AuthenticationError
packages/judgment/src/backends/jev-backend.ts:27:instanceof RateLimitError
packages/judgment/src/backends/jev-backend.ts:30:instanceof APITimeoutError
packages/judgment/src/backends/jev-backend.ts:33:instanceof APIConnectionError
packages/judgment/src/backends/jev-backend.ts:36:instanceof APIError
packages/judgment/src/backends/jev-backend.ts:39:instanceof Error
packages/judgment/src/backends/jev-backend.ts:89:instanceof Error
packages/judgment/src/backends/llm-backend.ts:157:instanceof Error
packages/judgment/src/backends/systemone/engine.ts:315:instanceof Error
packages/judgment/src/backends/systemone/engine.ts:330:instanceof Error
packages/judgment/src/backends/systemone/engine.ts:77:instanceof Error
packages/judgment/src/backends/systemone/engine.ts:86:instanceof Error
packages/observability/src/logging/logger-service.ts:99:instanceof Error
packages/observability/src/logging/structured-logger.ts:134:instanceof Error
packages/reactive-intelligence/src/learning/learning-engine.ts:184:instanceof Error
packages/react/src/hooks/use-run.ts:44:instanceof Error
packages/react/src/hooks/use-task-inbox.ts:33:instanceof Error
packages/reasoning/src/errors/errors.ts:44:instanceof KernelCodecError
packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:342:instanceof Error
packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:650:instanceof Error
packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:822:instanceof Error
packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:824:instanceof ToolNotFoundError
packages/reasoning/src/kernel/capabilities/act/tool-observe.ts:219:instanceof Error
packages/reasoning/src/kernel/loop/iterate-pass.ts:462:instanceof Error
packages/reasoning/src/kernel/loop/iterate-pass.ts:470:instanceof Error
packages/reasoning/src/kernel/loop/iterate-pass.ts:885:instanceof Error
packages/reasoning/src/kernel/loop/iterate-pass.ts:918:instanceof Error
packages/reasoning/src/kernel/state/kernel-codec.ts:211:instanceof Error
packages/reasoning/src/kernel/utils/tool-parsing.ts:83:instanceof Error
packages/reasoning/src/strategies/code-action/sandbox.ts:124:instanceof Error
packages/reasoning/src/strategies/code-action/sandbox.ts:147:instanceof Error
packages/reasoning/src/strategies/code-action/sandbox-worker.ts:103:instanceof Error
packages/reasoning/src/strategies/plan-execute/step-executor.ts:443:instanceof ExecutionError
packages/reasoning/src/strategies/plan-execute.ts:580:instanceof Error
packages/reasoning/src/strategies/plan-execute.ts:885:instanceof Error
packages/reasoning/src/structured-output/grounded/grounded-extract.ts:155:instanceof Error
packages/reasoning/src/structured-output/grounded/grounded-extract.ts:192:instanceof Error
packages/reasoning/src/structured-output/pipeline.ts:249:instanceof Error
packages/reasoning/src/structured-output/pipeline.ts:321:instanceof Error
packages/runtime/src/agent/execute-event.ts:154:instanceof Error
packages/runtime/src/agent/gateway-bootstrap.ts:248:instanceof Error
packages/runtime/src/agent/gateway-tick.ts:192:instanceof Error
packages/runtime/src/agent/run-task-effect.ts:559:instanceof Error
packages/runtime/src/agent-stream.ts:11:instanceof AgentStreamCollectError
packages/runtime/src/builder/api-surface.ts:70:instanceof Error
packages/runtime/src/create-agent.ts:89:instanceof Error
packages/runtime/src/engine/finalize/debrief-synthesis.ts:321:instanceof Error
packages/runtime/src/engine/finalize/extract-object.ts:57:instanceof Error
packages/runtime/src/engine/finalize/extract-object.ts:61:instanceof Error
packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:262:instanceof Error
packages/runtime/src/errors.ts:277:instanceof Error
packages/runtime/src/errors.ts:295:instanceof Error
packages/runtime/src/errors.ts:306:instanceof Error
packages/runtime/src/errors.ts:409:instanceof Error
packages/runtime/src/errors.ts:483:instanceof Error
packages/runtime/src/errors.ts:505:instanceof Error
packages/runtime/src/execution-engine.ts:1827:instanceof Error
packages/runtime/src/gateway-context-formatting.ts:229:instanceof Error
packages/runtime/src/reactive-agent.ts:1242:instanceof Error
packages/runtime/src/reactive-agent.ts:923:instanceof Error
packages/runtime/src/server/journal.ts:114:instanceof Error
packages/svelte/src/interactions.ts:28:instanceof Error
packages/svelte/src/run.ts:42:instanceof Error
packages/tools/src/adapters/agent-tool-adapter.ts:516:instanceof Error
packages/tools/src/adapters/agent-tool-adapter.ts:785:instanceof Error
packages/tools/src/define-tool-simple.ts:98:instanceof Error
packages/tools/src/define-tool.ts:394:instanceof Error
packages/tools/src/define-tool.ts:443:instanceof Error
packages/tools/src/define-tool.ts:492:instanceof Error
packages/tools/src/define-tool.ts:506:instanceof ToolExecutionError
packages/tools/src/define-tool.ts:509:instanceof Error
packages/tools/src/errors.ts:33:instanceof Error
packages/tools/src/execution/docker-sandbox.ts:384:instanceof Error
packages/tools/src/execution/docker-sandbox.ts:456:instanceof Error
packages/tools/src/mcp/mcp-client.ts:1030:instanceof Error
packages/tools/src/mcp/mcp-client.ts:1067:instanceof MCPConnectionError
packages/tools/src/mcp/mcp-client.ts:1068:instanceof Error
packages/tools/src/mcp/mcp-client.ts:1093:instanceof Error
packages/tools/src/mcp/mcp-client.ts:737:instanceof Error
packages/tools/src/mcp/mcp-client.ts:745:instanceof Error
packages/tools/src/mcp/mcp-client.ts:878:instanceof Error
packages/tools/src/mcp/mcp-client.ts:947:instanceof UnauthorizedError
packages/tools/src/mcp/mcp-client.ts:987:instanceof Error
packages/tools/src/mcp/registry/docker-hub.ts:103:instanceof Error
packages/tools/src/skills/activate-skill.ts:102:instanceof Error
packages/tools/src/skills/cli/gh-cli.ts:70:instanceof Error
packages/tools/src/skills/cli/git-cli.ts:69:instanceof Error
packages/tools/src/skills/cli/gws-cli.ts:73:instanceof Error
packages/tools/src/skills/code-execution.ts:202:instanceof Error
packages/tools/src/skills/code-execution.ts:224:instanceof Error
packages/tools/src/skills/code-execution.ts:245:instanceof Error
packages/tools/src/skills/file-operations.ts:167:instanceof Error
packages/tools/src/skills/file-operations.ts:181:instanceof Error
packages/tools/src/skills/file-operations.ts:249:instanceof Error
packages/tools/src/skills/file-operations.ts:418:instanceof Error
packages/tools/src/skills/grep.ts:123:instanceof Error
packages/tools/src/skills/relate.ts:167:instanceof Error
packages/tools/src/skills/relate.ts:187:instanceof Error
packages/tools/src/skills/shell-execution.ts:1048:instanceof Error
packages/tools/src/skills/web-search.ts:29:instanceof Error
packages/tools/src/tool-service.ts:554:instanceof Error
packages/ui-core/src/interaction/controller.ts:25:instanceof Error
packages/ui-core/src/stream/connect.ts:111:instanceof Error
packages/ui-core/src/stream/connect.ts:117:instanceof Error
packages/vue/src/use-agent-stream.ts:90:instanceof Error
packages/vue/src/use-agent-stream.ts:91:instanceof Error
packages/vue/src/use-agent.ts:28:instanceof Error
packages/vue/src/use-structured-object.ts:97:instanceof Error
packages/vue/src/use-structured-object.ts:98:instanceof Error
```
