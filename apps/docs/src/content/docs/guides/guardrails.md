---
title: Guardrails
description: Keeping agents safe and compliant.
---

The guardrails layer provides input and output safety checks.

## Detection Layers

### Prompt Injection Detection

Detects attempts to override agent instructions:
- "Ignore previous instructions"
- System prompt injection
- Role reassignment ("You are now DAN")
- Jailbreak patterns

### PII Detection

Identifies personally identifiable information:
- Social Security Numbers
- Email addresses
- Credit card numbers
- API keys and secrets

### Toxicity Detection

Flags toxic, harmful, or inappropriate content using pattern matching and configurable blocklists.

### Agent Contracts

Define behavioral boundaries for agents:
- Required topics
- Forbidden topics
- Response format constraints

## Configuration

```typescript
const agent = await ReactiveAgents.create()
  .withGuardrails()  // Enable with defaults
  .build();
```

All detection layers are enabled by default. The guardrails check runs during the `guardrail` phase of the execution engine.

## Input vs Output Checks

- **Input checks**: Injection, PII, toxicity, and contract checks
- **Output checks**: PII, toxicity, and contract checks (no injection detection on outputs)

## Scoring

Each check returns a `GuardrailResult`:

```typescript
{
  passed: boolean;       // true if no violations
  violations: Array<{
    type: string;        // "injection" | "pii" | "toxicity" | "contract"
    severity: string;    // "low" | "medium" | "high" | "critical"
    message: string;
    details?: string;
  }>;
  score: number;         // 0.0 to 1.0 (1.0 = fully safe)
  checkedAt: Date;
}
```
