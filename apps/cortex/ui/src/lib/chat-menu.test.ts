import { describe, expect, test } from "bun:test";
import { chipClicked, closeMenu, createToggleQueue, keepsMenuOpen, menuClosed, NO_CHIP_MENU, pickChip, syncChipMenu } from "./chat-menu.js";

describe("chipClicked", () => {
  test("opens the chip's picker and stashes the user's draft", () => {
    expect(chipClicked(NO_CHIP_MENU, "half-written question", "/tools ", false)).toEqual({
      menu: { stash: "half-written question", chipCmd: "/tools " },
      message: "/tools ",
      open: true,
    });
  });

  test("an empty composer stashes nothing", () => {
    expect(chipClicked(NO_CHIP_MENU, "  ", "/tools ", false).menu.stash).toBeNull();
  });

  test("another chip while one is open switches in one click and keeps the original draft", () => {
    const first = chipClicked(NO_CHIP_MENU, "draft", "/tools ", false);
    const second = chipClicked(first.menu, first.message, "/workspace ", true);
    expect(second).toEqual({ menu: { stash: "draft", chipCmd: "/workspace " }, message: "/workspace ", open: true });
  });

  test("the same chip while open closes the picker and restores the draft", () => {
    const first = chipClicked(NO_CHIP_MENU, "draft", "/tools ", false);
    expect(chipClicked(first.menu, first.message, "/tools ", true)).toEqual({ menu: NO_CHIP_MENU, message: "draft", open: false });
  });

  test("the same chip after the menu was dismissed re-opens it", () => {
    const first = chipClicked(NO_CHIP_MENU, "", "/tools ", false);
    expect(chipClicked(first.menu, first.message, "/tools ", false).open).toBe(true);
  });
});

describe("menuClosed", () => {
  test("dismissing an untouched chip picker restores the draft", () => {
    expect(menuClosed({ stash: "draft", chipCmd: "/tools " }, "/tools ", "dismiss")).toEqual({ menu: NO_CHIP_MENU, message: "draft" });
  });

  test("dismissing keeps what the user typed over the chip command", () => {
    expect(menuClosed({ stash: "draft", chipCmd: "/tools " }, "/tools web", "dismiss").message).toBe("/tools web");
  });

  test("a pick restores the draft (chip) or clears the command (typed)", () => {
    expect(menuClosed({ stash: "draft", chipCmd: "/model " }, "/model gp", "picked").message).toBe("draft");
    expect(menuClosed(NO_CHIP_MENU, "/model gpt", "picked").message).toBe("");
  });

  test("dismissing a typed command leaves it in the composer", () => {
    expect(menuClosed(NO_CHIP_MENU, "/model", "dismiss").message).toBe("/model");
  });
});

describe("syncChipMenu", () => {
  test("keeps the chip while its command (plus a filter) is in the composer; forgets it otherwise", () => {
    const s = { stash: "draft", chipCmd: "/tools " };
    expect(syncChipMenu(s, "/tools web")).toBe(s);
    expect(syncChipMenu(s, "/tools")).toBe(s);
    expect(syncChipMenu(s, "hello")).toEqual(NO_CHIP_MENU);
    expect(syncChipMenu(s, "")).toEqual(NO_CHIP_MENU);
  });
});

describe("keepsMenuOpen", () => {
  test("multi rows stay open on click and Tab; Enter closes", () => {
    expect(keepsMenuOpen({ multi: true }, "click")).toBe(true);
    expect(keepsMenuOpen({ multi: true }, "tab")).toBe(true);
    expect(keepsMenuOpen({ multi: true }, "enter")).toBe(false);
  });

  test("single-select rows close on any pick", () => {
    expect(keepsMenuOpen({}, "click")).toBe(false);
    expect(keepsMenuOpen({ multi: false }, "tab")).toBe(false);
  });
});

describe("pickChip / closeMenu (composer + menu state together)", () => {
  const ui = { chip: NO_CHIP_MENU, message: "draft", dismissed: true };

  test("a chip opens its picker and un-dismisses the menu", () => {
    expect(pickChip(ui, "/tools ", false)).toEqual({ chip: { stash: "draft", chipCmd: "/tools " }, message: "/tools ", dismissed: false });
  });

  test("the same chip again closes it, restores the draft and leaves it dismissed", () => {
    const open = pickChip(ui, "/tools ", false);
    expect(pickChip(open, "/tools ", true)).toEqual({ chip: NO_CHIP_MENU, message: "draft", dismissed: true });
  });

  test("dismiss restores the draft and dismisses; picked keeps the dismissed flag", () => {
    const open = pickChip(ui, "/model ", false);
    expect(closeMenu(open, "dismiss")).toEqual({ chip: NO_CHIP_MENU, message: "draft", dismissed: true });
    expect(closeMenu(open, "picked")).toEqual({ chip: NO_CHIP_MENU, message: "draft", dismissed: false });
  });
});

describe("createToggleQueue", () => {
  test("runs toggles in order, computing each patch when its turn comes", async () => {
    let config = 0;
    const applied: number[] = [];
    const toggle = createToggleQueue(async (p) => {
      await new Promise((r) => setTimeout(r, 1));
      config = p.n as number;
      applied.push(config);
    }, () => {});
    void toggle("a", () => ({ n: config + 1 }));
    void toggle("b", () => ({ n: config + 1 }));
    await toggle("c", () => ({ n: config + 1 }));
    expect(applied).toEqual([1, 2, 3]);
  });

  test("a failed toggle reports and the next still runs", async () => {
    const errors: string[] = [];
    const applied: string[] = [];
    const toggle = createToggleQueue(async (p) => {
      if (p.fail) throw new Error("boom");
      applied.push(String(p.k));
    }, (what, e) => errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`));
    void toggle("bad", () => ({ fail: true }));
    await toggle("good", () => ({ k: "ok" }));
    expect(errors).toEqual(["bad: boom"]);
    expect(applied).toEqual(["ok"]);
  });
});
