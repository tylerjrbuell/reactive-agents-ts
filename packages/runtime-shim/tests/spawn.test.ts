import { test, expect } from "bun:test";
import { spawn } from "../src/index.js";

async function readAll(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

test("spawn runs echo and captures stdout", async () => {
  const proc = spawn(["echo", "hello"], { stdout: "pipe" });
  expect(proc.pid).toBeGreaterThan(0);
  const output = await readAll(proc.stdout);
  const code = await proc.exited;
  expect(code).toBe(0);
  expect(output.trim()).toBe("hello");
});

test("spawn passes env vars", async () => {
  const proc = spawn(["sh", "-c", "echo $MY_VAR"], {
    env: { ...process.env, MY_VAR: "abc" } as Record<string, string>,
    stdout: "pipe",
  });
  const output = await readAll(proc.stdout);
  await proc.exited;
  expect(output.trim()).toBe("abc");
});

test("spawn captures stderr", async () => {
  const proc = spawn(["sh", "-c", "echo errmsg >&2"], { stderr: "pipe" });
  const output = await readAll(proc.stderr);
  await proc.exited;
  expect(output.trim()).toBe("errmsg");
});

test("spawn returns non-zero exit code on failure", async () => {
  const proc = spawn(["sh", "-c", "exit 7"], { stdout: "pipe" });
  const code = await proc.exited;
  expect(code).toBe(7);
});
