/** Translate a glob (`**`, `*`, `?`) to an anchored RegExp. `**` crosses `/`, `*` and `?` do not. */
function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?"
          i += 2
        } else {
          re += ".*"
          i += 1
        }
      } else re += "[^/]*"
    } else if (c === "?") re += "[^/]"
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

/** True when repo-relative `path` matches `glob`. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path)
}
