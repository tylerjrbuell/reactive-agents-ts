/**
 * The cause of a failed hub turn, reduced to something safe to show.
 *
 * The router reports a failed turn as a bare reason (`turn_failed`, `resolve_failed`); the real cause
 * sits on the `RoutingError`. This reduces it to its message only: no stack, no URL query or userinfo
 * (an MCP endpoint can carry a token there), no bearer or key-looking token, one line, bounded. Used for
 * the hub log, the activity feed and the simulate response, never for a platform reply.
 */
import { errorMessage } from "@reactive-agents/core";

const MAX_DETAIL = 300;

/** Drop credentials from URLs and token-shaped strings in `text`. */
const redact = (text: string): string =>
  text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1")
    .replace(/(\bhttps?:\/\/[^\s?#"')]+)[?#][^\s"')]*/gi, "$1")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 ••••")
    .replace(/\b(sk|pk|key|tok|token|xox[a-z])[-_][A-Za-z0-9_-]{8,}/gi, "$1-••••")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "••••");

/** A one-line, secret-free, bounded message for a failure `cause`. */
export const sanitizedCause = (cause: unknown): string => {
  const inner = cause !== null && typeof cause === "object" && "cause" in cause ? (cause as { readonly cause: unknown }).cause : undefined;
  const outer = errorMessage(cause);
  // A wrapper that only restates itself ("agent build failed") is more useful with the error beneath it.
  const text = inner !== undefined && inner !== null && errorMessage(inner) !== outer ? `${outer}: ${errorMessage(inner)}` : outer;
  const line = redact(text).replace(/\s+/g, " ").trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
};
