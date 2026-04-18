---
title: "Working with Sub-Agents"
description: "Delegate tasks to specialized sub-agents with persona control and context forwarding"
---

## Overview

Sub-agents allow a parent agent to delegate subtasks to specialized child agents. Rather than handling every step itself, a parent agent can spawn a focused child agent with its own tools, persona, and iteration budget.

Two delegation modes exist:

- **Static sub-agents** — configured at build time via `.withAgentTool()`. The sub-agent is always available as a named tool.
- **Dynamic sub-agents** — spawned at runtime via the `spawn-agent` tool. The parent LLM decides when to spawn and what configuration to use.

Both modes run fully within the parent's execution context. The child agent executes, produces a result, and that result is returned to the parent as a tool call observation.

---

## Static vs Dynamic Sub-Agents

### Static Sub-Agents (build-time)

Register a sub-agent as a named tool when its purpose is known at build time:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withAgentTool("data-analyst", {
    name: "Data Analyst",
    description: "Analyzes data and produces summaries",
    provider: "anthropic",
    maxIterations: 5,
    tools: ["file-read", "web-search"],
    persona: { role: "Data Analyst", instructions: "Focus on statistical patterns" },
  })
  .build();
```

The parent LLM can call `data-analyst` as a tool, passing a task description. The sub-agent executes with the configured tools and persona, then returns its result.

Use static sub-agents when:
- The sub-agent's purpose is fixed and known at build time
- You want consistent, optimized behavior for a specific task type
- You need tight control over which tools the sub-agent can access

### Dynamic Sub-Agents (runtime via `spawn-agent`)

Enable the `spawn-agent` tool to let the parent LLM create specialized agents on demand:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withDynamicSubAgents()  // enables spawn-agent tool
  .build();
// Parent LLM decides to spawn and configures at runtime
```

The parent LLM generates the sub-agent's configuration (tools, persona, task) dynamically based on what the current task requires. This is useful when the type of sub-agent needed cannot be known in advance.

Use dynamic sub-agents when:
- The sub-agent's purpose depends on runtime task content
- The parent needs to create differently-specialized agents for different subtasks
- You want the parent to have full flexibility in delegation

### Decision Tree

| Question | Answer | Mode |
|---|---|---|
| Is the sub-agent's purpose known at build time? | Yes | Static (`.withAgentTool()`) |
| Does the parent need to create agents dynamically? | Yes | Dynamic (`.withDynamicSubAgents()`) |
| Do you need consistent, repeatable sub-agent behavior? | Yes | Static |
| Does the sub-agent's role depend on the task at hand? | Yes | Dynamic |

---

## Context Forwarding — What Is Forwarded

When a parent delegates to a sub-agent, the framework automatically forwards context to help the child agent understand the broader task:

- **Parent tool results** — extracted from the parent's recent tool results / working context (agents persist notes via the **`recall`** meta-tool)
- **Parent working memory** — recent entries from the parent's working memory store
- **Combined prefix** — the above is composed into a `systemPrompt` prefix injected into the sub-agent, capped at 2000 characters (truncated oldest-first when over limit)

For the `spawn-agent` tool, the parent LLM can also pass:

- `tools` — a whitelist of tool names the sub-agent is allowed to use
- `role`, `instructions`, `tone` — persona steering applied to the spawned agent

Implementation reference: `buildParentContextPrefix()`, `MAX_PARENT_CONTEXT_CHARS = 2000`, and `ALWAYS_INCLUDE_TOOLS` in `packages/tools/src/adapters/agent-tool-adapter.ts`.

---

## Context Forwarding — Known Limitations

The current context forwarding mechanism has constraints to be aware of when designing sub-agent workflows:

- **2000 character cap** — forwarded context exceeding 2000 characters is truncated. Oldest entries are dropped first.
- **No full parent thread** — sub-agents receive extracted tool results and a short forwarded slice, not the parent's full message history or everything stored through **`recall`**.
- **No memory inheritance** — sub-agents start with fresh memory. They do not inherit the parent's episodic or semantic memory stores.
- **Sub-agents re-fetch data** — if the parent fetched a URL or file, the sub-agent will re-fetch that resource unless the data is explicitly included in the forwarded context.

---

## Workarounds for Context Limitations

When context forwarding falls short, use these patterns:

- **Embed context in instructions** — pass critical data directly in the `instructions` field of `spawn-agent`. The parent LLM can summarize key findings inline before delegating.
- **Keep sub-agent tasks narrow** — design sub-agents for single-purpose tasks that do not require parent history. The less context a sub-agent needs, the less forwarding matters.
- **Use the `tools` whitelist** — constrain the sub-agent to only the tools it needs. This reduces token usage and prevents the sub-agent from taking actions outside its scope.
- **Summarize before delegating** — instruct the parent agent (via system prompt or persona) to produce a concise summary of relevant findings in its thought step before spawning a sub-agent.

---

## Persona Control

Personas give sub-agents a defined role, background, and behavioral style. This is especially useful for specialized sub-agents where you want consistent behavior.

### Static Persona

Configure a persona at build time with `.withAgentTool()`:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withAgentTool("security-auditor", {
    name: "Security Auditor",
    description: "Reviews code for security vulnerabilities",
    provider: "anthropic",
    maxIterations: 6,
    tools: ["file-read"],
    persona: {
      role: "Security Auditor",
      background: "Expert in OWASP top 10 and common injection vulnerabilities",
      instructions: "Flag any potential injection vulnerabilities. Be thorough and cite specific lines.",
      tone: "formal",
    },
  })
  .build();
```

### Dynamic Persona via `spawn-agent`

When using dynamic sub-agents, the parent LLM generates persona parameters at runtime based on the task:

| Parameter | Description | Example value |
|---|---|---|
| `role` | The sub-agent's functional role | `"Data Analyst"`, `"Code Reviewer"` |
| `instructions` | Task-specific guidance for this invocation | `"Summarize the error patterns in this log"` |
| `tone` | Behavioral style | `"formal"`, `"concise"`, `"detailed"` |
| `background` | Domain expertise context | `"Expert in distributed systems"` |

The parent LLM selects these values based on the subtask it is delegating. For example, a research agent might spawn a `"Citation Verifier"` sub-agent with instructions specific to the sources it found.

---

## Performance Considerations

Sub-agent delegation adds overhead. Understand the costs before adopting this pattern:

- **Delegation overhead** — delegate mode runs approximately 4x more expensive than a solo agent for simple tasks. Each delegation involves additional LLM calls for spawning and a full sub-agent execution cycle.
- **Small model limitations** — models smaller than ~8B parameters often struggle with sub-agent tasks. They tend to hallucinate results or fail tool calls when operating as a sub-agent. Use capable models (7B+ instruction-tuned, or hosted providers) for sub-agent roles.
- **`maxIterations` for sub-agents** — defaults to `3` when not set; the configured value is fully honored with no internal cap. Recommended range is 3–7: sub-agent tasks should be narrow and focused. A high iteration count on a sub-agent signals the task scope is too broad.
- **When not to use sub-agents**:
  - Single-step lookups (one tool call is sufficient)
  - Tasks where the parent already has all required context
  - Cost-sensitive scenarios where the 4x overhead is not justified
  - Simple transformations or calculations that a tool handles directly
