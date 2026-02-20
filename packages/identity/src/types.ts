import { Schema } from "effect";

// ─── Agent Identity ───

export const AgentIdentitySchema = Schema.Struct({
  agentId: Schema.String,
  name: Schema.String,
  type: Schema.Literal("primary", "worker", "orchestrator", "specialist"),
  createdAt: Schema.DateFromSelf,
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
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
  reason: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.DateFromSelf),
});
export type AuthResult = typeof AuthResultSchema.Type;

// ─── Permission ───

export const PermissionSchema = Schema.Struct({
  resource: Schema.String,
  actions: Schema.Array(Schema.Literal("read", "write", "execute", "delete", "admin")),
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
      { resource: "*", actions: ["read", "write", "execute", "delete", "admin"] },
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
  action: Schema.String,
  resource: Schema.optional(Schema.String),
  result: Schema.Literal("success", "failure", "denied"),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  parentAgentId: Schema.optional(Schema.String),
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
