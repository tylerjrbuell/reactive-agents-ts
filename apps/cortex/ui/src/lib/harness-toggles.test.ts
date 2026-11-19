import { describe, expect, test } from "bun:test";
import { HARNESS_PLAN_TOGGLES, harnessTextEditable, harnessToggleOn, setHarnessToggle } from "./harness-toggles.js";

const [recon, budget] = [HARNESS_PLAN_TOGGLES[0]!, HARNESS_PLAN_TOGGLES[1]!];

describe("harness plan toggles", () => {
  test("lists the four framework keys with the framework defaults", () => {
    expect(Object.fromEntries(HARNESS_PLAN_TOGGLES.map((t) => [t.key, t.defaultOn]))).toEqual({
      planRecon: false, planBudget: false, wrapUpReserve: false, planToolCatalog: true,
    });
  });

  test("plan budget is opt-in: untouched harness text carries no planBudget, an explicit switch writes true", () => {
    expect(harnessToggleOn("", budget)).toBe(false);
    expect(harnessToggleOn("{}", budget)).toBe(false);
    expect(JSON.parse(setHarnessToggle("", recon, true))).not.toHaveProperty("planBudget");
    expect(JSON.parse(setHarnessToggle("", budget, true))).toEqual({ planBudget: true });
  });

  test("an absent key reads as the framework default; a present boolean wins", () => {
    expect(harnessToggleOn("", recon)).toBe(false);
    expect(harnessToggleOn("", budget)).toBe(false);
    expect(harnessToggleOn('{"planRecon":true,"planBudget":true}', recon)).toBe(true);
    expect(harnessToggleOn('{"planRecon":true,"planBudget":true}', budget)).toBe(true);
    expect(harnessToggleOn('{"planRecon":"yes"}', recon)).toBe(false);
  });

  test("flipping a switch writes its key and keeps the others", () => {
    const next = setHarnessToggle('{"toolIndex": true}', recon, true);
    expect(JSON.parse(next)).toEqual({ toolIndex: true, planRecon: true });
    expect(JSON.parse(setHarnessToggle("", budget, true))).toEqual({ planBudget: true });
  });

  test("text that is not a JSON object is left alone", () => {
    for (const bad of ["{ nope", "[1]", "3"]) {
      expect(harnessTextEditable(bad)).toBe(false);
      expect(setHarnessToggle(bad, recon, true)).toBe(bad);
      expect(harnessToggleOn(bad, budget)).toBe(false);
    }
    expect(harnessTextEditable("")).toBe(true);
    expect(harnessTextEditable('{"a":1}')).toBe(true);
  });
});
