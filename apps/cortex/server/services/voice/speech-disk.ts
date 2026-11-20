/**
 * Disk space for the local speech server's model cache (Settings · Voice).
 *
 * Speaches downloads models into the `hf-hub-cache` volume. On Docker Desktop (macOS, Windows) that
 * volume lives on Docker's own fixed-size VM disk, not the computer's disk, so "no space left on
 * device" can happen while the Mac has plenty free. Cortex measures the space the container itself
 * sees (`df` inside its own container), names that cause in one plain sentence, and refuses a
 * download when the cache is nearly full.
 *
 * The Speaches registry (`GET /v1/registry`) carries no model size (checked 2026-11-20 against
 * `latest-cuda`: keys `id`, `created`, `object`, `owned_by`, `language`, `task`, `sample_rate`,
 * `voices`), so there is no per-model fit check: the pre-download refusal is a fixed floor,
 * `MIN_FREE_FOR_DOWNLOAD_BYTES`.
 */

/**
 * Below this much free space in the model cache, Cortex does not start a model download. The smallest
 * models Cortex suggests are a few hundred MB (Kokoro, faster-whisper-small) and the large Whisper models
 * about 3 GB, so under 1 GiB a download most likely fails part way and leaves a partial file behind.
 */
export const MIN_FREE_FOR_DOWNLOAD_BYTES = 1024 ** 3;

/** Text from the speech server or docker that means the disk is full (ENOSPC, errno 28). */
export function isDiskFullText(text: string): boolean {
  return /no space left on device|errno 28|\bENOSPC\b/i.test(text);
}

/** Bytes available on the filesystem from `df -Pk <path>` output (POSIX format, 1024-byte blocks), or `null`. */
export function parseDfAvailableBytes(stdout: string): number | null {
  const lines = stdout.trim().split("\n");
  const row = lines[lines.length - 1];
  if (lines.length < 2 || row === undefined) return null;
  const cols = row.trim().split(/\s+/);
  // Filesystem, 1024-blocks, Used, Available, Capacity, Mounted on (the mount point may hold spaces).
  const avail = cols.length >= 6 ? Number(cols[3]) : Number.NaN;
  return Number.isSafeInteger(avail) && avail >= 0 ? avail * 1024 : null;
}

/** `1.2 GB`, `350 MB` (decimal units, as Docker Desktop shows them). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1e6))} MB`;
}

/**
 * The one sentence for a full model cache: the cause (Docker's disk, not the computer's), the free space
 * when measured, and the fix. Never suggests removing the `hf-hub-cache` volume: it holds the models
 * already downloaded, and `docker system prune` without `--volumes` keeps it. At most 300 characters,
 * so the status's 300-character tail rule never cuts it.
 */
export function diskFullSentence(freeBytes: number | null): string {
  const free = freeBytes === null ? "" : ` (${formatBytes(freeBytes)} free for speech models)`;
  return `Docker's disk is full${free}. This is Docker's own disk, not your computer's. Raise the disk limit in Docker Desktop (Settings, Resources), or check docker system df and run docker system prune (it keeps volumes, so models stay). Then press Retry.`;
}
