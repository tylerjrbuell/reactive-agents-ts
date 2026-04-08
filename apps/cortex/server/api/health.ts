/**
 * /api/health — server health and uptime information.
 */
import { Elysia } from "elysia";

const VERSION = "0.1.0";
const SERVER_START_TIME = Date.now();

export const healthRouter = new Elysia({ prefix: "/api/health" })
  .get(
    "/",
    () => {
      const uptimeMs = Date.now() - SERVER_START_TIME;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);
      return {
        ok: true,
        version: VERSION,
        uptime: uptimeSeconds,
      };
    },
  );
