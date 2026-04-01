import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
import { CortexStoreService } from "../services/store-service.js";

export const skillsRouter = (storeLayer: Layer.Layer<CortexStoreService>) =>
  new Elysia({ prefix: "/api/skills" }).get("/", async () => {
    const program = Effect.gen(function* () {
      const store = yield* CortexStoreService;
      return yield* store.getSkills();
    });
    return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
  });
