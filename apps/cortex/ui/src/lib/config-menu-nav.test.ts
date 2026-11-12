import { describe, expect, test } from "bun:test";
import { CLOSED_NAV, configNavReduce as step, groupOf, groupSummary, type ConfigNav, type ConfigNavEvent } from "./config-menu-nav.js";
import type { ConfigGroup } from "./chat-composer-bar.js";

const run = (events: readonly ConfigNavEvent[], from: ConfigNav = CLOSED_NAV): ConfigNav => events.reduce(step, from);
const inGroup = run([{ type: "toggle" }, { type: "enter-group", group: "Tools" }]);
const picked = step(inGroup, { type: "pick", cmd: "/terminal " });

describe("configNavReduce", () => {
  test("toggle opens on the main menu and closes again", () => {
    expect(step(CLOSED_NAV, { type: "toggle" })).toEqual({ open: true, level: "menu", group: null, item: null });
    expect(step(step(CLOSED_NAV, { type: "toggle" }), { type: "toggle" })).toEqual(CLOSED_NAV);
  });

  test("choosing a group drills in", () => {
    expect(inGroup).toEqual({ open: true, level: "group", group: "Tools", item: null });
  });

  test("Back from a group returns to the main menu; Back from the menu closes", () => {
    const menu = step(inGroup, { type: "back" });
    expect(menu).toEqual({ open: true, level: "menu", group: null, item: null });
    expect(step(menu, { type: "back" })).toEqual(CLOSED_NAV);
  });

  test("Escape goes back one level before closing", () => {
    expect(step(inGroup, { type: "escape" }).level).toBe("menu");
    expect(step(step(inGroup, { type: "escape" }), { type: "escape" })).toEqual(CLOSED_NAV);
  });

  test("picking a row hides the popover but remembers the group and row", () => {
    expect(picked).toEqual({ open: false, level: "item", group: "Tools", item: "/terminal " });
  });

  test("when the picker closes, the user lands back on the group", () => {
    expect(step(picked, { type: "picker-closed" })).toEqual({ open: true, level: "group", group: "Tools", item: null });
  });

  test("Back or Escape from a picker also returns to the group", () => {
    expect(step(picked, { type: "back" }).level).toBe("group");
    expect(step(picked, { type: "escape" })).toEqual({ open: true, level: "group", group: "Tools", item: null });
  });

  test("a click outside closes from any level, picker included, and the picker closing afterwards stays closed", () => {
    const after = step(picked, { type: "outside" });
    expect(after).toEqual(CLOSED_NAV);
    expect(step(after, { type: "picker-closed" })).toEqual(CLOSED_NAV);
    expect(step(inGroup, { type: "outside" })).toEqual(CLOSED_NAV);
  });

  test("re-entry: reopening after a close starts at the main menu, and a group can be entered again", () => {
    const reopened = step(step(inGroup, { type: "outside" }), { type: "toggle" });
    expect(reopened.level).toBe("menu");
    expect(step(reopened, { type: "enter-group", group: "Limits" }).group).toBe("Limits");
  });

  test("events on a closed popover do nothing", () => {
    expect(step(CLOSED_NAV, { type: "enter-group", group: "Tools" })).toEqual(CLOSED_NAV);
    expect(step(CLOSED_NAV, { type: "pick", cmd: "/model " })).toEqual(CLOSED_NAV);
    expect(step(CLOSED_NAV, { type: "picker-closed" })).toEqual(CLOSED_NAV);
  });
});

const groups: readonly ConfigGroup[] = [
  { title: "Model", rows: [{ label: "Provider", value: "ollama", cmd: "/provider ", icon: "cloud", on: false }, { label: "Model", value: "qwen3", cmd: "/model ", icon: "model", on: false }] },
  { title: "Limits", rows: [{ label: "Steps per turn", value: "30 steps", cmd: "/iterations ", icon: "steps", on: true }] },
];

describe("groupOf / groupSummary", () => {
  test("finds the group a nav points at, and tolerates one that vanished", () => {
    expect(groupOf(groups, inGroup)).toBeUndefined();
    expect(groupOf(groups, { ...inGroup, group: "Limits" })?.title).toBe("Limits");
    expect(groupOf(groups, CLOSED_NAV)).toBeUndefined();
  });

  test("summary names what differs from the default, else the first values", () => {
    expect(groupSummary(groups[1]!)).toBe("Steps per turn 30 steps");
    expect(groupSummary(groups[0]!)).toBe("ollama, qwen3");
  });
});
