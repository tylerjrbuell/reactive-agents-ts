import { describe, test, expect } from "bun:test";
import { templateResolveRouter } from "./template-resolve.js";

async function post(body: unknown) {
  const app = templateResolveRouter();
  return app.handle(
    new Request("http://localhost/api/template/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/template/resolve", () => {
  test("returns resolved payload + empty unresolved", async () => {
    const res = await post({
      payload: { prompt: "Hi {{name}}" },
      variables: [{ name: "name", type: "string", required: true }],
      values: { name: "Ada" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { resolved: { prompt: string }; unresolved: string[] };
    expect(json.resolved.prompt).toBe("Hi Ada");
    expect(json.unresolved).toEqual([]);
  });

  test("reports unresolved required", async () => {
    const res = await post({
      payload: { prompt: "Hi {{name}}" },
      variables: [{ name: "name", type: "string", required: true }],
      values: {},
    });
    const json = (await res.json()) as { unresolved: string[] };
    expect(json.unresolved).toEqual(["name"]);
  });
});
