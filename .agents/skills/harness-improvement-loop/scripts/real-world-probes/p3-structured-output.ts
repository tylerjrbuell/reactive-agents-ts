// P3 — structured-output agent: .withOutputSchema → result.object. The
// user-facing typed-output contract. Hermetic knowledge task.
import { ReactiveAgents } from "reactive-agents";
import { z } from "zod";
import { runProbe, check } from "./probe-harness.ts";

const schema = z.array(
  z.object({ city: z.string(), country: z.string() }),
);

await runProbe({
  name: "p3-structured-output",
  build: () =>
    ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: "gemma4", numCtx: 32768 })
      .withOutputSchema(schema)
      .build(),
  task: "List the 3 most populous cities in the world with their countries.",
  grade: (result) => {
    const obj = (result as { object?: unknown }).object;
    const parsed = schema.safeParse(obj);
    return [
      check("object-present", obj !== undefined && obj !== null, `object=${JSON.stringify(obj)?.slice(0, 200)}`),
      check("object-matches-schema", parsed.success, parsed.success ? `${(parsed.data ?? []).length} items` : JSON.stringify(parsed.error?.issues?.slice(0, 2))),
      check(
        "object-has-3-items",
        parsed.success && parsed.data.length === 3,
        parsed.success ? `len=${parsed.data.length}` : "schema failed",
      ),
      check("run-success", result.success === true, `success=${result.success}`),
    ];
  },
});
