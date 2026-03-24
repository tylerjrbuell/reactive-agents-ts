/**
 * 5-stage skill compression pipeline.
 * Each stage builds on the previous — stages are cumulative.
 *
 * Stage 0: No compression (full body)
 * Stage 1: Strip examples sections
 * Stage 2: Stage 1 + strip references sections
 * Stage 3: Stage 2 + condense paragraphs to first sentence
 * Stage 4: Stage 3 + keep only imperative sentences
 * Stage 5: Catalog-only (empty string — body not injected)
 */

// Action verbs for stage 4 imperative sentence detection
const ACTION_VERBS = [
  "add", "apply", "build", "call", "check", "clean", "close", "collect",
  "commit", "compare", "compute", "configure", "connect", "convert", "copy",
  "create", "debug", "define", "delete", "deploy", "detect", "disable",
  "download", "enable", "ensure", "establish", "evaluate", "execute",
  "export", "extract", "fetch", "filter", "find", "fix", "follow",
  "format", "generate", "get", "group", "handle", "identify", "implement",
  "import", "include", "initialize", "inject", "insert", "inspect",
  "install", "invoke", "iterate", "keep", "launch", "list", "load",
  "log", "make", "map", "merge", "monitor", "move", "normalize",
  "notify", "open", "optimize", "output", "override", "parse", "patch",
  "perform", "persist", "poll", "process", "provide", "publish", "pull",
  "push", "query", "read", "rebuild", "receive", "record", "reduce",
  "refresh", "register", "reject", "release", "reload", "remove",
  "rename", "render", "replace", "report", "request", "require",
  "reset", "resolve", "restart", "restore", "retrieve", "retry",
  "return", "revert", "review", "route", "run", "save", "scan",
  "schedule", "search", "select", "send", "serve", "set", "setup",
  "skip", "sort", "split", "start", "stop", "store", "stream",
  "strip", "submit", "subscribe", "summarize", "support", "sync",
  "tag", "terminate", "test", "throw", "track", "transform",
  "trigger", "trim", "truncate", "update", "upgrade", "upload",
  "use", "validate", "verify", "wait", "watch", "wire", "wrap", "write",
];

/** Remove markdown sections matching heading patterns (case-insensitive). */
function stripSections(body: string, headingPatterns: string[]): string {
  const lines = body.split("\n");
  const result: string[] = [];
  let skipping = false;
  let skipLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const title = headingMatch[2]!.toLowerCase().trim();

      if (headingPatterns.some(p => title.includes(p))) {
        skipping = true;
        skipLevel = level;
        continue;
      }

      if (skipping && level <= skipLevel) {
        skipping = false;
      }
    }

    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Keep only the first sentence of each paragraph. */
function condenseParagraphs(body: string): string {
  const lines = body.split("\n");
  const result: string[] = [];
  let sentenceAdded = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Headings always pass through
    if (trimmed.startsWith("#")) {
      result.push(line);
      sentenceAdded = false;
      continue;
    }

    // Empty line = paragraph boundary
    if (trimmed === "") {
      result.push(line);
      sentenceAdded = false;
      continue;
    }

    // List items always pass through
    if (trimmed.match(/^\d+\.\s/) || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      result.push(line);
      sentenceAdded = true;
      continue;
    }

    // First sentence of paragraph
    if (!sentenceAdded) {
      result.push(line);
      sentenceAdded = true;
    }
    // Subsequent sentences in paragraph are dropped
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Keep only imperative sentences (starting with action verbs). */
function keepImperatives(body: string): string {
  const lines = body.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Headings pass through
    if (trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }

    // Empty lines pass through
    if (trimmed === "") {
      result.push(line);
      continue;
    }

    // Check if line starts with a numbered list or bullet + action verb
    const listMatch = trimmed.match(/^(?:\d+\.\s+|- |\* )?(\w+)/);
    if (listMatch) {
      const firstWord = listMatch[1]!.toLowerCase();
      if (ACTION_VERBS.includes(firstWord)) {
        result.push(line);
      }
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Compress skill content using the specified stage.
 * Stages are cumulative: stage 3 = stage 1 + 2 + 3.
 *
 * @param body - Full skill instructions (markdown)
 * @param stage - Compression stage (0-5)
 * @returns Compressed content
 */
export function compressSkillContent(body: string, stage: number): string {
  if (stage <= 0) return body;
  if (stage >= 5) return "";

  let result = body;

  // Stage 1: Strip examples
  if (stage >= 1) {
    result = stripSections(result, ["example"]);
  }

  // Stage 2: Strip references
  if (stage >= 2) {
    result = stripSections(result, ["reference", "see also"]);
  }

  // Stage 3: Condense paragraphs to first sentence
  if (stage >= 3) {
    result = condenseParagraphs(result);
  }

  // Stage 4: Keep only imperative sentences
  if (stage >= 4) {
    result = keepImperatives(result);
  }

  return result;
}

/**
 * Get the default compression stage for a model tier.
 */
export function getDefaultCompressionStage(tier: string): number {
  switch (tier) {
    case "frontier": return 0;
    case "large": return 1;
    case "mid": return 2;
    case "local": return 4;
    default: return 2; // default to mid-tier behavior
  }
}

/**
 * Estimate token count for a text string.
 * Simple heuristic: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
