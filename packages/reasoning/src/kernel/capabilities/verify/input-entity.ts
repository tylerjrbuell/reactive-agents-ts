// File: src/kernel/capabilities/verify/input-entity.ts
//
// Does a tool call name a listed task input? The one matcher behind the
// `InputRead` condition (post-condition-types.ts). Leaf module: no imports, so
// post-conditions.ts (the verifier) and derive-inputs.ts (the extractor) can
// both use it without an import cycle.
//
// Pure, deterministic, NO fs, NO LLM.

/** True when a listed input is a URL rather than a file path. */
export const isUrlEntity = (entity: string): boolean => /^https?:\/\//i.test(entity);

/** Drop surrounding quotes/brackets and trailing clause punctuation from an argument token. */
const trimToken = (token: string): string =>
  token.trim().replace(/^['"`(<[]+/, "").replace(/['"`)>\],;:]+$/, "");

const stripDotSlash = (p: string): string => p.replace(/^\.\//, "");

/**
 * Does one argument value (or one token of it) name `entity`?
 *
 * - URL: equal, or the value extends it past a `/`, `?` or `#` boundary (a
 *   listed API base `https://api.x.com` is read by `https://api.x.com/posts?id=3`).
 * - Path: equal after `./` is dropped, or one ends with the other after a `/`
 *   boundary. Both directions: the task may list the absolute path while the
 *   model reads it relative to the working directory, or the reverse. The `/`
 *   boundary keeps `my-out.md` from matching `out.md`.
 */
export function tokenNamesEntity(token: string, entity: string): boolean {
  const t = trimToken(token);
  if (t.length === 0) return false;
  if (isUrlEntity(entity)) {
    const base = entity.replace(/\/+$/, "").toLowerCase();
    const v = t.toLowerCase();
    if (v === base) return true;
    return v.startsWith(base) && /^[/?#]/.test(v.slice(base.length));
  }
  const a = stripDotSlash(t);
  const b = stripDotSlash(entity.trim());
  if (a.length === 0 || b.length === 0) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** Splits a free-text argument (a shell command, a code string) into candidate tokens. */
const TOKEN_SPLIT = /[\s'"`=,;()<>|&{}[\]]+/;

/**
 * True when any string argument of a call names `entity`: the whole value
 * (`path`, `url`), or one whitespace/quote-delimited token of it (a `command`
 * like `cat src/a.ts`, a `code` string that opens the file). Arrays of strings
 * are read one level deep (`paths: [...]`).
 */
export function argsNameEntity(args: Readonly<Record<string, unknown>>, entity: string): boolean {
  const values: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v === "string") values.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") values.push(x);
  }
  return values.some(
    (v) => tokenNamesEntity(v, entity) || v.split(TOKEN_SPLIT).some((tok) => tokenNamesEntity(tok, entity)),
  );
}
