import { Effect, Context, Layer } from "effect";
import type { Certificate, AuthResult, Permission, Role, AuditEntry, Delegation, AuthzDecision, AgentIdentity } from "./types.js";
import { DefaultRoles } from "./types.js";
import type { AuthenticationError, AuthorizationError, AuditError, DelegationError, CredentialError } from "./errors.js";
import { makeCertificateAuth } from "./auth/certificate-auth.js";
import { makePermissionManager } from "./authz/permission-manager.js";
import { makeAuditLogger } from "./audit/audit-logger.js";

// ─── Service Tag ───

export class IdentityService extends Context.Tag("IdentityService")<
  IdentityService,
  {
    readonly authenticate: (certificate: Certificate) => Effect.Effect<AuthResult, AuthenticationError>;
    readonly authorize: (agentId: string, resource: string, action: "read" | "write" | "execute" | "delete" | "admin") => Effect.Effect<AuthzDecision, AuthorizationError>;
    readonly assignRole: (agentId: string, role: Role) => Effect.Effect<void, never>;
    readonly getRoles: (agentId: string) => Effect.Effect<readonly Role[], never>;
    readonly audit: (entry: Omit<AuditEntry, "id" | "timestamp">) => Effect.Effect<void, AuditError>;
    readonly queryAudit: (agentId: string, options?: { startDate?: Date; endDate?: Date; action?: string; limit?: number }) => Effect.Effect<readonly AuditEntry[], AuditError>;
    readonly delegate: (fromAgentId: string, toAgentId: string, permissions: readonly Permission[], reason: string, durationMs: number) => Effect.Effect<Delegation, DelegationError>;
    readonly revokeDelegation: (delegationId: string) => Effect.Effect<void, DelegationError>;
    readonly issueCertificate: (agentId: string, ttlMs?: number) => Effect.Effect<Certificate, CredentialError>;
    readonly rotateCertificate: (agentId: string) => Effect.Effect<Certificate, CredentialError>;
    readonly getIdentity: (agentId: string) => Effect.Effect<AgentIdentity & { roles: readonly Role[] }, AuthenticationError>;
  }
>() {}

// ─── Live Implementation ───

export const IdentityServiceLive = Layer.effect(
  IdentityService,
  Effect.gen(function* () {
    const certAuth = yield* makeCertificateAuth;
    const permissions = yield* makePermissionManager;
    const auditLogger = yield* makeAuditLogger;

    return {
      authenticate: (cert) => certAuth.authenticate(cert),
      authorize: (agentId, resource, action) => permissions.authorize(agentId, resource, action),
      assignRole: (agentId, role) => permissions.assignRole(agentId, role),
      getRoles: (agentId) => permissions.getRoles(agentId),
      audit: (entry) => auditLogger.log(entry),
      queryAudit: (agentId, options) => auditLogger.query(agentId, options),
      delegate: (from, to, perms, reason, dur) => permissions.delegate(from, to, perms, reason, dur),
      revokeDelegation: (id) => permissions.revokeDelegation(id),
      issueCertificate: (agentId, ttlMs) => certAuth.issueCertificate(agentId, ttlMs),
      rotateCertificate: (agentId) => certAuth.rotateCertificate(agentId),
      getIdentity: (agentId) =>
        Effect.gen(function* () {
          const roles = yield* permissions.getRoles(agentId);
          return {
            agentId,
            name: agentId,
            type: "primary" as const,
            createdAt: new Date(),
            roles: roles.length > 0 ? roles : [DefaultRoles["agent-standard"]!],
          };
        }),
    };
  }),
);
