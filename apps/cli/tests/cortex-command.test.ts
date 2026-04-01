import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dir, "../src/index.ts");

describe("CLI cortex command", () => {
  it("main help lists cortex and Cortex workflow", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "help"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("cortex");
    expect(out).toContain("--cortex");
    expect(out).toContain("--dev");
    expect(out).toContain("rax cortex --help");
  });

  it("cortex --help exits 0 and documents env and run workflow", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "cortex", "--help"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("CORTEX_URL");
    expect(out).toContain("rax run");
    expect(out).toContain("--cortex");
    expect(out).toContain("--dev");
  });

  it("cortex --port without value exits non-zero", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "cortex", "--port"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("--port");
  });

  it("cortex unknown flag exits non-zero", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "cortex", "--not-a-real-flag"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("Unknown option");
  });
});
