import { test, expect } from "bun:test";
import { writeFile, readFile } from "../src/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("writeFile + readFile roundtrip (string)", async () => {
  const path = join(tmpdir(), `shim-test-${Date.now()}.txt`);
  await writeFile(path, "hello from shim");
  const content = await readFile(path);
  expect(content).toBe("hello from shim");
});

test("writeFile accepts Uint8Array", async () => {
  const path = join(tmpdir(), `shim-bin-${Date.now()}.bin`);
  const data = new TextEncoder().encode("binary content");
  await writeFile(path, data);
  const content = await readFile(path);
  expect(content).toBe("binary content");
});
