import { Either, Schema } from "effect";
import { PlanSchema, PlanSourceSchema } from "./plan.js";
import type { Plan, PlanFinding, PlanSource, PlanStep, PlanStepStatus } from "./plan.js";

/**
 * Portable plan formats: Markdown (editable checklist), JSON (versioned
 * envelope) and HTML (read-only, print-friendly). All functions are pure and
 * never throw; parsers return an `Either` carrying a {@link PlanParseError}.
 */

/** Current version of the portable plan formats (Markdown front-matter and JSON envelope). */
export const PLAN_FORMAT_VERSION = 1;

/** Why a portable plan could not be read. */
export type PlanParseReason = "no-steps" | "invalid-json" | "invalid-shape" | "unsupported-version";

/** Tagged failure value from the plan parsers. */
export interface PlanParseError {
  readonly _tag: "PlanParseError";
  /** Machine-readable cause. */
  readonly reason: PlanParseReason;
  /** Human-readable detail. */
  readonly message: string;
  /** The unsupported version when `reason` is `unsupported-version`; absent otherwise. */
  readonly version?: unknown;
}

const fail = (reason: PlanParseReason, message: string, version?: unknown): Either.Either<never, PlanParseError> =>
  Either.left({ _tag: "PlanParseError", reason, message, ...(version !== undefined ? { version } : {}) });

// ---------------------------------------------------------------- Markdown

const STATUS_CHAR: Readonly<Record<PlanStepStatus, string>> = {
  pending: " ",
  "in-progress": "~",
  done: "x",
  skipped: "-",
};

const statusOfChar = (c: string): PlanStepStatus | undefined =>
  c === " " ? "pending" : c === "x" || c === "X" ? "done" : c === "~" ? "in-progress" : c === "-" ? "skipped" : undefined;

const hex = (ch: string): string => `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`;

/** Single-line escape: backslash, line breaks, and edge whitespace (so trimming on read is safe). */
const escapeText = (s: string): string => {
  let out = s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  out = out.replace(/^\s+/u, (m) => Array.from(m).map(hex).join(""));
  out = out.replace(/\s+$/u, (m) => Array.from(m).map(hex).join(""));
  return out;
};

const unescapeText = (s: string): string =>
  s.replace(/\\(u\{[0-9a-f]+\}|[\s\S])/g, (_m, g: string) => {
    if (g.startsWith("u{")) return String.fromCodePoint(parseInt(g.slice(2, -1), 16));
    return g === "n" ? "\n" : g === "r" ? "\r" : g;
  });

/** Title escape additionally defuses the literal `(tool:` marker. */
const escapeTitle = (s: string): string => escapeText(s).replace(/\(tool:/g, "\\(tool:");
const escapeTool = (s: string): string => escapeText(s).replace(/\)/g, "\\)");

const escapeFindingTool = (s: string): string => escapeText(s).replace(/\]/g, "\\]");

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Render a plan as Markdown: a front-matter block (`id`, `source`, `createdAt`,
 * `version`), a `# <goal>` heading, and one checklist line per step:
 * `- [ ] title  (tool: name) <!--id:...-->` with `x` done, `~` in progress,
 * `-` skipped. When the plan has findings, a `## Findings` section follows the
 * steps, one line per finding: `- [tool] summary <!--id:...;at:...-->`.
 * Lossless with {@link planFromMarkdown}.
 */
export function planToMarkdown(plan: Plan): string {
  const head = [
    "---",
    `id: ${JSON.stringify(plan.id)}`,
    `source: ${plan.source}`,
    `createdAt: ${plan.createdAt}`,
    `version: ${PLAN_FORMAT_VERSION}`,
    "---",
    "",
    `# ${escapeText(plan.goal)}`,
    "",
  ];
  const lines = plan.steps.map((s) => {
    const tool = s.tool !== undefined ? `  (tool: ${escapeTool(s.tool)})` : "";
    return `- [${STATUS_CHAR[s.status]}] ${escapeTitle(s.title)}${tool} <!--id:${encodeURIComponent(s.id)}-->`;
  });
  const findings = plan.findings ?? [];
  const findingLines =
    findings.length === 0
      ? []
      : [
          "",
          FINDINGS_HEADING,
          "",
          ...findings.map(
            (f) =>
              `- [${escapeFindingTool(f.tool)}] ${escapeText(f.summary)} <!--id:${encodeURIComponent(f.id)}${
                f.at !== undefined ? `;at:${f.at}` : ""
              }-->`,
          ),
        ];
  return [...head, ...lines, ...findingLines, ""].join("\n");
}

const FINDINGS_HEADING = "## Findings";
const FINDINGS_HEADING_RE = /^##\s+findings\s*$/i;
const FINDING_LINE = /^\s*(?:[-*+]|\d+[.)])\s+([\s\S]*)$/;
const FINDING_TOOL = /^\[((?:[^\\\]]|\\[\s\S])*)\]\s?/;
const FINDING_TRAILER_MARK = "<!--id:";
const FINDING_TRAILER = /^<!--id:([^>;]*)(?:;at:(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?))?-->\s*$/i;

/** Parse one line of the `## Findings` section; `undefined` when the line is not a finding. */
const parseFindingLine = (rest: string, ordinal: number, used: Set<string>): PlanFinding | undefined => {
  let body = rest;
  let id: string | undefined;
  let at: number | undefined;
  const cut = body.lastIndexOf(FINDING_TRAILER_MARK);
  if (cut >= 0) {
    const tm = FINDING_TRAILER.exec(body.slice(cut));
    if (tm) {
      id = safeDecode(tm[1]!);
      if (tm[2] !== undefined && Number.isFinite(Number(tm[2]))) at = Number(tm[2]);
      body = body.slice(0, cut);
    }
  }
  let tool = "";
  const pm = FINDING_TOOL.exec(body);
  if (pm) {
    tool = unescapeText(pm[1]!);
    body = body.slice(pm[0].length);
  }
  const summary = unescapeText(body.trim());
  if (id === undefined && tool === "" && summary === "") return undefined;
  const base = id ?? `finding-${ordinal}`;
  let finalId = base;
  for (let n = 2; used.has(finalId); n++) finalId = `${base}-${n}`;
  used.add(finalId);
  return { id: finalId, tool, summary, ...(at !== undefined ? { at } : {}) };
};

/** Defaults for fields hand-edited Markdown may omit. */
export interface PlanFromMarkdownDefaults {
  /** Plan id when front-matter has none. Default `"plan"`. */
  readonly id?: string;
  /** Creation time when front-matter has none. Default `0` (the parser stays pure). */
  readonly createdAt?: number;
}

const ID_TRAILER = /\s*<!--id:([^>]*)-->\s*$/;
const TOOL_TRAILER = /\s\s\(tool: ((?:[^\\)]|\\[\s\S])*)\)\s*$/;
const ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX~-])\]\s?)?([\s\S]*)$/;

/**
 * Parse Markdown into a plan. Reads the format {@link planToMarkdown} writes
 * (lossless) and tolerant hand-edited Markdown: any `- [ ]`/`- [x]` line, or a
 * plain bulleted/numbered line (pending). Unknown front-matter keys are
 * ignored. Without front-matter the source is `user-edited`. Returns a
 * `no-steps` failure when no step lines exist; never throws.
 */
export function planFromMarkdown(
  markdown: string,
  defaults: PlanFromMarkdownDefaults = {},
): Either.Either<Plan, PlanParseError> {
  const lines = markdown.split(/\r\n|\n|\r/);
  let i = 0;
  const meta: Record<string, string> = {};
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
    if (close > 0) {
      for (const l of lines.slice(1, close)) {
        const m = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]*)$/.exec(l);
        if (m) meta[m[1]!] = m[2]!.trim();
      }
      i = close + 1;
    }
  }
  let goal: string | undefined;
  const steps: PlanStep[] = [];
  const used = new Set<string>();
  const findings: PlanFinding[] = [];
  const usedFindings = new Set<string>();
  let inFindings = false;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (FINDINGS_HEADING_RE.test(line)) {
      inFindings = true;
      continue;
    }
    if (inFindings) {
      if (/^#{1,6}\s/.test(line)) inFindings = false;
      else {
        const fm = FINDING_LINE.exec(line);
        const f = fm ? parseFindingLine(fm[1]!, findings.length + 1, usedFindings) : undefined;
        if (f) findings.push(f);
        continue;
      }
    }
    if (goal === undefined && /^#\s/.test(line)) {
      goal = unescapeText(line.slice(2).trim());
      continue;
    }
    const m = ITEM_LINE.exec(line);
    if (!m) continue;
    const status = m[1] !== undefined ? (statusOfChar(m[1]) ?? "pending") : "pending";
    let rest = m[2]!;
    let id: string | undefined;
    const idm = ID_TRAILER.exec(rest);
    if (idm) {
      id = safeDecode(idm[1]!);
      rest = rest.slice(0, idm.index);
    }
    let tool: string | undefined;
    const tm = TOOL_TRAILER.exec(rest);
    if (tm) {
      tool = unescapeText(tm[1]!);
      rest = rest.slice(0, tm.index);
    }
    const title = unescapeText(rest.trim());
    if (id === undefined && title === "") continue;
    let finalId = id ?? `step-${steps.length + 1}`;
    for (let n = 2; used.has(finalId); n++) finalId = `${id ?? `step-${steps.length + 1}`}-${n}`;
    used.add(finalId);
    steps.push({ id: finalId, title, status, ...(tool !== undefined ? { tool } : {}) });
  }
  if (steps.length === 0) return fail("no-steps", "No checklist or list items found in the Markdown.");

  const rawId = meta.id;
  let id = defaults.id ?? "plan";
  if (rawId !== undefined && rawId !== "") {
    try {
      const parsed: unknown = JSON.parse(rawId);
      id = typeof parsed === "string" ? parsed : rawId;
    } catch {
      id = rawId;
    }
  }
  const created = meta.createdAt !== undefined ? Number(meta.createdAt) : NaN;
  const createdAt = Number.isFinite(created) ? created : (defaults.createdAt ?? 0);
  const src = Schema.decodeUnknownEither(PlanSourceSchema)(meta.source);
  const source: PlanSource = Either.isRight(src) ? src.right : "user-edited";
  return Either.right({
    id,
    goal: goal ?? "",
    steps,
    createdAt,
    source,
    ...(findings.length > 0 ? { findings } : {}),
  });
}

// -------------------------------------------------------------------- JSON

const PlanEnvelopeSchema = Schema.Struct({
  kind: Schema.Literal("reactive-agents.plan"),
  version: Schema.Number,
  plan: PlanSchema,
});

/** Serialize a plan as a versioned JSON envelope: `{ kind, version, plan }`. */
export function planToJSON(plan: Plan): string {
  return JSON.stringify({ kind: "reactive-agents.plan", version: PLAN_FORMAT_VERSION, plan }, null, 2);
}

/**
 * Parse and schema-validate a JSON plan envelope. Failures: `invalid-json`,
 * `invalid-shape`, or `unsupported-version` (carrying the version seen).
 */
export function planFromJSON(json: string): Either.Either<Plan, PlanParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "";
    return fail("invalid-json", message || "Invalid JSON.");
  }
  if (typeof raw === "object" && raw !== null && "version" in raw) {
    const v = (raw as { readonly version: unknown }).version;
    if (v !== PLAN_FORMAT_VERSION) return fail("unsupported-version", `Unsupported plan version: ${String(v)}`, v);
  }
  const decoded = Schema.decodeUnknownEither(PlanEnvelopeSchema)(raw);
  if (Either.isLeft(decoded)) return fail("invalid-shape", "JSON is not a valid plan envelope.");
  return Either.right(decoded.right.plan);
}

// -------------------------------------------------------------------- HTML

/** Escape text for HTML element content and quoted attribute values. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const GLYPH: Readonly<Record<PlanStepStatus, string>> = {
  pending: "○",
  "in-progress": "◐",
  done: "✔",
  skipped: "⊘",
};

const CSS = `:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fff;--mut:#666;--chip:#eee}
@media (prefers-color-scheme:dark){:root{--fg:#e8e8e8;--bg:#161616;--mut:#999;--chip:#2a2a2a}}
body{font:16px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:48rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}.meta{color:var(--mut);font-size:.85rem}
ol{list-style:none;padding:0}li{padding:.35rem 0;display:flex;gap:.6rem;align-items:baseline}
.g{width:1.2rem;text-align:center}.done .t{color:var(--mut);text-decoration:line-through}.skipped .t{color:var(--mut)}
h2{font-size:1.1rem}ul.f{list-style:none;padding:0}ul.f li{display:block;padding:.35rem 0}.tl{margin-right:.4rem}
code{background:var(--chip);padding:.05rem .4rem;border-radius:.3rem;font-size:.8rem}
@media print{body{margin:0;max-width:none}}`;

/**
 * Render a plan as one self-contained HTML document: inline CSS (light/dark
 * via `prefers-color-scheme`, print-friendly), status glyphs, tool hints as
 * code chips. Every interpolated string is escaped; no scripts, no external assets.
 */
export function planToHtml(plan: Plan): string {
  const items = plan.steps
    .map(
      (s) =>
        `<li class="${s.status}"><span class="g" title="${esc(s.status)}">${GLYPH[s.status]}</span>` +
        `<span class="t">${esc(s.title)}</span>${s.tool !== undefined ? ` <code>${esc(s.tool)}</code>` : ""}</li>`,
    )
    .join("\n");
  const findings = plan.findings ?? [];
  const findingsHtml =
    findings.length === 0
      ? ""
      : `\n<h2>Findings</h2>\n<ul class="f">\n${findings
          .map((f) => `<li><code class="tl">${esc(f.tool)}</code><span class="t">${esc(f.summary)}</span></li>`)
          .join("\n")}\n</ul>`;
  const d = new Date(plan.createdAt);
  const when = Number.isNaN(d.getTime()) ? "" : d.toISOString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.goal)}</title><style>${CSS}</style></head>
<body><h1>${esc(plan.goal)}</h1>
<p class="meta">${esc(plan.source)}${when ? ` · ${esc(when)}` : ""} · ${esc(plan.id)}</p>
<ol>
${items}
</ol>${findingsHtml}</body></html>
`;
}
