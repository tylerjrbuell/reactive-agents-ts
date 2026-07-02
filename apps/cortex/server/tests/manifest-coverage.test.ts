/**
 * Ties the Cortex UI presentation layer to the LIVE framework manifest.
 * Lives server-side because the UI package intentionally has no
 * @reactive-agents/runtime dependency (keeps the runtime out of the browser
 * bundle); the presentation map it imports is pure (no Svelte/DOM).
 *
 * - Every strategy must be renderable (manifest carries a label).
 * - Config fields with neither a hint nor an intentional default are LISTED
 *   (not a hard failure — a new field is allowed to render with a default
 *   widget), so drift is visible in CI logs and gets styled over time.
 */
import { describe, it, expect } from "bun:test";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import {
  PRESENTATION,
  INTENTIONAL_DEFAULTS,
} from "../../ui/src/lib/config-presentation.js";

describe("manifest coverage", () => {
  it("every strategy is renderable (manifest provides a label)", () => {
    for (const s of getCapabilityManifest().strategies) {
      expect(s.label, `strategy ${s.name} missing label`).toBeTruthy();
    }
  });

  it("lists config fields lacking a hint or intentional default (informational)", () => {
    const m = getCapabilityManifest();
    const unstyled = m.configFields
      .map((f) => f.path)
      .filter((p) => !PRESENTATION[p] && !INTENTIONAL_DEFAULTS.has(p));
    if (unstyled.length > 0) {
      // Visible in CI logs; these render with a default widget until styled.
      console.log(`[manifest-coverage] ${unstyled.length} unstyled fields: ${unstyled.join(", ")}`);
    }
    // Fields render with a default widget when unhinted → never a hard failure.
    expect(Array.isArray(unstyled)).toBe(true);
  });

  it("no overlay builder method surfaced in PRESENTATION is stale", () => {
    const methodNames = new Set(getCapabilityManifest().builderMethods.map((b) => b.name));
    // PRESENTATION keys are either config-field paths (contain a '.') or plain
    // builder-method names. Any bare-name key that isn't a live method is stale.
    const stale = Object.keys(PRESENTATION).filter(
      (k) => k.startsWith("with") && !methodNames.has(k),
    );
    expect(stale, `stale builder-method hints: ${stale.join(", ")}`).toEqual([]);
  });
});
