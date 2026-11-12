import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { JudgmentService, makeJudgmentServiceLive } from "../src/index.js";

describe("JudgmentService.backend", () => {
  it("names the backend so consumers can record which judge answered", async () => {
    const layer = makeJudgmentServiceLive({ name: "scripted-backend", evaluate: () => Effect.succeed({}) });
    const name = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return svc.backend;
      }).pipe(Effect.provide(layer)),
    );
    expect(name).toBe("scripted-backend");
  });
});
