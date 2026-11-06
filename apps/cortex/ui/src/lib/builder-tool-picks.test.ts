import { describe, expect, it } from "bun:test";
import { builderToolPicks } from "./builder-tool-picks.js";

describe("builderToolPicks", () => {
  const catalog = [
    { kind: "built-in", name: "web-search" },
    { kind: "meta", name: "recall" },
    { kind: "meta", name: "find" },
    { kind: "built-in", name: "file-read", displayName: "File read" },
    { kind: "built-in", name: "gws-cli", disabled: true },
    { kind: "mcp", name: "github/list" },
  ];

  it("offers built-in tools only, so meta-tools like recall appear only in Meta tools", () => {
    const ids = builderToolPicks(catalog, {}).map((p) => p.id);
    expect(ids).toEqual(["file-read", "web-search"]);
    expect(ids).not.toContain("recall");
  });

  it("uses the icon map with a settings fallback", () => {
    const picks = builderToolPicks(catalog, { "web-search": "search" });
    expect(picks.find((p) => p.id === "web-search")?.icon).toBe("search");
    expect(picks.find((p) => p.id === "file-read")?.icon).toBe("settings");
  });
});
