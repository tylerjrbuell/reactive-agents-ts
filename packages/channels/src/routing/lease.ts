import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { Scope } from "effect";
import { ChannelAlreadyOwned } from "./types.js";

/** The lease file could not be read or written (permissions, full disk). Typed, never a defect. */
export class ChannelLeaseError extends Data.TaggedError("ChannelLeaseError")<{
  readonly channelId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * One owner per account. Taking the lease before an adapter starts makes a second owner (another
 * process, or a second channel with the same credential in this one) fail closed instead of two
 * pollers fighting over one bot token or one Signal socket.
 */
export interface AccountLeases {
  /** Take the lease for `fingerprint` until the scope closes. Fails with {@link ChannelAlreadyOwned}. */
  readonly acquire: (
    channelId: string,
    fingerprint: string,
  ) => Effect.Effect<void, ChannelAlreadyOwned | ChannelLeaseError, Scope.Scope>;
}

interface LeaseFile {
  readonly pid: number;
  readonly since: number;
  readonly host: string;
}

const isLeaseFile = (u: unknown): u is LeaseFile => {
  if (typeof u !== "object" || u === null) return false;
  const o = u as Record<string, unknown>;
  return typeof o["pid"] === "number" && typeof o["since"] === "number" && typeof o["host"] === "string";
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return typeof e === "object" && e !== null && "code" in e && e.code === "EPERM";
  }
};

const readLease = (path: string): LeaseFile | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isLeaseFile(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Default lock directory (OS temp dir). */
export const defaultLeaseDir = (): string => join(tmpdir(), "reactive-agents-channel-leases");

/**
 * Lock-file leases keyed by a hash of the credential fingerprint (never the secret). A lock is
 * stale when its pid is dead on this host; a stale or unreadable lock is taken over.
 */
export const makeFileLeases = (options: { readonly lockDir?: string } = {}): AccountLeases => {
  const dir = options.lockDir ?? defaultLeaseDir();
  const host = hostname();
  return {
    acquire: (channelId, fingerprint) => {
      const path = join(dir, `${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}.lock`);
      const mine: LeaseFile = { pid: process.pid, since: Date.now(), host };
      const leaseError = (cause: unknown) =>
        Effect.fail(new ChannelLeaseError({ channelId, message: `channel ${channelId}: lease file unavailable`, cause }));
      const take = (): Effect.Effect<void, ChannelAlreadyOwned | ChannelLeaseError> =>
        Effect.suspend((): Effect.Effect<void, ChannelAlreadyOwned | ChannelLeaseError> => {
          try {
            mkdirSync(dir, { recursive: true });
          } catch (e) {
            return leaseError(e);
          }
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              // Exclusive create is the one mutual-exclusion point: exactly one process wins it.
              writeFileSync(path, JSON.stringify(mine), { flag: "wx" });
              return Effect.void;
            } catch (e) {
              if (!(typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST")) return leaseError(e);
              const owner = readLease(path);
              const stale = owner === undefined || (owner.host === host && !pidAlive(owner.pid));
              if (!stale) {
                return Effect.fail(new ChannelAlreadyOwned({ channelId, ownerPid: owner.pid, since: owner.since }));
              }
              // Take the stale file out of the way by atomic rename to a unique name: only one
              // contender moves it, and the loser gets ENOENT instead of unlinking a fresh lock.
              const tomb = `${path}.stale-${process.pid}-${attempt}`;
              try {
                renameSync(path, tomb);
              } catch (renameError) {
                if (typeof renameError === "object" && renameError !== null && "code" in renameError && renameError.code === "ENOENT") continue;
                return leaseError(renameError);
              }
              const moved = readLease(tomb);
              const stillStale = moved === undefined || (moved.host === host && !pidAlive(moved.pid));
              if (!stillStale) {
                // Raced with a new owner: we moved a live lock. Put it back (link fails if the path
                // was retaken) and fail closed.
                try {
                  linkSync(tomb, path);
                } catch {
                  // path already retaken by another owner; that owner holds the lease
                }
                try {
                  unlinkSync(tomb);
                } catch {
                  // already gone
                }
                return Effect.fail(new ChannelAlreadyOwned({ channelId, ownerPid: moved.pid, since: moved.since }));
              }
              try {
                unlinkSync(tomb);
              } catch {
                // already gone
              }
            }
          }
          return Effect.fail(new ChannelAlreadyOwned({ channelId, ownerPid: -1, since: 0 }));
        });
      const release = Effect.sync(() => {
        const owner = readLease(path);
        if (owner && owner.pid === mine.pid && owner.since === mine.since) {
          try {
            unlinkSync(path);
          } catch {
            // already gone
          }
        }
      });
      return Effect.acquireRelease(take(), () => release);
    },
  };
};

/** Process-local leases, for tests and hosts that guarantee a single process. */
export const makeMemoryLeases = (): AccountLeases => {
  const held = new Map<string, number>();
  return {
    acquire: (channelId, fingerprint) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          const since = held.get(fingerprint);
          if (since !== undefined) return Effect.fail(new ChannelAlreadyOwned({ channelId, ownerPid: process.pid, since }));
          held.set(fingerprint, Date.now());
          return Effect.void;
        }),
        () => Effect.sync(() => void held.delete(fingerprint)),
      ),
  };
};
