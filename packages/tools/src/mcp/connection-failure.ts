/**
 * MCP connect failures: build the `MCPConnectionError` a failed `connect()`
 * returns, with a typed `status` / `reason` so hosts can tell "sign in
 * required" from any other failure without walking the cause chain or
 * matching message text.
 *
 * Signals read from the thrown value and its `cause` chain:
 * - an SDK transport error with an HTTP `code` (`StreamableHTTPError`,
 *   `SseError`) gives `status`; 401 also gives `reason: "auth-required"`.
 * - an error tagged by {@link markAuthRequired} (the non-interactive
 *   authorization-code provider's "run `rax mcp login`" error) gives
 *   `reason: "auth-required"` and `status: 401`.
 */
import { errorMessage } from "@reactive-agents/core";
import { MCPConnectionError, type MCPConnectionFailureReason } from "../errors.js";

/** Registry symbol, so two module instances (src + dist) agree on the tag. */
const AUTH_REQUIRED = Symbol.for("reactive-agents.mcp.auth-required");

/** Cause links followed before giving up (guards against cyclic `cause`). */
const MAX_CAUSE_DEPTH = 8;

/** Tag `err` as "the server needs a login this client cannot do on its own". */
export function markAuthRequired<E extends object>(err: E): E {
  Object.defineProperty(err, AUTH_REQUIRED, { value: true, enumerable: false });
  return err;
}

/** The typed part of a connect failure: HTTP status seen and known reason. */
export interface MCPConnectionFailureSignal {
  readonly status?: number;
  readonly reason?: MCPConnectionFailureReason;
}

const isRecord = (v: unknown): v is Record<PropertyKey, unknown> =>
  typeof v === "object" && v !== null;

const httpStatusOf = (v: Record<PropertyKey, unknown>): number | undefined => {
  const code = v.code ?? v.status;
  return typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599
    ? code
    : undefined;
};

/** Read `status` / `reason` from `e` and its `cause` chain. Never throws. */
export function connectionFailureSignal(e: unknown): MCPConnectionFailureSignal {
  let status: number | undefined;
  let authRequired = false;
  let link: unknown = e;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isRecord(link); depth++) {
    if (link[AUTH_REQUIRED] === true) authRequired = true;
    status ??= httpStatusOf(link);
    link = link.cause;
  }
  if (status === 401) authRequired = true;
  if (authRequired) status ??= 401;
  return {
    ...(status !== undefined ? { status } : {}),
    ...(authRequired ? { reason: "auth-required" as const } : {}),
  };
}

/**
 * The `MCPConnectionError` for a failed connect of `serverName` over
 * `transport`. `message` is the thrown value's message as-is: callers
 * redact it before it reaches here (`connectHttpLike` sanitizes in place).
 */
export function toMCPConnectionError(
  e: unknown,
  serverName: string,
  transport: string,
): MCPConnectionError {
  return new MCPConnectionError({
    message: errorMessage(e),
    serverName,
    transport,
    cause: e,
    ...connectionFailureSignal(e),
  });
}
