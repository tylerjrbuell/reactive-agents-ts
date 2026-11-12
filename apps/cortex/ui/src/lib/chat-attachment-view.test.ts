import { describe, expect, test } from "bun:test";
import { attachmentIcon, attachmentLabel, attachmentTitle } from "./chat-attachment-view.js";

describe("attachment wording", () => {
  test("label shows the size, and 'N KB of M KB sent' when a file was cut", () => {
    expect(attachmentLabel({ name: "a.md", bytes: 2048 })).toBe("a.md · 2 KB");
    expect(attachmentLabel({ name: "big.md", bytes: 300 * 1024, shownBytes: 64 * 1024 })).toBe("big.md · 64 KB of 300 KB sent");
  });
  test("icons by kind", () => {
    expect(attachmentIcon("image")).toBe("image");
    expect(attachmentIcon("audio")).toBe("mic");
    expect(attachmentIcon("workspace-file")).toBe("file");
  });
  test("title names the kind, the path and the size", () => {
    expect(attachmentTitle({ kind: "workspace-file", name: "c.ts", path: "src/c.ts", bytes: 1024 })).toBe("Workspace file src/c.ts, 1 KB");
  });
});
