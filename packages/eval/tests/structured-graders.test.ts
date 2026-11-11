import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  resolveJsonPointer,
  toJsonPointer,
  runFieldCheck,
  gradeFields,
  gradeSchema,
  gradeStructured,
  parseStructuredOutput,
} from "../src/graders/index.js";

const order = {
  id: "ord-1",
  total: 19.99,
  paid: true,
  note: null,
  customer: { name: "Ada Lovelace", "a/b": 1, "t~x": 2 },
  items: [
    { sku: "A", qty: 2 },
    { sku: "B", qty: 1 },
  ],
  tags: ["rush", "gift"],
};

describe("JSON Pointer", () => {
  it("resolves root, nested keys, array indexes and escaped keys", () => {
    expect(resolveJsonPointer(order, "")).toEqual({ found: true, value: order });
    expect(resolveJsonPointer(order, "/customer/name")).toEqual({ found: true, value: "Ada Lovelace" });
    expect(resolveJsonPointer(order, "/items/1/sku")).toEqual({ found: true, value: "B" });
    expect(resolveJsonPointer(order, "/customer/a~1b")).toEqual({ found: true, value: 1 });
    expect(resolveJsonPointer(order, "/customer/t~0x")).toEqual({ found: true, value: 2 });
    expect(resolveJsonPointer(order, "/note")).toEqual({ found: true, value: null });
  });

  it("reports missing fields and out-of-range or malformed indexes", () => {
    expect(resolveJsonPointer(order, "/customer/email").found).toBe(false);
    expect(resolveJsonPointer(order, "/items/2").found).toBe(false);
    expect(resolveJsonPointer(order, "/items/01").found).toBe(false);
    expect(resolveJsonPointer(order, "/total/x").found).toBe(false);
  });

  it("rejects a pointer that does not start with '/'", () => {
    const r = resolveJsonPointer(order, "customer");
    expect(r.found).toBe(false);
    expect(r.found === false && r.malformed).toBe(true);
  });

  it("builds pointers from key paths with RFC 6901 escaping", () => {
    expect(toJsonPointer([])).toBe("");
    expect(toJsonPointer(["items", 0, "a/b", "t~x"])).toBe("/items/0/a~1b/t~0x");
  });
});

describe("runFieldCheck", () => {
  it("equals: deep equality ignores key order", () => {
    expect(runFieldCheck(order, { kind: "equals", path: "/items/0", value: { qty: 2, sku: "A" } }).outcome).toBe("pass");
    const r = runFieldCheck(order, { kind: "equals", path: "/id", value: "ord-2" });
    expect(r.outcome).toBe("fail");
    expect(r.path).toBe("/id");
    expect(r.actual).toBe("ord-1");
    expect(r.expected).toBe("ord-2");
  });

  it("equals: missing field fails with a 'missing' reason", () => {
    const r = runFieldCheck(order, { kind: "equals", path: "/customer/email", value: "x" });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toContain("missing");
  });

  it("equals: null is not missing", () => {
    expect(runFieldCheck(order, { kind: "equals", path: "/note", value: null }).outcome).toBe("pass");
  });

  it("approx: absolute tolerance is inclusive at the edge", () => {
    expect(runFieldCheck({ x: 10.5 }, { kind: "approx", path: "/x", value: 10, tolerance: 0.5 }).outcome).toBe("pass");
    expect(runFieldCheck({ x: 10.51 }, { kind: "approx", path: "/x", value: 10, tolerance: 0.5 }).outcome).toBe("fail");
    expect(runFieldCheck({ x: 9.5 }, { kind: "approx", path: "/x", value: 10, tolerance: 0.5 }).outcome).toBe("pass");
  });

  it("approx: default tolerance is exact; relative tolerance scales with the expected value", () => {
    expect(runFieldCheck(order, { kind: "approx", path: "/total", value: 19.99 }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "approx", path: "/total", value: 20 }).outcome).toBe("fail");
    expect(runFieldCheck({ x: 1010 }, { kind: "approx", path: "/x", value: 1000, relativeTolerance: 0.01 }).outcome).toBe("pass");
    expect(runFieldCheck({ x: 1011 }, { kind: "approx", path: "/x", value: 1000, relativeTolerance: 0.01 }).outcome).toBe("fail");
  });

  it("approx: a non-number or NaN fails as a type mismatch", () => {
    const r = runFieldCheck({ x: "10" }, { kind: "approx", path: "/x", value: 10, tolerance: 1 });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toContain("string");
    expect(runFieldCheck({ x: Number.NaN }, { kind: "approx", path: "/x", value: 10, tolerance: 1 }).outcome).toBe("fail");
  });

  it("contains: substring, optionally case-insensitive; non-string fails", () => {
    expect(runFieldCheck(order, { kind: "contains", path: "/customer/name", value: "Love" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "contains", path: "/customer/name", value: "love" }).outcome).toBe("fail");
    expect(
      runFieldCheck(order, { kind: "contains", path: "/customer/name", value: "love", caseInsensitive: true }).outcome,
    ).toBe("pass");
    expect(runFieldCheck(order, { kind: "contains", path: "/total", value: "19" }).outcome).toBe("fail");
  });

  it("matches: regex with flags; an invalid pattern is invalid, not a guess", () => {
    expect(runFieldCheck(order, { kind: "matches", path: "/id", pattern: "^ord-\\d+$" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "matches", path: "/id", pattern: "^ORD", flags: "i" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "matches", path: "/id", pattern: "^x" }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "matches", path: "/id", pattern: "(" }).outcome).toBe("invalid");
  });

  it("array-contains: primitive membership and partial object match", () => {
    expect(runFieldCheck(order, { kind: "array-contains", path: "/tags", value: "gift" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "array-contains", path: "/tags", value: "fragile" }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "array-contains", path: "/items", value: { sku: "B" } }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "array-contains", path: "/items", value: { sku: "B", qty: 9 } }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "array-contains", path: "/id", value: "o" }).outcome).toBe("fail");
  });

  it("length: arrays and strings, inclusive bounds; no bound is invalid", () => {
    expect(runFieldCheck(order, { kind: "length", path: "/items", equals: 2 }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "length", path: "/items", min: 3 }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "length", path: "/id", min: 5, max: 5 }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "length", path: "/total", min: 1 }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "length", path: "/items" }).outcome).toBe("invalid");
  });

  it("type: distinguishes integer, number, array, object and null", () => {
    expect(runFieldCheck(order, { kind: "type", path: "/total", type: "number" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "type", path: "/total", type: "integer" }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "type", path: "/items/0/qty", type: "integer" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "type", path: "/items", type: "array" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "type", path: "/items", type: "object" }).outcome).toBe("fail");
    expect(runFieldCheck(order, { kind: "type", path: "/note", type: "null" }).outcome).toBe("pass");
    expect(runFieldCheck(order, { kind: "type", path: "/missing", type: "null" }).outcome).toBe("fail");
  });

  it("a malformed pointer is invalid", () => {
    expect(runFieldCheck(order, { kind: "equals", path: "id", value: "ord-1" }).outcome).toBe("invalid");
  });
});

describe("gradeFields (partial expected object)", () => {
  it("passes when every expected leaf matches and ignores extra actual keys", () => {
    const g = gradeFields(order, { id: "ord-1", customer: { name: "Ada Lovelace" } });
    expect(g.verdict).toBe("pass");
    expect(g.score).toBe(1);
    expect(g.fields.map((f) => f.path).sort()).toEqual(["/customer/name", "/id"]);
  });

  it("returns per-field pass/fail with reasons for nested paths", () => {
    const g = gradeFields(order, {
      id: "ord-1",
      paid: false,
      customer: { name: "Ada Lovelace", email: "ada@example.com" },
      items: [{ sku: "A" }, { sku: "C" }],
    });
    expect(g.verdict).toBe("fail");
    const byPath = new Map(g.fields.map((f) => [f.path, f]));
    expect(byPath.get("/id")?.outcome).toBe("pass");
    expect(byPath.get("/paid")?.outcome).toBe("fail");
    expect(byPath.get("/customer/email")?.outcome).toBe("fail");
    expect(byPath.get("/customer/email")?.reason).toContain("missing");
    expect(byPath.get("/items/0/sku")?.outcome).toBe("pass");
    expect(byPath.get("/items/1/sku")?.outcome).toBe("fail");
    expect(g.passed).toBe(3);
    expect(g.failed).toBe(3);
    expect(g.score).toBeCloseTo(0.5);
  });

  it("reports a type mismatch at the container path", () => {
    const g = gradeFields(order, { customer: "Ada", items: { sku: "A" } });
    const byPath = new Map(g.fields.map((f) => [f.path, f]));
    expect(byPath.get("/customer")?.outcome).toBe("fail");
    expect(byPath.get("/customer")?.reason).toContain("object");
    expect(byPath.get("/items")?.outcome).toBe("fail");
  });

  it("array length mismatch fails at the array path", () => {
    const g = gradeFields(order, { tags: ["rush"] });
    const lengthResult = g.fields.find((f) => f.path === "/tags");
    expect(lengthResult?.outcome).toBe("fail");
    expect(lengthResult?.reason).toContain("length");
    expect(g.fields.find((f) => f.path === "/tags/0")?.outcome).toBe("pass");
  });

  it("numeric leaves use numericTolerance", () => {
    expect(gradeFields(order, { total: 20 }).verdict).toBe("fail");
    const g = gradeFields(order, { total: 20 }, { numericTolerance: 0.01 });
    expect(g.verdict).toBe("pass");
    expect(g.fields[0]?.check).toBe("approx");
  });

  it("a key named with '/' gets an escaped pointer", () => {
    const g = gradeFields(order, { customer: { "a/b": 1 } });
    expect(g.fields[0]?.path).toBe("/customer/a~1b");
    expect(g.verdict).toBe("pass");
  });

  it("nothing to check is inconclusive, never a pass", () => {
    const g = gradeFields(order, {});
    expect(g.verdict).toBe("inconclusive");
    expect(g.score).toBe(0);
  });
});

describe("gradeSchema", () => {
  const Order = Schema.Struct({
    id: Schema.String,
    total: Schema.Number,
    items: Schema.Array(Schema.Struct({ sku: Schema.String, qty: Schema.Number })),
  });

  it("passes a schema-valid value", () => {
    const g = gradeSchema(Order, order);
    expect(g.verdict).toBe("pass");
    expect(g.fields).toHaveLength(1);
    expect(g.fields[0]?.check).toBe("schema");
  });

  it("reports every field error as a JSON Pointer", () => {
    const g = gradeSchema(Order, { id: 7, total: "x", items: [{ sku: "A", qty: "2" }] });
    expect(g.verdict).toBe("fail");
    expect(g.fields.map((f) => f.path).sort()).toEqual(["/id", "/items/0/qty", "/total"]);
    expect(g.fields.every((f) => f.outcome === "fail" && f.check === "schema")).toBe(true);
  });
});

describe("gradeStructured (composite)", () => {
  it("combines fields, checks and an optional schema into one grade", () => {
    const g = gradeStructured(order, {
      fields: { id: "ord-1" },
      checks: [
        { kind: "approx", path: "/total", value: 20, tolerance: 0.05 },
        { kind: "length", path: "/items", min: 1 },
        { kind: "contains", path: "/customer/name", value: "Babbage" },
      ],
    });
    expect(g.verdict).toBe("fail");
    expect(g.passed).toBe(3);
    expect(g.failed).toBe(1);
    expect(g.score).toBeCloseTo(0.75);
    expect(g.fields.find((f) => f.outcome === "fail")?.path).toBe("/customer/name");
  });

  it("an invalid check makes the whole grade inconclusive", () => {
    const g = gradeStructured(order, {
      fields: { id: "ord-1" },
      checks: [{ kind: "matches", path: "/id", pattern: "[" }],
    });
    expect(g.verdict).toBe("inconclusive");
    expect(g.invalid).toBe(1);
  });

  it("an empty expectation is inconclusive", () => {
    expect(gradeStructured(order, {}).verdict).toBe("inconclusive");
  });

  it("includes schema results when a schema is given", () => {
    const g = gradeStructured(order, { fields: { id: "ord-1" } }, { schema: Schema.Struct({ id: Schema.Number }) });
    expect(g.verdict).toBe("fail");
    expect(g.fields.some((f) => f.check === "schema" && f.path === "/id")).toBe(true);
  });
});

describe("parseStructuredOutput", () => {
  it("prefers an explicit structured value", () => {
    expect(parseStructuredOutput("not json", { a: 1 })).toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses JSON text", () => {
    expect(parseStructuredOutput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reports text that is not JSON", () => {
    const r = parseStructuredOutput("The answer is 4.");
    expect(r.ok).toBe(false);
  });
});
