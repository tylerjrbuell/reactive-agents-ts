import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const apiPort = process.env.CORTEX_PORT ?? "4321";
const apiOrigin = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/api": apiOrigin,
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
