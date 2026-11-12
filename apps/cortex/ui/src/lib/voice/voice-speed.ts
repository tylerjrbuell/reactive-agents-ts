/**
 * Reading-speed rules for the voice-mode banner stepper. Pure. The speed itself is
 * the saved `rate` pref (Settings · Voice · Reading speed), read by the shared
 * read-aloud controller before every sentence, so a change reaches the next sentence
 * (and `setPrefs` restarts the one being read) for the browser engine (`rate`) and the
 * server engine (`speed` in the `/api/voice/speak` body) alike.
 */
import { RATE_STEPS } from "./voice-prefs.js";

/** Step direction. */
export type SpeedDirection = "slower" | "faster";

/**
 * The next speed on offer in `direction`, or the current one at the end of the range.
 * A saved speed between two steps (older prefs) moves to the nearest step that way.
 */
export function stepRate(current: number, direction: SpeedDirection): number {
  const steps = [...RATE_STEPS].sort((a, b) => a - b);
  const eps = 1e-9;
  if (direction === "faster") return steps.find((s) => s > current + eps) ?? steps[steps.length - 1] ?? current;
  const slower = [...steps].reverse().find((s) => s < current - eps);
  return slower ?? steps[0] ?? current;
}

/** True when `current` is at the end of the range in `direction`. */
export function atRateLimit(current: number, direction: SpeedDirection): boolean {
  return stepRate(current, direction) === current || (direction === "faster" ? current >= Math.max(...RATE_STEPS) : current <= Math.min(...RATE_STEPS));
}

/** The label shown for a speed, "1.25×". */
export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/**
 * A one-line hint when the engine in use may not honour a speed change, else `null`.
 * The browser engine always does; a server voice depends on the speech server
 * (Speaches and Kokoro-FastAPI take `speed`, some OpenAI-compatible servers ignore it).
 */
export function speedHint(engine: "browser" | "server" | string): string | null {
  return engine === "server" ? "If the speed does not change, your speech server ignores it." : null;
}
