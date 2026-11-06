import { describe, expect, test } from "bun:test";
import { choiceOptions, formFields, formValue, replyControl, replyToChatInteraction } from "./chat-interactions.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("schema readers", () => {
  test("choiceOptions keeps non-blank strings only", () => {
    expect(choiceOptions({ options: ["red", 3, "", "blue"] })).toEqual(["red", "blue"]);
    expect(choiceOptions({})).toEqual([]);
    expect(choiceOptions(null)).toEqual([]);
  });

  test("formFields normalises label/type/required and skips unnamed fields", () => {
    expect(
      formFields({ fields: [{ name: "age", type: "number", required: true }, { label: "no name" }, { name: "ok", label: "OK?", type: "boolean" }, { name: "x", type: "date" }] }),
    ).toEqual([
      { name: "age", label: "age", type: "number", required: true },
      { name: "ok", label: "OK?", type: "boolean", required: false },
      { name: "x", label: "x", type: "text", required: false },
    ]);
    expect(formFields({ fields: "nope" })).toEqual([]);
  });

  test("replyControl falls back to free text when the schema gives nothing to pick", () => {
    expect(replyControl({ kind: "confirmation", schema: {} })).toBe("confirmation");
    expect(replyControl({ kind: "choice", schema: { options: ["a"] } })).toBe("choice");
    expect(replyControl({ kind: "choice", schema: {} })).toBe("text");
    expect(replyControl({ kind: "form", schema: { fields: [{ name: "a" }] } })).toBe("form");
    expect(replyControl({ kind: "form", schema: {} })).toBe("text");
    expect(replyControl({ kind: "other", schema: {} })).toBe("text");
  });
});

describe("formValue", () => {
  const fields = formFields({ fields: [{ name: "name", required: true }, { name: "age", type: "number" }, { name: "ok", type: "boolean" }, { name: "note" }] });

  test("coerces numbers and booleans, drops blank optional fields", () => {
    expect(formValue(fields, { name: " Ada ", age: "36", ok: true, note: " " })).toEqual({ value: { name: "Ada", age: 36, ok: true }, missing: [] });
  });

  test("a non-numeric number field stays text; unchecked booleans are false", () => {
    expect(formValue(fields, { name: "A", age: "old" }).value).toEqual({ name: "A", age: "old", ok: false });
  });

  test("names required fields that are blank", () => {
    expect(formValue(fields, {}).missing).toEqual(["name"]);
  });
});

describe("replyToChatInteraction", () => {
  test("posts the value to the session-scoped respond route and reads the outcome", async () => {
    const seen: { url: string; body: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return json(url.includes("r2") ? { ok: true, status: "awaiting-interaction" } : { ok: true, status: "completed", reply: "done" });
    };
    expect(await replyToChatInteraction("s 1", "r1", { value: false }, f)).toEqual({ ok: true, status: "completed" });
    expect(await replyToChatInteraction("s1", "r2", { value: "blue" }, f)).toEqual({ ok: true, status: "awaiting-interaction" });
    expect(seen[0]!.url).toContain("/api/chat/sessions/s%201/interactions/r1/respond");
    expect(seen[0]!.body).toBe(JSON.stringify({ value: false }));
  });

  test("dismiss posts to the dismiss route", async () => {
    let url = "";
    const out = await replyToChatInteraction("s", "r", "dismiss", async (u) => {
      url = u;
      return json({ ok: true });
    });
    expect(out).toEqual({ ok: true, status: "dismissed" });
    expect(url).toContain("/interactions/r/dismiss");
  });

  test("server and network failures come back as values, not throws", async () => {
    expect(await replyToChatInteraction("s", "r", { value: 1 }, async () => json({ error: "config changed" }, 422))).toEqual({ ok: false, status: 422, error: "config changed" });
    const down = await replyToChatInteraction("s", "r", { value: 1 }, async () => {
      throw new Error("offline");
    });
    expect(down).toEqual({ ok: false, status: 0, error: "offline" });
  });
});
