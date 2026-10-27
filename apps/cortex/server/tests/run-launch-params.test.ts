import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { createGatewayAgent, getLaunchParams, getRunById, upsertRun } from "../db/queries.js";

function setup() {
  const path = `/tmp/cortex-launch-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  return { db, cleanup: () => (db.close(), rmSync(path, { force: true })) };
}

describe("run launch params (Rerun availability for Lab / gateway agents)", () => {
  it("a stored snapshot wins", () => {
    const { db, cleanup } = setup();
    try {
      upsertRun(db, "a1", "r1", null, JSON.stringify({ prompt: "snap", provider: "test" }));
      expect(getLaunchParams(db, "r1")).toEqual({ prompt: "snap", provider: "test" });
      expect(getRunById(db, "r1")?.launchParams).toEqual({ prompt: "snap", provider: "test" });
    } finally {
      cleanup();
    }
  });

  it("a gateway run with NO snapshot falls back to its saved agent's config (so Rerun still shows)", () => {
    const { db, cleanup } = setup();
    try {
      createGatewayAgent(db, "agent-lab", "Lab agent", JSON.stringify({ prompt: "do it", provider: "test" }), null);
      upsertRun(db, "agent-lab", "r2");
      expect(getLaunchParams(db, "r2")).toEqual({ prompt: "do it", provider: "test" });
      expect(getRunById(db, "r2")?.launchParams).toEqual({ prompt: "do it", provider: "test" });
    } finally {
      cleanup();
    }
  });

  it("no snapshot and no promptful agent → null (no Rerun)", () => {
    const { db, cleanup } = setup();
    try {
      upsertRun(db, "ghost", "r3");
      expect(getLaunchParams(db, "r3")).toBeNull();
      expect(getRunById(db, "r3")?.launchParams).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
