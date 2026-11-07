// File: src/kernel/capabilities/verify/derive-inputs.ts
//
// The listed-input deriver (DEBT #39, per-entity coverage; harness switch
// `inputCoverage`, default OFF).
//
// A task that lists its inputs ("six modules: src/a.ts ... src/f.ts", "the
// invoices invoices/inv-01.json ... inv-12.json") is not done after ONE read:
// `tool:file-read` is satisfied by the first file, so neither the exit gate nor
// act-or-answer saw work left while 5 of 6 modules went unread (act-or-answer
// ablation 2026-11-07: 9 lh-debug-green runs ended "success" after 1-5 of 6
// modules). This deriver turns each listed input into its own entity; the
// RunContract compiles one `input-coverage` requirement per entity
// (`InputRead`, post-condition-types.ts).
//
// Inputs are the path / URL tokens the task names that are NOT deliverables.
// Deliverables come from the one deliverable deriver (`deriveDeliverableItems`),
// so a file the task asks to WRITE never becomes a read requirement. A file to
// fix "in place" is not a deliverable there (no write verb), so it is an input:
// it must be read before it can be fixed.
//
// Pure, deterministic, NO LLM, NO fs.

import {
  deriveDeliverablePaths,
  isPlaceholderPath,
  MAX_BOUND_FAMILY,
  passesPathPrecision,
  PATH_TOKEN,
} from "./derive-conditions.js";
import { anchorDeliverablePath } from "./post-conditions.js";

/** One listed input: the entity as written, and where it starts in the task text. */
export interface ListedInput {
  readonly entity: string;
  readonly start: number;
}

const URL_TOKEN = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;

/**
 * Hosts whose URLs are identifiers, not documents to read: a JSON-Schema
 * `$schema` value or an XML namespace names a vocabulary. `.withOutputSchema()`
 * injects `http://json-schema.org/draft-07/schema#` into every structured task.
 */
const IDENTIFIER_HOSTS = /^https?:\/\/(?:[\w-]+\.)*(?:json-schema\.org|w3\.org)(?:[/:?#]|$)/i;

/**
 * Code members that look like `<word>.<real-extension>` (`console.log` reads
 * as a `.log` file). Denied by name, the TECH_NAME_TOKENS idiom of the
 * deliverable deriver.
 */
const CODE_MEMBER_TOKENS = new Set<string>(["console.log"]);

/** True when the URL at `start` is a JSON value (`"key": "https://..."`): data, not a listed input. */
function isJsonValue(task: string, start: number): boolean {
  if (task.charAt(start - 1) !== '"') return false;
  return /:\s*$/.test(task.slice(Math.max(0, start - 40), start - 1));
}

/**
 * Derive the inputs a task explicitly lists, in first-appearance order,
 * de-duplicated (`./a.ts` and `a.ts` are one input). Empty when the task lists
 * none, and when it lists more than {@link MAX_BOUND_FAMILY} (no longer a
 * per-item checklist).
 */
export function deriveListedInputs(task: string): ListedInput[] {
  const deliverables = new Set(deriveDeliverablePaths(task));
  const out: ListedInput[] = [];
  const seen = new Set<string>();
  const add = (entity: string, start: number): void => {
    const key = entity.replace(/^\.\//, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entity, start });
  };

  const urlSpans: Array<readonly [number, number]> = [];
  for (const m of task.matchAll(URL_TOKEN)) {
    const start = m.index ?? 0;
    urlSpans.push([start, start + m[0].length]);
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (IDENTIFIER_HOSTS.test(url) || isJsonValue(task, start)) continue;
    add(url, start);
  }

  for (const m of task.matchAll(new RegExp(PATH_TOKEN.source, "g"))) {
    const candidate = m[1];
    const start = m.index ?? 0;
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (urlSpans.some(([a, b]) => start >= a && start < b)) continue;
    if (CODE_MEMBER_TOKENS.has(candidate.toLowerCase())) continue;
    if (!passesPathPrecision(candidate, task)) continue;
    if (task.charAt(start + candidate.length) === "(") continue; // a call, not a file
    if (isPlaceholderPath(candidate, task, start)) continue;
    if (deliverables.has(anchorDeliverablePath(candidate))) continue;
    add(candidate, start);
  }

  return out.length > MAX_BOUND_FAMILY ? [] : out.sort((a, b) => a.start - b.start);
}
