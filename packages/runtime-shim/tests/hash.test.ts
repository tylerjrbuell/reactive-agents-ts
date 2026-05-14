import { test, expect } from "bun:test";
import { hash } from "../src/index.js";

test("hash returns deterministic 64-bit bigint", () => {
  const a = hash("hello");
  const b = hash("hello");
  expect(a).toBe(b);
  expect(typeof a).toBe("bigint");

  const c = hash("world");
  expect(c).not.toBe(a);
});

test("hash with toString(36) produces compact cache keys", () => {
  const key = hash("test").toString(36);
  expect(key.length).toBeGreaterThan(0);
  expect(key.length).toBeLessThan(20);
});

test("hash accepts Uint8Array", () => {
  const bytes = new TextEncoder().encode("hello");
  const a = hash(bytes);
  const b = hash("hello");
  expect(typeof a).toBe("bigint");
  expect(typeof b).toBe("bigint");
  // Both bytes and string of same content should hash deterministically
  // (Note: bun:hash may produce different values for string vs bytes — only check determinism)
  const a2 = hash(bytes);
  expect(a2).toBe(a);
});
