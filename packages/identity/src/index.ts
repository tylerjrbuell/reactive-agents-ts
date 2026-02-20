// ─── Types ───
export type {
  AgentIdentity,
  Certificate,
  AuthResult,
  Permission,
  Role,
  AuditEntry,
  Delegation,
  AuthzDecision,
} from "./types.js";
export {
  AgentIdentitySchema,
  CertificateSchema,
  AuthResultSchema,
  PermissionSchema,
  RoleSchema,
  AuditEntrySchema,
  DelegationSchema,
  AuthzDecisionSchema,
  DefaultRoles,
} from "./types.js";

// ─── Errors ───
export {
  AuthenticationError,
  AuthorizationError,
  AuditError,
  DelegationError,
  CredentialError,
} from "./errors.js";

// ─── Auth ───
export { makeCertificateAuth } from "./auth/certificate-auth.js";
export type { CertificateAuth } from "./auth/certificate-auth.js";

// ─── AuthZ ───
export { makePermissionManager } from "./authz/permission-manager.js";
export type { PermissionManager } from "./authz/permission-manager.js";

// ─── Audit ───
export { makeAuditLogger } from "./audit/audit-logger.js";
export type { AuditLogger } from "./audit/audit-logger.js";

// ─── Service ───
export { IdentityService, IdentityServiceLive } from "./identity-service.js";

// ─── Runtime ───
export { createIdentityLayer } from "./runtime.js";
