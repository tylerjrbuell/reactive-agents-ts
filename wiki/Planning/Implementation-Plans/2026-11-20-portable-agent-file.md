---
type: plan
status: active
created: 2026-11-20
tags: [plan, agent-config, portability, cli, cortex, open-standard]
---

# Portable agent file (Open Agent Spec)

**Goal:** one file describes an agent, and it runs the same in code, `rax` and Cortex. An agent designed in the Cortex Lab can run from the terminal, CI or a server without exporting TypeScript.

**Issue:** #299. **Source:** 2026-11-20 sweep, item B (score 27), in `wiki/Planning/Recommended-Enhancements.md`. Owner go-ahead on 2026-11-20: start it, version the file, and align with an open agent standard.

## Format decision

The agent file is an **Open Agent Spec** document (Oracle, `oracle/agent-spec`, language spec 26.1.2). It is the most mature open, declarative and framework-neutral agent format. It has a versioned spec (`agentspec_version`, YEAR.QUARTER.PATCH), JSON and YAML forms, adapters for several runtimes (WayFlow, LangGraph, AutoGen, CrewAI), and a rule that files carry no executable code and no inline secrets. Both rules match ours.

Alternatives considered:
- **Letta Agent File (`.af`)** serializes agent *state* (memory blocks, message history) for one runtime's model. It is the wrong shape for configuration.
- **Agent Definition Language (ADL)** is an individual IETF draft (`draft-nederveld-adl-01`, Feb 2026) and early.
- **A2A Agent Card** describes discovery, not construction; `packages/a2a` already covers it.
- **AGENTS.md and Agent Skills** cover instructions and skills, not agents.

### Mapping

The root component is an Agent Spec `Agent`. Portable fields live in standard places, so other Agent Spec runtimes can read the core agent. Reactive Agents-only settings live under `metadata["reactive-agents"]`, which the spec allows.

| AgentConfig | Agent Spec |
|---|---|
| `name`, `agentId` | `name`, `id` |
| `systemPrompt` (+ persona text) | `system_prompt` |
| `provider`, `model`, temperature, max tokens | `llm_config`: `OllamaConfig` (`url`) / `OpenAiConfig` / `GeminiConfig` / base `LlmConfig` with `provider` for the rest; `default_generation_parameters` |
| API keys | never written. They are a sensitive-field reference that the loader resolves from the environment (later from the shared key store, sweep item C) |
| `mcpServers` | `toolboxes`: `MCPToolBox` with `StdioTransport` / `StreamableHTTPTransport` / `SSETransport`; `env` and `headers` values become `sensitive_headers` / env references |
| tools defined in code (`defineTool`, Cortex host tools) | `ServerTool` declaration (name, description, inputs), no code. The loader must be given an implementation or it fails with a clear error naming the missing tools |
| approval policy | `human_in_the_loop` (coarse) plus the exact policy in metadata |
| everything else (reasoning strategy, memory, guardrails, cost, execution, RI, verification, gateway...) | `metadata["reactive-agents"] = { schemaVersion: 1, config: <AgentConfig minus the fields mapped above> }` |

Rules:
- On import, standard fields win. Metadata carries only fields with no standard home, so there is one source of truth per field.
- `schemaVersion` versions our metadata block. `agentspec_version` versions the document. The loader refuses an unknown major version with a clear error.
- Import supports an `Agent` root only. A `Flow` root (or another component type) fails with "not supported yet" and is never dropped silently.
- A plain `AgentConfig` JSON (today's `agentConfigToJSON`) still loads, so existing files keep working.

## Tasks

0. **Spike (zero-token).** Confirm canonical field names from the `oracle/agent-spec` source (pyagentspec `Agent`, `LlmConfig`, `MCPToolBox`, transports). The spec page shows `llm_config` vs `llm_configuration` and `type` vs `component_type` inconsistently. Hand-write two fixture documents (Ollama + stdio MCP; Anthropic + HTTP MCP + a code tool) and, if pyagentspec installs, load them with it. Record the field names here.
1. **Framework (runtime-warden).** In `packages/runtime`: `agentConfigToAgentSpec(config)` and `agentConfigFromAgentSpec(doc)` (pure, Effect-typed errors), plus `loadAgentFile(path)`, which accepts Agent Spec JSON/YAML or plain AgentConfig JSON. Round-trip tests: AgentConfig to Agent Spec and back is identity for every mapped field. Add a fixture loaded by a reference Agent Spec reader if task 0 got one. Docs page and changeset.
2. **CLI (dx-warden).** `rax run --agent <file> "<task>"` and `rax serve --agent <file>`. Flags (`--provider`, `--model`, `--tools`...) override the file. Missing code tools fail with their names. Update `cli.md`.
3. **Cortex (cortex-warden).** Make Lab "Export → JSON" write the Agent Spec document from `cortexParamsToAgentConfig`, showing the same "not in file" list the code export shows. Lab import accepts an Agent Spec document or AgentConfig JSON, and the old Lab envelope keeps loading. Round-trip test: Cortex params to file to Cortex params.
4. **Proof.** An end-to-end test runs one file through the builder, `rax run --agent` (test provider) and the Cortex import/export, with the same AgentConfig at each step.

## Out of scope

- Agent Spec `Flow` import and export (multi-step workflows). Revisit once agents travel.
- Shipping code tools inside the file. The spec forbids executable code.
- The shared provider-key store (sweep item C, its own work).

## Risks

- Agent Spec is young and changes by quarter. Pin `agentspec_version` "26.1.2", keep the mapping in one module, and pin it with fixtures.
- Lossy mapping for providers with no dedicated config: the base `LlmConfig` with `provider` covers them, and metadata keeps the exact `provider` string.
