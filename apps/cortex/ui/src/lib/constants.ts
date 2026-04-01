export const CORTEX_COLORS = {
  primary: "#d0bcff",
  secondary: "#4cd7f6",
  tertiary: "#f7be1d",
  error: "#ffb4ab",
  surface: "#111317",
  surfaceContainer: "#1e2024",
} as const;

/** Browser: current origin (dev proxy). SSR fallback: Cortex default port. */
export const CORTEX_SERVER_URL =
  typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location?.host
    ? `${globalThis.location.protocol}//${globalThis.location.host}`
    : "http://localhost:4321";

export const WS_BASE =
  typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location?.host
    ? `${globalThis.location.protocol === "https:" ? "wss" : "ws"}://${globalThis.location.host}`
    : "ws://localhost:4321";

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export const AGENT_STATE_COLORS = {
  idle: { ring: "#494454", glow: "rgba(73, 68, 84, 0.2)" },
  running: { ring: "#d0bcff", glow: "rgba(208, 188, 255, 0.3)" },
  exploring: { ring: "#f7be1d", glow: "rgba(247, 190, 29, 0.3)" },
  stressed: { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.3)" },
  completed: { ring: "#4cd7f6", glow: "rgba(76, 215, 246, 0.3)" },
  error: { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.2)" },
} as const;
