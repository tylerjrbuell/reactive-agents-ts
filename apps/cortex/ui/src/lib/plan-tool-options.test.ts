import { describe, expect, test } from "bun:test";
import { EMPTY_CATALOG, type QuickbarCatalog } from "./chat-quickbar-data.js";
import { OWN_TOOLS_GROUP, planToolOptions, UNAVAILABLE_TOOLS_GROUP } from "./plan-tool-options.js";

const catalog: QuickbarCatalog = {
  ...EMPTY_CATALOG,
  builtinTools: [{ name: "file-read", label: "Read file" }, { name: "web-search", label: "Web search" }],
  mcpServers: [
    { serverId: "gh", name: "GitHub", tools: ["create_issue", "list_prs"] },
    { serverId: "fs", name: "Files", tools: ["read_dir"] },
  ],
};
const pairs = (o: ReturnType<typeof planToolOptions>) => o.map((x) => [x.group ?? "", x.value]);

describe("planToolOptions", () => {
  test("lists the session's own tools, then each attached MCP server's tools under its name", () => {
    const o = planToolOptions({ tools: ["file-read", "web-search"], mcpServerIds: ["gh"] }, catalog, []);
    expect(pairs(o)).toEqual([
      ["", ""],
      [OWN_TOOLS_GROUP, "file-read"],
      [OWN_TOOLS_GROUP, "web-search"],
      ["GitHub", "create_issue"],
      ["GitHub", "list_prs"],
    ]);
    expect(o[0]?.label).toBe("No tool");
    expect(o[1]?.label).toBe("Read file");
  });

  test("an MCP server attached with named tools offers only those (the quick bar's rule); a detached one offers none", () => {
    const o = planToolOptions({ tools: ["list_prs"], mcpServerIds: ["gh"] }, catalog, []);
    expect(o.filter((x) => x.group === "GitHub").map((x) => x.value)).toEqual(["list_prs"]);
    expect(o.some((x) => x.group === "Files")).toBe(false);
  });

  test("a hinted name the session does not offer stays visible under its own heading, once", () => {
    const o = planToolOptions({ tools: ["file-read"], mcpServerIds: [] }, catalog, ["shell-execute", "file-read", "shell-execute", ""]);
    expect(pairs(o).filter(([g]) => g === UNAVAILABLE_TOOLS_GROUP)).toEqual([[UNAVAILABLE_TOOLS_GROUP, "shell-execute"]]);
    expect(o.filter((x) => x.value === "file-read")).toHaveLength(1);
  });

  test("tools off offers nothing but the hinted names; terminal adds shell-execute", () => {
    const off = planToolOptions({ enableTools: false, tools: ["file-read"] }, catalog, ["web-search"]);
    expect(pairs(off)).toEqual([["", ""], [UNAVAILABLE_TOOLS_GROUP, "web-search"]]);
    expect(planToolOptions({ terminalTools: true }, catalog, []).map((x) => x.value)).toEqual(["", "shell-execute"]);
  });
});
