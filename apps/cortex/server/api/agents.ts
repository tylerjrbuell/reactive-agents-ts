import { Elysia } from "elysia";
import type { Layer } from "effect";
import type { CortexStoreService } from "../services/store-service.js";

export const agentsRouter = (_storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/agents" }).get("/", async () => {
    return [];
  });
