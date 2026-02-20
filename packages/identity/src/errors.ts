import { Data } from "effect";

export class AuthenticationError extends Data.TaggedError("AuthenticationError")<{
  readonly message: string;
  readonly reason: "invalid-certificate" | "expired" | "revoked" | "unknown-agent";
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
