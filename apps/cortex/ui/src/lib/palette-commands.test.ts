import { describe, expect, test } from "bun:test";
import { paletteCommands, type PaletteDeps } from "./palette-commands.js";
import { LAB_TABS } from "./lab-tabs.js";
import { COMMAND_GROUPS } from "./stores/command-palette.js";

function harness(latest: string | null = "run-1") {
  const calls: string[] = [];
  const deps: PaletteDeps = {
    goto: async (path) => void calls.push(`goto ${path}`),
    dispatch: (name, detail) => void calls.push(detail ? `event ${name} ${detail}` : `event ${name}`),
    serverUrl: "http://127.0.0.1:4321",
    copy: async (text) => void calls.push(`copy ${text}`),
    latestRunId: async () => latest,
  };
  const byId = new Map(paletteCommands(deps).map((c) => [c.id, c]));
  const run = async (id: string) => {
    await byId.get(id)!.action();
    await Promise.resolve();
  };
  return { calls, byId, run };
}

describe("paletteCommands", () => {
  test("ids and labels are unique; every command has a known group and an icon", () => {
    const list = [...harness().byId.values()];
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    expect(new Set(list.map((c) => `${c.group}:${c.label}`)).size).toBe(list.length);
    for (const c of list) {
      expect(COMMAND_GROUPS).toContain(c.group!);
      expect(c.icon).toBeDefined();
    }
  });

  test("one Lab command per Lab tab, in tab order", () => {
    const { byId } = harness();
    const lab = [...byId.values()].filter((c) => c.group === "Lab").map((c) => c.label);
    expect(lab).toEqual(LAB_TABS.map((t) => t.label));
  });

  test("a Lab tab navigates to its hash, then tells a mounted Lab page to switch", async () => {
    const h = harness();
    await h.run("lab-memory");
    expect(h.calls).toEqual(["goto /lab#memory", "event cortex:lab-tab memory"]);
    const b = harness();
    await b.run("lab-builder");
    expect(b.calls).toEqual(["goto /lab", "event cortex:lab-tab builder"]);
  });

  test("latest run opens /run/<id>; nothing happens without runs", async () => {
    const h = harness("01ABC");
    await h.run("view-last-run");
    expect(h.calls).toEqual(["goto /run/01ABC"]);
    const none = harness(null);
    await none.run("view-last-run");
    expect(none.calls).toEqual([]);
  });

  test("copy actions use the server URL; write a prompt focuses Beacon's input after navigating", async () => {
    const h = harness();
    await h.run("connect-snippet");
    await h.run("copy-env");
    await h.run("focus-input");
    expect(h.calls).toEqual([
      'copy .withCortex("http://127.0.0.1:4321")',
      "copy CORTEX_URL=http://127.0.0.1:4321",
      "goto /",
      "event cortex:focus-input",
    ]);
  });
});
