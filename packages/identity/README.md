# @reactive-agents/identity

> Ed25519 agent certificates, role-based access control, audit logging and delegation for Reactive Agents.

> **Stability:** experimental. No builder wither exists (`.withIdentity()` does not exist); you use the services directly, and no in-tree consumer reads this package yet.

## Install

```bash
bun add @reactive-agents/identity
# or: npm install @reactive-agents/identity
```

## Usage

Use the Effect service directly:

```ts
import { Effect } from "effect";
import { IdentityService, IdentityServiceLive } from "@reactive-agents/identity";

const program = Effect.gen(function* () {
  const identity = yield* IdentityService;
  const cert = yield* identity.issueCertificate("agent-001");
  return yield* identity.authenticate(cert);
});

const auth = await Effect.runPromise(program.pipe(Effect.provide(IdentityServiceLive)));
console.log(auth.authenticated);
```

For enforced run gates inside an agent, use `.withApprovalPolicy()` on the builder instead.

## API

| Export | Use it when |
|---|---|
| `IdentityService`, `IdentityServiceLive` | You want certificates, authorization, roles, audit and delegation in one service. |
| `makeCertificateAuth` | You issue, rotate or verify Ed25519 certificates alone. |
| `makePermissionManager` | You check roles and permissions, or delegate them. |
| `makeAuditLogger` | You write and query an append-only audit log. |
| `createIdentityLayer` | You build the runtime layer by hand. |
| `DefaultRoles` | You want the baseline role set. |
| `AuthenticationError`, `AuthorizationError`, `AuditError`, `DelegationError`, `CredentialError` | You handle the tagged errors. |

## Documentation

- [Architecture overview](https://docs.reactiveagents.dev/concepts/architecture/). This package has no dedicated docs page yet.

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
