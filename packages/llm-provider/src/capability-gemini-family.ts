/**
 * Gemini family rule for model ids missing from the static capability table.
 *
 * Users pick Gemini ids from Google's live model list: aliases such as
 * `gemini-flash-latest`, dated previews (`gemini-2.5-flash-preview-09-2025`),
 * experimental and new-version ids. Without a row they resolved to the
 * 2048-token fallback with thinking off (v0.19 QA finding N5). Every Gemini
 * text model of a variant (pro, flash, flash-lite) shares that variant's
 * window, output limit and thinking support, so an unlisted id borrows the
 * nearest static row of its variant:
 *
 *   - versioned id: the highest listed version at or below it, else the lowest
 *     listed version above it;
 *   - alias without a version (`-latest`): the highest listed version.
 *
 * The result has `source: "inferred"`: ranked like provider-reported
 * metadata, its output ceiling is advisory and never clamps a request.
 * Explicit table rows always win (the resolver checks them first).
 * Non-text models (embedding, TTS, image, live/native-audio) and ids with no
 * variant stay on the fallback.
 */

import { STATIC_CAPABILITIES, type Capability } from "./capability.js";

type GeminiVariant = "pro" | "flash" | "flash-lite";

interface GeminiId {
  readonly variant: GeminiVariant;
  /** Numeric version (`2.5`, `3`), undefined for aliases like `gemini-flash-latest`. */
  readonly version: number | undefined;
}

const NON_TEXT_MODEL = /(embedding|tts|image|live|native-audio|aqa|robotics|computer-use)/;
const GEMINI_ID = /^gemini-(?:(\d+(?:\.\d+)?)-)?(pro|flash-lite|flash)(?:-|$)/;

/**
 * Parse a Gemini model id into variant and version.
 *
 * @param model — model id, with or without the `models/` prefix
 * @returns the parsed id, or undefined when it is not a Gemini text model
 */
export const parseGeminiId = (model: string): GeminiId | undefined => {
  const id = model.toLowerCase().replace(/^models\//, "");
  if (NON_TEXT_MODEL.test(id)) return undefined;
  const m = GEMINI_ID.exec(id);
  const variant = m?.[2];
  if (variant !== "pro" && variant !== "flash" && variant !== "flash-lite") return undefined;
  return { variant, version: m?.[1] === undefined ? undefined : Number(m[1]) };
};

/**
 * Capability for a Gemini id that has no static row, borrowed from the
 * nearest static row of the same variant.
 *
 * @param model — Gemini model id
 * @returns an inferred Capability, or undefined when the family is not recognized
 */
export const geminiFamilyCapability = (model: string): Capability | undefined => {
  const wanted = parseGeminiId(model);
  if (wanted === undefined) return undefined;

  const rows: { readonly version: number; readonly cap: Capability }[] = [];
  for (const cap of Object.values(STATIC_CAPABILITIES)) {
    if (cap.provider !== "gemini") continue;
    const parsed = parseGeminiId(cap.model);
    if (parsed?.variant !== wanted.variant || parsed.version === undefined) continue;
    rows.push({ version: parsed.version, cap });
  }
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => a.version - b.version);

  const target = wanted.version;
  const atOrBelow = target === undefined ? rows : rows.filter((r) => r.version <= target);
  const nearest = atOrBelow.length > 0 ? atOrBelow[atOrBelow.length - 1] : rows[0];
  if (nearest === undefined) return undefined;
  return { ...nearest.cap, model, source: "inferred" };
};
