/**
 * Deterministic docs generation for the dual API (spec §3.2 / Q8).
 *
 * BOTH reference tables render from the SINGLE source (`AgentConfigSchema` +
 * the builder prototype), via `deriveCorrespondence()` / `deriveConfigFields()`:
 *   - the fluent "builder method ↔ config key" reference (→ builder-api.md), and
 *   - the declarative "config field" reference (→ configuration.md).
 *
 * The rendered tables live inside marker blocks in the committed docs, so
 * hand-written prose (and its anchor links) is preserved; only the block is
 * machine-owned. A CI drift-check (`docs:gen:api --check`) fails if a committed
 * block differs from a fresh generation — hand-editing the table goes RED.
 *
 * Output is deterministic (stable ordering, escaped cells) so re-generation of
 * an unchanged source is byte-identical.
 */
import { deriveCorrespondence } from "./api-correspondence.js";
import { deriveBuilderMethods } from "./builder-methods.js";
import { deriveConfigFields } from "./config-fields.js";

/** Escape a markdown table cell (pipe + newline). */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Opening marker for a generated block. */
export function beginMarker(id: string): string {
  return `<!-- BEGIN GENERATED: ${id} (via \`bun run docs:gen:api\` — DO NOT EDIT BY HAND) -->`;
}
/** Closing marker for a generated block. */
export function endMarker(id: string): string {
  return `<!-- END GENERATED: ${id} -->`;
}

/**
 * Replace the content between the begin/end markers for `id` in `source`.
 * Throws if the markers are absent (the file must declare where generated
 * content lives — the generator never guesses).
 */
export function replaceBlock(source: string, id: string, body: string): string {
  const begin = beginMarker(id);
  const end = endMarker(id);
  const bi = source.indexOf(begin);
  const ei = source.indexOf(end);
  if (bi === -1 || ei === -1 || ei < bi) {
    throw new Error(
      `docs-gen: markers for block "${id}" not found (need ${begin} … ${end}).`,
    );
  }
  const before = source.slice(0, bi + begin.length);
  const after = source.slice(ei);
  return `${before}\n\n${body}\n\n${after}`;
}

/**
 * The fluent surface reference: every `with*` method, its kind, the AgentConfig
 * key(s) it sets (or its overlay reason), and a one-line description. Sorted by
 * method name (deriveBuilderMethods is already sorted).
 */
export function renderBuilderReference(): string {
  const rows = deriveCorrespondence();
  const byName = new Map(deriveBuilderMethods().map((m) => [m.name, m]));
  const lines = [
    "| Method | Config key(s) | Kind | Description |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const desc = byName.get(r.wither)?.description ?? "";
    const keys = r.overlay
      ? `_overlay — ${r.reason ?? "code-only"}_`
      : r.configKeys.map((k) => `\`${k}\``).join(", ");
    lines.push(
      `| \`${cell(r.wither)}\` | ${cell(keys)} | ${r.overlay ? "overlay" : "config"} | ${cell(desc)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * The declarative surface reference: every AgentConfig leaf path, its type
 * (enum values inlined), whether it is required, and its schema description.
 * Sorted by dotted path for stability.
 */
export function renderConfigReference(): string {
  const fields = [...deriveConfigFields()].sort((a, b) => a.path.localeCompare(b.path));
  const lines = [
    "| Config key | Type | Required | Description |",
    "| --- | --- | --- | --- |",
  ];
  for (const f of fields) {
    const type =
      f.type === "enum" && f.enumValues
        ? f.enumValues.map((v) => `\`${v}\``).join(" \\| ")
        : `\`${f.type}\``;
    lines.push(
      `| \`${cell(f.path)}\` | ${type} | ${f.optional ? "no" : "**yes**"} | ${cell(f.description ?? "")} |`,
    );
  }
  return lines.join("\n");
}

/** The generated-block IDs and which doc file each lives in. */
export const GENERATED_BLOCKS = [
  {
    id: "builder-method-reference",
    file: "src/content/docs/reference/builder-api.md",
    render: renderBuilderReference,
  },
  {
    id: "config-field-reference",
    file: "src/content/docs/reference/configuration.md",
    render: renderConfigReference,
  },
] as const;
