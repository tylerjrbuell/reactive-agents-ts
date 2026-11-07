import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import { DEFAULT_SKILL_FILE_MAX_BYTES, readSkillFile } from "./skill-file-read.js";

/**
 * The `activate-skill` meta-tool schema: `{ name, file? }`.
 *
 * The description is static on purpose. The skill catalog renders once in
 * the system prefix; keeping it out of this description means activation
 * never changes a tool schema, so the wire tools array stays byte-stable
 * (skills spec §5 item 1, §11 item 4).
 */
export const activateSkillTool: ToolDefinition = {
  name: "activate-skill",
  description:
    "Load a skill's full instructions by name, from the Skills list in your system prompt. " +
    "Call it before you start that kind of work; the instructions stay in your context for the rest of the run. " +
    "Pass `file` to read one file bundled with the skill instead (a path relative to the skill's directory).",
  parameters: [
    {
      name: "name",
      type: "string",
      description: "The skill name, exactly as listed in the Skills list.",
      required: true,
    },
    {
      name: "file",
      type: "string",
      description:
        "Optional. A file inside the skill's directory to read, relative to it, e.g. \"references/guide.md\". " +
        "Omit it to load the skill's instructions.",
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "function",
};

/** Escape XML attribute values so untrusted name/source cannot break out of the tag. */
function escapeXmlAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Neutralize skill-wrapper boundary tags inside untrusted body text so an
 * `instructions` payload containing `</skill_content>` (or `<skill_content>`,
 * `<skill_resources>`) cannot prematurely close the wrapper and inject
 * free-form instructions. Only the tag-opening `<` is escaped, preserving
 * legitimate markdown/code content elsewhere in the body.
 */
function neutralizeSkillTags(body: string): string {
  return body.replace(/<(\/?)(skill_content|skill_resources)\b/gi, "&lt;$1$2");
}

/**
 * Build the <skill_content> XML wrapper for an activated skill.
 *
 * Skill fields are treated as untrusted: `name`/`source` are attribute-escaped
 * and the `instructions` body has its wrapper-boundary tags neutralized, so a
 * poisoned skill (e.g. from skill-evolution ingesting injected tool output)
 * cannot break out of the envelope (F9).
 */
export function buildSkillContentXml(params: {
  name: string;
  version: number;
  source: string;
  instructions: string;
  resources?: { scripts: string[]; references: string[] };
}): string {
  const lines: string[] = [];
  lines.push(
    `<skill_content name="${escapeXmlAttr(params.name)}" version="${params.version}" source="${escapeXmlAttr(params.source)}">`,
  );
  lines.push("");
  lines.push(neutralizeSkillTags(params.instructions));
  lines.push("");
  if (params.resources && (params.resources.scripts.length > 0 || params.resources.references.length > 0)) {
    lines.push(`<skill_resources>`);
    for (const s of params.resources.scripts) {
      lines.push(`  <file>scripts/${s}</file>`);
    }
    for (const r of params.resources.references) {
      lines.push(`  <file>references/${r}</file>`);
    }
    lines.push(`</skill_resources>`);
  }
  lines.push("</skill_content>");
  return lines.join("\n");
}

// ─── Handler factory ────────────────────────────────────────────────────────

/** One resolved skill, as discovery hands it to the kernel. */
export interface ResolvedSkill {
  /** The `SKILL.md` procedure body (frontmatter stripped). */
  readonly body: string;
  /** Absolute path of the skill's directory; `file` reads are confined to it. */
  readonly dir: string;
  /** Content hash of the body, recorded with the activation. */
  readonly sha256: string;
  /** Envelope `version` attribute. Default 1. */
  readonly version?: number;
  /** Envelope `source` attribute. Default "installed". */
  readonly source?: string;
  /** Bundled files to list in the envelope's `<skill_resources>` block. */
  readonly resources?: { readonly scripts: string[]; readonly references: string[] };
}

/** Name to resolved skill, for one run. */
export type ResolvedSkills = ReadonlyMap<string, ResolvedSkill>;

/**
 * Everything the handler decides from. The kernel owns the state: it derives
 * `loaded` and `remainingTokens` from the run's ledger each call and records
 * the activation itself when the result is `activated`.
 */
export interface ActivateSkillContext {
  readonly skills: ResolvedSkills;
  /** Names already activated this run (dedupe). */
  readonly loaded: ReadonlySet<string>;
  /** Largest envelope one activation may preserve, in tokens. */
  readonly maxBodyTokens: number;
  /** Tokens left in the run's preserved-skill budget. */
  readonly remainingTokens: number;
  /** Token estimator for the envelope. Default: `ceil(chars / 4)`. */
  readonly estimateTokens?: (text: string) => number;
  /** Byte cap for one `file` read. Default {@link DEFAULT_SKILL_FILE_MAX_BYTES}. */
  readonly maxFileBytes?: number;
}

/** Why a call produced no skill content. */
export type ActivateSkillRefusal =
  | "invalid-args"
  | "unknown-skill"
  | "over-budget"
  | "file-refused";

/**
 * Result of one `activate-skill` call. `content` is the model-facing text.
 * Only `activated` carries `preserveOnCompaction: true`: the body is pinned
 * against compaction, while file reads and short replies are ordinary
 * results (skills spec §11 item 2).
 */
export type ActivateSkillResult =
  | {
      readonly kind: "activated";
      readonly success: true;
      readonly name: string;
      readonly sha256: string;
      readonly content: string;
      readonly tokens: number;
      readonly preserveOnCompaction: true;
    }
  | {
      readonly kind: "already-loaded";
      readonly success: true;
      readonly name: string;
      readonly content: string;
      readonly preserveOnCompaction: false;
    }
  | {
      readonly kind: "file";
      readonly success: true;
      readonly name: string;
      readonly file: string;
      readonly content: string;
      readonly truncated: boolean;
      readonly preserveOnCompaction: false;
    }
  | {
      readonly kind: "refused";
      readonly success: false;
      readonly reason: ActivateSkillRefusal;
      readonly content: string;
      readonly preserveOnCompaction: false;
    };

const MAX_NAMES_IN_HINT = 20;

const defaultEstimateTokens = (text: string): number => Math.ceil(text.length / 4);

const refused = (reason: ActivateSkillRefusal, content: string): ActivateSkillResult => ({
  kind: "refused",
  success: false,
  reason,
  content,
  preserveOnCompaction: false,
});

const fileCall = (name: string): string => `activate-skill({ name: "${name}", file: "<path>" })`;

function unknownSkillMessage(name: string, skills: ResolvedSkills): string {
  const names = [...skills.keys()].sort();
  if (names.length === 0) return `No skill named "${name}": this run has no skills.`;
  const shown = names.slice(0, MAX_NAMES_IN_HINT).join(", ");
  const more = names.length > MAX_NAMES_IN_HINT ? `, and ${names.length - MAX_NAMES_IN_HINT} more` : "";
  return `No skill named "${name}". Available skills: ${shown}${more}.`;
}

function activate(name: string, skill: ResolvedSkill, ctx: ActivateSkillContext): ActivateSkillResult {
  if (ctx.loaded.has(name)) {
    return {
      kind: "already-loaded",
      success: true,
      name,
      content: `Skill "${name}" is already loaded; its instructions are earlier in this conversation.`,
      preserveOnCompaction: false,
    };
  }
  const content = buildSkillContentXml({
    name,
    version: skill.version ?? 1,
    source: skill.source ?? "installed",
    instructions: skill.body,
    ...(skill.resources ? { resources: skill.resources } : {}),
  });
  const tokens = (ctx.estimateTokens ?? defaultEstimateTokens)(content);
  const limit = Math.min(ctx.maxBodyTokens, ctx.remainingTokens);
  if (tokens > limit) {
    const why =
      tokens > ctx.maxBodyTokens
        ? `its instructions are about ${tokens} tokens, over the ${ctx.maxBodyTokens}-token limit for one skill`
        : `about ${tokens} tokens are needed and only ${Math.max(0, ctx.remainingTokens)} remain in this run's skill budget`;
    return refused(
      "over-budget",
      `Skill "${name}" was not loaded: ${why}. Read only the part you need with ${fileCall(name)}, ` +
        `for example file: "SKILL.md" or a file under references/.`,
    );
  }
  return {
    kind: "activated",
    success: true,
    name,
    sha256: skill.sha256,
    content,
    tokens,
    preserveOnCompaction: true,
  };
}

const readFile = (
  name: string,
  file: string,
  skill: ResolvedSkill,
  ctx: ActivateSkillContext,
): Effect.Effect<ActivateSkillResult> => {
  const maxBytes = ctx.maxFileBytes ?? DEFAULT_SKILL_FILE_MAX_BYTES;
  return Effect.map(readSkillFile(skill.dir, file, maxBytes), (read): ActivateSkillResult => {
    if (!read.ok) return refused("file-refused", `Skill "${name}": ${read.message}`);
    const note = read.truncated
      ? `\n\n[truncated: showing the first ${maxBytes} of ${read.sizeBytes} bytes]`
      : "";
    return {
      kind: "file",
      success: true,
      name,
      file,
      content: read.text + note,
      truncated: read.truncated,
      preserveOnCompaction: false,
    };
  });
};

/**
 * Build the `activate-skill` handler over one call's inputs.
 *
 * - `{ name }`: returns the {@link buildSkillContentXml} envelope flagged
 *   `preserveOnCompaction`; a duplicate returns a short "already loaded"
 *   reply; an envelope over `min(maxBodyTokens, remainingTokens)` is refused
 *   with a message naming `activate-skill({ name, file })`.
 * - `{ name, file }`: returns the file's text from inside that skill's
 *   directory only, size-capped, as an ordinary result.
 *
 * Pure over `ctx` apart from the confined file read. Never fails: every
 * refusal is a `refused` result with model-facing text.
 */
export const makeActivateSkillHandler =
  (ctx: ActivateSkillContext) =>
  (args: Record<string, unknown>): Effect.Effect<ActivateSkillResult> => {
    const name = args["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      return Effect.succeed(
        refused("invalid-args", `activate-skill needs a skill name, e.g. activate-skill({ name: "<skill>" }).`),
      );
    }
    const skill = ctx.skills.get(name);
    if (skill === undefined) {
      return Effect.succeed(refused("unknown-skill", unknownSkillMessage(name, ctx.skills)));
    }
    const file = args["file"];
    // Models often fill an unused optional argument with "": treat it as absent.
    if (file === undefined || file === null || file === "") return Effect.succeed(activate(name, skill, ctx));
    if (typeof file !== "string") {
      return Effect.succeed(
        refused("invalid-args", `file must be a string path relative to the skill directory, e.g. ${fileCall(name)}.`),
      );
    }
    return readFile(name, file, skill, ctx);
  };
