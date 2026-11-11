import { describe, expect, it } from "bun:test";
import {
  picksImplyShell,
  shellCheckboxClick,
  shellCheckboxView,
  shellOffDetail,
  shellOffLabel,
  shellPickReason,
  shellState,
  shellToolsetPicks,
} from "./shell-from-picks.js";

const presets = { git: ["git", "gh"] };

describe("picksImplyShell", () => {
  it("is true when the picks contain the git shell toolset", () => {
    expect(picksImplyShell(["web-search", "git"], presets)).toBe(true);
  });

  it("is false otherwise, including plain tools and an unknown / retired toolset name", () => {
    expect(picksImplyShell([], presets)).toBe(false);
    expect(picksImplyShell(["web-search", "file-read"], presets)).toBe(false);
    expect(picksImplyShell(["workspace", "gws-cli"], presets)).toBe(false);
    // the full host shell is the user's switch, not a toolset pick
    expect(picksImplyShell(["shell-execute"], presets)).toBe(false);
  });

  it("follows the presets the server serves, not a hard-coded list", () => {
    expect(picksImplyShell(["git"], {})).toBe(false);
    expect(picksImplyShell(["deploy"], { deploy: ["kubectl"] })).toBe(true);
  });

  it("does not treat inherited object keys as toolsets", () => {
    expect(picksImplyShell(["toString", "constructor"], presets)).toBe(false);
  });
});

describe("shellToolsetPicks / shellPickReason", () => {
  it("lists toolset picks once, in pick order", () => {
    expect(shellToolsetPicks(["git", "web-search", "git"], presets)).toEqual(["git"]);
  });

  it("names the toolset and the programs it runs", () => {
    expect(shellPickReason(["git"], presets)).toBe("enabled by git toolset (git · gh only)");
    expect(shellPickReason(["web-search"], presets)).toBeUndefined();
  });

  it("names every toolset when several are picked", () => {
    expect(shellPickReason(["git", "deploy"], { ...presets, deploy: ["kubectl"] })).toBe(
      "enabled by git + deploy toolsets (git · gh · kubectl only)",
    );
  });
});

describe("shell states", () => {
  it("off: no toolset, switch off", () => {
    expect(shellState(false, ["web-search"], presets)).toBe("off");
    expect(shellState(undefined, [], presets)).toBe("off");
    expect(shellCheckboxView(false, ["web-search"], presets)).toEqual({ state: "off", checked: false, hint: undefined });
  });

  it("toolset: git picked, switch off -> checked, hint offers the full shell", () => {
    expect(shellCheckboxView(false, ["git"], presets)).toEqual({
      state: "toolset",
      checked: true,
      hint: "Limited to git · gh by the toolset pick. Click for the full shell.",
    });
  });

  it("full: switch on -> checked; with git picked the hint offers to limit it", () => {
    expect(shellCheckboxView(true, ["git"], presets)).toEqual({
      state: "full",
      checked: true,
      hint: "Full shell on. Click to limit it to git · gh.",
    });
    expect(shellCheckboxView(true, [], presets)).toEqual({ state: "full", checked: true, hint: undefined });
  });

  it("never shows unchecked while a toolset is picked", () => {
    for (const own of [false, true, undefined]) expect(shellCheckboxView(own, ["git"], presets).checked).toBe(true);
  });
});

describe("shellCheckboxClick transitions", () => {
  const after = (own: boolean | undefined, tools: readonly string[]) => shellState(shellCheckboxClick(own), tools, presets);

  it("toolset -> full (writes terminalTools on)", () => {
    expect(shellCheckboxClick(false)).toBe(true);
    expect(after(false, ["git"])).toBe("full");
  });

  it("full with git picked -> toolset (writes terminalTools off, still checked)", () => {
    expect(shellCheckboxClick(true)).toBe(false);
    expect(after(true, ["git"])).toBe("toolset");
    expect(shellCheckboxView(shellCheckboxClick(true), ["git"], presets).checked).toBe(true);
  });

  it("without a toolset it is a plain toggle", () => {
    expect(after(undefined, [])).toBe("full");
    expect(after(true, [])).toBe("off");
  });

  it("unpicking the toolset shows the user's own value", () => {
    expect(shellState(false, [], presets)).toBe("off");
    expect(shellState(true, [], presets)).toBe("full");
  });
});

describe("chat /terminal off row", () => {
  it("lands in git-only while git is picked, else no shell", () => {
    expect(shellOffLabel(["git"], presets)).toBe("Shell: git · gh only");
    expect(shellOffDetail(["git"], presets)).toBe("No full shell; shell-execute enabled by git toolset (git · gh only)");
    expect(shellOffLabel(["web-search"], presets)).toBe("Shell off");
    expect(shellOffDetail(["web-search"], presets)).toBe("No shell-execute tool");
  });
});
