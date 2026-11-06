import { describe, expect, test } from "bun:test";
import { matchCommands, parseExportFormat, parseKeepLast, parseSlash, resolveCommand } from "./chat-commands.js";

describe("chat slash commands", () => {
  test("only a single-line leading slash is a command", () => {
    expect(parseSlash("hello")).toBeNull();
    expect(parseSlash("/clear\nmore")).toBeNull();
    expect(parseSlash("/")).toEqual({ query: "", arg: "", hasArg: false });
    expect(parseSlash("/usr/bin/env")).toBeNull();
    expect(parseSlash("/ 5 apples")).toBeNull();
    expect(parseSlash("/Compact 3")).toEqual({ query: "compact", arg: "3", hasArg: true });
  });

  test("matching ranks prefix before substring", () => {
    expect(matchCommands("").length).toBeGreaterThan(5);
    expect(matchCommands("re").map((c) => c.name)).toEqual(["rerun", "rewind", "rename"]);
    expect(matchCommands("o").map((c) => c.name)).toEqual(["compact", "fork", "copy", "export", "model", "provider", "docs", "tools", "workspace", "iterations", "goal", "go", "loop"]);
    expect(matchCommands("zzz")).toEqual([]);
  });

  test("/export resolves with a format arg, defaulting to md", () => {
    const cmd = resolveCommand(parseSlash("/export json")!);
    expect(cmd?.name).toBe("export");
    expect(parseSlash("/export json")!.arg).toBe("json");
    expect(parseExportFormat("")).toBe("md");
    expect(parseExportFormat("JSON")).toBe("json");
    expect(parseExportFormat("jsonl")).toBe("jsonl");
    expect(parseExportFormat("xml")).toBeUndefined();
  });

  test("resolve is exact, keep-last must be a positive integer", () => {
    expect(resolveCommand(parseSlash("/clear")!)?.name).toBe("clear");
    expect(resolveCommand(parseSlash("/cle")!)).toBeUndefined();
    expect(parseKeepLast("")).toBeUndefined();
    expect(parseKeepLast("3")).toBe(3);
    expect(parseKeepLast("0")).toBeUndefined();
    expect(parseKeepLast("x")).toBeUndefined();
  });
});

describe("/go command", () => {
  test("is registered and resolvable", () => {
    expect(resolveCommand({ query: "go", arg: "", hasArg: false })?.name).toBe("go");
  });
});

describe("matchCommands exact-match ranking", () => {
  test("exact name outranks longer prefix matches (/go before /goal)", () => {
    expect(matchCommands("go").map((c) => c.name).slice(0, 2)).toEqual(["go", "goal"]);
  });
});
