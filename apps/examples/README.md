# Reactive Agents — Example Suite

21 runnable examples demonstrating every layer of the framework. Each example
exports a `run()` function for use with the test runner, and can also be run
standalone with `bun run`.

## Quick Start

```bash
# Run all offline examples (no API key needed):
cd apps/examples
bun run run-all.ts --offline

# Run a single example:
bun run src/foundations/01-simple-agent.ts

# Run a category:
bun run run-all.ts --filter trust

# Run all examples (requires ANTHROPIC_API_KEY):
ANTHROPIC_API_KEY=sk-ant-... bun run run-all.ts
```

## All Examples

| # | File | What It Shows | Key Builder Method | Offline? |
|---|------|--------------|-------------------|----------|
| 01 | [foundations/01-simple-agent](src/foundations/01-simple-agent.ts) | First agent, test mode | `.build()`, `.run()` | ✅ |
| 02 | [foundations/02-lifecycle-hooks](src/foundations/02-lifecycle-hooks.ts) | Execution phase hooks | `.withHook()` | ✅ |
| 03 | [foundations/03-multi-turn-memory](src/foundations/03-multi-turn-memory.ts) | Episodic memory, multi-turn | `.withMemory()` | ✅ |
| 04 | [foundations/04-agent-composition](src/foundations/04-agent-composition.ts) | Agent-as-tool delegation | `.withAgentTool()` | ✅ |
| 05 | [tools/05-builtin-tools](src/tools/05-builtin-tools.ts) | Built-in file/code tools | `.withTools()` | ✅ |
| 06 | [tools/06-mcp-filesystem](src/tools/06-mcp-filesystem.ts) | MCP stdio filesystem | `.withMCP([])` | ⚡ |
| 07 | [tools/07-mcp-github](src/tools/07-mcp-github.ts) | MCP GitHub server | `.withMCP([])` | ⚡ |
| 08 | [multi-agent/08-a2a-protocol](src/multi-agent/08-a2a-protocol.ts) | A2A JSON-RPC protocol | `generateAgentCard()` | ⚡ |
| 09 | [multi-agent/09-orchestration](src/multi-agent/09-orchestration.ts) | Workflow pipeline + approval | multi-agent sequencing | ⚡ |
| 10 | [multi-agent/10-dynamic-spawning](src/multi-agent/10-dynamic-spawning.ts) | Runtime sub-agent spawning | `.withDynamicSubAgents()` | ⚡ |
| 11 | [trust/11-identity](src/trust/11-identity.ts) | Ed25519 certs + RBAC | `makeCertificateAuth()` | ✅ |
| 12 | [trust/12-guardrails](src/trust/12-guardrails.ts) | Behavioral contracts + kill switch | `.withBehavioralContracts()` | ⚡ |
| 13 | [trust/13-verification](src/trust/13-verification.ts) | Fact-checking pipeline | `.withVerification()` | ⚡ |
| 14 | [advanced/14-cost-tracking](src/advanced/14-cost-tracking.ts) | Budget enforcement | `.withCostTracking()` | ⚡ |
| 15 | [advanced/15-prompt-experiments](src/advanced/15-prompt-experiments.ts) | A/B variant assignment | `ExperimentService` | ✅ |
| 16 | [advanced/16-eval-framework](src/advanced/16-eval-framework.ts) | LLM-as-judge evaluation | `EvalService` | ⚡ |
| 17 | [advanced/17-observability](src/advanced/17-observability.ts) | Live streaming + JSONL | `.withObservability()` | ⚡ |
| 18 | [advanced/18-self-improvement](src/advanced/18-self-improvement.ts) | Cross-task learning | `.withSelfImprovement()` | ⚡ |
| 19 | [reasoning/19-reasoning-strategies](src/reasoning/19-reasoning-strategies.ts) | 3 strategies compared | `.withReasoning()` | ⚡ |
| 20 | [reasoning/20-context-profiles](src/reasoning/20-context-profiles.ts) | Local vs frontier tiers | `.withContextProfile()` | ✅ |
| 21 | [interaction/21-interaction-modes](src/interaction/21-interaction-modes.ts) | Autonomy modes | `.withInteraction()` | ✅ |

✅ = offline (no API key) &nbsp; ⚡ = requires `ANTHROPIC_API_KEY`
