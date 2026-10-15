# @reactive-agents/identity

Cryptographic identity, authorization, and audit for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

> **Stability note:** This package ships as `@unstable`. Scaffolding (Ed25519 certificates, RBAC, audit log, delegation chains) and the runtime layer are merged, but no in-tree consumer reads it yet. The audit verdict is DEFER, meaning the surface may change in v0.10.x without notice. See `AUDIT-overhaul-2026.md` §10.1 for context.

Provides Ed25519-signed agent certificates, role-based access control with permission checks, append-only audit logs, and signed delegation chains so an agent can act on behalf of another principal with a verifiable proof trail.

## Installation

```bash
bun add @reactive-agents/identity
```

## Features

- **Ed25519 agent certificates** — `@noble/ed25519` keypairs signed by an issuer, with expiry and capability scope
- **RBAC permission manager** — role definitions, permission checks, deny-by-default
- **Audit logger** — append-only log of authentication, authorization, and delegation events
- **Delegation chains** — signed proof that agent A is acting on behalf of user U
- **Default roles** — `DefaultRoles` constant exports a baseline role set

## Quick Example (direct service usage)

> **Builder integration note:** there is no `.withIdentity()` builder wither
> (removed as a provide-and-forget layer; the ratchet test pins its absence).
> Use this package directly via its Effect `Layer`, and `.withApprovalPolicy()`
> for enforced run gates.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("privileged-agent")
  .withProvider("anthropic")
  .build();
```

## Direct Service Usage

```typescript
import { Effect } from "effect";
import {
  IdentityService,
  IdentityServiceLive,
  makeCertificateAuth,
  makePermissionManager,
} from "@reactive-agents/identity";

const program = Effect.gen(function* () {
  const id = yield* IdentityService;
  const cert = yield* id.issueCertificate({
    subject: "agent-001",
    roles: ["reader"],
    ttlSeconds: 3600,
  });
  const ok = yield* id.authenticate(cert);
  return { cert, ok };
});

await Effect.runPromise(program.pipe(Effect.provide(IdentityServiceLive)));
```

## Key Exports

| Export                               | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `IdentityService`, `IdentityServiceLive` | Composite identity entry point               |
| `makeCertificateAuth`                | Ed25519 certificate authentication               |
| `makePermissionManager`              | RBAC checks                                      |
| `makeAuditLogger`                    | Append-only audit log                            |
| `createIdentityLayer`                | Factory for the runtime layer                    |
| `DefaultRoles`                       | Baseline role set                                |
| `AgentIdentity`, `Certificate`, `Permission`, `Role`, `Delegation`, `AuditEntry` | Schemas + types |
| `AuthenticationError`, `AuthorizationError`, `AuditError`, `DelegationError`, `CredentialError` | Tagged errors |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
