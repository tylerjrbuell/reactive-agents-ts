/**
 * Run view Safety lane: how Cortex paints ui-core safety entries
 * (`safetyEntriesOf` / `safetySummaryOf`): icon, badge tone and words.
 * The entries themselves (which events, what they say, which loop) are
 * ui-core's; this file only maps them onto the Bench kit.
 */
import type { SafetyKind, SafetyLoopMark, SafetyTone } from "@reactive-agents/ui-core";
import type { IconName } from "./icons.js";

/** Kit `Badge` tones used here. */
export type SafetyBadgeTone = "accent" | "warn" | "bad" | "ok";

const ICONS: Record<SafetyKind, IconName> = {
  intervention: "bolt",
  guardrail: "lock",
  verifier: "check-circle",
  budget: "clock",
  context: "compress",
  calibration: "signal",
};

const KIND_LABELS: Record<SafetyKind, string> = {
  intervention: "Controller",
  guardrail: "Guardrail",
  verifier: "Verifier",
  budget: "Budget",
  context: "Context",
  calibration: "Calibration",
};

/** The icon for an entry's mechanism. */
export function safetyIcon(kind: SafetyKind): IconName {
  return ICONS[kind];
}

/** The mechanism's name: `Guardrail`, `Controller`, … */
export function safetyKindLabel(kind: SafetyKind): string {
  return KIND_LABELS[kind];
}

/** Badge tone: the controller adapting is the agent (accent); limits warn; blocks are bad; a passed check is ok. */
export function safetyBadgeTone(tone: SafetyTone): SafetyBadgeTone {
  return tone === "info" ? "accent" : tone;
}

/** `1 safety event`, `3 safety events`. */
export function safetyCountLabel(count: number): string {
  return `${count} safety event${count === 1 ? "" : "s"}`;
}

/** The trace row mark's hover text: `2 safety events in this loop`. */
export function safetyMarkLabel(mark: SafetyLoopMark): string {
  return `${safetyCountLabel(mark.count)} in this loop`;
}
