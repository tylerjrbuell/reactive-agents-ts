---
name: identity-and-guardrails
description: Enable prompt injection detection, PII masking, behavioral contracts, kill switch controls, and agent identity for safe production deployments.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Identity and Guardrails

## Agent objective

Produce a builder with guardrails, behavioral contracts, and safety controls correctly configured so the agent operates within defined bounds and can be stopped when needed.

## When to load this skill

- Deploying an agent in a multi-tenant or public-facing context
- Restricting which tools an agent can call or which topics it can address
- Requiring human approval before certain tool calls
- Needing runtime pause/resume/stop controls
- Enforcing token/iteration/output-length budgets at the contract level

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ allowedTools: ["web-search", "http-get", "file-read", "checkpoint"] })
  .withGuardrails({
    injection: true,     // detect prompt injection attempts
    pii: true,           // detect and mask PII in inputs/outputs
    toxicity: true,      // detect toxic content
  })
  .withBehavioralContracts({
    deniedTools: ["file-write", "shell-execute"],
    maxToolCalls: 30,
    maxIterations: 20,
    requireDisclosure: true,   // agent must disclose it is an AI
  })
  .withKillSwitch()   // enables pause/resume/stop/terminate controls
  .withIdentity()     // enables identity and session tracking
  .withAudit()        // records all tool calls and decisions to audit log
  .build();
```

## Key patterns

### Guardrails

```ts
.withGuardrails()
// Enables all detectors with defaults: injection=true, pii=true, toxicity=true

.withGuardrails({
  injection: true,           // detect "ignore previous instructions" attacks
  pii: false,                // disable PII masking (e.g., agent legitimately processes PII)
  toxicity: true,
  customBlocklist: ["competitor-product", "internal-codename"],  // substring blocklist
})
```

Guardrail violations abort the turn and return a structured error — the agent never processes the blocked content.

### Behavioral contracts

Full field reference for `.withBehavioralContracts(contract)`:

```ts
.withBehavioralContracts({
  deniedTools: ["file-delete", "shell-execute"],    // tools the agent may NEVER call
  allowedTools: ["web-search", "file-read"],        // if set, ONLY these tools are allowed
  maxToolCalls: 50,                                  // hard stop after N total tool calls
  maxIterations: 20,                                 // hard stop after N reasoning iterations
  maxOutputLength: 4000,                             // truncate/block output over N chars
  deniedTopics: ["competitor names", "legal advice"], // topics agent must refuse
  requireDisclosure: true,                           // first response must disclose AI identity
})
```

Contract violations are enforced at runtime — violations halt the current turn with a `ContractViolation` error.

### Kill switch (runtime control)

```ts
.withKillSwitch()
// Enables runtime controls on the built agent handle:

const handle = agent.run("Do a long task...");

// Graceful pause (waits for current phase to finish)
await handle.pause();

// Resume from paused state
await handle.resume();

// Graceful stop (finishes current phase, then stops)
await handle.stop("User requested cancellation");

// Immediate termination
await handle.terminate("Emergency shutdown");
```

Kill switch controls are no-ops if `.withKillSwitch()` was not called during build.

### Identity and audit

```ts
.withIdentity()   // enables agent identity headers, session IDs, and persona tracking
.withAudit()      // records all tool calls, guardrail decisions, and contract checks to an audit trail
```

Identity and audit work independently — enable both for full traceability.

## GuardrailsOptions reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `injection` | `boolean` | `true` | Prompt injection detection |
| `pii` | `boolean` | `true` | PII detection and masking |
| `toxicity` | `boolean` | `true` | Toxic content detection |
| `customBlocklist` | `string[]` | `[]` | Case-insensitive substring blocklist |

## BehavioralContract reference

| Field | Type | Notes |
|-------|------|-------|
| `deniedTools` | `string[]` | Tools that may never be called |
| `allowedTools` | `string[]` | If set, only these tools are allowed |
| `maxToolCalls` | `number` | Hard stop after N total tool calls |
| `maxIterations` | `number` | Hard stop after N reasoning iterations |
| `maxOutputLength` | `number` | Max output characters before truncation |
| `deniedTopics` | `string[]` | Topics the agent must refuse |
| `requireDisclosure` | `boolean` | Agent must disclose AI identity |

## Pitfalls

- `.withGuardrails()` with no args enables ALL detectors — disable selectively if your use case legitimately handles PII
- `deniedTools` in a contract and `allowedTools` in `.withTools()` are independent — a tool can be in `.withTools({ allowedTools })` but still blocked by a contract's `deniedTools`
- Kill switch controls (`pause`, `resume`, `stop`, `terminate`) are no-ops without `.withKillSwitch()` — no error is thrown, calls are silently ignored
- `requireDisclosure` enforces the agent states it is AI in its first response — this is a prompt-level enforcement, not cryptographic
- Contract violations raise `ContractViolation` errors — handle these in your error callback or the agent run will throw
- `.withAudit()` without a log destination writes to the observability stream — add `.withObservability()` to capture audit events
