# @reactive-agents/identity

Identity and access control for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Manages agent certificates and role-based access control (RBAC) so agents can safely act on behalf of users with well-defined permissions.

## Installation

```bash
bun add @reactive-agents/identity
```

## Features

- **Agent certificates** — cryptographically identified agent instances
- **RBAC** — role and permission checks before privileged operations
- **Identity context** — propagated through the execution engine

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("privileged-agent")
  .withProvider("anthropic")
  .withIdentity({
    roles: ["reader", "writer"],
    issuer: "my-org",
  })
  .build();
```

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
