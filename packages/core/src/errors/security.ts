import { Data } from "effect";

/**
 * Security failure — a tool or subsystem attempted an operation outside
 * its declared capabilities (env var, network host, filesystem path,
 * MCP server trust boundary). NOT retryable. Should be escalated to
 * `SecurityEvent` telemetry and optionally trigger a kill switch.
 *
 * @see isRetryable — returns false
 */
export class SecurityError extends Data.TaggedError("SecurityError")<{
  readonly message: string;
}> {}

/**
 * A tool attempted an operation outside its declared `capabilities`
 * scope. `attempted` lists the resources the tool tried to access;
 * `granted` lists what was declared in the tool definition. The
 * intersection (or lack thereof) reveals the violation.
 */
export class ToolCapabilityViolation extends Data.TaggedError("ToolCapabilityViolation")<{
  readonly toolName: string;
  readonly attempted: readonly string[];
  readonly granted: readonly string[];
  readonly message: string;
}> {}
