# Layer 6: Identity & Security - AI Agent Implementation Spec

## Overview

Certificate-based agent authentication, fine-grained permission scoping, immutable append-only audit trails, delegation tracking, and credential lifecycle management. This layer ensures that every agent action is authenticated, authorized, and auditable — critical for enterprise deployment and multi-agent orchestration.

**Package:** `@reactive-agents/identity`
**Dependencies:** `@reactive-agents/core` (EventBus, types)

---

## Package Structure

```
@reactive-agents/identity/
├── src/
│   ├── index.ts                          # Public API exports
│   ├── identity-service.ts               # Main IdentityService (Effect service)
│   ├── types.ts                          # All types & schemas
│   ├── auth/
│   │   └── certificate-auth.ts           # X.509-style certificate verification
│   ├── authz/
│   │   ├── permission-manager.ts         # Role-based + capability-based authorization
│   │   └── policy-engine.ts              # Policy evaluation engine
│   ├── audit/
│   │   └── audit-logger.ts               # Immutable append-only audit log
│   ├── delegation/
│   │   └── delegation-tracker.ts         # Agent-to-agent permission delegation
│   └── lifecycle/
│       └── credential-manager.ts         # Certificate issuance, rotation, revocation
├── tests/
│   ├── identity-service.test.ts
│   ├── auth/
│   │   └── certificate-auth.test.ts
│   ├── authz/
│   │   └── permission-manager.test.ts
│   ├── audit/
│   │   └── audit-logger.test.ts
│   └── delegation/
│       └── delegation-tracker.test.ts
└── package.json
```

---

## Build Order

1. `src/types.ts` — AgentCertificate, Permission, Role, AuditEntry, DelegationGrant schemas
2. `src/errors.ts` — All error types (IdentityError, AuthenticationError, AuthorizationError, CertificateError, AuditError, DelegationError)
3. `src/auth/certificate-auth.ts` — X.509-style certificate verification
4. `src/authz/policy-engine.ts` — Policy evaluation engine
5. `src/authz/permission-manager.ts` — Role-based + capability-based authorization
6. `src/audit/audit-logger.ts` — Immutable append-only audit log
7. `src/delegation/delegation-tracker.ts` — Agent-to-agent permission delegation with expiration
8. `src/lifecycle/credential-manager.ts` — Certificate issuance, rotation, revocation
9. `src/identity-service.ts` — Main IdentityService Context.Tag + IdentityServiceLive
10. `src/index.ts` — Public re-exports
11. Tests for each module

---

## Core Types & Schemas

```typescript
import { Schema, Data, Effect, Context, Layer } from "effect";

// ─── Agent Identity ───

export const AgentIdentitySchema = Schema.Struct({
  agentId: Schema.String,
  name: Schema.String,
  type: Schema.Literal("primary", "worker", "orchestrator", "specialist"),
  createdAt: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type AgentIdentity = typeof AgentIdentitySchema.Type;

// ─── Certificate ───

export const CertificateSchema = Schema.Struct({
  serialNumber: Schema.String,
  agentId: Schema.String,
  issuedAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf,
  publicKey: Schema.String,
  issuer: Schema.String,
  fingerprint: Schema.String,
  status: Schema.Literal("active", "expired", "revoked"),
});
export type Certificate = typeof CertificateSchema.Type;

// ─── Authentication Result ───

export const AuthResultSchema = Schema.Struct({
  authenticated: Schema.Boolean,
  agentId: Schema.optional(Schema.String),
  identity: Schema.optional(AgentIdentitySchema),
  reason: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.DateFromSelf),
});
export type AuthResult = typeof AuthResultSchema.Type;

// ─── Permission ───

export const PermissionSchema = Schema.Struct({
  resource: Schema.String, // e.g., 'tools/*', 'memory/factual', 'llm/opus'
  actions: Schema.Array(
    Schema.Literal("read", "write", "execute", "delete", "admin"),
  ),
  conditions: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  expiresAt: Schema.optional(Schema.DateFromSelf),
});
export type Permission = typeof PermissionSchema.Type;

// ─── Role ───

export const RoleSchema = Schema.Struct({
  name: Schema.String,
  permissions: Schema.Array(PermissionSchema),
  description: Schema.String,
});
export type Role = typeof RoleSchema.Type;

// ─── Pre-defined Roles ───

export const DefaultRoles: Record<string, Role> = {
  "agent-basic": {
    name: "agent-basic",
    description: "Basic agent with limited tool access",
    permissions: [
      { resource: "memory/working", actions: ["read", "write"] },
      { resource: "tools/basic/*", actions: ["execute"] },
      { resource: "llm/haiku", actions: ["execute"] },
    ],
  },
  "agent-standard": {
    name: "agent-standard",
    description: "Standard agent with full tool and memory access",
    permissions: [
      { resource: "memory/*", actions: ["read", "write"] },
      { resource: "tools/*", actions: ["execute"] },
      { resource: "llm/haiku", actions: ["execute"] },
      { resource: "llm/sonnet", actions: ["execute"] },
    ],
  },
  "agent-privileged": {
    name: "agent-privileged",
    description: "Privileged agent with full access including admin ops",
    permissions: [
      { resource: "*", actions: ["read", "write", "execute", "delete"] },
      { resource: "llm/*", actions: ["execute"] },
    ],
  },
  orchestrator: {
    name: "orchestrator",
    description: "Orchestrator with agent management and delegation rights",
    permissions: [
      {
        resource: "*",
        actions: ["read", "write", "execute", "delete", "admin"],
      },
      { resource: "llm/*", actions: ["execute"] },
      { resource: "agents/*", actions: ["read", "write", "execute", "admin"] },
    ],
  },
};

// ─── Audit Entry ───

export const AuditEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.DateFromSelf,
  agentId: Schema.String,
  sessionId: Schema.String,
  action: Schema.String, // e.g., 'tool.execute', 'llm.complete', 'memory.write'
  resource: Schema.optional(Schema.String),
  result: Schema.Literal("success", "failure", "denied"),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  parentAgentId: Schema.optional(Schema.String), // For delegation tracking
  durationMs: Schema.optional(Schema.Number),
});
export type AuditEntry = typeof AuditEntrySchema.Type;

// ─── Delegation ───

export const DelegationSchema = Schema.Struct({
  id: Schema.String,
  fromAgentId: Schema.String,
  toAgentId: Schema.String,
  permissions: Schema.Array(PermissionSchema),
  issuedAt: Schema.DateFromSelf,
  expiresAt: Schema.DateFromSelf,
  reason: Schema.String,
  status: Schema.Literal("active", "expired", "revoked"),
});
export type Delegation = typeof DelegationSchema.Type;

// ─── Authorization Decision ───

export const AuthzDecisionSchema = Schema.Struct({
  allowed: Schema.Boolean,
  resource: Schema.String,
  action: Schema.String,
  reason: Schema.optional(Schema.String),
  matchedPermission: Schema.optional(PermissionSchema),
});
export type AuthzDecision = typeof AuthzDecisionSchema.Type;
```

---

## Error Types

```typescript
import { Data } from "effect";

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError",
)<{
  readonly message: string;
  readonly reason:
    | "invalid-certificate"
    | "expired"
    | "revoked"
    | "unknown-agent";
  readonly agentId?: string;
}> {}

export class AuthorizationError extends Data.TaggedError("AuthorizationError")<{
  readonly message: string;
  readonly agentId: string;
  readonly resource: string;
  readonly action: string;
}> {}

export class AuditError extends Data.TaggedError("AuditError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DelegationError extends Data.TaggedError("DelegationError")<{
  readonly message: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
}> {}

export class CredentialError extends Data.TaggedError("CredentialError")<{
  readonly message: string;
  readonly agentId: string;
  readonly operation: "issue" | "rotate" | "revoke";
}> {}
```

---

## Effect Service Definition

```typescript
import { Effect, Context } from "effect";

export class IdentityService extends Context.Tag("IdentityService")<
  IdentityService,
  {
    /**
     * Authenticate an agent using their certificate.
     * Verifies signature, expiration, and revocation status.
     */
    readonly authenticate: (
      certificate: Certificate,
    ) => Effect.Effect<AuthResult, AuthenticationError>;

    /**
     * Check if an agent is authorized to perform an action on a resource.
     * Uses role-based + capability-based authorization with wildcard support.
     */
    readonly authorize: (
      agentId: string,
      resource: string,
      action: "read" | "write" | "execute" | "delete" | "admin",
    ) => Effect.Effect<AuthzDecision, AuthorizationError>;

    /**
     * Log an action to the immutable audit trail.
     * All agent actions should be audited.
     */
    readonly audit: (
      entry: Omit<AuditEntry, "id" | "timestamp">,
    ) => Effect.Effect<void, AuditError>;

    /**
     * Query the audit trail for an agent within a date range.
     */
    readonly queryAudit: (
      agentId: string,
      options?: {
        startDate?: Date;
        endDate?: Date;
        action?: string;
        limit?: number;
      },
    ) => Effect.Effect<readonly AuditEntry[], AuditError>;

    /**
     * Delegate permissions from one agent to another with expiration.
     */
    readonly delegate: (
      fromAgentId: string,
      toAgentId: string,
      permissions: readonly Permission[],
      reason: string,
      durationMs: number,
    ) => Effect.Effect<Delegation, DelegationError>;

    /**
     * Revoke a previously granted delegation.
     */
    readonly revokeDelegation: (
      delegationId: string,
    ) => Effect.Effect<void, DelegationError>;

    /**
     * Issue a new certificate for an agent.
     */
    readonly issueCertificate: (
      agentId: string,
      ttlMs?: number,
    ) => Effect.Effect<Certificate, CredentialError>;

    /**
     * Rotate an agent's certificate (issue new, revoke old).
     */
    readonly rotateCertificate: (
      agentId: string,
    ) => Effect.Effect<Certificate, CredentialError>;

    /**
     * Get the current identity and roles for an agent.
     */
    readonly getIdentity: (
      agentId: string,
    ) => Effect.Effect<
      AgentIdentity & { roles: readonly Role[] },
      AuthenticationError
    >;
  }
>() {}
```

---

## Certificate Authentication Implementation

```typescript
import { Effect, Ref } from "effect";
import * as crypto from "node:crypto";

export const makeCertificateAuth = Effect.gen(function* () {
  // Certificate store (in production: backed by persistent storage)
  const certsRef = yield* Ref.make<Map<string, Certificate>>(new Map());
  const revokedRef = yield* Ref.make<Set<string>>(new Set());

  const authenticate = (
    cert: Certificate,
  ): Effect.Effect<AuthResult, AuthenticationError> =>
    Effect.gen(function* () {
      // Step 1: Verify certificate format and signature
      const valid = yield* verifyCertificateSignature(cert);
      if (!valid) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Invalid certificate signature for agent ${cert.agentId}`,
            reason: "invalid-certificate",
            agentId: cert.agentId,
          }),
        );
      }

      // Step 2: Check expiration
      if (cert.expiresAt < new Date()) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Certificate expired for agent ${cert.agentId}`,
            reason: "expired",
            agentId: cert.agentId,
          }),
        );
      }

      // Step 3: Check revocation list
      const revoked = yield* Ref.get(revokedRef);
      if (revoked.has(cert.serialNumber)) {
        return yield* Effect.fail(
          new AuthenticationError({
            message: `Certificate revoked for agent ${cert.agentId}`,
            reason: "revoked",
            agentId: cert.agentId,
          }),
        );
      }

      return {
        authenticated: true,
        agentId: cert.agentId,
        expiresAt: cert.expiresAt,
      };
    });

  const issueCertificate = (
    agentId: string,
    ttlMs: number = 7 * 24 * 60 * 60 * 1000, // 7 days default
  ): Effect.Effect<Certificate, CredentialError> =>
    Effect.gen(function* () {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const publicKeyPem = publicKey.export({
        type: "spki",
        format: "pem",
      }) as string;

      const now = new Date();
      const cert: Certificate = {
        serialNumber: crypto.randomUUID(),
        agentId,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
        publicKey: publicKeyPem,
        issuer: "reactive-agents-ca",
        fingerprint: crypto
          .createHash("sha256")
          .update(publicKeyPem)
          .digest("hex"),
        status: "active",
      };

      yield* Ref.update(certsRef, (certs) => {
        const newCerts = new Map(certs);
        newCerts.set(cert.serialNumber, cert);
        return newCerts;
      });

      return cert;
    }).pipe(
      Effect.mapError(
        (e) =>
          new CredentialError({
            message: `Failed to issue certificate: ${e}`,
            agentId,
            operation: "issue",
          }),
      ),
    );

  const rotateCertificate = (
    agentId: string,
  ): Effect.Effect<Certificate, CredentialError> =>
    Effect.gen(function* () {
      // Revoke all existing certificates for this agent
      const certs = yield* Ref.get(certsRef);
      for (const [serial, cert] of certs) {
        if (cert.agentId === agentId && cert.status === "active") {
          yield* Ref.update(
            revokedRef,
            (revoked) => new Set([...revoked, serial]),
          );
        }
      }

      // Issue new certificate
      return yield* issueCertificate(agentId);
    });

  const revokeCertificate = (
    serialNumber: string,
  ): Effect.Effect<void, CredentialError> =>
    Ref.update(
      revokedRef,
      (revoked) => new Set([...revoked, serialNumber]),
    ).pipe(
      Effect.mapError(
        (e) =>
          new CredentialError({
            message: "Revocation failed",
            agentId: "unknown",
            operation: "revoke",
          }),
      ),
    );

  return {
    authenticate,
    issueCertificate,
    rotateCertificate,
    revokeCertificate,
  };
});

// ─── Helper: Certificate signature verification ───

const verifyCertificateSignature = (
  cert: Certificate,
): Effect.Effect<boolean, never> =>
  Effect.try({
    try: () => {
      // In production: verify against root CA
      // For now: validate format and non-empty fields
      return (
        cert.serialNumber.length > 0 &&
        cert.publicKey.length > 0 &&
        cert.fingerprint.length > 0
      );
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
```

---

## Permission Manager Implementation

```typescript
import { Effect, Ref } from "effect";

export const makePermissionManager = Effect.gen(function* () {
  // Agent → Roles mapping
  const agentRolesRef = yield* Ref.make<Map<string, Role[]>>(new Map());

  // Active delegations
  const delegationsRef = yield* Ref.make<Delegation[]>([]);

  const assignRole = (
    agentId: string,
    role: Role,
  ): Effect.Effect<void, never> =>
    Ref.update(agentRolesRef, (map) => {
      const newMap = new Map(map);
      const existing = newMap.get(agentId) ?? [];
      newMap.set(agentId, [...existing, role]);
      return newMap;
    });

  const authorize = (
    agentId: string,
    resource: string,
    action: "read" | "write" | "execute" | "delete" | "admin",
  ): Effect.Effect<AuthzDecision, AuthorizationError> =>
    Effect.gen(function* () {
      const roles = yield* Ref.get(agentRolesRef).pipe(
        Effect.map((map) => map.get(agentId) ?? []),
      );

      // Also check delegated permissions
      const delegations = yield* Ref.get(delegationsRef).pipe(
        Effect.map((dels) =>
          dels.filter(
            (d) =>
              d.toAgentId === agentId &&
              d.status === "active" &&
              d.expiresAt > new Date(),
          ),
        ),
      );

      // Collect all permissions (from roles + delegations)
      const allPermissions: Permission[] = [
        ...roles.flatMap((r) => r.permissions),
        ...delegations.flatMap((d) => [...d.permissions]),
      ];

      // Check for matching permission with wildcard support
      const matched = allPermissions.find((p) => {
        const resourceMatch = matchWildcard(p.resource, resource);
        const actionMatch =
          p.actions.includes(action) || p.actions.includes("admin");
        const notExpired = !p.expiresAt || p.expiresAt > new Date();
        return resourceMatch && actionMatch && notExpired;
      });

      if (matched) {
        return {
          allowed: true,
          resource,
          action,
          matchedPermission: matched,
        };
      }

      return yield* Effect.fail(
        new AuthorizationError({
          message: `Agent ${agentId} not authorized for ${action} on ${resource}`,
          agentId,
          resource,
          action,
        }),
      );
    });

  const delegate = (
    fromAgentId: string,
    toAgentId: string,
    permissions: readonly Permission[],
    reason: string,
    durationMs: number,
  ): Effect.Effect<Delegation, DelegationError> =>
    Effect.gen(function* () {
      // Verify delegator has the permissions they're trying to delegate
      for (const perm of permissions) {
        for (const action of perm.actions) {
          yield* authorize(fromAgentId, perm.resource, action).pipe(
            Effect.mapError(
              (e) =>
                new DelegationError({
                  message: `Cannot delegate ${action} on ${perm.resource}: delegator lacks permission`,
                  fromAgentId,
                  toAgentId,
                }),
            ),
          );
        }
      }

      const now = new Date();
      const delegation: Delegation = {
        id: crypto.randomUUID(),
        fromAgentId,
        toAgentId,
        permissions: [...permissions],
        issuedAt: now,
        expiresAt: new Date(now.getTime() + durationMs),
        reason,
        status: "active",
      };

      yield* Ref.update(delegationsRef, (dels) => [...dels, delegation]);
      return delegation;
    });

  const revokeDelegation = (
    delegationId: string,
  ): Effect.Effect<void, DelegationError> =>
    Ref.update(delegationsRef, (dels) =>
      dels.map((d) =>
        d.id === delegationId ? { ...d, status: "revoked" as const } : d,
      ),
    ).pipe(
      Effect.mapError(
        (e) =>
          new DelegationError({
            message: "Revocation failed",
            fromAgentId: "",
            toAgentId: "",
          }),
      ),
    );

  return { assignRole, authorize, delegate, revokeDelegation };
});

// ─── Helper: Wildcard pattern matching ───

function matchWildcard(pattern: string, value: string): boolean {
  if (pattern === "*") return true;

  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
  );
  return regex.test(value);
}
```

---

## Immutable Audit Logger Implementation

```typescript
import { Effect, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";

export const makeAuditLogger = Effect.gen(function* () {
  const eventBus = yield* EventBus;

  // Append-only log (in production: backed by append-only storage like S3/event log)
  const logRef = yield* Ref.make<AuditEntry[]>([]);

  const log = (
    entry: Omit<AuditEntry, "id" | "timestamp">,
  ): Effect.Effect<void, AuditError> =>
    Effect.gen(function* () {
      const fullEntry: AuditEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      };

      // Append (never modify or delete existing entries)
      yield* Ref.update(logRef, (entries) => [...entries, fullEntry]);

      // Emit audit event
      yield* eventBus.publish({
        type: "identity.audit-logged",
        payload: {
          agentId: fullEntry.agentId,
          action: fullEntry.action,
          result: fullEntry.result,
          resource: fullEntry.resource,
        },
      });

      // Emit warning for denied actions
      if (fullEntry.result === "denied") {
        yield* eventBus.publish({
          type: "identity.access-denied",
          payload: {
            agentId: fullEntry.agentId,
            action: fullEntry.action,
            resource: fullEntry.resource,
          },
        });
      }
    }).pipe(
      Effect.mapError(
        (e) => new AuditError({ message: "Audit logging failed", cause: e }),
      ),
    );

  const query = (
    agentId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      action?: string;
      limit?: number;
    },
  ): Effect.Effect<readonly AuditEntry[], AuditError> =>
    Effect.gen(function* () {
      const allEntries = yield* Ref.get(logRef);
      const retentionMs = 90 * 24 * 60 * 60 * 1000; // 90 days
      const now = Date.now();

      let filtered = allEntries.filter((e) => {
        // Filter by agent
        if (e.agentId !== agentId) return false;

        // Filter by retention
        if (now - e.timestamp.getTime() > retentionMs) return false;

        // Filter by date range
        if (options?.startDate && e.timestamp < options.startDate) return false;
        if (options?.endDate && e.timestamp > options.endDate) return false;

        // Filter by action
        if (options?.action && e.action !== options.action) return false;

        return true;
      });

      // Apply limit
      if (options?.limit) {
        filtered = filtered.slice(-options.limit);
      }

      return filtered;
    }).pipe(
      Effect.mapError(
        (e) => new AuditError({ message: "Audit query failed", cause: e }),
      ),
    );

  return { log, query };
});
```

---

## Main IdentityService Implementation

```typescript
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";

export const IdentityServiceLive = Layer.effect(
  IdentityService,
  Effect.gen(function* () {
    const certAuth = yield* makeCertificateAuth;
    const permissions = yield* makePermissionManager;
    const auditLogger = yield* makeAuditLogger;

    // Auto-assign default role for new agents
    const ensureDefaultRole = (
      agentId: string,
      agentType: string,
    ): Effect.Effect<void, never> => {
      const role =
        agentType === "orchestrator"
          ? DefaultRoles["orchestrator"]
          : DefaultRoles["agent-standard"];
      return permissions.assignRole(agentId, role);
    };

    const authenticate = (cert: Certificate) => certAuth.authenticate(cert);

    const authorize = (
      agentId: string,
      resource: string,
      action: "read" | "write" | "execute" | "delete" | "admin",
    ) => permissions.authorize(agentId, resource, action);

    const audit = (entry: Omit<AuditEntry, "id" | "timestamp">) =>
      auditLogger.log(entry);

    const queryAudit = (
      agentId: string,
      options?: {
        startDate?: Date;
        endDate?: Date;
        action?: string;
        limit?: number;
      },
    ) => auditLogger.query(agentId, options);

    const delegate = (
      fromAgentId: string,
      toAgentId: string,
      perms: readonly Permission[],
      reason: string,
      durationMs: number,
    ) =>
      permissions.delegate(fromAgentId, toAgentId, perms, reason, durationMs);

    const revokeDelegation = (delegationId: string) =>
      permissions.revokeDelegation(delegationId);

    const issueCertificate = (agentId: string, ttlMs?: number) =>
      certAuth.issueCertificate(agentId, ttlMs);

    const rotateCertificate = (agentId: string) =>
      certAuth.rotateCertificate(agentId);

    const getIdentity = (agentId: string) =>
      Effect.succeed({
        agentId,
        name: agentId,
        type: "primary" as const,
        createdAt: new Date(),
        roles: [DefaultRoles["agent-standard"]],
      });

    return {
      authenticate,
      authorize,
      audit,
      queryAudit,
      delegate,
      revokeDelegation,
      issueCertificate,
      rotateCertificate,
      getIdentity,
    };
  }),
);
```

---

## Testing

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { IdentityService, IdentityServiceLive } from "../src";

const TestIdentityLayer = IdentityServiceLive.pipe(
  Layer.provide(TestEventBusLayer),
);

describe("IdentityService", () => {
  it("should authenticate valid certificates", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      const cert = yield* identity.issueCertificate("agent-1");
      const result = yield* identity.authenticate(cert);

      expect(result.authenticated).toBe(true);
      expect(result.agentId).toBe("agent-1");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });

  it("should reject expired certificates", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      // Issue certificate with 0ms TTL (immediately expired)
      const cert = yield* identity.issueCertificate("agent-1", 0);

      // Wait a tick
      yield* Effect.sleep("10 millis");

      const result = yield* identity.authenticate(cert).pipe(Effect.flip);
      expect(result._tag).toBe("AuthenticationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });

  it("should enforce authorization rules", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      // Basic agent should NOT have access to opus model
      const result = yield* identity
        .authorize("basic-agent", "llm/opus", "execute")
        .pipe(Effect.flip);

      expect(result._tag).toBe("AuthorizationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });

  it("should maintain immutable audit log", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      yield* identity.audit({
        agentId: "agent-1",
        sessionId: "session-1",
        action: "tool.execute",
        resource: "tools/web-search",
        result: "success",
      });

      yield* identity.audit({
        agentId: "agent-1",
        sessionId: "session-1",
        action: "llm.complete",
        resource: "llm/sonnet",
        result: "success",
      });

      const entries = yield* identity.queryAudit("agent-1");
      expect(entries).toHaveLength(2);
      expect(entries[0].action).toBe("tool.execute");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });

  it("should support permission delegation", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      const delegation = yield* identity.delegate(
        "orchestrator-1",
        "worker-1",
        [{ resource: "tools/web-search", actions: ["execute"] }],
        "Delegating web search for research task",
        60 * 60 * 1000, // 1 hour
      );

      expect(delegation.status).toBe("active");
      expect(delegation.fromAgentId).toBe("orchestrator-1");

      // Revoke delegation
      yield* identity.revokeDelegation(delegation.id);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });

  it("should rotate certificates", async () => {
    const program = Effect.gen(function* () {
      const identity = yield* IdentityService;

      const cert1 = yield* identity.issueCertificate("agent-1");
      const cert2 = yield* identity.rotateCertificate("agent-1");

      expect(cert2.serialNumber).not.toBe(cert1.serialNumber);

      // Old cert should be rejected
      const oldResult = yield* identity.authenticate(cert1).pipe(Effect.flip);
      expect(oldResult._tag).toBe("AuthenticationError");

      // New cert should work
      const newResult = yield* identity.authenticate(cert2);
      expect(newResult.authenticated).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestIdentityLayer)));
  });
});
```

---

## Configuration

```typescript
export const IdentityConfig = {
  // Certificate lifecycle
  certificates: {
    defaultTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    rotationIntervalMs: 7 * 24 * 60 * 60 * 1000, // Rotate every 7 days
    maxCertificatesPerAgent: 5,
  },

  // Audit
  audit: {
    retentionDays: 90,
    maxEntriesInMemory: 100_000,
    exportBatchSize: 1000,
  },

  // Delegation
  delegation: {
    maxDelegationDepth: 3, // Prevent deep delegation chains
    maxDelegationDurationMs: 24 * 60 * 60 * 1000, // Max 24 hours
    requireReason: true,
  },

  // Authorization
  authorization: {
    defaultRole: "agent-standard",
    cacheDecisionsTtlMs: 5 * 60 * 1000, // Cache authz decisions for 5 minutes
  },
};
```

---

## Performance Targets

| Metric                 | Target | Notes                          |
| ---------------------- | ------ | ------------------------------ |
| Authentication latency | <5ms   | Certificate verification       |
| Authorization latency  | <2ms   | Permission lookup with caching |
| Audit log write        | <1ms   | Append-only, in-memory         |
| Audit query            | <50ms  | Up to 90 days of data          |
| Certificate rotation   | <100ms | Including old cert revocation  |
| Delegation creation    | <10ms  | With permission verification   |

---

## Secret Manager (Vision Pillar: Security)

Optional extension for runtime secret management (API keys, credentials).
Default provider reads from environment variables; extensible to Vault/AWS Secrets Manager.

```typescript
// File: src/services/secret-manager.ts
import { Context, Effect, Layer } from "effect";
import { IdentityError } from "./errors.js";

export class SecretManagerService extends Context.Tag("SecretManagerService")<
  SecretManagerService,
  {
    /** Retrieve a secret by key. */
    readonly get: (key: string) => Effect.Effect<string, IdentityError>;
    /** Rotate a secret (re-fetch or generate new value). */
    readonly rotate: (key: string) => Effect.Effect<void, IdentityError>;
    /** List available secret keys. */
    readonly list: () => Effect.Effect<readonly string[], IdentityError>;
  }
>() {}

/**
 * Default implementation: reads secrets from environment variables.
 * Keys are uppercased and prefixed with REACTIVE_AGENTS_ by convention.
 */
export const SecretManagerEnvLive = Layer.succeed(SecretManagerService, {
  get: (key) =>
    Effect.sync(() => {
      const envKey = `REACTIVE_AGENTS_${key.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
      const value = process.env[envKey];
      if (!value) throw new Error(`Secret not found: ${envKey}`);
      return value;
    }).pipe(Effect.mapError((e) => new IdentityError({ message: String(e) }))),

  rotate: (_key) => Effect.succeed(undefined), // no-op for env vars

  list: () =>
    Effect.sync(() =>
      Object.keys(process.env)
        .filter((k) => k.startsWith("REACTIVE_AGENTS_"))
        .map((k) => k.replace("REACTIVE_AGENTS_", "").toLowerCase()),
    ),
});
```

---

## Integration Points

- **EventBus** (Layer 1): Emits `identity.audit-logged`, `identity.access-denied`, `identity.cert-rotated`, `identity.delegation-created` events
- **Orchestration** (Layer 7): Orchestrator uses delegation to grant workers temporary permissions
- **Tools** (Layer 8): Tool execution checks authorization before running
- **Observability** (Layer 9): Audit metrics exported for security monitoring
- **All Layers**: Every service can check `IdentityService.authorize()` before performing sensitive operations

## Success Criteria

- [ ] Certificate-based agent authentication working
- [ ] X.509-style certificate issuance, rotation, and revocation
- [ ] Role-based + capability-based authorization with wildcard patterns
- [ ] Permission delegation between agents with expiration
- [ ] Immutable append-only audit log with 90-day retention
- [ ] SecretManagerService reads secrets from environment variables
- [ ] All operations use Effect-TS patterns (no raw async/await)
- [ ] <5ms authentication, <2ms authorization latency

---

## Package Config

### File: `package.json`

```json
{
  "name": "@reactive-agents/identity",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@noble/ed25519": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```

---

**Status: Ready for implementation**
**Priority: Phase 3 (Weeks 10-11)**
