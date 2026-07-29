// Run: bun test packages/benchmarks/tests/tau-bench/loader.test.ts
//
// These assert against the REAL vendored upstream corpus, not a fixture written
// here. That is the point: τ-bench is only worth citing because its tasks are
// third-party, so the test that would catch "someone quietly re-authored the
// tasks" is a test pinned to upstream's own counts and content.
import { describe, it, expect } from "bun:test";
import {
  loadDomain,
  isTauBenchDomain,
  TAU_BENCH_PROVENANCE,
} from "../../src/tau-bench/loader.js";
import {
  toRaToolDefinition,
  unportedEnvironment,
  runTrial,
  runTauBench,
} from "../../src/tau-bench/adapter.js";

describe("τ-bench loader", () => {
  it("parses the upstream retail TEST split at its published size", () => {
    const spec = loadDomain("retail");
    // 115 tasks / 15 tools + `think`: upstream tasks_test.py at the pinned SHA.
    expect(spec.tasks.length).toBe(115);
    expect(spec.tools.length).toBe(16);
    expect(spec.tasks[0]?.userId).toBe("yusuf_rossi_9620");
    expect(spec.tasks[0]?.actions[0]?.name).toBe("find_user_id_by_name_zip");
  });

  it("parses the upstream airline TEST split", () => {
    const spec = loadDomain("airline");
    expect(spec.tasks.length).toBe(50);
    expect(spec.tools.length).toBe(14);
  });

  it("keeps the domain policy verbatim, since it is the agent's system prompt", () => {
    const spec = loadDomain("retail");
    expect(spec.policy).toContain("retail agent");
    expect(spec.policy.length).toBeGreaterThan(3_000);
  });

  it("carries provenance so a score can be traced to an upstream commit", () => {
    expect(TAU_BENCH_PROVENANCE.repo).toBe("sierra-research/tau-bench");
    expect(TAU_BENCH_PROVENANCE.sha).toHaveLength(40);
    expect(loadDomain("airline").provenance).toBe(TAU_BENCH_PROVENANCE);
  });

  it("gives every task an instruction and a well-formed ground truth", () => {
    for (const domain of ["retail", "airline"] as const) {
      for (const task of loadDomain(domain).tasks) {
        expect(task.instruction.length).toBeGreaterThan(0);
        expect(Array.isArray(task.actions)).toBe(true);
        expect(Array.isArray(task.outputs)).toBe(true);
      }
    }
  });

  it("keeps upstream's empty-ground-truth tasks, which are its refusal cases", () => {
    // 8 of the 165 TEST tasks have NO ground-truth actions and NO expected
    // outputs (retail #57, airline #12/15/17/18/21/24/49). That is not corrupt
    // data — upstream scores the database HASH, so an empty action list means
    // "the correct behaviour is to change nothing", i.e. the user is asking for
    // something the domain policy forbids. Filtering them out as "empty" would
    // delete exactly the abstention cases this project cares most about, and
    // would quietly make the bench easier than the published one.
    const emptyGroundTruth = (["retail", "airline"] as const).flatMap((domain) =>
      loadDomain(domain).tasks.filter(
        (task) => task.actions.length === 0 && task.outputs.length === 0,
      ),
    );
    expect(emptyGroundTruth.length).toBe(8);
  });

  it("rejects a domain upstream does not define", () => {
    expect(isTauBenchDomain("banking")).toBe(false);
  });
});

describe("τ-bench → RA tool translation", () => {
  it("marks upstream's required params required and the rest optional", () => {
    const spec = loadDomain("retail");
    const tool = spec.tools.find((t) => t.function.name === "find_user_id_by_name_zip");
    const definition = toRaToolDefinition(tool!);
    expect(definition.name).toBe("find_user_id_by_name_zip");
    expect(definition.parameters.map((p) => p.name).sort()).toEqual([
      "first_name",
      "last_name",
      "zip",
    ]);
    expect(definition.parameters.every((p) => p.required)).toBe(true);
  });

  it("preserves nested array-of-object schemas RA's flat param shape cannot hold", () => {
    // airline `book_reservation.flights` is an array of objects with a
    // `flight_number` and a `date`, both required. Dropping that shape would hand
    // the model a strictly easier surface than upstream's, which would make the
    // resulting number un-comparable to published runs.
    const spec = loadDomain("airline");
    const tool = spec.tools.find((t) => t.function.name === "book_reservation");
    const flights = toRaToolDefinition(tool!).parameters.find((p) => p.name === "flights");
    expect(flights?.type).toBe("array");
    expect(flights?.description).toContain("flight_number");
    expect(flights?.description).toContain("YYYY-MM-DD");
    expect(flights?.items?.type).toBe("object");
  });
});

describe("τ-bench environment port", () => {
  it("refuses to score anything until a real environment is supplied", async () => {
    // The failure mode this guards is a canned stub environment producing a
    // plausible pass^k that measures nothing. Scaffolding must fail loudly.
    await expect(unportedEnvironment(loadDomain("retail").tasks[0]!, loadDomain("retail")))
      .rejects.toThrow(/No τ-bench environment is wired/);
  });

  it("records a crashed trial as failed rather than dropping it", async () => {
    // Dropping it would shrink pass^k's denominator and raise the score.
    const spec = loadDomain("retail");
    const trial = await runTrial(spec.tasks[0]!, spec, {
      domain: "retail",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      k: 1,
    });
    expect(trial.solved).toBe(false);
    expect(trial.error).toContain("No τ-bench environment is wired");
  });

  it("refuses to report pass^k as 0 when nothing was ever measured", async () => {
    // Without this the unported adapter prints `pass^3 0.000` and exits 0, which
    // reads as "the harness scored zero" rather than "the bench never ran".
    // Unmeasured is not zero -- the same rule the bench runner already enforces.
    await expect(
      runTauBench({
        domain: "retail",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        taskCount: 1,
        k: 2,
      }),
    ).rejects.toThrow(/produced no measurement/);
  });
});
