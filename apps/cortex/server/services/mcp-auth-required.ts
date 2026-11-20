/**
 * "This MCP server wants you to sign in": the one rule that turns a failed connect into the typed
 * `authRequired` outcome the Tools Lab offers Sign in for.
 *
 * The framework's `MCPConnectionError` keeps the SDK error on `cause` (`UnauthorizedError`, or a
 * `StreamableHTTPError` / `SseError` with `code: 401`) but its message drops the status, and a
 * non-interactive authorization_code provider fails with a `rax mcp login <name>` hint. So the rule
 * walks the error chain (through Effect's FiberFailure) for any of those. The stored `last_error`
 * line starts with {@link AUTH_REQUIRED_PREFIX} when it held, so the list can show the chip after a
 * reload without a schema change ({@link isAuthRequiredText}).
 */
import { Cause, Option, Runtime } from "effect";

/** Leading words of a stored failure line that means "sign in to this server". */
export const AUTH_REQUIRED_PREFIX = "Sign-in required (HTTP 401)";

const MAX_DEPTH = 6;

const fieldOf = (value: object, key: string): unknown => (key in value ? (value as Record<string, unknown>)[key] : undefined);

/** The failure inside an Effect FiberFailure, else the value itself. */
const unwrapFiberFailure = (err: unknown): unknown => {
  if (!Runtime.isFiberFailure(err)) return err;
  const failure = Cause.failureOption(err[Runtime.FiberFailureCauseId]);
  return Option.isSome(failure) ? failure.value : Cause.squash(err[Runtime.FiberFailureCauseId]);
};

/** True when one link of the chain says the server refused us for lack of a login. */
const linkSaysUnauthorized = (link: object): boolean => {
  const name = fieldOf(link, "name");
  if (name === "UnauthorizedError") return true;
  if (fieldOf(link, "code") === 401 || fieldOf(link, "status") === 401) return true;
  const message = fieldOf(link, "message");
  return typeof message === "string" && /\brax mcp login\b/.test(message);
};

/** True when `err` (a connect failure, any depth of `cause`) means the server needs a sign-in. */
export function isMcpAuthRequired(err: unknown): boolean {
  let link: unknown = unwrapFiberFailure(err);
  for (let depth = 0; depth < MAX_DEPTH && link !== null && typeof link === "object"; depth++) {
    if (linkSaysUnauthorized(link)) return true;
    link = unwrapFiberFailure(fieldOf(link, "cause"));
  }
  return false;
}

/** The stored failure line for an auth-required failure: the prefix, then the scrubbed detail. */
export const authRequiredLine = (detail: string): string => (detail.trim() === "" ? AUTH_REQUIRED_PREFIX : `${AUTH_REQUIRED_PREFIX}: ${detail}`);

/** True when a stored `last_error` line was written by {@link authRequiredLine}. */
export const isAuthRequiredText = (line: string | null | undefined): boolean => typeof line === "string" && line.startsWith(AUTH_REQUIRED_PREFIX);
