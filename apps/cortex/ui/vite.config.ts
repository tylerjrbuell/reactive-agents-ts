import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";

const apiPort = process.env.CORTEX_PORT ?? "4321";
const apiOrigin = `http://127.0.0.1:${apiPort}`;

/**
 * MCP `refresh-tools` can run long: HTTP handshake, or `docker run` + first image pull.
 * Short proxy timeouts → Vite "socket hang up" while Cortex is still working.
 */
const API_PROXY_MS = 1_800_000; // 30m — first `docker pull` of an MCP image can exceed 10m

const apiProxy: ProxyOptions = {
  target: apiOrigin,
  changeOrigin: true,
  timeout: API_PROXY_MS,
  proxyTimeout: API_PROXY_MS,
  // Do not call proxyReq/proxyRes.setTimeout here: it replaces http-proxy’s proxyTimeout handler and
  // can fight Vite’s proxyRes wiring. timeout + proxyTimeout above are enough for Node’s side.
};

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": apiProxy,
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
