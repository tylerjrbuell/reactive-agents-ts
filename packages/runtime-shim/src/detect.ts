/**
 * Runtime detection. Sync, no top-level await.
 */

export const isBun: boolean = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export const isNode: boolean = !isBun && typeof process !== "undefined" && process.versions?.node !== undefined;

/**
 * Returns true if the current module is the program's entry point.
 * Replaces Bun's `import.meta.main`.
 *
 * @param importMetaUrl - Pass `import.meta.url` from the caller.
 */
export function isMain(importMetaUrl: string): boolean {
  if (isBun) {
    // Bun: prefer native import.meta.main if available via globalThis trick
    return Boolean((globalThis as { Bun?: { main?: string } }).Bun?.main === new URL(importMetaUrl).pathname);
  }
  if (isNode && typeof process !== "undefined") {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // Convert argv[1] (a path) to a file URL for comparison
    const argvUrl = argv1.startsWith("file:") ? argv1 : `file://${argv1.startsWith("/") ? "" : "/"}${argv1.replace(/\\/g, "/")}`;
    return importMetaUrl === argvUrl;
  }
  return false;
}
