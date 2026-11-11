import { describe, expect, it } from "bun:test";
import { isRedirect } from "@sveltejs/kit";
import { load } from "../routes/run/+page.js";

describe("/run", () => {
  it("redirects to /runs (it used to be a placeholder page with one link)", () => {
    let thrown: unknown;
    try {
      load();
    } catch (e) {
      thrown = e;
    }
    expect(isRedirect(thrown)).toBe(true);
    if (!isRedirect(thrown)) return;
    expect(thrown.location).toBe("/runs");
    expect(thrown.status).toBe(307);
  });
});
