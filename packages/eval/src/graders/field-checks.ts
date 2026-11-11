/**
 * Single-path deterministic checks (`FieldCheck`) and the partial-object
 * matcher behind `gradeFields`. No LLM, no Effect context: the same value and
 * check always give the same result.
 */
import { Either } from "effect";
import type { FieldCheck, GradeCheckKind, GradeFieldResult } from "../types/structured-expectation.js";
import { deepEqual, isJsonType, isRecord, resolveJsonPointer, show, toJsonPointer, typeLabel } from "./json.js";

const result = (
  path: string,
  check: GradeCheckKind,
  outcome: GradeFieldResult["outcome"],
  reason: string,
  extra: { readonly expected?: unknown; readonly actual?: unknown } = {},
): GradeFieldResult => ({ path, check, outcome, reason, ...extra });

/**
 * Numeric closeness: inclusive absolute or relative tolerance. A few ULPs of
 * slack keep the inclusive edge inclusive under binary floating point
 * (`|19.99 - 20|` is `0.0100000000000016`, not `0.01`).
 */
const withinTolerance = (actual: number, expected: number, tolerance: number, relative: number): boolean => {
  if (actual === expected) return true;
  const diff = Math.abs(actual - expected);
  const slack = 4 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
  return diff <= tolerance + slack || diff <= relative * Math.abs(expected) + slack;
};

/** Equality failure reason; names both types when they differ. */
const equalsFailure = (expected: unknown, actual: unknown): string =>
  typeLabel(expected) === typeLabel(actual)
    ? `expected ${show(expected)}, got ${show(actual)}`
    : `type mismatch: expected ${typeLabel(expected)} ${show(expected)}, got ${typeLabel(actual)} ${show(actual)}`;

/** Compile a regex; `undefined` when the pattern or flags are invalid. */
const compile = (pattern: string, flags: string | undefined): RegExp | undefined =>
  Either.getOrUndefined(Either.try(() => new RegExp(pattern, flags)));

/**
 * Partial match used by `gradeFields` and `array-contains`: every leaf of
 * `expected` must match `actual` at the same path. Returns one result per
 * leaf (or per container whose type or length is wrong). `pathPrefix` is the
 * key path of `actual` inside the graded root.
 */
export const matchPartial = (
  actual: unknown,
  expected: unknown,
  numericTolerance: number,
  pathPrefix: ReadonlyArray<string | number> = [],
): GradeFieldResult[] => {
  const path = toJsonPointer(pathPrefix);

  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return [result(path, "type", "fail", `expected an object, got ${typeLabel(actual)}`, { actual })];
    }
    return Object.entries(expected).flatMap(([key, value]) =>
      Object.hasOwn(actual, key)
        ? matchPartial(actual[key], value, numericTolerance, [...pathPrefix, key])
        : [result(toJsonPointer([...pathPrefix, key]), "equals", "fail", "missing field", { expected: value })],
    );
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [result(path, "type", "fail", `expected an array, got ${typeLabel(actual)}`, { actual })];
    }
    const common = Math.min(expected.length, actual.length);
    const elements = expected
      .slice(0, common)
      .flatMap((value, i) => matchPartial(actual[i], value, numericTolerance, [...pathPrefix, i]));
    return actual.length === expected.length
      ? elements
      : [
          result(path, "length", "fail", `expected length ${expected.length}, got ${actual.length}`, {
            expected: expected.length,
            actual: actual.length,
          }),
          ...elements,
        ];
  }

  if (typeof expected === "number" && numericTolerance > 0) {
    return [runFieldCheckAt(actual, path, { kind: "approx", path, value: expected, tolerance: numericTolerance })];
  }
  return [runFieldCheckAt(actual, path, { kind: "equals", path, value: expected })];
};

/** Run `check` against `value`, which was already resolved at `path`. */
const runFieldCheckAt = (value: unknown, path: string, check: FieldCheck): GradeFieldResult => {
  switch (check.kind) {
    case "equals":
      return deepEqual(value, check.value)
        ? result(path, "equals", "pass", `equals ${show(check.value)}`)
        : result(path, "equals", "fail", equalsFailure(check.value, value), {
            expected: check.value,
            actual: value,
          });

    case "approx": {
      const tolerance = check.tolerance ?? 0;
      const relative = check.relativeTolerance ?? 0;
      const expectedText = `${check.value} (tolerance ${tolerance}${relative > 0 ? `, relative ${relative}` : ""})`;
      if (typeof value !== "number" || Number.isNaN(value)) {
        return result(path, "approx", "fail", `expected a number, got ${Number.isNaN(value) ? "NaN" : typeLabel(value)}`, {
          expected: check.value,
          actual: value,
        });
      }
      return withinTolerance(value, check.value, tolerance, relative)
        ? result(path, "approx", "pass", `${value} is within ${expectedText}`)
        : result(path, "approx", "fail", `${value} is outside ${expectedText}`, { expected: check.value, actual: value });
    }

    case "contains": {
      if (typeof value !== "string") {
        return result(path, "contains", "fail", `expected a string, got ${typeLabel(value)}`, { actual: value });
      }
      const hit = check.caseInsensitive
        ? value.toLowerCase().includes(check.value.toLowerCase())
        : value.includes(check.value);
      return hit
        ? result(path, "contains", "pass", `contains ${show(check.value)}`)
        : result(path, "contains", "fail", `does not contain ${show(check.value)}`, {
            expected: check.value,
            actual: value,
          });
    }

    case "matches": {
      const re = compile(check.pattern, check.flags);
      if (re === undefined) {
        return result(path, "matches", "invalid", `invalid regular expression /${check.pattern}/${check.flags ?? ""}`);
      }
      if (typeof value !== "string") {
        return result(path, "matches", "fail", `expected a string, got ${typeLabel(value)}`, { actual: value });
      }
      return re.test(value)
        ? result(path, "matches", "pass", `matches ${re}`)
        : result(path, "matches", "fail", `does not match ${re}`, { expected: check.pattern, actual: value });
    }

    case "array-contains": {
      if (!Array.isArray(value)) {
        return result(path, "array-contains", "fail", `expected an array, got ${typeLabel(value)}`, { actual: value });
      }
      const index = value.findIndex((el) => {
        const leaves = matchPartial(el, check.value, 0);
        return leaves.length > 0 && leaves.every((l) => l.outcome === "pass");
      });
      return index >= 0
        ? result(path, "array-contains", "pass", `element ${index} matches ${show(check.value)}`)
        : result(path, "array-contains", "fail", `no element matches ${show(check.value)}`, { expected: check.value });
    }

    case "length": {
      const { min, max, equals } = check;
      if (min === undefined && max === undefined && equals === undefined) {
        return result(path, "length", "invalid", "length check declares no bound (min, max or equals)");
      }
      if (typeof value !== "string" && !Array.isArray(value)) {
        return result(path, "length", "fail", `expected an array or string, got ${typeLabel(value)}`, { actual: value });
      }
      const n = value.length;
      const bounds = [
        equals !== undefined ? `= ${equals}` : "",
        min !== undefined ? `>= ${min}` : "",
        max !== undefined ? `<= ${max}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const ok = (equals === undefined || n === equals) && (min === undefined || n >= min) && (max === undefined || n <= max);
      return ok
        ? result(path, "length", "pass", `length ${n} satisfies ${bounds}`)
        : result(path, "length", "fail", `length ${n} does not satisfy ${bounds}`, { actual: n });
    }

    case "type":
      return isJsonType(value, check.type)
        ? result(path, "type", "pass", `is ${check.type}`)
        : result(path, "type", "fail", `expected ${check.type}, got ${typeLabel(value)}`, {
            expected: check.type,
            actual: value,
          });
  }
};

/**
 * Run one deterministic check against `root`. A missing field fails with
 * reason `missing field`; a pointer that is not RFC 6901 is `invalid`.
 */
export const runFieldCheck = (root: unknown, check: FieldCheck): GradeFieldResult => {
  const resolved = resolveJsonPointer(root, check.path);
  if (!resolved.found) {
    return resolved.malformed
      ? result(check.path, check.kind, "invalid", `malformed JSON Pointer ${show(check.path)} (must be "" or start with "/")`)
      : result(check.path, check.kind, "fail", `missing field (nothing at ${resolved.missingAt})`);
  }
  return runFieldCheckAt(resolved.value, check.path, check);
};
