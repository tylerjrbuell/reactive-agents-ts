/**
 * Detects HTTP responses that are failures even though the fetch succeeded:
 * non-2xx statuses, and "soft 404" pages (HTTP 200 whose body is a tiny
 * not-found shell). Reporting these as tool successes inflates success counts
 * and hides a dead source from the broken-tool tracker.
 */

/** Soft-404 detection only applies to bodies shorter than this many chars. */
export const SOFT_404_MAX_BODY_CHARS = 2048;

const NOT_FOUND_PHRASES: readonly RegExp[] = [
  /\bpage\s+not\s+found\b/i,
  /\b404\s*(?:[-:|]\s*)?(?:error|not\s+found|page)\b/i,
  /\berror\s+404\b/i,
  /\bnot\s+found\b.{0,40}\b404\b/i,
  /\b404\b.{0,40}\bnot\s+found\b/i,
  /\bthe\s+(?:requested\s+)?(?:page|url|resource)\s+(?:you\s+(?:requested|were\s+looking\s+for)\s+)?(?:could\s+not|cannot|can't|was\s+not|does\s+not|doesn't)\b.{0,30}\b(?:found|exist)\b/i,
];

const stripTags = (s: string): string =>
  s
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when a 200 body is a short not-found page. Non-string bodies never match. */
export function isSoft404Body(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const text = stripTags(body);
  if (text.length === 0 || text.length >= SOFT_404_MAX_BODY_CHARS) return false;
  return NOT_FOUND_PHRASES.some((re) => re.test(text));
}

/**
 * Failure message for a response that should not count as a success, or
 * `undefined` when the response is fine.
 */
export function httpFailureMessage(status: number, url: string, body: unknown): string | undefined {
  if (status >= 400) {
    return `HTTP ${status} for ${url}. The source is unavailable; try a different URL or source.`;
  }
  if (status >= 200 && status < 300 && isSoft404Body(body)) {
    return `HTTP ${status} for ${url} but the page body is a "not found" page. The source has no content; try a different URL or source.`;
  }
  return undefined;
}
