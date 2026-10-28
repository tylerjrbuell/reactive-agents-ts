// Run: bun test packages/runtime/tests/meta-tools-resolution.test.ts
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ReactiveAgents } from "../src";
import {
  harnessSkillInjectable,
  droppedMetaToolsNotice,
} from "../src/builder/meta-tools-resolution";

describe("withMetaTools dropped-default notice", () => {
  // The notice goes through Effect.logWarning (framework logger path), whose
  // default logger writes via console.log — never console.warn.
  let warn: ReturnType<typeof spyOn>;
  let consoleWarn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "log").mockImplementation(() => {});
    consoleWarn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    consoleWarn.mockRestore();
  });

  test("{ todo: true } logs exactly one notice naming recall", () => {
    ReactiveAgents.create().withMetaTools({ todo: true });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0]);
    expect(msg).toContain("recall");
    expect(msg).toContain("recall: true");
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  test("{ todo: true, recall: true } logs nothing", () => {
    ReactiveAgents.create().withMetaTools({ todo: true, recall: true });
    expect(warn).not.toHaveBeenCalled();
  });

  test("no-arg full suite and false log nothing", () => {
    ReactiveAgents.create().withMetaTools();
    ReactiveAgents.create().withMetaTools(false);
    expect(warn).not.toHaveBeenCalled();
  });

  test("pure notice helper", () => {
    expect(droppedMetaToolsNotice({ recall: true })).toBeUndefined();
    expect(droppedMetaToolsNotice({ recall: false })).toContain("recall");
  });
});

describe("harnessSkill resolves honestly", () => {
  test("default config (recall only, harnessSkill true) is not injectable", () => {
    expect(
      harnessSkillInjectable({ recall: true, brief: false, pulse: false, harnessSkill: true }),
    ).toBe(false);
  });
  test("brief or pulse makes it injectable", () => {
    expect(harnessSkillInjectable({ brief: true, harnessSkill: true })).toBe(true);
    expect(harnessSkillInjectable({ pulse: true })).toBe(true);
  });
  test("harnessSkill:false always off", () => {
    expect(harnessSkillInjectable({ brief: true, harnessSkill: false })).toBe(false);
  });
});
