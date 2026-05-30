// File: src/kernel/capabilities/verify/derive-conditions.ts
//
// deriveConditions(task, requiredTools) — turn a run's intent into a set of
// deterministic, state-grounded PostConditions. NO LLM. Conservative: emit a
// condition ONLY on a clear deliverable signal; otherwise emit nothing and let
// the prose verdict stand exactly as today (additive-only).
//
// Precedence (all that apply contribute):
//   1. requiredTools          -> ToolCalled(each)   (highest-confidence signal)
//   2. literal deliverable path in the task ("write/create/save/generate a
//      file ./X") -> ArtifactProduced('./X') + ToolCalled(<writing tool>)
//   3. (reserved) explicit output format -> OutputContains  [not derived yet —
//      kept conservative; the brief's high-precision bar is hard to hit from a
//      task string without false positives. Callers may add OutputContains
//      conditions directly.]
//
// If nothing derives -> EMPTY set.

import {
  artifactProduced,
  outputContains,
  toolCalled,
  WRITING_TOOL_NAMES,
  type PostCondition,
} from "./post-conditions.js";

// Tools that count as "writing" a file artifact — shared with post-conditions.ts
// (WRITING_TOOL_NAMES) so derive/produce vocabularies stay in lockstep. If a
// requiredTool matches one we use it as the writing tool; else default "file-write".
function pickWritingTool(requiredTools: readonly string[]): string {
  const match = requiredTools.find((t) =>
    WRITING_TOOL_NAMES.has(t.toLowerCase()),
  );
  return match ?? "file-write";
}

// HIGH-PRECISION literal deliverable-path matcher. Requires:
//   - an explicit write/create/save/generate verb, AND
//   - a file token "file"/"document"/"report" nearby OR a literal path, AND
//   - a concrete path token with an extension (e.g. ./commits.md, out.txt).
// Conservative on purpose: a bare "the file system" or "create a function"
// must NOT derive an artifact.
//
// Path token: optional leading "./", at least one path segment, a ".ext"
// (2-5 alnum). We require the path to look like a real filename, not prose.
const PATH_TOKEN = /(\.?\/?[\w./-]*[\w-]+\.[A-Za-z0-9]{1,5})/;
const WRITE_VERB = /\b(write|create|save|generate|produce|output)\b/i;
const FILE_NOUN = /\b(file|document|report|markdown|md|json|csv|txt)\b/i;

// Real file extensions we accept when the candidate has NO explicit path
// separator. Prose abbreviations like "e.g"/"i.e" produce a single-char or
// non-extension suffix and are excluded by construction. Conservative on
// purpose: a token with a separator (./X, /X) keeps the permissive behavior;
// a bare "word.suffix" only counts if `suffix` is a known real extension.
const REAL_FILE_EXTENSIONS = new Set<string>([
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "pdf",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "sh",
  "sql",
  "toml",
  "ini",
  "log",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
]);

// Known prose abbreviations whose dotted form would otherwise masquerade as a
// "word.ext" filename. Compared against the FULL lowercased candidate.
const PROSE_ABBREVIATIONS = new Set<string>([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "a.m",
  "p.m",
]);

function deriveDeliverablePath(task: string): string | undefined {
  if (!WRITE_VERB.test(task)) return undefined;

  // Find a path-like token. Prefer one inside parentheses (the brief's
  // canonical "create a markdown file (./commits.md)" form) but accept any.
  const parenMatch = task.match(/\(([^)]*?\.[A-Za-z0-9]{1,5})[^)]*\)/);
  const candidate = parenMatch
    ? parenMatch[1]?.match(PATH_TOKEN)?.[1]
    : task.match(PATH_TOKEN)?.[1];

  if (!candidate) return undefined;

  const hasSeparator = candidate.includes("/") || candidate.startsWith("./");

  // Reject known prose abbreviations outright ("e.g", "i.e", ...) — these
  // masquerade as "word.ext" but are never deliverables.
  if (PROSE_ABBREVIATIONS.has(candidate.toLowerCase())) return undefined;

  // Guard against matching version-like or domain-like tokens that happen to
  // contain a dot but aren't deliverables. Require either a file-noun in the
  // task OR an explicit path separator / leading ./ in the candidate.
  const looksLikePath = hasSeparator || FILE_NOUN.test(task);
  if (!looksLikePath) return undefined;

  // PRECISION GATE: without an explicit path separator, a bare "word.suffix"
  // only counts as a file when `suffix` is a known real file extension. This
  // rejects prose like "e.g" (suffix "g", single char) deriving "./e.g" even
  // when a file-noun appears elsewhere in the task. Separator-present tokens
  // (./X, /X) keep the permissive behavior.
  if (!hasSeparator) {
    const ext = candidate.split(".").pop()?.toLowerCase() ?? "";
    if (!REAL_FILE_EXTENSIONS.has(ext)) return undefined;
  }

  // Reject obvious non-deliverables (URLs, decimals).
  if (/^\d+\.\d+$/.test(candidate)) return undefined;
  if (/https?:/i.test(candidate)) return undefined;
  // A paren-extracted URL like `(https://example.com/x)` leaves `//example.com`
  // after the PATH_TOKEN strip — the protocol is gone so `/https?:/i` misses it.
  // A leading "//" is never a deliverable path; reject it as a protocol-relative URL.
  if (candidate.startsWith("//")) return undefined;

  // Normalize to a "./"-anchored relative path for the ArtifactProduced
  // condition (verify() normalizes both sides, so this is cosmetic).
  const cleaned = candidate.replace(/^\.\//, "");
  return `./${cleaned}`;
}

/**
 * Derive post-conditions for a run. Deterministic. NO LLM. Conservative.
 *
 * @param task          the task description
 * @param requiredTools tools the dispatcher requires (may be empty)
 */
export function deriveConditions(
  task: string,
  requiredTools: readonly string[],
): PostCondition[] {
  const conditions: PostCondition[] = [];
  const seen = new Set<string>();
  const push = (c: PostCondition): void => {
    const key = JSON.stringify(c);
    if (seen.has(key)) return;
    seen.add(key);
    conditions.push(c);
  };

  // 1. requiredTools -> ToolCalled(each)
  for (const tool of requiredTools) {
    if (typeof tool === "string" && tool.length > 0) push(toolCalled(tool));
  }

  // 2. literal deliverable path -> ArtifactProduced + writing ToolCalled
  const path = deriveDeliverablePath(task);
  if (path) {
    push(artifactProduced(path));
    push(toolCalled(pickWritingTool(requiredTools)));
  }

  return conditions;
}

// Re-export for callers that want to attach an output-format condition
// explicitly (deriveConditions stays conservative and does not infer these).
export { outputContains };
