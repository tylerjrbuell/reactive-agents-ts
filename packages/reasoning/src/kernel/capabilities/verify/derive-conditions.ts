// File: src/kernel/capabilities/verify/derive-conditions.ts
//
// deriveConditions(task, requiredTools) — turn a run's intent into a set of
// deterministic, state-grounded PostConditions. NO LLM. Conservative: emit a
// condition ONLY on a clear deliverable signal; otherwise emit nothing and let
// the prose verdict stand exactly as today (additive-only).
//
// Precedence (all that apply contribute):
//   1. requiredTools          -> ToolCalled(each)   (highest-confidence signal)
//   2. every literal deliverable path in the task ("write/create/save/generate
//      ./X", a "produce these files:" list) -> ArtifactProduced(each) +
//      ToolCalled(<writing tool>), via the SAME deriver the RunContract uses
//   3. (reserved) explicit output format -> OutputContains  [not derived yet —
//      kept conservative; the brief's high-precision bar is hard to hit from a
//      task string without false positives. Callers may add OutputContains
//      conditions directly.]
//
// If nothing derives -> EMPTY set.

import type { RunPosture } from "@reactive-agents/core";
import { extractCurrentTurn } from "../../contract/current-turn.js";
import { isStepScope, type DeliveryScope } from "../../contract/delivery-scope.js";
import {
  artifactProduced,
  outputContains,
  sideEffectLanded,
  surfaceHasSubstantiveTool,
  toolCalled,
  WRITING_TOOL_NAMES,
  type PostCondition,
} from "./post-conditions.js";

// HIGH-PRECISION non-file mutation matcher. A task that asks to create/send/
// delete an EXTERNAL resource (a note, email, event, issue, …) via a tool has a
// side-effect deliverable with NO local file to disk-check — so `ToolCalled`
// (satisfied by a successful READ like a schema query) is the only signal, and
// it cannot tell a read from a failed write. Require BOTH a mutation verb AND an
// external-resource noun so a READ ("get the events", "summarise the note") and
// a bare "create a function" never derive a side-effect condition.
// "draft" and "invite" are deliberately verb-only (not also in the noun list
// below): `MUTATION_VERB.test(task) && EXTERNAL_RESOURCE_NOUN.test(task)`
// each run independently against the WHOLE task text, so a single word
// present in both lists satisfies both tests on its own — no genuine second
// word required. This bit a real run: `.withOutputSchema()`'s auto-injected
// prompt names the JSON-Schema meta-schema URI
// (`http://json-schema.org/draft-07/schema#`), and "draft" used to be in
// both lists, so EVERY structured-output task spuriously derived an
// unsatisfiable SideEffectLanded condition — the run then redirected to
// max_iterations trying to satisfy a requirement that names no real
// side-effect, surfaced as a hard failure once bare builders started
// throwing on max_iterations (2026-08-13, B1). Keep both lists disjoint.
const MUTATION_VERB =
  /\b(create|send|add|post|delete|remove|update|schedule|assign|upload|publish|rename|archive|move|share|invite|draft|reply|forward|submit|set)\b/i;
const EXTERNAL_RESOURCE_NOUN =
  /\b(note|email|e-mail|message|event|issue|pull[\s-]?request|pr|record|reminder|todo|task|label|calendar|comment|page|row|entry|ticket|memo|meeting|contact|folder|group|channel|list|thread)\b/i;

// Tools that count as "writing" a file artifact — shared with post-conditions.ts
// (WRITING_TOOL_NAMES) so derive/produce vocabularies stay in lockstep. If a
// requiredTool matches one we use it as the writing tool; else default "file-write".
export function pickWritingTool(requiredTools: readonly string[]): string {
  const match = requiredTools.find((t) =>
    WRITING_TOOL_NAMES.has(t.toLowerCase()),
  );
  return match ?? "file-write";
}

// HIGH-PRECISION literal deliverable-path vocabulary (used by
// `deriveDeliverableItems`). A path derives only when it is anchored to a
// write verb (or listed under a "produce these files:" intro) AND is a concrete
// path token with a separator or a real extension (./commits.md, out.txt).
// Conservative on purpose: a bare "the file system" or "create a function"
// must NOT derive an artifact.
//
// Path token: optional leading "./", at least one path segment, a ".ext"
// (2-5 alnum). We require the path to look like a real filename, not prose.
const PATH_TOKEN = /(\.?\/?[\w./-]*[\w-]+\.[A-Za-z0-9]{1,5})/;
const WRITE_VERB = /\b(write|create|save|generate|produce|output)\b/gi;

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

/**
 * Technology names that LOOK like bare filenames (`<word>.<real-extension>`) but
 * name an ecosystem, never a deliverable. "Generate a summary using Node.js"
 * has a write verb in front of `Node.js`, so verb anchoring alone will not
 * exclude it.
 *
 * These were previously excluded as a SIDE EFFECT of requiring a generic file
 * noun somewhere in the task — a gate that also rejected precisely-named
 * deliverables like rw-4's `output.ts` (see derive-bare-filename.test.ts). The
 * class is now denied BY NAME, in the same idiom as PROSE_ABBREVIATIONS, so
 * recall does not depend on the task happening to say the word "file".
 */
const TECH_NAME_TOKENS = new Set<string>([
  "node.js",
  "react.js",
  "next.js",
  "vue.js",
  "nuxt.js",
  "express.js",
  "nest.js",
  "d3.js",
  "three.js",
  "chart.js",
  "socket.io",
  "vite.js",
  "ember.js",
  "backbone.js",
  "angular.js",
  "jquery.js",
]);

// ─── Placeholder (template) paths (H3 2026-11-03) ───────────────────────────
//
// "For each notes-N.txt, write out-N.txt" names a FAMILY of files through a
// template variable. Compiling `out-N.txt` as a literal deliverable minted
// `artifact:./out-N.txt`, a file no correct run ever writes, so the runtime's
// unproduced-deliverable veto failed runs that wrote all six real files.
// Rule: a placeholder is NEVER a literal deliverable. We do not guess the
// expansion (out-1..out-6); the task's other signals (required tools, the
// output) carry the family. Real paths (README.md, src/A.ts) are untouched.

/** Characters that mark a token as a fragment of a template (`<n>`, `{i}`, `[k]`, `*`, `$i`, `%d`). */
const TEMPLATE_DELIMITERS = new Set<string>(["<", ">", "{", "}", "[", "]", "*", "$", "%"]);

/**
 * Family cue: the task describes a SET of items ("for each", "every", "per",
 * "notes-1.txt through notes-6.txt", "1..N", "1 to 6"). Required before a
 * single-uppercase-letter segment counts as a variable, so a real name like
 * `v2/X-ray.md` in a plain task stays a literal deliverable.
 */
const FAMILY_CUE =
  /\b(?:each|every|per|for\s+all|through|thru)\b|\b\d+\s*(?:\.\.|to|-)\s*(?:\d+|[A-Z])\b/i;

/**
 * Is `candidate` (found at `start` in `task`) a template placeholder rather
 * than a literal path? True when either:
 *  1. it touches a template delimiter in the task text (the regex captured a
 *     FRAGMENT of `out-{i}-final.txt` / `$i.txt`, never a real path), or
 *  2. its filename stem has a single-uppercase-letter segment joined to other
 *     segments (`out-N`, `file_X`, `chapter-N-notes`) AND the task has a family
 *     cue. A stem that IS one letter (`src/A.ts`) is a real name.
 */
export function isPlaceholderPath(candidate: string, task: string, start: number): boolean {
  const before = start > 0 ? task.charAt(start - 1) : "";
  const after = task.charAt(start + candidate.length);
  if (TEMPLATE_DELIMITERS.has(before) || TEMPLATE_DELIMITERS.has(after)) return true;
  const base = candidate.split("/").pop() ?? candidate;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const segments = stem.split(/[-_.]/).filter((s) => s.length > 0);
  if (segments.length < 2) return false;
  if (!segments.some((s) => /^[A-Z]$/.test(s))) return false;
  return FAMILY_CUE.test(task);
}

// ─── Bound template expansion (H3 2026-11-04) ───────────────────────────────
//
// A placeholder is dropped because its members are unknown — UNLESS the task
// itself binds the variable. "notes-1.txt through notes-6.txt ... For each
// notes-N.txt, write out-N.txt" names the domain of N twice: an INPUT template
// (notes-N.txt) with the same variable, and literal instances of that input
// template (a range or a list). Expanding out-N.txt over that domain is
// deterministic substitution, not a guess. Every other shape (no binding, a
// disagreeing second binding, a non-numeric or reversed range, zero-padded
// values, more than MAX_BOUND_FAMILY items) keeps the placeholder dropped.
// Only the single-uppercase-letter variable form (`out-N.txt`) is expanded;
// delimiter forms (`out-{i}.txt`, `out-<n>.txt`) are never expanded.

/** Past this size an expansion is not a per-item checklist; the placeholder stays dropped. */
export const MAX_BOUND_FAMILY = 50;

/** The text between two literal instances that makes them an inclusive range. */
const RANGE_CONNECTOR = /^\s*(?:through|thru|to|-|–|—|\.\.)\s*$/i;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A template path split around its one variable segment: `prefix + value + suffix`. */
interface TemplateShape {
  readonly variable: string;
  /** Directory + file-name text before the variable (`reports/ch-`). */
  readonly prefix: string;
  /** File-name text before the variable, no directory (`ch-`). */
  readonly namePrefix: string;
  readonly suffix: string;
}

/**
 * The shape of a template path: exactly one single-uppercase-letter stem
 * segment joined to at least one other segment (`out-N.txt`, `dir/ch-N-notes.md`).
 * `undefined` for a literal path, a stem that IS one letter (`src/A.ts`), or a
 * stem with two variable segments (ambiguous).
 */
function templateShape(path: string): TemplateShape | undefined {
  const clean = path.replace(/^\.\//, "");
  const slash = clean.lastIndexOf("/");
  const dir = clean.slice(0, slash + 1);
  const base = clean.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  // Separators are kept at odd indices so the shape rebuilds byte-exactly.
  const parts = base.slice(0, dot).split(/([-_.])/);
  const segments = parts.filter((p, i) => i % 2 === 0 && p.length > 0);
  if (segments.length < 2) return undefined;
  const varIdx = parts.flatMap((p, i) => (i % 2 === 0 && /^[A-Z]$/.test(p) ? [i] : []));
  if (varIdx.length !== 1) return undefined;
  const at = varIdx[0] ?? 0;
  const namePrefix = parts.slice(0, at).join("");
  return {
    variable: parts[at] ?? "",
    prefix: dir + namePrefix,
    namePrefix,
    suffix: parts.slice(at + 1).join("") + base.slice(dot),
  };
}

/**
 * The values an input template is bound to by its literal instances in the
 * task: each "a through|thru|to|-|.. b" pair is an inclusive range, every
 * other instance is a listed value. `undefined` when fewer than two values
 * bind it, or when the instances sit in different directories; `null` when
 * the binding is invalid (reversed range, zero padding, too many items) —
 * invalid poisons the whole expansion.
 *
 * Instances match the template by FILE NAME: a task (or a harness that
 * absolutizes inputs) may name them `/abs/w/notes-1.txt`, `./notes-1.txt` or
 * `data/notes-1.txt` while the template says `notes-N.txt`. Every instance
 * that binds must share one directory (`./` stripped), so a range from
 * `a/notes-1.txt` to `b/notes-6.txt` binds nothing.
 */
function boundValues(input: TemplateShape, task: string): number[] | undefined | null {
  const literal = new RegExp(
    // Not inside a longer name (`x-notes-1.txt`, `a.notes-1.txt`); a ".." range
    // connector right before the instance is allowed. The optional directory
    // (absolute, ./rel, rel/dir) is captured so instances can be compared.
    `(?<![\\w/-])(?<![\\w-]\\.)((?:[\\w.~-]*/)*)${escapeRegExp(input.namePrefix)}(\\d+)${escapeRegExp(input.suffix)}(?![\\w-]|\\.\\w)`,
    "g",
  );
  const hits = [...task.matchAll(literal)].map((m) => ({
    dir: (m[1] ?? "").replace(/^(?:\.\/)+/, ""),
    raw: m[2] ?? "",
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  if (new Set(hits.map((h) => h.dir)).size > 1) return undefined;
  if (hits.some((h) => /^0\d/.test(h.raw))) return null;
  const values: number[] = [];
  const add = (v: number): void => {
    if (!values.includes(v)) values.push(v);
  };
  for (let i = 0; i < hits.length; i++) {
    const a = hits[i];
    const b = hits[i + 1];
    if (a === undefined) continue;
    const lo = Number(a.raw);
    if (b !== undefined && RANGE_CONNECTOR.test(task.slice(a.end, b.start))) {
      const hi = Number(b.raw);
      if (hi < lo || hi - lo + 1 > MAX_BOUND_FAMILY) return null;
      for (let v = lo; v <= hi; v++) add(v);
      i++;
      continue;
    }
    add(lo);
  }
  if (values.length > MAX_BOUND_FAMILY) return null;
  return values.length >= 2 ? values : undefined;
}

/**
 * Expand a template OUTPUT path over the domain the task binds its variable
 * to, or `undefined` when the task does not bind it explicitly.
 *
 * Binding = another template in the task with the SAME variable (the input,
 * `notes-N.txt`) AND literal instances of that input template: a range
 * ("notes-1.txt through notes-6.txt") or a list ("notes-1.txt, notes-2.txt and
 * notes-4.txt"). Endpoints that differ in any segment besides the variable are
 * not instances of the input template, so they bind nothing. Two input
 * templates that bind different domains are ambiguous → `undefined`.
 *
 * Returns "./"-anchored paths in domain order. Pure, deterministic, NO fs.
 */
export function expandBoundTemplate(candidate: string, task: string): string[] | undefined {
  const output = templateShape(candidate);
  if (output === undefined) return undefined;
  const pathRe = new RegExp(PATH_TOKEN.source, "g");
  let domain: number[] | undefined;
  const checked = new Set<string>();
  for (const m of task.matchAll(pathRe)) {
    const input = templateShape(m[1] ?? "");
    if (input === undefined || input.variable !== output.variable) continue;
    if (input.prefix === output.prefix && input.suffix === output.suffix) continue; // the output itself
    const key = `${input.prefix}\u0000${input.suffix}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const values = boundValues(input, task);
    if (values === null) return undefined;
    if (values === undefined) continue;
    if (domain !== undefined && domain.join(",") !== values.join(",")) return undefined;
    domain = values;
  }
  if (domain === undefined) return undefined;
  return domain.map((v) => `./${output.prefix}${v}${output.suffix}`);
}

// ─── Multi-path derivation (audit 01-F5 fix) ─────────────────────────────────
//
// The ONE deliverable-path deriver (2026-11-04: the single-path deriver that
// bound to the LAST write verb and returned one target is gone). One target was
// the brittle behavior audit 01-F5 flagged — a task that asks for THREE files
// (rw-8: types.ts / generate.ts / validate.ts) or enumerates a deliverable list
// (lh-1, h3-plan-only) collapsed to one derived artifact, or to NONE when no
// path followed the last write verb ("Produce these three files: ... Create the
// files"), so the terminal gates could report DONE with deliverables missing
// while the RunContract listed them. `deriveConditions` and `compileRunContract`
// now both call `deriveDeliverableItems`, so they agree by construction.
//
// It uses the shared precision vocabulary (PATH_TOKEN, PROSE_ABBREVIATIONS,
// TECH_NAME_TOKENS, REAL_FILE_EXTENSIONS) and two rules:
//   1. it scans EVERY path token in the task, not just the one after the last
//      write verb, and
//   2. it classifies each candidate by its NEAREST preceding action verb: a
//      write verb (write/create/save/…) anchors a deliverable; a read verb
//      (read/analyze/fetch/given/…) marks a task INPUT that must never derive an
//      artifact. Paths with no nearby verb are admitted only in genuine
//      produce-these-files shape: the task has a deliverable-list intro
//      (lh-1's shape) AND a write verb anywhere before the token, AND the
//      token is neither existentially framed ("there are N files, ...") nor
//      consumed by a forward read verb (GH #251). A forward read verb also
//      vetoes a DISTANT write anchor; only an adjacent write ("write X")
//      directly governs its token.
//
// Consumed by the RunContract compiler (kernel/contract/) — the deterministic
// floor that guarantees every declared deliverable becomes a typed requirement —
// and by `deriveConditions` below (the stored set the terminal gates verify).

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
 * How far ahead of a path token we look for a consuming read verb (GH #251).
 * A path the task is about to READ ("Read both files") is an input, never a
 * deliverable. Symmetric with ANCHOR_BACK_WINDOW.
 */
const FORWARD_READ_WINDOW = 80;

/**
 * A write verb this close before a path token directly governs it
 * ("write X", "write a file named X" — the token is the verb's direct
 * object). A later "read it back to verify" must not veto such a
 * deliverable, so the forward read-verb veto applies only to write anchors
 * farther away than this (GH #251).
 */
const WRITE_ADJACENT_WINDOW = 30;

/**
 * Inventory phrasing that frames listed paths as pre-existing task INPUTS,
 * never deliverables (GH #251: "there are two files, sales-q1.txt and
 * sales-q2.txt ..."). Tested against the backward anchor window.
 */
const EXISTENTIAL_LIST_RE = /\bthere\s+(are|is)\b[^.]{0,60}\bfiles?\b/i;

/** Stateless (non-global) tests reusing the exact anchor vocabularies. */
const WRITE_VERB_TEST = new RegExp(WRITE_VERB.source, "i");
const READ_VERB_TEST = new RegExp(READ_VERB_RE.source, "i");

/**
 * Does `candidate` pass the same precision gates the single-path deriver uses?
 * Shared vocabulary (not a fork): a path token counts only when it has a real
 * separator or a real file extension, is not a prose abbreviation, and is not a
 * URL / decimal / protocol-relative token.
 */
function passesPathPrecision(candidate: string, task: string): boolean {
  if (PROSE_ABBREVIATIONS.has(candidate.toLowerCase())) return false;
  if (TECH_NAME_TOKENS.has(candidate.toLowerCase())) return false;
  const hasSeparator = candidate.includes("/") || candidate.startsWith("./");
  if (!hasSeparator) {
    // For a separator-less candidate the REAL extension is the precision gate.
    // It used to ALSO require a generic file noun somewhere in the task
    // (`FILE_NOUN.test(task)`), which bought no precision the extension check
    // does not already provide and cost real recall: rw-4's "write a TypeScript
    // module to output.ts" derived NOTHING, because the task says "module" and
    // its only "json" is inside "JSONPlaceholder". A task that names its
    // deliverable exactly should not have to name it twice. The prose class
    // that gate incidentally covered is now denied by name (TECH_NAME_TOKENS).
    const ext = candidate.split(".").pop()?.toLowerCase() ?? "";
    if (!REAL_FILE_EXTENSIONS.has(ext)) return false;
  }
  void task;
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
  return deriveDeliverableItems(task).map((d) => d.path);
}

/** One derived deliverable path; `template` is the span of the bound template it was expanded from. */
export interface DerivedDeliverable {
  readonly path: string;
  readonly template?: { readonly start: number; readonly length: number };
}

/**
 * `deriveDeliverablePaths` with provenance: an expanded member of a bound
 * template (`out-N.txt` → `./out-1.txt` …) carries the template's span in the
 * task. Same paths, same order.
 */
export function deriveDeliverableItems(task: string): DerivedDeliverable[] {
  const listMode = DELIVERABLE_LIST_INTRO.test(task);
  const globalPathRe = new RegExp(PATH_TOKEN.source, "g");
  const out: DerivedDeliverable[] = [];
  const seen = new Set<string>();

  for (const m of task.matchAll(globalPathRe)) {
    const candidate = m[1];
    const start = m.index ?? 0;
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (!passesPathPrecision(candidate, task)) continue;
    // A token called like a function is code, never a file: "What is the
    // output of: console.log(typeof null)?" must not derive ./console.log.
    if (task.charAt(start + candidate.length) === "(") continue;
    // A placeholder is dropped unless the task binds its variable; a bound
    // template is anchored like a literal path, then admits every member.
    let family: string[] | undefined;
    if (isPlaceholderPath(candidate, task, start)) {
      family = expandBoundTemplate(candidate, task);
      if (family === undefined) continue;
    }

    const backStart = Math.max(0, start - ANCHOR_BACK_WINDOW);
    const back = task.slice(backStart, start);
    const writeEnd = lastVerbEnd(back, new RegExp(WRITE_VERB.source, "gi"));
    const readEnd = lastVerbEnd(back, READ_VERB_RE);
    const end = start + candidate.length;

    /**
     * Forward read-verb veto (GH #251): a path the task goes on to READ is
     * an input, never a deliverable.
     */
    const forwardReadVeto = (): boolean =>
      READ_VERB_TEST.test(task.slice(end, end + FORWARD_READ_WINDOW));

    // Nearest preceding verb decides. Read-anchored => input, never a deliverable.
    let admit: boolean;
    if (writeEnd === -1 && readEnd === -1) {
      // List-mode fallback (no anchoring verb nearby): NEVER admit on the
      // list intro alone (GH #251 — a singular "write a file named X" trips
      // DELIVERABLE_LIST_INTRO and would mint every listed input). Require a
      // write verb ANYWHERE before the token (genuine lists like lh-1's
      // "Produce THREE deliverable files ..." satisfy this; S3's inputs,
      // named before any write verb exists, do not), plus no existential
      // inventory framing and no forward read consuming the token.
      admit =
        listMode &&
        WRITE_VERB_TEST.test(task.slice(0, start)) &&
        !EXISTENTIAL_LIST_RE.test(back) &&
        !forwardReadVeto();
    } else if (writeEnd >= readEnd) {
      // Write-anchored: admit, except a DISTANT write anchor loses to a
      // forward read ("Write a summary ... data-a.txt must be read first").
      // An adjacent write directly governs the token ("write X then read it
      // back to verify") and is never vetoed.
      const writeDistance = start - (backStart + writeEnd);
      admit =
        writeDistance <= WRITE_ADJACENT_WINDOW || !forwardReadVeto();
    } else {
      admit = false;
    }
    if (!admit) continue;

    for (const path of family ?? [candidate]) {
      const normalized = `./${path.replace(/^\.\//, "")}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(
        family === undefined
          ? { path: normalized }
          : { path: normalized, template: { start, length: candidate.length } },
      );
    }
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
  /**
   * Tools ACTUALLY available to this run that can write a file (FM-15 layer 5).
   * `compileRunContract` takes the same signal; both derive the "a file was
   * written implies a writing tool was called" condition, and they must agree —
   * they are two authorities over one fact. Omitted → legacy guess.
   *
   * Empty means no tool can write, so the condition is UNSATISFIABLE and is not
   * pushed: `ArtifactProduced`'s disk truth still grounds the deliverable.
   */
  availableWritingTools?: readonly string[],
  /**
   * `"step"`: a per-step sub-kernel whose task text carries its parent's goal;
   * the files that text names are not held here (delivery-scope.ts).
   * Absent ⇒ the run owns every file its task text names.
   */
  deliveryScope?: DeliveryScope,
): PostCondition[] {
  // Root fix (2026-09-04): two independent call sites prepend prior-turn prose
  // to the task text verbatim before it reaches the kernel:
  //   - `ReactiveAgent.chat()`'s tool-capable path: "Context from prior run:
  //     ${contextSummary}\n\nNew request: ${message}" (reactive-agent.ts)
  //   - `withHistoryBlock()` (reactive-agent.ts, shared with the gateway's
  //     `formatHistoryBlock`): "--- Conversation history ---\n...\n\n
  //     --- Current message ---\n${input}" — and the two COMPOSE, since
  //     `.run()` calls withHistoryBlock on the already-chat-enriched string.
  // Prior-turn prose narrates what ALREADY happened ("searched the page and
  // shared a summary of the note") in past tense — exactly the MUTATION_VERB
  // + EXTERNAL_RESOURCE_NOUN vocabulary this heuristic scans for, but it
  // describes PAST work, not what the CURRENT turn is asking for. Left
  // unstripped, a plain conversational follow-up ("that's so cool") inherited
  // an unsatisfiable SideEffectLanded condition from the previous turn's own
  // rich prose and looped indefinitely (verified live — the post-condition
  // steer can never land a side-effect a banter reply was never going to
  // produce). Scan only the text after the LAST of either marker (whichever
  // is closer to the actual current ask); absent both, byte-identical.
  // Marker parsing now lives in ONE place: contract/current-turn.ts.
  const scanTask = extractCurrentTurn(task).text;

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

  // 2. every literal deliverable path -> ArtifactProduced(each) + writing
  //    ToolCalled. The SAME deriver over the SAME current-turn text as the
  //    RunContract's task-explicit items, so the two sets cannot disagree. A
  //    step kernel's named files are its parent's (delivery-scope.ts): none is
  //    held here, exactly as compileRunContract compiles none.
  const paths = deriveDeliverablePaths(scanTask);
  if (paths.length > 0) {
    if (!isStepScope({ deliveryScope })) {
      for (const path of paths) push(artifactProduced(path));
      const writer =
        availableWritingTools === undefined
          ? pickWritingTool(requiredTools)
          : (requiredTools.find((t) => availableWritingTools.includes(t)) ??
             availableWritingTools[0]);
      if (writer !== undefined) push(toolCalled(writer));
    }
  } else if (MUTATION_VERB.test(scanTask) && EXTERNAL_RESOURCE_NOUN.test(scanTask)) {
    // 3. non-file mutation (create/send/… a note/email/event) -> the side-effect
    //    must LAND. Excluded when a file path derived above: ArtifactProduced's
    //    disk truth already grounds that case, and adding a terminal-success
    //    condition on top would false-negative a write-then-failed-read run.
    push(sideEffectLanded());
  }

  return conditions;
}

/**
 * The set the runner seeds on `state.meta.postConditions`: the derived set
 * minus the conditions this run's tool surface can never satisfy. Returns
 * `undefined` when nothing derived (the seed is skipped, as before).
 *
 * `SideEffectLanded` is met only by a successful substantive tool call, and it
 * is derived from task PROSE, often prose the task only QUOTES: a Cortex
 * compaction prompt embeds a transcript that says "create a note ... the tool
 * call failed". On a surface with no substantive tool (a tool-less `direct`
 * utility run: none, or meta-tools only) it can never be met, so the gates
 * listed "retry the failed tool call" as outstanding and the handoff appended
 * `Unfinished:` to a good summary (K1, 2026-11-04). It is not a contract
 * deliverable, so nothing else holds the run to it once it is dropped here.
 *
 * `ArtifactProduced` stays even on a tool-less surface: the RunContract and the
 * runtime's unproduced-deliverable veto (F1 "talking is not doing") hold the
 * run to a declared file whatever this seed says, so dropping it here would
 * only split the authorities. A file named in QUOTED text must be kept out of
 * the current turn by the caller (`contract/current-turn.ts` markers).
 *
 * The filtered set is returned even when it is EMPTY: an empty stored set means
 * "derived and found nothing this run can be held to", and keeps the
 * Arbitrator's derive-from-task fallback from re-adding the dropped condition.
 *
 * `rails` are the run-shape exemptions the fallback cannot see, so they store
 * an explicit EMPTY set rather than skipping the seed: under plan posture the
 * run is held to nothing it derives (the tools are withheld), and a step
 * kernel (`deliveryScope: "step"`) whose derive held nothing must not have the
 * fallback re-derive its parent's files from the same text.
 */
export function seedPostConditions(
  derived: readonly PostCondition[],
  surface: readonly { readonly name: string }[] | undefined,
  rails: { readonly posture?: RunPosture; readonly deliveryScope?: DeliveryScope } = {},
): PostCondition[] | undefined {
  if (rails.posture === "plan") return [];
  if (derived.length === 0) return isStepScope(rails) ? [] : undefined;
  if (surfaceHasSubstantiveTool(surface)) return [...derived];
  return derived.filter((c) => c.kind !== "SideEffectLanded");
}

// Re-export for callers that want to attach an output-format condition
// explicitly (deriveConditions stays conservative and does not infer these).
export { outputContains };
