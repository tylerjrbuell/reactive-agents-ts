/**
 * Confined, size-capped read of one file bundled with a skill.
 *
 * Backs `activate-skill({ name, file })` (skills spec §4 "Bundled files",
 * §11 item 2). The file must resolve inside the skill's own directory: an
 * absolute path, a `..` segment, or a symlink whose real target leaves the
 * directory is refused. This reaches global skills that sit outside the run's
 * file root, so the skill directory, not the file root, is the boundary.
 *
 * Every outcome is a value. A refusal is something the model can act on, so
 * it comes back as `{ ok: false, message }`, never as a failure channel.
 */
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Default cap on bytes returned from one bundled-file read (32 KiB). */
export const DEFAULT_SKILL_FILE_MAX_BYTES = 32 * 1024;

/** Outcome of {@link readSkillFile}. */
export type SkillFileRead =
  | {
      readonly ok: true;
      /** The file text, cut at the byte cap when `truncated`. */
      readonly text: string;
      /** True when the file was larger than the cap. */
      readonly truncated: boolean;
      /** Full size of the file on disk, in bytes. */
      readonly sizeBytes: number;
    }
  | { readonly ok: false; readonly message: string };

function isWithin(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

/**
 * Lexical check on the requested path, before touching the filesystem.
 * Returns a refusal message, or undefined when the shape is acceptable.
 */
function lexicalRefusal(file: string): string | undefined {
  if (file.trim().length === 0) return "file must be a non-empty path relative to the skill directory.";
  if (file.includes("\0")) return "file must not contain a NUL byte.";
  if (path.isAbsolute(file) || path.win32.isAbsolute(file)) {
    return `file "${file}" is absolute. Pass a path relative to the skill directory, e.g. "references/guide.md".`;
  }
  if (file.split(/[\\/]+/).some((segment) => segment === "..")) {
    return `file "${file}" contains "..". Only files inside the skill directory can be read.`;
  }
  return undefined;
}

const readCapped = async (
  dir: string,
  file: string,
  maxBytes: number,
): Promise<SkillFileRead> => {
  const refusal = lexicalRefusal(file);
  if (refusal !== undefined) return { ok: false, message: refusal };

  const realDir = await fs.realpath(dir);
  const target = path.resolve(realDir, file);
  if (!isWithin(realDir, target)) {
    return { ok: false, message: `file "${file}" is outside the skill directory.` };
  }

  let realTarget: string;
  try {
    realTarget = await fs.realpath(target);
  } catch {
    return { ok: false, message: `file "${file}" does not exist in the skill directory.` };
  }
  // A symlink inside the directory may still point outside it.
  if (!isWithin(realDir, realTarget)) {
    return { ok: false, message: `file "${file}" links outside the skill directory.` };
  }

  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) {
    return { ok: false, message: `"${file}" is not a regular file.` };
  }

  const handle = await fs.open(realTarget, "r");
  try {
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return {
      ok: true,
      text: buffer.subarray(0, bytesRead).toString("utf-8"),
      truncated: stat.size > maxBytes,
      sizeBytes: stat.size,
    };
  } finally {
    await handle.close();
  }
};

/**
 * Read `file` from inside the skill directory `dir`, at most `maxBytes`.
 *
 * Never fails: lexical escapes (absolute path, `..`), lexical or symlink
 * escapes after `realpath`, missing files, non-regular files and I/O faults
 * all return `{ ok: false, message }` with model-facing text.
 */
export const readSkillFile = (
  dir: string,
  file: string,
  maxBytes: number = DEFAULT_SKILL_FILE_MAX_BYTES,
): Effect.Effect<SkillFileRead> =>
  Effect.tryPromise(() => readCapped(dir, file, maxBytes)).pipe(
    Effect.catchAll((cause) =>
      Effect.succeed<SkillFileRead>({
        ok: false,
        message: `could not read "${file}" from the skill directory: ${String(cause.error)}`,
      }),
    ),
  );
