/**
 * Typed test seam for reading runtime-only / private fields without a double cast.
 * `Reflect.get` is the single sanctioned peek; callers get `unknown` or a guarded shape.
 */

/** Read one field off any object as `unknown`. */
export const peek = (target: object, key: string): unknown => Reflect.get(target, key);

/** Read a field expected to be an array of records; throws if it is not an array. */
export const peekRecords = (target: object, key: string): Array<Record<string, unknown>> => {
  const value = peek(target, key);
  if (!Array.isArray(value)) throw new TypeError(`expected "${key}" to be an array`);
  return value;
};

/** Read a field expected to be a plain record; throws if it is not an object. */
export const peekRecord = (target: object, key: string): Record<string, unknown> => {
  const value = peek(target, key);
  if (typeof value !== "object" || value === null) throw new TypeError(`expected "${key}" to be an object`);
  return Object.fromEntries(Object.entries(value));
};

/** Shallow own-property snapshot of an object (private builder state is own fields). */
export const snapshot = <T extends object>(target: object): Partial<T> => Object.assign({}, target);
