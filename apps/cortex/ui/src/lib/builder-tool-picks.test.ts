import { describe, expect, it } from "bun:test";
import { builderToolPicks, shellPresetPicks } from "./builder-tool-picks.js";

describe("builderToolPicks", () => {
  const catalog = [
    { kind: "built-in", name: "web-search" },
    { kind: "meta", name: "recall" },
    { kind: "meta", name: "find" },
    { kind: "built-in", name: "file-read", displayName: "File read" },
    { kind: "built-in", name: "crypto-price", disabled: true },
    { kind: "mcp", name: "github/list" },
  ];

  it("offers built-in tools only, so meta-tools like recall appear only in Meta tools", () => {
    const ids = builderToolPicks(catalog, {}).map((p) => p.id);
    expect(ids).toEqual(["file-read", "web-search"]);
    expect(ids).not.toContain("recall");
  });

  it("offers each shell toolset by its own name, labelled with the programs it runs", () => {
    const picks = shellPresetPicks({ git: ["git", "gh"], workspace: ["gws"] });
    expect(picks).toEqual([
      { id: "git", label: "git (git · gh via shell)", icon: "shell" },
      { id: "workspace", label: "workspace (gws via shell)", icon: "shell" },
    ]);
    expect(picks.map((p) => p.id)).not.toContain("shell-execute");
  });

  it("uses the kit icon map with a generic tool fallback", () => {
    const picks = builderToolPicks(catalog, { "web-search": "search" });
    expect(picks.find((p) => p.id === "web-search")?.icon).toBe("search");
    expect(picks.find((p) => p.id === "file-read")?.icon).toBe("tool");
    expect(builderToolPicks(catalog).find((p) => p.id === "file-read")?.icon).toBe("file");
  });
});
