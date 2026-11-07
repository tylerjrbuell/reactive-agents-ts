// packages/trace/src/attribution-refusal.ts
//
// Content refusals (2026-11-07 leverage scan, item 6). A write boundary that
// refuses the content the model supplied (file-write's `Refusing to write
// findings.json: the content is not valid JSON ...`) is not a tool that itself
// failed: before this rule such runs read `environment:tool-failure` (through
// cause `tool-failure`) or `unattributed`. Rule order and the verdict assembly
// live in attribution.ts.
//
//   harness:refused-repairable  the boundary refused JSON content that a deterministic,
//                               content-preserving repair parses (escape the stray
//                               quotes, drop surplus closing brackets): the harness
//                               could have saved it
//   harness:misleading-refusal  the refusal carried a hint that contradicts its own fix
//                               (`Malformed JSON in arguments` on a content refusal whose
//                               arguments parsed; tool-execution before dc7d9eb80)
//   model:invalid-content       the refusal was correct and actionable and no
//                               deterministic repair parses the content
//
// Fires only when the refused write targets a failing file and no later write
// of that path succeeded (a refusal the model recovered from explains nothing).

import type { ToolCallEvent } from "./events.js";
import {
  isWriter, ev1, clip, oneLine, refMatcher, argPath, contentArg, executedOk,
  type Rule,
} from "./attribution-facts.js";
import type { CauseEvidence } from "./cause.js";

/** A write boundary's refusal of model-supplied content (file-operations.ts writeContentRejection). */
export const CONTENT_REFUSAL = /Refusing to write /;
/** The `.json` validity refusal: the content did not parse. */
const INVALID_JSON = /the content is not valid JSON/;
/**
 * The recovery hint tool-execution appended to every JSON parse error before
 * dc7d9eb80, including a content refusal whose arguments parsed fine. It told the
 * model its ARGUMENTS were malformed, contradicting the refusal's own fix.
 */
const MISLEADING_HINT = /Malformed JSON in arguments/;

const parses = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

/** First index at or after `i` that is not JSON whitespace. */
const skipWs = (s: string, i: number): number => {
  let j = i;
  while (j < s.length && /\s/.test(s[j]!)) j++;
  return j;
};

/** A char that can start a JSON value or close a container (what may follow `,` or `:`). */
const VALUE_OR_CLOSE = /["{[\]}\-0-9tfn]/;

/**
 * Escape double quotes that sit inside a string value. A quote inside a string
 * closes it only when what follows is structure: end of input, `}`, `]`, or a
 * `,` / `:` followed by a value or a closer. Any other quote is content
 * (`"the "component model", what does it"` quotes a phrase). Only backslashes
 * are inserted.
 */
const escapeInnerQuotes = (s: string): string => {
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr && c === "\\") {
      out += s.slice(i, i + 2);
      i++;
      continue;
    }
    if (c !== '"') {
      out += c;
      continue;
    }
    if (!inStr) {
      inStr = true;
      out += c;
      continue;
    }
    const j = skipWs(s, i + 1);
    const next = s[j];
    const closes =
      next === undefined || next === "}" || next === "]" ||
      ((next === "," || next === ":") && VALUE_OR_CLOSE.test(s[skipWs(s, j + 1)] ?? "}"));
    if (closes) {
      inStr = false;
      out += c;
    } else out += '\\"';
  }
  return out;
};

/** Drop up to 3 surplus closing brackets from the end (`Extra data` / `Unexpected '}'`). */
const dropSurplusClosers = (s: string): string | undefined => {
  let t = s.trimEnd();
  for (let n = 0; n < 3 && /[}\]]$/.test(t); n++) {
    t = t.slice(0, -1).trimEnd();
    if (parses(t)) return t;
  }
  return undefined;
};

/**
 * The text a deterministic, content-preserving repair turns `content` into when
 * that text parses as JSON: stray quotes inside strings escaped (inserts only
 * backslashes), surplus trailing closers dropped (removes only brackets), or
 * both. Undefined when no such repair parses, or when `content` already parses.
 *
 * This is the instrument's own check of what a repair at the write boundary
 * could have saved, not the tools package's repairer (trace depends on core
 * only). A refused call that records a heal attempt would be the stronger signal.
 */
export function repairedJson(content: string): string | undefined {
  const s = content.trim();
  if (parses(s)) return undefined;
  const escaped = escapeInnerQuotes(s);
  if (parses(escaped)) return escaped;
  return dropSurplusClosers(s) ?? dropSurplusClosers(escaped);
}

/** The refusal text the model saw (`error`, else the result). */
const refusalText = (t: ToolCallEvent): string => t.error ?? (typeof t.result === "string" ? t.result : "");

/** A write call the boundary refused for its content. */
export const isContentRefusal = (t: ToolCallEvent): boolean =>
  t.ok === false && isWriter(t.toolName) && CONTENT_REFUSAL.test(refusalText(t));

const refusalLine = (t: ToolCallEvent, why: string): CauseEvidence => {
  const text = oneLine(refusalText(t).replace(/^\[Tool error: (File write failed: )?/, ""));
  return ev1(t, `${t.toolName} ${argPath(t.args) ?? "?"} refused: ${clip(text, 120)}; ${why}`);
};

/**
 * The write boundary refused content the model wrote for a failing file, and no
 * later write of that path succeeded. Owner by what the trace shows about the
 * refusal: a repair would have parsed it (harness), its text misled (harness),
 * or it was correct and the content is not repairable (model).
 */
export const ruleContentRefused: Rule = ({ f, targets }) => {
  const files = targets.filter((t) => t.kind === "file");
  if (files.length === 0) return undefined;
  const targetOf = (t: ToolCallEvent) => {
    const path = argPath(t.args);
    return path === undefined ? undefined : files.find((tg) => refMatcher(tg.ref)(path));
  };
  const unresolved = f.toolEnds.filter((t) => {
    if (!isContentRefusal(t) || targetOf(t) === undefined) return false;
    const path = argPath(t.args);
    return !f.toolEnds.some((x) => x.seq > t.seq && isWriter(x.toolName) && argPath(x.args) === path && executedOk(x));
  });
  if (unresolved.length === 0) return undefined;
  const hit = (reason: "harness:refused-repairable" | "harness:misleading-refusal" | "model:invalid-content", t: ToolCallEvent, why: string, needs: readonly string[]) => {
    const target = targetOf(t);
    return { reason, evidence: [refusalLine(t, why)], needs, ...(target ? { target } : {}) };
  };
  const json = unresolved.filter((t) => INVALID_JSON.test(refusalText(t)));
  const repairable = json.find((t) => {
    const c = contentArg(t.args);
    return c !== undefined && repairedJson(c) !== undefined;
  });
  if (repairable) {
    return hit("harness:refused-repairable", repairable, "a content-preserving repair (escape stray quotes, drop surplus closers) parses it", []);
  }
  const misled = unresolved.find((t) => MISLEADING_HINT.test(refusalText(t)));
  if (misled) {
    return hit("harness:misleading-refusal", misled, "its hint says the ARGUMENTS were malformed, contradicting the refusal's fix", []);
  }
  // Refused JSON content the recorder did not keep cannot be checked for a repair.
  const unchecked = json.some((t) => contentArg(t.args) === undefined);
  return hit(
    "model:invalid-content", unresolved.at(-1)!,
    `${unresolved.length} refusal(s) of the model's content, none repairable, the file never written`,
    unchecked ? ["tool-call-end.args.content (the refused content, to check it for a deterministic repair)"] : [],
  );
};
