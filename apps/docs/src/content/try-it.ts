/**
 * Where the first-screen "Try it" block (TryIt.astro) renders. One rule, one
 * place. Allowlist = entry/how-to pages where a runnable snippet helps. Denylist
 * = reference, release and meta pages where it is noise; the denylist wins over
 * the allowlist. A page can force it with frontmatter `tryIt: true` (denylist
 * still wins) or hide it with `tryIt: false`.
 */
export const TRY_IT_PAGES: ReadonlySet<string> = new Set([
  "guides/quickstart",
  "guides/installation",
  "guides/your-first-agent",
  "guides/reasoning",
  "guides/local-models",
  "guides/choosing-strategies",
  "guides/cost-optimization",
  "guides/tools",
  "cookbook/agent-tool-calling-mcp",
  "cookbook/local-agent-ollama",
]);

/** Prefixes and substrings that never show Try it. */
const DENY_PREFIXES = ["reference/", "concepts/", "whats-new", "guides/whats-new", "guides/troubleshooting"];
const DENY_CONTAINS = ["whats-new", "changelog", "release-notes", "stability", "glossary"];

export function isTryItDenied(pageId: string): boolean {
  return DENY_PREFIXES.some((p) => pageId.startsWith(p)) || DENY_CONTAINS.some((s) => pageId.includes(s));
}

export function shouldShowTryIt(pageId: string, override?: boolean): boolean {
  if (isTryItDenied(pageId)) return false;
  if (override !== undefined) return override;
  return TRY_IT_PAGES.has(pageId);
}
