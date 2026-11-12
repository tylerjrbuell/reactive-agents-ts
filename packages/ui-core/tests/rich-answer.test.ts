import { describe, expect, test } from "bun:test";
import {
  ATTACHMENT_CAPS,
  calloutKindOf,
  classifyAttachment,
  cutToBytes,
  deliverableCallsOf,
  deliverableFileName,
  deliverablesOf,
  fileContextBlock,
  gateAttachmentKind,
  modalityMessage,
  outlineOf,
  rankPaths,
  scorePath,
} from "../src/index.js";

const write = (path: string, content: string, status: "done" | "failed" | "running" = "done", result?: string) => ({
  name: "file-write",
  status,
  args: { path, content },
  ...(result !== undefined ? { result } : {}),
});

describe("deliverablesOf", () => {
  test("files the run wrote, one entry per path, later write replaces content", () => {
    const items = deliverablesOf({ toolCalls: [write("out/a.md", "one"), write("out/b.json", "{}"), write("out/a.md", "two")] });
    expect(items.map((i) => [i.name, i.kind, i.content])).toEqual([
      ["a.md", "report", "two"],
      ["b.json", "data", "{}"],
    ]);
  });

  test("a failed or running write produces nothing", () => {
    expect(deliverablesOf({ toolCalls: [write("a.md", "x", "failed"), write("b.md", "x", "running")] })).toEqual([]);
  });

  test("the tool's resolved path wins over the requested one", () => {
    const [d] = deliverablesOf({ toolCalls: [write("./r.md", "x", "done", JSON.stringify({ written: true, path: "/ws/r.md" }))] });
    expect(d?.path).toBe("/ws/r.md");
    expect(d?.name).toBe("r.md");
  });

  test("edits become a patch; an edit after a whole write keeps the file", () => {
    const edit = (n: string) => ({ name: "file-edit", status: "done" as const, args: { path: "s.ts", oldText: `a${n}`, newText: `b${n}` } });
    const [d] = deliverablesOf({ toolCalls: [edit("1"), edit("2")] });
    expect(d?.kind).toBe("diff");
    expect(d?.content).toBe("-a1\n+b1\n-a2\n+b2");
    expect(deliverableFileName(d!)).toBe("s.ts.patch");
    const [w] = deliverablesOf({ toolCalls: [write("s.ts", "whole"), edit("1")] });
    expect(w?.kind).toBe("file");
    expect(w?.content).toBe("whole");
  });

  test("images are recognised by extension; long content is capped and marked", () => {
    const [img, big] = deliverablesOf({ toolCalls: [write("p.png", "x"), write("big.txt", "y".repeat(50_000))] });
    expect(img?.kind).toBe("image");
    expect(big?.truncated).toBe(true);
    expect(big?.contentChars).toBe(50_000);
    expect(big?.content?.length).toBeLessThan(50_000);
  });

  test("structured result and declared deliverables not already files", () => {
    const items = deliverablesOf({
      toolCalls: [write("report.md", "x")],
      structured: { ok: true },
      declared: [{ spec: "report.md", produced: true }, { spec: "notes.txt", produced: false }],
    });
    expect(items.map((i) => i.id)).toEqual(["report.md", "structured", "declared:notes.txt"]);
    expect(items[2]?.missing).toBe(true);
    expect(items[1]?.content).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  test("other tools and prose produce nothing", () => {
    expect(deliverablesOf({ toolCalls: [{ name: "web-search", status: "done", args: { path: "x.md" } }] })).toEqual([]);
  });
});

describe("outlineOf", () => {
  test("headings with unique ids, fenced code skipped, depth bounded", () => {
    const md = ["# Title", "intro", "```", "# not a heading", "```", "## Part", "### Sub", "#### too deep", "## Part"].join("\n");
    expect(outlineOf(md).map((e) => [e.depth, e.text, e.id])).toEqual([
      [1, "Title", "title"],
      [2, "Part", "part"],
      [3, "Sub", "sub"],
      [2, "Part", "part-2"],
    ]);
  });

  test("fewer than three headings is no outline", () => {
    expect(outlineOf("# One\n## Two")).toEqual([]);
  });

  test("inline markup is stripped from heading text", () => {
    expect(outlineOf("# A `b` [c](http://x)\n## d\n## e")[0]?.text).toBe("A b c");
  });
});

describe("calloutKindOf", () => {
  test("recognises GitHub-style callouts in any case", () => {
    expect(calloutKindOf("[!NOTE] hi")).toBe("note");
    expect(calloutKindOf("[!warning]")).toBe("warning");
    expect(calloutKindOf("[!BOGUS]")).toBeNull();
    expect(calloutKindOf("plain")).toBeNull();
  });
});

describe("classifyAttachment", () => {
  test("images, audio, text by MIME or extension", () => {
    expect(classifyAttachment({ name: "a.png", mediaType: "image/png", bytes: 10 })).toEqual({ ok: true, kind: "image", mediaType: "image/png" });
    expect(classifyAttachment({ name: "a.mp3", mediaType: "", bytes: 10 })).toEqual({ ok: true, kind: "audio", mediaType: "audio/mpeg" });
    expect(classifyAttachment({ name: "a.ts", mediaType: "application/octet-stream", bytes: 10 })).toMatchObject({ ok: true, kind: "text" });
  });

  test("size caps per kind", () => {
    expect(classifyAttachment({ name: "a.png", mediaType: "image/png", bytes: ATTACHMENT_CAPS.imageBytes + 1 }).ok).toBe(false);
    expect(classifyAttachment({ name: "a.wav", mediaType: "audio/wav", bytes: ATTACHMENT_CAPS.audioBytes + 1 }).ok).toBe(false);
    const big = classifyAttachment({ name: "a.txt", mediaType: "text/plain", bytes: ATTACHMENT_CAPS.fileBytes + 1 });
    expect(big.ok).toBe(false);
  });

  test("unsupported type is refused with a reason", () => {
    const r = classifyAttachment({ name: "a.exe", mediaType: "application/x-msdownload", bytes: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not supported");
  });
});

describe("gateAttachmentKind", () => {
  const noVision = { vision: false, authoritative: true } as const;
  test("authoritative no-vision refuses images with a reason; text passes", () => {
    const g = gateAttachmentKind("image", noVision, "llama3");
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain("llama3");
    expect(gateAttachmentKind("text", noVision).allowed).toBe(true);
  });
  test("a guessed capability or unknown model lets the part through", () => {
    expect(gateAttachmentKind("image", { vision: false, authoritative: false }).allowed).toBe(true);
    expect(gateAttachmentKind("image", undefined).allowed).toBe(true);
  });
  test("audio refused only when audioIn is explicitly false", () => {
    expect(gateAttachmentKind("audio", { vision: true, audioIn: false, authoritative: true }).allowed).toBe(false);
    expect(gateAttachmentKind("audio", { vision: true, authoritative: true }).allowed).toBe(true);
  });
  test("modalityMessage names the model and the kind", () => {
    expect(modalityMessage("image", "m1")).toContain("m1 does not accept pictures");
  });
});

describe("file context", () => {
  test("cutToBytes cuts on a character boundary and reports it", () => {
    expect(cutToBytes("abc", 10)).toEqual({ text: "abc", truncated: false });
    const r = cutToBytes("ééééé", 5);
    expect(r.truncated).toBe(true);
    expect(new TextEncoder().encode(r.text).length).toBeLessThanOrEqual(5);
  });
  test("a cut file says N KB of M KB", () => {
    expect(fileContextBlock("a.ts", "x", 340 * 1024, 64 * 1024)).toContain("(64 KB of 340 KB, cut)");
    expect(fileContextBlock("a.ts", "x", 2048, 2048)).toContain("(2 KB)");
  });
});

describe("rankPaths", () => {
  const paths = ["src/chat/composer.ts", "src/chat/index.ts", "README.md", "docs/guide/composer-notes.md", "a/b/c/d/readme-extra.txt"];
  test("base-name contiguous hits come first", () => {
    expect(rankPaths("composer", paths)[0]?.path).toBe("src/chat/composer.ts");
  });
  test("subsequence matches and non-matches", () => {
    expect(rankPaths("scc", paths).map((m) => m.path)).toContain("src/chat/composer.ts");
    expect(rankPaths("zzz", paths)).toEqual([]);
  });
  test("empty query lists shallow files first; limit applies", () => {
    expect(rankPaths("", paths)[0]?.path).toBe("README.md");
    expect(rankPaths("", paths, 2)).toHaveLength(2);
  });
  test("indices point at matched characters", () => {
    const m = scorePath("read", "README.md");
    expect(m?.indices).toEqual([0, 1, 2, 3]);
  });
});

describe("deliverableCallsOf", () => {
  test("pairs start and completion by callId, keeps args and the resolved path", () => {
    const calls = deliverableCallsOf([
      { _tag: "ToolCallStarted", callId: "c1", toolName: "file-write", args: { path: "r.md", content: "# R" } },
      { _tag: "ToolCallCompleted", callId: "c1", toolName: "file-write", success: true, result: { written: true, path: "/ws/r.md" } },
      { _tag: "ToolCallStarted", callId: "c2", toolName: "file-write", args: { path: "b.md", content: "x" } },
      { _tag: "ToolCallCompleted", callId: "c3", toolName: "web-search", success: false },
      { _tag: "TextDelta" },
    ]);
    expect(calls.map((c) => [c.name, c.status])).toEqual([["file-write", "done"], ["file-write", "running"], ["web-search", "failed"]]);
    const items = deliverablesOf({ toolCalls: calls });
    expect(items.map((i) => [i.path, i.content])).toEqual([["/ws/r.md", "# R"]]);
  });
});
