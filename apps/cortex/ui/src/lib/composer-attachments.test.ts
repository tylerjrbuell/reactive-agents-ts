import { describe, expect, test } from "bun:test";
import { ATTACHMENT_CAPS } from "@reactive-agents/ui-core";
import { acceptFor, addTagged, admit, bytesToBase64, countRefusal, metaOf, requestOf, type DraftAttachment } from "./composer-attachments.js";

const file = (name: string, mediaType: string, bytes: number) => ({ name, mediaType, bytes });
const chip = (over: Partial<DraftAttachment> & Pick<DraftAttachment, "id" | "kind" | "name">): DraftAttachment => ({ bytes: 10, ...over });
const noVision = { vision: false, authoritative: true } as const;

describe("admit", () => {
  test("pictures, audio and text pass for a model that takes them", () => {
    const vision = { vision: true, audioIn: true, authoritative: true };
    expect(admit([], file("a.png", "image/png", 5), vision, "m")).toEqual({ ok: true, kind: "image", mediaType: "image/png" });
    expect(admit([], file("a.wav", "audio/wav", 5), vision, "m").ok).toBe(true);
    expect(admit([], file("a.md", "text/markdown", 5), vision, "m").ok).toBe(true);
  });

  test("a no-vision model refuses a picture with the reason; text still passes", () => {
    const r = admit([], file("a.png", "image/png", 5), noVision, "qwen3:4b");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("qwen3:4b does not accept pictures");
    expect(admit([], file("a.md", "text/markdown", 5), noVision, "qwen3:4b").ok).toBe(true);
  });

  test("size caps, the type allowlist and the count cap", () => {
    expect(admit([], file("a.png", "image/png", ATTACHMENT_CAPS.imageBytes + 1), undefined, "m").ok).toBe(false);
    expect(admit([], file("a.exe", "application/x-msdownload", 5), undefined, "m").ok).toBe(false);
    const full = Array.from({ length: ATTACHMENT_CAPS.count }, (_, i) => chip({ id: `${i}`, kind: "text", name: `f${i}.txt` }));
    expect(countRefusal(full)).toContain("At most");
    expect(admit(full, file("x.txt", "text/plain", 1), undefined, "m").ok).toBe(false);
  });

  test("the same upload twice is refused", () => {
    const items = [chip({ id: "1", kind: "image", name: "a.png", bytes: 5 })];
    expect(admit(items, file("a.png", "image/png", 5), undefined, "m")).toMatchObject({ ok: false });
  });
});

describe("tagging", () => {
  test("a tagged file becomes a chip named by its base name; the same path twice is one chip", () => {
    const a = addTagged([], { path: "src/chat/composer.ts", bytes: 99 }, "t1");
    expect(a.items).toEqual([{ id: "t1", kind: "workspace-file", name: "composer.ts", path: "src/chat/composer.ts", bytes: 99 }]);
    expect(addTagged(a.items, { path: "src/chat/composer.ts", bytes: 99 }, "t2").items).toHaveLength(1);
  });

  test("the count cap applies to tagged files too", () => {
    const full = Array.from({ length: ATTACHMENT_CAPS.count }, (_, i) => chip({ id: `${i}`, kind: "workspace-file", name: `f${i}`, path: `f${i}` }));
    expect(addTagged(full, { path: "extra", bytes: 1 }, "x").error).toContain("At most");
  });
});

describe("request and transcript shapes", () => {
  const items: DraftAttachment[] = [
    chip({ id: "1", kind: "image", name: "a.png", mediaType: "image/png", dataBase64: "QUJD", thumb: "data:image/png;base64,QUJD" }),
    chip({ id: "2", kind: "workspace-file", name: "composer.ts", path: "src/composer.ts" }),
  ];
  test("requestOf splits uploads from tagged paths; nothing attached is undefined", () => {
    expect(requestOf(items)).toEqual({ uploads: [{ name: "a.png", mediaType: "image/png", dataBase64: "QUJD" }], files: ["src/composer.ts"] });
    expect(requestOf([])).toBeUndefined();
  });
  test("metaOf keeps names and sizes, never bytes or thumbnails", () => {
    const meta = metaOf(items);
    expect(JSON.stringify(meta)).not.toContain("QUJD");
    expect(meta[1]).toEqual({ kind: "workspace-file", name: "composer.ts", bytes: 10, path: "src/composer.ts" });
  });
});

describe("helpers", () => {
  test("bytesToBase64 handles chunk boundaries", () => {
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(bytesToBase64(big))).toBe("A".repeat(big.length));
    expect(bytesToBase64(new Uint8Array([0x61, 0x62, 0x63]))).toBe("YWJj");
  });
  test("accept lists", () => {
    expect(acceptFor("image")).toContain("image/png");
    expect(acceptFor("audio")).toBe("audio/*");
    expect(acceptFor("text")).toContain(".md");
  });
});
