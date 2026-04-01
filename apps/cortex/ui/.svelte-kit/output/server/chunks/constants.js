const CORTEX_SERVER_URL = typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location?.host ? `${globalThis.location.protocol}//${globalThis.location.host}` : "http://localhost:4321";
const WS_BASE = typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location?.host ? `${globalThis.location.protocol === "https:" ? "wss" : "ws"}://${globalThis.location.host}` : "ws://localhost:4321";
const RECONNECT_DELAYS_MS = [1e3, 2e3, 4e3, 8e3, 16e3, 3e4];
const AGENT_STATE_COLORS = {
  idle: { ring: "#494454", glow: "rgba(73, 68, 84, 0.2)" },
  running: { ring: "#d0bcff", glow: "rgba(208, 188, 255, 0.3)" },
  exploring: { ring: "#f7be1d", glow: "rgba(247, 190, 29, 0.3)" },
  stressed: { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.3)" },
  completed: { ring: "#4cd7f6", glow: "rgba(76, 215, 246, 0.3)" },
  error: { ring: "#ffb4ab", glow: "rgba(255, 180, 171, 0.2)" }
};
export {
  AGENT_STATE_COLORS as A,
  CORTEX_SERVER_URL as C,
  RECONNECT_DELAYS_MS as R,
  WS_BASE as W
};
