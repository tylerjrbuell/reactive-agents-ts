/**
 * decide/text-similarity.ts — normalized Levenshtein similarity.
 *
 * Pure lexical utility (no dependencies). Moved verbatim from `arbitrator.ts`
 * (GH #220 / quality program Task 7); `normalizedLevenshtein` is still
 * re-exported from `arbitrator.ts` (imported by runner-helpers/flail-signature
 * and the lexical termination evaluators).
 */

// ── Levenshtein Utility ──────────────────────────────────────────────────────

/**
 * Normalized Levenshtein similarity (0-1, 1 = identical). No external dependencies.
 *
 * Two rolling typed-array rows, not a full (|a|+1)x(|b|+1) matrix. The kernel
 * calls this every iteration on whole thoughts (flail-signature, content
 * stability). Thoughts run to thousands of chars, and the old nested
 * `number[][]` built ~14M boxed cells per call for two 3,700-char thoughts.
 * That cost ~150ms per iteration and pushed scripted kernel tests past bun's
 * 5s default in CI. Same distance, O(min) memory, no per-cell allocation.
 */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Iterate rows over the longer string; the row width is the shorter one.
  const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
  const width = inner.length;
  let prev = new Uint32Array(width + 1);
  let curr = new Uint32Array(width + 1);
  for (let j = 0; j <= width; j++) prev[j] = j;
  for (let i = 1; i <= outer.length; i++) {
    curr[0] = i;
    const oc = outer.charCodeAt(i - 1);
    for (let j = 1; j <= width; j++) {
      const sub = prev[j - 1]! + (oc === inner.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      curr[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return 1 - prev[width]! / maxLen;
}

/**
 * `normalizedLevenshtein(a, b) > threshold`, without computing the full
 * distance. Use this for every near-duplicate check (the kernel only ever asks
 * "above the threshold?").
 *
 * Passing needs distance <= k = floor((1 - threshold) * maxLen). The check
 * bails early on the length gap, fills only the diagonal band |i - j| <= k,
 * and stops once a whole band row exceeds k. Distinct thoughts usually stop
 * within ~k rows, so the cost is about O(k^2), not O(|a| * |b|). Inside the
 * band the distance is exact, so the verdict matches the full computation.
 */
export function similarityExceeds(a: string, b: string, threshold: number): boolean {
  if (a === b) return 1 > threshold;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1 > threshold;
  const k = Math.floor((1 - threshold) * maxLen);
  if (k < 0) return false;

  const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
  const n = outer.length;
  const m = inner.length;
  if (n - m > k) return false;

  const OUT = k + 1; // any value > k marks a cell outside the band / over budget
  let prev = new Uint32Array(m + 2);
  let curr = new Uint32Array(m + 2);
  prev.fill(OUT);
  for (let j = 0; j <= Math.min(m, k); j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - k);
    const hi = Math.min(m, i + k);
    curr[lo - 1] = lo === 1 ? (i <= k ? i : OUT) : OUT;
    if (hi + 1 <= m) curr[hi + 1] = OUT;
    const oc = outer.charCodeAt(i - 1);
    let rowMin = curr[lo - 1]!;
    for (let j = lo; j <= hi; j++) {
      const sub = prev[j - 1]! + (oc === inner.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j]! + 1;
      const ins = curr[j - 1]! + 1;
      let v = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
      if (v > OUT) v = OUT;
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return false;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const d = prev[m]!;
  if (d > k) return false;
  return 1 - d / maxLen > threshold;
}
