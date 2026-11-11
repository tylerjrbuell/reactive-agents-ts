/**
 * JSON helpers shared by the structured graders: RFC 6901 pointers, JSON type
 * names and deep equality. Pure functions, no Effect context.
 */
import type { JsonTypeName } from "../types/structured-expectation.js";

/** Result of resolving a JSON Pointer against a value. */
export type PointerResolution =
  | { readonly found: true; readonly value: unknown }
  | {
      readonly found: false;
      /** True when the pointer itself is not valid RFC 6901 (it must be `""` or start with `/`). */
      readonly malformed: boolean;
      /** Pointer prefix that was missing (the deepest point resolution reached, plus one segment). */
      readonly missingAt: string;
    };

const escapeSegment = (seg: string): string => seg.replace(/~/g, "~0").replace(/\//g, "~1");
const unescapeSegment = (seg: string): string => seg.replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * RFC 6901 JSON Pointer for a key path, the same form as
 * `StructuredFieldError.path` in `@reactive-agents/core` (`""` = root).
 */
export const toJsonPointer = (path: ReadonlyArray<PropertyKey>): string =>
  path.map((seg) => "/" + escapeSegment(typeof seg === "symbol" ? String(seg.description ?? "") : String(seg))).join("");

/** True for a non-null, non-array object. */
export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Resolve an RFC 6901 JSON Pointer. A key that is absent is `found: false`;
 * a key whose value is `null` is found. Array segments must be canonical
 * indexes (`01` and `-` do not resolve).
 */
export const resolveJsonPointer = (root: unknown, pointer: string): PointerResolution => {
  if (pointer === "") return { found: true, value: root };
  if (!pointer.startsWith("/")) return { found: false, malformed: true, missingAt: pointer };

  let current: unknown = root;
  let reached = "";
  for (const raw of pointer.slice(1).split("/")) {
    const seg = unescapeSegment(raw);
    reached += "/" + raw;
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(seg) || Number(seg) >= current.length) {
        return { found: false, malformed: false, missingAt: reached };
      }
      current = current[Number(seg)];
    } else if (isRecord(current) && Object.hasOwn(current, seg)) {
      current = current[seg];
    } else {
      return { found: false, malformed: false, missingAt: reached };
    }
  }
  return { found: true, value: current };
};

/** JSON type name of a value; `undefined` and non-JSON values report their `typeof`. */
export const jsonTypeOf = (x: unknown): JsonTypeName | "undefined" | "bigint" | "function" | "symbol" => {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  const t = typeof x;
  return t === "number" ? (Number.isInteger(x) ? "integer" : "number") : t;
};

/** True when `x` is of JSON type `type` (`integer` is also a `number`). */
export const isJsonType = (x: unknown, type: JsonTypeName): boolean => {
  const actual = jsonTypeOf(x);
  return actual === type || (type === "number" && actual === "integer");
};

/** Display name for type-mismatch reasons (`integer` shows as `number`). */
export const typeLabel = (x: unknown): string => {
  const t = jsonTypeOf(x);
  return t === "integer" ? "number" : t;
};

/** Deep equality with JSON semantics: key order does not matter, `NaN` equals `NaN`. */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
};

/** Short, single-line rendering of a value for reasons. */
export const show = (x: unknown): string => {
  const text = x === undefined ? "undefined" : JSON.stringify(x) ?? String(x);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};
