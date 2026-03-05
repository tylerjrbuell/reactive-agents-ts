---
name: multi-agent-orchestration
description: Design and implement reliable multi-agent workflows using sequential, parallel, pipeline, and map-reduce execution patterns.
compatibility: Reactive Agents projects using orchestration and agent-as-tool patterns.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Multi-Agent Orchestration

Use this skill for complex tasks that benefit from decomposition and specialization.

## Agent objective

When building orchestrated systems, produce implementations that:

- Decompose tasks by dependency and specialization boundaries.
- Use topology choices (sequential/parallel/pipeline/map-reduce) intentionally.
- Resolve aggregation conflicts deterministically.

## What this skill does

- Splits work into specialized agent roles.
- Chooses orchestration topology by dependency shape.
- Aggregates outputs with verification and rollback rules.

## Workflow

1. Partition task into independent and dependent steps.
2. Assign each step to a specialist agent/tool chain.
3. Use parallel execution for independent branches.
4. Use pipeline/sequential mode for ordered dependencies.
5. Verify merged output and resolve conflicts deterministically.

## Code Examples

### Sequential Workflow with Multiple Agents

This example demonstrates a multi-agent workflow where tasks are executed in a sequence. The workflow consists of three specialized agents: a researcher, a writer, and a reviewer.

1.  **Researcher**: Gathers information on a topic.
2.  **Writer**: Uses the researcher's output to draft a summary.
3.  **Reviewer**: Checks the writer's draft for quality and accuracy.

The example manually orchestrates the flow by iterating through a series of steps, passing the output of one step as the input to the next. This pattern is useful for simple, linear workflows. The `@reactive-agents/orchestration` package provides a `WorkflowEngine` for more complex scenarios, including parallel execution and dependency management.

*Source: [apps/examples/src/multi-agent/09-orchestration.ts](apps/examples/src/multi-agent/09-orchestration.ts)*

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// Build worker agents (researcher, writer, reviewer)
const researchAgent = await ReactiveAgents.create().withName("researcher").build();
const writerAgent = await ReactiveAgents.create().withName("writer").build();
const reviewerAgent = await ReactiveAgents.create().withName("reviewer").build();

// Define workflow steps
const steps = [
  { id: "research", name: "Research", task: "Research the topic: AI safety", agent: researchAgent },
  { id: "draft",    name: "Draft",    task: "Draft a 1-paragraph summary of this research", agent: writerAgent, dependsOn: "research" },
  { id: "review",   name: "Review",   task: "Review this draft for quality and accuracy", agent: reviewerAgent, dependsOn: "draft" },
];

// Execute workflow sequentially
let contextFromPrevious = "";
for (const step of steps) {
  const taskInput = contextFromPrevious
    ? `${step.task}\n\nContext from previous step: ${contextFromPrevious}`
    : step.task;

  const result = await step.agent.run(taskInput);
  contextFromPrevious = result.output;
  console.log(`[${step.name}] ${result.output}`);
}
```

## Expected implementation output

- Orchestration setup with explicit workflow topology.
- Specialist role definitions with narrow responsibilities.
- Merge/verification logic handling contradictory sub-agent outputs.

## Pitfalls to avoid

- Parallelizing steps that require strict ordering.
- No timeout/cancellation policy for sub-agents.
- No aggregation validation for contradictory results.
