import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  BehavioralContractServiceLive,
  BehavioralContractService,
} from "../src/behavioral-contracts.js";
import type { BehavioralContract } from "../src/behavioral-contracts.js";

const makeService = (contract: BehavioralContract) =>
  BehavioralContractServiceLive(contract);

const run = <A>(
  effect: Effect.Effect<A, any, BehavioralContractService>,
  contract: BehavioralContract,
) => Effect.runPromise(Effect.provide(effect, makeService(contract)));

describe("BehavioralContractService", () => {
  describe("checkToolCall", () => {
    test("blocks denied tools", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("file-delete", 0);
        }),
        { deniedTools: ["file-delete", "shell-exec"] },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("denied-tool");
      expect(violation!.severity).toBe("block");
    });

    test("allows tools not in denied list", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("web-search", 0);
        }),
        { deniedTools: ["file-delete"] },
      );
      expect(violation).toBeNull();
    });

    test("enforces allowlist", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("file-delete", 0);
        }),
        { allowedTools: ["web-search", "file-read"] },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("tool-not-in-allowlist");
    });

    test("allows tools in allowlist", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("web-search", 0);
        }),
        { allowedTools: ["web-search", "file-read"] },
      );
      expect(violation).toBeNull();
    });

    test("enforces max tool calls", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("any-tool", 5);
        }),
        { maxToolCalls: 5 },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("max-tool-calls");
    });

    test("allows under max tool calls", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkToolCall("any-tool", 3);
        }),
        { maxToolCalls: 5 },
      );
      expect(violation).toBeNull();
    });
  });

  describe("checkOutput", () => {
    test("blocks output exceeding max length", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkOutput("a".repeat(200));
        }),
        { maxOutputLength: 100 },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("max-output-length");
    });

    test("blocks denied topics in output", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkOutput("Here is how to make explosives");
        }),
        { deniedTopics: ["explosives", "weapons"] },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("denied-topic");
    });

    test("passes clean output", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkOutput("TypeScript is great");
        }),
        { deniedTopics: ["explosives"], maxOutputLength: 1000 },
      );
      expect(violation).toBeNull();
    });
  });

  describe("checkIteration", () => {
    test("blocks excess iterations", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkIteration(6);
        }),
        { maxIterations: 5 },
      );
      expect(violation).not.toBeNull();
      expect(violation!.rule).toBe("max-iterations");
    });

    test("allows within iteration limit", async () => {
      const violation = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.checkIteration(3);
        }),
        { maxIterations: 5 },
      );
      expect(violation).toBeNull();
    });
  });

  describe("getContract", () => {
    test("returns the configured contract", async () => {
      const contract: BehavioralContract = {
        deniedTools: ["shell"],
        maxToolCalls: 10,
        maxOutputLength: 5000,
      };
      const result = await run(
        Effect.gen(function* () {
          const svc = yield* BehavioralContractService;
          return yield* svc.getContract();
        }),
        contract,
      );
      expect(result.deniedTools).toEqual(["shell"]);
      expect(result.maxToolCalls).toBe(10);
    });
  });
});
