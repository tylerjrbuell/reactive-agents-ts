import { isAbsolute, relative, resolve } from "node:path"

/** Repo-relative form of `p` (absolute or relative to `root`), or undefined when it lies outside `root`. */
export function repoRelative(root: string, p: string): string | undefined {
  const rel = relative(root, isAbsolute(p) ? p : resolve(root, p))
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : rel.split("\\").join("/")
}
