import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  type Command,
  commandPalette,
  commandPaletteFiltered,
  commandPaletteQuery,
  commandPaletteView,
  filterCommands,
  groupCommands,
  highlightSegments,
  paletteView,
  scoreCommand,
  wrapIndex,
} from "./command-palette.js";

const noop = () => {};
const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, label, action: noop, ...extra });

const commands: Command[] = [
  cmd("go-runs", "Runs", { group: "Navigate", keywords: ["history", "trace"], description: "Run history and traces" }),
  cmd("go-lab", "Lab", { group: "Navigate", keywords: ["builder"] }),
  cmd("lab-builder", "Builder", { group: "Lab", keywords: ["lab", "configure"] }),
  cmd("lab-tools", "Tools", { group: "Lab", keywords: ["lab", "mcp"] }),
  cmd("view-last-run", "Open the latest run", { group: "Runs", keywords: ["recent"] }),
  cmd("copy-env", "Copy CORTEX_URL", { description: "The server URL as an environment variable" }),
];

describe("scoreCommand", () => {
  test("label start beats word start beats inside the label beats keyword beats description", () => {
    const c = cmd("x", "Open the latest run", { keywords: ["recent"], description: "jump to trace" });
    expect(scoreCommand(c, "open")).toBe(100);
    expect(scoreCommand(c, "lat")).toBe(80);
    expect(scoreCommand(c, "test")).toBe(60);
    expect(scoreCommand(c, "rec")).toBe(40);
    expect(scoreCommand(c, "cent")).toBe(30);
    expect(scoreCommand(c, "jump")).toBe(10);
    expect(scoreCommand(c, "zzz")).toBe(0);
  });
  test("every word must match; scores add up; case is ignored", () => {
    const c = cmd("x", "Copy CORTEX_URL", { description: "environment variable" });
    expect(scoreCommand(c, "COPY env")).toBe(110);
    expect(scoreCommand(c, "copy nope")).toBe(0);
  });
  test("an empty query matches everything", () => {
    expect(scoreCommand(commands[0]!, "   ")).toBe(1);
  });
});

describe("filterCommands", () => {
  test("empty query keeps every command in registration order", () => {
    expect(filterCommands(commands, "").map((c) => c.id)).toEqual(commands.map((c) => c.id));
  });
  test("ranks best match first and drops non-matches", () => {
    // "lab": label start for Lab, keyword for Builder and Tools.
    expect(filterCommands(commands, "lab").map((c) => c.id)).toEqual(["go-lab", "lab-builder", "lab-tools"]);
  });
  test("caps a query's matches", () => {
    expect(filterCommands(commands, "o", 2)).toHaveLength(2);
  });
});

describe("groupCommands / paletteView", () => {
  test("no query: sections follow COMMAND_GROUPS, ungrouped commands list under Actions, indexes run in display order", () => {
    const shuffled = [commands[5]!, commands[4]!, commands[2]!, commands[0]!];
    const sections = groupCommands(shuffled, false);
    expect(sections.map((s) => s.group)).toEqual(["Navigate", "Lab", "Runs", "Actions"]);
    expect(sections.flatMap((s) => s.items.map((i) => `${i.index}:${i.command.id}`))).toEqual([
      "0:go-runs",
      "1:lab-builder",
      "2:view-last-run",
      "3:copy-env",
    ]);
  });
  test("with a query, sections follow their best match so the first row is the best match", () => {
    const view = paletteView(commands, "run");
    // "Open the latest run" (word start, Runs) ranks below "Runs" (label start, Navigate).
    expect(view.sections.map((s) => s.group)).toEqual(["Navigate", "Runs"]);
    expect(view.flat.map((c) => c.id)).toEqual(["go-runs", "view-last-run"]);
  });
  test("a later group with the best match lists first", () => {
    const list = [
      cmd("go-runs", "Runs", { group: "Navigate", keywords: ["history"] }),
      cmd("export", "History export", { group: "Actions" }),
    ];
    const view = paletteView(list, "history");
    expect(view.sections.map((s) => s.group)).toEqual(["Actions", "Navigate"]);
    expect(view.flat.map((c) => c.id)).toEqual(["export", "go-runs"]);
  });
  test("flat order equals the sections' order", () => {
    const view = paletteView(commands, "");
    expect(view.flat.map((c) => c.id)).toEqual(view.sections.flatMap((s) => s.items.map((i) => i.command.id)));
  });
  test("no match: no sections", () => {
    expect(paletteView(commands, "qqq")).toEqual({ sections: [], flat: [] });
  });
});

describe("highlightSegments", () => {
  test("marks the first occurrence of each word, case-insensitive", () => {
    expect(highlightSegments("Open the latest run", "LAT run")).toEqual([
      { text: "Open the ", match: false },
      { text: "lat", match: true },
      { text: "est ", match: false },
      { text: "run", match: true },
    ]);
  });
  test("overlapping marks merge", () => {
    expect(highlightSegments("Settings", "set ett")).toEqual([
      { text: "Sett", match: true },
      { text: "ings", match: false },
    ]);
  });
  test("no query or a keyword-only match leaves the label plain", () => {
    expect(highlightSegments("Builder", "")).toEqual([{ text: "Builder", match: false }]);
    expect(highlightSegments("Builder", "lab")).toEqual([{ text: "Builder", match: false }]);
  });
});

describe("wrapIndex", () => {
  test("wraps at both ends; empty list stays at 0", () => {
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(1, 1, 3)).toBe(2);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});

describe("palette store", () => {
  test("registered commands flow through the view; re-registering an id replaces it; unregister removes", () => {
    const off = commandPalette.register([cmd("t-a", "Alpha test", { group: "Runs" })]);
    const off2 = commandPalette.register([cmd("t-a", "Alpha replaced", { group: "Runs" })]);
    commandPaletteQuery.set("alpha");
    expect(get(commandPaletteFiltered).map((c) => c.label)).toEqual(["Alpha replaced"]);
    expect(get(commandPaletteView).sections.map((s) => s.group)).toEqual(["Runs"]);
    off2();
    off();
    expect(get(commandPaletteFiltered)).toEqual([]);
    commandPalette.close();
    expect(get(commandPaletteQuery)).toBe("");
  });
});
