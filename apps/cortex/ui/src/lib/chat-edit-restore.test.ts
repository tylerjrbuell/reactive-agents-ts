// Run: bun run repo test apps/cortex/ui/src/lib/chat-edit-restore.test.ts
//
// Edit message brings the tags back as chips; the attached-file block never shows as text.
import { describe, expect, it } from "bun:test";
import { restoreEdit, splitAttachedFiles, tagsOfTurn, userTurnView, type TaggedFile, type TurnLike } from "./chat-edit-restore.js";

const BLOCK = "--- Attached file: AGENTS.md (23 KB) ---\nWorkspace path ./AGENTS.md. The contents are not included here; read the file with file-read if you need them.\n--- End attached file ---";
const user = (id: number, content: string, attachments?: TurnLike["attachments"]): TurnLike => ({ id, role: "user", content, attachments });
const assistant = (id: number): TurnLike => ({ id, role: "assistant", content: "ok" });

describe("splitAttachedFiles", () => {
  it("removes the block and names its file", () => {
    expect(splitAttachedFiles(`summarise this\n\n${BLOCK}`)).toEqual({ text: "summarise this", files: [{ path: "AGENTS.md", bytes: 23 * 1024 }] });
  });
  it("plain text is untouched", () => {
    expect(splitAttachedFiles("  hello  ")).toEqual({ text: "  hello  ", files: [] });
  });
  it("an inlined small file block is removed whole", () => {
    const small = "--- Attached file: a.md (9 B) ---\n```\ntiny body\n```\n--- End attached file ---";
    expect(splitAttachedFiles(`x\n\n${small}`).text).toBe("x");
  });
  it("an older lowercase closing line (already stored text) still parses", () => {
    const old = BLOCK.replace("End attached", "end attached");
    expect(splitAttachedFiles(`x\n\n${old}`)).toEqual({ text: "x", files: [{ path: "AGENTS.md", bytes: 23 * 1024 }] });
  });
});

describe("edit restore", () => {
  const stored = [{ kind: "workspace-file" as const, name: "AGENTS.md", path: "AGENTS.md", bytes: 23_000 }];
  it("tags come from the message's stored attachments (assistant id walks back to its user message)", () => {
    const turns = [user(1, "summarise this", stored), assistant(2)];
    expect(tagsOfTurn(turns, 1)).toEqual([{ path: "AGENTS.md", bytes: 23_000 }]);
    expect(tagsOfTurn(turns, 2)).toEqual([{ path: "AGENTS.md", bytes: 23_000 }]);
    expect(tagsOfTurn(turns, 99)).toEqual([]);
  });
  it("a message with only the envelope text still yields its tag", () => {
    expect(tagsOfTurn([user(1, `go\n\n${BLOCK}`)], 1)).toEqual([{ path: "AGENTS.md", bytes: 23 * 1024 }]);
  });
  it("restoreEdit puts clean text in the composer and each tag back as a chip", () => {
    const put: string[] = [];
    const tags: TaggedFile[] = [];
    restoreEdit([user(1, "summarise this", stored), assistant(2)], 1, "summarise this", (t) => put.push(t), (f) => tags.push(f));
    expect(put).toEqual(["summarise this"]);
    expect(tags).toEqual([{ path: "AGENTS.md", bytes: 23_000 }]);
  });
  it("restoreEdit strips an envelope from the rewound text and does not tag twice", () => {
    const put: string[] = [];
    const tags: TaggedFile[] = [];
    restoreEdit([user(1, `go\n\n${BLOCK}`, stored)], 1, `go\n\n${BLOCK}`, (t) => put.push(t), (f) => tags.push(f));
    expect(put).toEqual(["go"]);
    expect(tags.map((t) => t.path)).toEqual(["AGENTS.md"]);
  });
});

describe("userTurnView", () => {
  it("shows typed text and chips, never the block", () => {
    const v = userTurnView({ content: `go\n\n${BLOCK}`, attachments: undefined });
    expect(v.text).toBe("go");
    expect(v.attachments).toEqual([{ kind: "workspace-file", name: "AGENTS.md", path: "AGENTS.md", bytes: 23 * 1024 }]);
  });
});

describe("rerun keeps the tags", () => {
  it("taggedDraftsOf gives path chips that requestOf sends as files", async () => {
    const { taggedDraftsOf, requestOf } = await import("./composer-attachments.js");
    const drafts = taggedDraftsOf(user(1, "again", [{ kind: "workspace-file", name: "AGENTS.md", path: "AGENTS.md", bytes: 5 }]));
    expect(requestOf(drafts)).toEqual({ files: ["AGENTS.md"] });
  });
});
