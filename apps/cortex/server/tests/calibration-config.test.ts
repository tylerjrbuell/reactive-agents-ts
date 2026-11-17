/**
 * The opt-in calibration tiers reach the built agent config. `AgentConfig.calibration`
 * requires `mode`, so a lone `{ learned: true }` is invalid: the Lab switches
 * (`ui/src/lib/calibration-tiers.ts`) always write `mode`.
 */
import { describe, expect, it } from "bun:test";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { rawConfigForCalibrationTier } from "../../ui/src/lib/calibration-tiers.js";

describe("calibration tiers through the config path", () => {
  it("default: no calibration key (framework default, both tiers off)", () => {
    expect(cortexParamsToAgentConfig({ provider: "anthropic" }).calibration).toBeUndefined();
  });

  it("learned + community from the Lab switches reach AgentConfig.calibration", () => {
    let raw = rawConfigForCalibrationTier({}, "learned", true);
    raw = rawConfigForCalibrationTier(raw, "community", true);
    const config = cortexParamsToAgentConfig({ provider: "anthropic", rawConfig: raw });
    expect(config.calibration).toEqual({ mode: "auto", learned: true, community: true });
  });

  it("a tier without mode does not decode (why the switches write mode)", () => {
    expect(() =>
      cortexParamsToAgentConfig({ provider: "anthropic", rawConfig: { calibration: { learned: true } } }),
    ).toThrow();
  });
});
