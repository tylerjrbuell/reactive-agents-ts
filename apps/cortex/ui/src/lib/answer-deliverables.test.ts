import { describe, expect, test } from "bun:test";
import type { DeliverableItem } from "@reactive-agents/ui-core";
import { deliverableActions, deliverableIcon, deliverableMeta, deliverableMime } from "./answer-deliverables.js";

const item = (over: Partial<DeliverableItem>): DeliverableItem => ({ id: "x", kind: "file", name: "x", source: "file-write", ...over });

describe("deliverables strip", () => {
  test("preview, copy and download need known content; images and declared items have none", () => {
    expect(deliverableActions(item({ content: "hi" }))).toEqual({ preview: true, copy: true, download: true });
    expect(deliverableActions(item({ kind: "image", content: "bytes?" }))).toEqual({ preview: false, copy: false, download: false });
    expect(deliverableActions(item({ kind: "declared" }))).toEqual({ preview: false, copy: false, download: false });
  });

  test("meta line: kind, size, preview cut, declared-not-produced", () => {
    expect(deliverableMeta(item({ kind: "report", content: "x", contentChars: 2048 }))).toBe("report · 2 KB");
    expect(deliverableMeta(item({ kind: "file", content: "x", contentChars: 90_000, truncated: true }))).toBe("file · 88 KB, preview cut");
    expect(deliverableMeta(item({ kind: "declared", missing: true }))).toBe("declared, not produced");
    expect(deliverableMeta(item({ kind: "structured", contentChars: 10 }))).toBe("typed result · 10 B");
  });

  test("icons and download type", () => {
    expect(deliverableIcon("image")).toBe("image");
    expect(deliverableIcon("diff")).toBe("code");
    expect(deliverableMime(item({ mediaType: "text/markdown" }))).toBe("text/markdown");
    expect(deliverableMime(item({ mediaType: "application/octet-stream" }))).toBe("text/plain");
  });
});
