---
title: Identity & RBAC
description: Agent authentication, role-based access control, certificates, and delegation.
sidebar:
  order: 4
---

The identity layer provides authentication, authorization, and audit capabilities for agents. Control what each agent can access, delegate permissions between agents, and maintain a full audit trail.

## Quick Start

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withIdentity()   // Enable RBAC + certificates
  .build();
```

## Certificates

Every agent can have a cryptographic certificate for authentication:

```typescript
import { IdentityService } from "@reactive-agents/identity";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const identity = yield* IdentityService;

  // Issue a certificate
  const cert = yield* identity.issueCertificate("agent-1", 86400_000); // 24h TTL

  // Authenticate with it
  const auth = yield* identity.authenticate(cert);
  console.log(auth.authenticated); // true
  console.log(auth.expiresAt);     // Date

  // Rotate (invalidates old cert, issues new one)
  const newCert = yield* identity.rotateCertificate("agent-1");
});
```

### Certificate Fields

```typescript
{
  serialNumber: "unique-id",
  agentId: "agent-1",
  issuedAt: Date,
  expiresAt: Date,
  publicKey: "base64-encoded",
  issuer: "reactive-agents",
  fingerprint: "sha256-hash",
  status: "active",  // "active" | "expired" | "revoked"
}
```

## Role-Based Access Control

Assign roles to control what agents can do:

### Pre-defined Roles

| Role | Tools | Memory | LLM Tiers | Admin |
|------|:---:|:---:|:---:|:---:|
| `agent-basic` | Basic only | Working only | Haiku | No |
| `agent-standard` | All | All | Haiku + Sonnet | No |
| `agent-privileged` | All | All | All | Yes |
| `orchestrator` | All | All | All | Yes + Delegation |

```typescript
const program = Effect.gen(function* () {
  const identity = yield* IdentityService;

  // Assign a role
  yield* identity.assignRole("agent-1", {
    name: "agent-standard",
    description: "Standard agent with full tool and memory access",
    permissions: [
      { resource: "tools/*", actions: ["read", "execute"] },
      { resource: "memory/*", actions: ["read", "write"] },
      { resource: "llm/haiku", actions: ["execute"] },
      { resource: "llm/sonnet", actions: ["execute"] },
    ],
  });

  // Check authorization
  const decision = yield* identity.authorize("agent-1", "tools/web_search", "execute");
  console.log(decision); // { allowed: true, ... }

  // List roles
  const roles = yield* identity.getRoles("agent-1");
});
```

### Custom Roles

Define roles with fine-grained permissions using glob patterns:

```typescript
yield* identity.assignRole("agent-1", {
  name: "data-analyst",
  description: "Can read data and use analysis tools, but no write access",
  permissions: [
    { resource: "tools/query_*", actions: ["read", "execute"] },
    { resource: "tools/chart_*", actions: ["read", "execute"] },
    { resource: "memory/semantic", actions: ["read"] },
    { resource: "llm/sonnet", actions: ["execute"] },
  ],
});
```

## Delegation

Temporarily delegate permissions from one agent to another:

```typescript
const program = Effect.gen(function* () {
  const identity = yield* IdentityService;

  // Orchestrator delegates search capability to worker
  const delegation = yield* identity.delegate(
    "orchestrator-1",          // from
    "worker-1",                // to
    [{ resource: "tools/web_search", actions: ["execute"] }],
    "Research subtask",        // reason (logged for audit)
    3600_000,                  // duration: 1 hour
  );

  // Later: revoke early
  yield* identity.revokeDelegation(delegation.id);
});
```

Delegations automatically expire after the specified duration. All delegation events are recorded in the audit log.

## Audit Trail

Every security-relevant action is logged:

```typescript
const program = Effect.gen(function* () {
  const identity = yield* IdentityService;

  // Manual audit entry
  yield* identity.audit({
    agentId: "agent-1",
    sessionId: "session-123",
    action: "tool_execution",
    resource: "tools/web_search",
    result: "success",
    metadata: { query: "latest AI news" },
  });

  // Query audit history
  const entries = yield* identity.queryAudit("agent-1", {
    startDate: new Date("2026-02-01"),
    action: "tool_execution",
    limit: 100,
  });
});
```

### Audit Entry Fields

| Field | Description |
|-------|-------------|
| `agentId` | The acting agent |
| `sessionId` | Current session |
| `action` | What happened (e.g., "auth_attempt", "tool_execution") |
| `resource` | What was accessed |
| `result` | "success", "failure", or "denied" |
| `parentAgentId` | If delegated, the delegating agent |
| `durationMs` | How long the action took |

## Full Identity Lookup

Get the complete identity record for an agent:

```typescript
const identity = yield* identityService.getIdentity("agent-1");
// { agentId, name, roles, certificates, metadata, ... }
```
