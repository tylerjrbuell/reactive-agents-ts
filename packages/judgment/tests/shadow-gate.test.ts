import { describe, expect, it } from "bun:test";
import { Deferred, Effect, Either } from "effect";
import { JudgmentService, makeJudgmentServiceLive } from "../src/services/judgment-service.js";
import type { JudgmentBackend } from "../src/types.js";

const QUESTIONS = { q: { type: "noul" as const } };

/** Backend that tracks peak concurrency; each call sleeps `holdMs`. */
const trackingBackend = (holdMs: number) => {
  const seen = { inFlight: 0, max: 0, calls: 0 };
  const backend: JudgmentBackend = {
    name: "fake",
    evaluate: () =>
      Effect.gen(function* () {
        seen.calls++;
        seen.inFlight++;
        seen.max = Math.max(seen.max, seen.inFlight);
        yield* Effect.sleep(`${holdMs} millis`);
        seen.inFlight--;
        return { q: { kind: "noul" as const, probability: 0.5 } };
      }),
  };
  return { backend, seen };
};

const withSvc = <A, E>(
  backend: JudgmentBackend,
  shadow: { maxInFlight?: number; maxQueue?: number; timeoutMs?: number },
  f: (svc: JudgmentService["Type"]) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* JudgmentService;
      return yield* f(svc);
    }).pipe(Effect.provide(makeJudgmentServiceLive(backend, { shadow }))),
  );

describe("shadow gate", () => {
  it("200 concurrent shadow asks: max in flight <= cap, excess dropped and counted", async () => {
    const { backend, seen } = trackingBackend(5);
    const stats = await withSvc(backend, { maxInFlight: 2, maxQueue: 4, timeoutMs: 5000 }, (svc) =>
      Effect.gen(function* () {
        const results = yield* Effect.all(
          Array.from({ length: 200 }, () =>
            svc.ask({ state: "x", questions: QUESTIONS, priority: "shadow" }).pipe(Effect.either),
          ),
          { concurrency: "unbounded" },
        );
        const dropped = results.filter(
          (r) => Either.isLeft(r) && r.left._tag === "JudgmentShadowDropped",
        ).length;
        const s = yield* svc.shadowStats!();
        return { s, dropped };
      }),
    );
    expect(seen.max).toBeLessThanOrEqual(2);
    expect(stats.s.dropped).toBe(stats.dropped);
    expect(stats.s.dropped).toBeGreaterThan(150);
    expect(seen.calls + stats.s.dropped).toBe(200);
    expect(stats.s.inFlight).toBe(0);
    expect(stats.s.queued).toBe(0);
  });

  it("explicit asks are never gated or dropped, even while shadows saturate", async () => {
    const { backend, seen } = trackingBackend(5);
    const out = await withSvc(backend, { maxInFlight: 1, maxQueue: 0 }, (svc) =>
      Effect.gen(function* () {
        const shadows = Array.from({ length: 20 }, () =>
          svc.ask({ state: "x", questions: QUESTIONS, priority: "shadow" }).pipe(Effect.either),
        );
        const explicits = Array.from({ length: 10 }, () =>
          svc.ask({ state: "x", questions: QUESTIONS }).pipe(Effect.either),
        );
        const all = yield* Effect.all([...shadows, ...explicits], { concurrency: "unbounded" });
        return all.slice(20);
      }),
    );
    expect(out.every(Either.isRight)).toBe(true);
    expect(seen.calls).toBeGreaterThanOrEqual(10);
  });

  it("shadow ask times out on its own short budget and is not retried", async () => {
    const { backend, seen } = trackingBackend(500);
    const res = await withSvc(backend, { timeoutMs: 20 }, (svc) =>
      Effect.gen(function* () {
        const r = yield* svc
          .ask({ state: "x", questions: QUESTIONS, priority: "shadow" })
          .pipe(Effect.either);
        const s = yield* svc.shadowStats!();
        return { r, s };
      }),
    );
    expect(Either.isLeft(res.r) && res.r.left._tag).toBe("JudgmentTimeout");
    expect(seen.calls).toBe(1);
    expect(res.s.timedOut).toBe(1);
    expect(res.s.inFlight).toBe(0);
  });

  it("queued shadow that times out while waiting frees its queue slot", async () => {
    const gate = Effect.runSync(Deferred.make<void>());
    const backend: JudgmentBackend = {
      name: "fake",
      evaluate: () =>
        Deferred.await(gate).pipe(
          Effect.map(() => ({ q: { kind: "noul" as const, probability: 0.5 } })),
        ),
    };
    const s = await withSvc(backend, { maxInFlight: 1, maxQueue: 5, timeoutMs: 30 }, (svc) =>
      Effect.gen(function* () {
        yield* Effect.all(
          Array.from({ length: 4 }, () =>
            svc.ask({ state: "x", questions: QUESTIONS, priority: "shadow" }).pipe(Effect.either),
          ),
          { concurrency: "unbounded" },
        );
        return yield* svc.shadowStats!();
      }),
    );
    expect(s.queued).toBe(0);
    expect(s.inFlight).toBe(0);
    expect(s.timedOut).toBe(4);
  });

  it("backend defect in a shadow ask becomes a typed failure, not a crash", async () => {
    const backend: JudgmentBackend = {
      name: "fake",
      evaluate: () => Effect.die(new Error("boom")),
    };
    const r = await withSvc(backend, {}, (svc) =>
      svc.ask({ state: "x", questions: QUESTIONS, priority: "shadow" }).pipe(Effect.either),
    );
    expect(Either.isLeft(r) && r.left._tag).toBe("JudgmentConnectionError");
  });
});
