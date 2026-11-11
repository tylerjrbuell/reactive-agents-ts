/**
 * file-read trap heals (census of 501 recorded runs, 2026-11-10).
 *
 * Each heal turns a call that failed for a reason the tool can see into the
 * read the model meant, and says what it did:
 * - a directory path returned raw EISDIR → return its listing;
 * - a relative path that repeats the end of the working root
 *   (root `.../apps/cortex`, path `apps/cortex/README.md`) → ENOENT under
 *   `apps/cortex/apps/cortex/` → read the path with the repeat stripped;
 * - an encoding Node's fs does not accept (`utf-16le` under Bun) → decode
 *   with the matching Buffer encoding, or as utf-8 when there is none.
 *
 * Pure helpers plus the directory listing shared with list-directory.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** One entry of a directory listing (list-directory's `entries` shape). */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: "file" | "dir";
  readonly bytes?: number;
}

/**
 * The entries of directory `resolved`, sorted by codepoint (the listing a
 * model sees must not depend on the host's locale). Files carry `bytes`.
 */
export async function readDirectoryListing(resolved: string): Promise<DirectoryEntry[]> {
  const dirents = await fs.readdir(resolved, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (d): Promise<DirectoryEntry> => {
      if (d.isDirectory()) return { name: d.name, type: "dir" };
      const stat = await fs.stat(path.join(resolved, d.name)).catch(() => undefined);
      return stat ? { name: d.name, type: "file", bytes: stat.size } : { name: d.name, type: "file" };
    }),
  );
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/** Note on a file-read result that is a directory listing. */
export const DIRECTORY_READ_NOTE =
  "path is a directory; its listing is shown — call file-read on a file path";

/**
 * When relative `requested` starts with the last segment(s) of `root`
 * (root `/r/apps/cortex`, requested `apps/cortex/README.md`), the path with
 * that repeat removed (`README.md`). Longest repeat first. `undefined` for an
 * absolute path, no repeat, or a repeat that would leave nothing.
 */
export function stripRepeatedRootPrefix(root: string, requested: string): string | undefined {
  if (path.isAbsolute(requested)) return undefined;
  const req = requested.split(/[\\/]+/).filter((s) => s.length > 0 && s !== ".");
  const rootSegs = root.split(/[\\/]+/).filter((s) => s.length > 0);
  for (let k = Math.min(rootSegs.length, req.length - 1); k >= 1; k--) {
    const tail = rootSegs.slice(rootSegs.length - k);
    if (tail.every((seg, i) => seg === req[i])) return req.slice(k).join("/");
  }
  return undefined;
}

/** Encoding names a model may send, mapped to the Buffer encoding they mean. */
const ENCODINGS: Readonly<Record<string, BufferEncoding>> = {
  utf8: "utf8",
  "utf-8": "utf8",
  utf16le: "utf16le",
  "utf-16le": "utf16le",
  "utf-16": "utf16le",
  utf16: "utf16le",
  ucs2: "utf16le",
  "ucs-2": "utf16le",
  latin1: "latin1",
  "iso-8859-1": "latin1",
  binary: "latin1",
  ascii: "ascii",
  base64: "base64",
  base64url: "base64url",
  hex: "hex",
};

/** Decoded file text, plus a note when the requested encoding was not used as given. */
export interface DecodedText {
  readonly text: string;
  readonly note?: string;
}

/**
 * Decode `buf` with the encoding the caller asked for. Names fs rejects but
 * that have an obvious Buffer meaning (`utf-16le`, `UTF-8`) are honored. An
 * unknown name decodes as utf-8 with a note. A UTF-16 request on a file with
 * no UTF-16 byte-order mark and no NUL bytes (plain UTF-8 text: decoding it as
 * UTF-16 would print noise) also decodes as utf-8 with a note.
 */
export function decodeFileText(buf: Buffer, requested: unknown): DecodedText {
  if (requested === undefined || requested === null || requested === "") {
    return { text: buf.toString("utf8") };
  }
  const name = String(requested);
  const encoding = ENCODINGS[name.trim().toLowerCase()];
  if (encoding === undefined) {
    return {
      text: buf.toString("utf8"),
      note: `encoding "${name}" is not supported; the file was read as utf-8`,
    };
  }
  if (encoding === "utf16le") {
    const bom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
    if (!bom && !buf.includes(0)) {
      return {
        text: buf.toString("utf8"),
        note: `the file is not UTF-16 (no byte-order mark, no NUL bytes); it was read as utf-8 instead of "${name}"`,
      };
    }
  }
  const text = buf.toString(encoding);
  return { text: encoding === "utf16le" ? text.replace(/^﻿/, "") : text };
}
