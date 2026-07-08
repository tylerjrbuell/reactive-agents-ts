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
export function pickWritingTool(requiredTools: readonly string[]): string {
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
const WRITE_VERB = /\b(write|create|save|generate|produce|output)\b/gi;
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
  // Bind the deliverable to a WRITE verb, never to a READ/fetch input. For the
  // common read-X-then-write-Y shape, the artifact is the path that FOLLOWS the
  // (last) write verb — not the first path token in the string (which is often
  // the read input). Scope ALL candidate selection + precision gates to the
  // post-write-verb substring so a read-side path can never be chosen.
  const writeVerbs = [...task.matchAll(WRITE_VERB)];
  if (writeVerbs.length === 0) return undefined;

  const lastWrite = writeVerbs[writeVerbs.length - 1];
  const after = task.slice((lastWrite.index ?? 0) + lastWrite[0].length);

  // Find a path-like token in the post-write substring. Prefer one inside
  // parentheses (the brief's canonical "create a markdown file (./commits.md)"
  // form) but accept any. A path that follows only a read verb cannot appear
  // here, so the read input is never a candidate.
  const parenMatch = after.match(/\(([^)]*?\.[A-Za-z0-9]{1,5})[^)]*\)/);
  const candidate = parenMatch
    ? parenMatch[1]?.match(PATH_TOKEN)?.[1]
    : after.match(PATH_TOKEN)?.[1];

  // No path follows a write verb -> derive NO ArtifactProduced (stay
  // conservative; do NOT fall back to a read-side path).
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

// ─── Multi-path derivation (audit 01-F5 fix) ─────────────────────────────────
//
// `deriveDeliverablePath` above is single-path: it binds to the LAST write verb
// and returns ONE target. That is the brittle behavior audit 01-F5 flagged — a
// task that asks for THREE files (rw-8: types.ts / generate.ts / validate.ts) or
// enumerates a deliverable list (lh-1: findings.json / report.md / sources.md)
// collapses to a single derived artifact, so the terminal gate can report DONE
// with two of three deliverables missing.
//
// `deriveDeliverablePaths` fixes this WITHOUT changing the single-path function
// (kept byte-identical for its existing terminal-gate / arbitrator callers). It
// reuses the exact same precision vocabulary (PATH_TOKEN, PROSE_ABBREVIATIONS,
// FILE_NOUN, REAL_FILE_EXTENSIONS) — it does not fork it — and adds two things:
//   1. it scans EVERY path token in the task, not just the one after the last
//      write verb, and
//   2. it classifies each candidate by its NEAREST preceding action verb: a
//      write verb (write/create/save/…) anchors a deliverable; a read verb
//      (read/analyze/fetch/given/…) marks a task INPUT that must never derive an
//      artifact. Paths with no nearby verb are admitted only when the task has a
//      "produce these files:" deliverable-list intro (lh-1's shape).
//
// Consumed by the RunContract compiler (kernel/contract/) — the deterministic
// floor that guarantees every declared deliverable becomes a typed requirement.

/** Read / consume verbs — a path anchored to one of these is a task INPUT. */
const READ_VERB_RE =
  /\b(?:read|open|load|cat|fetch|retrieve|download|analyze|examine|inspect|profile|parse|review|given|attached)\b/gi;

/**
 * A "produce these deliverable files:" intro — a write verb followed within a
 * short window by a plural deliverable noun. When present, path tokens that are
 * merely LISTED (no nearby verb, e.g. a numbered "1. findings.json") still count
 * as deliverables. Read-anchored paths are still excluded even in list mode.
 */
const DELIVERABLE_LIST_INTRO =
  /\b(?:write|create|save|generate|produce|output)\b[^.]{0,40}\b(?:files?|deliverables?|documents?|artifacts?|reports?)\b/i;

/** How far back from a path token we look for its anchoring verb. */
const ANCHOR_BACK_WINDOW = 80;

/**
 * Does `candidate` pass the same precision gates the single-path deriver uses?
 * Shared vocabulary (not a fork): a path token counts only when it has a real
 * separator or a real file extension, is not a prose abbreviation, and is not a
 * URL / decimal / protocol-relative token.
 */
function passesPathPrecision(candidate: string, task: string): boolean {
  if (PROSE_ABBREVIATIONS.has(candidate.toLowerCase())) return false;
  const hasSeparator = candidate.includes("/") || candidate.startsWith("./");
  const looksLikePath = hasSeparator || FILE_NOUN.test(task);
  if (!looksLikePath) return false;
  if (!hasSeparator) {
    const ext = candidate.split(".").pop()?.toLowerCase() ?? "";
    if (!REAL_FILE_EXTENSIONS.has(ext)) return false;
  }
  if (/^\d+\.\d+$/.test(candidate)) return false;
  if (/https?:/i.test(candidate)) return false;
  if (candidate.startsWith("//")) return false;
  return true;
}

/** Index of the nearest write-verb end within a backward window, or -1. */
function lastVerbEnd(window: string, re: RegExp): number {
  re.lastIndex = 0;
  let end = -1;
  for (const m of window.matchAll(re)) {
    end = (m.index ?? 0) + m[0].length;
  }
  return end;
}

/**
 * Derive ALL deterministic deliverable paths in a task (audit 01-F5 fix).
 * Deterministic, NO LLM, NO fs. Returns "./"-anchored, de-duplicated paths in
 * first-appearance order. Empty when nothing derives (conservative).
 */
export function deriveDeliverablePaths(task: string): string[] {
  const listMode = DELIVERABLE_LIST_INTRO.test(task);
  const globalPathRe = new RegExp(PATH_TOKEN.source, "g");
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of task.matchAll(globalPathRe)) {
    const candidate = m[1];
    const start = m.index ?? 0;
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (!passesPathPrecision(candidate, task)) continue;

    const back = task.slice(Math.max(0, start - ANCHOR_BACK_WINDOW), start);
    const writeEnd = lastVerbEnd(back, new RegExp(WRITE_VERB.source, "gi"));
    const readEnd = lastVerbEnd(back, READ_VERB_RE);

    // Nearest preceding verb decides. Read-anchored => input, never a deliverable.
    let admit: boolean;
    if (writeEnd === -1 && readEnd === -1) admit = listMode;
    else admit = writeEnd >= readEnd;
    if (!admit) continue;

    const normalized = `./${candidate.replace(/^\.\//, "")}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
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
