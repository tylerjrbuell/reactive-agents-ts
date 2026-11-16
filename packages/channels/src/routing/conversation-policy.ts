import { Deferred, Effect } from "effect";
import type { InboundMessage } from "../types.js";
import type { RouteOutcome, RouteRole, RouteSpec } from "./types.js";

/** One inbound envelope on its way to a turn (or several, after batching or folding). */
export interface TurnEntry {
  readonly adapterId: string;
  readonly msg: InboundMessage;
  readonly route: RouteSpec;
  readonly role: RouteRole;
  /** `route:role:conversation`, the queue key. */
  readonly key: string;
  readonly taskId: string;
  readonly simulated: boolean;
  /** Inbox keys of every source envelope this turn covers. */
  readonly keys: ReadonlyArray<string>;
}

/** Source message ids behind a message: its own, or the ones a batch already joined. */
export const sourceIdsOf = (msg: InboundMessage): ReadonlyArray<string> => {
  const batch = msg.metadata["batch"];
  if (typeof batch === "object" && batch !== null && "sourceIds" in batch && Array.isArray(batch.sourceIds)) {
    return batch.sourceIds.filter((id): id is string => typeof id === "string");
  }
  return [msg.id];
};

/**
 * Join messages into one turn input: texts in arrival order separated by a newline, attachments
 * concatenated, every source id kept in `metadata.batch.sourceIds`. One message comes back unchanged.
 */
export const combineMessages = (first: InboundMessage, rest: ReadonlyArray<InboundMessage>): InboundMessage => {
  const last = rest[rest.length - 1];
  if (last === undefined) return first;
  const msgs = [first, ...rest];
  const sourceIds = msgs.flatMap(sourceIdsOf);
  const attachments = msgs.flatMap((m) => m.attachments ?? []);
  return {
    ...first,
    content: msgs.map((m) => m.content).join("\n"),
    ...(attachments.length > 0 ? { attachments } : {}),
    timestamp: last.timestamp,
    metadata: { ...first.metadata, batch: { sourceIds, size: sourceIds.length } },
  };
};

interface Batch {
  readonly msgs: InboundMessage[];
  readonly keys: string[];
  readonly done: Deferred.Deferred<RouteOutcome>;
}

interface Pending {
  readonly msg: InboundMessage;
  readonly keys: ReadonlyArray<string>;
}

/** A turn that is running for a conversation on a `fold` or `interrupt` route. */
export interface RunningTurn {
  /** Envelopes that arrived while the turn ran and were not consumed yet. */
  pending: Pending[];
  /** Callers waiting for this turn's final outcome. */
  readonly waiters: Array<Deferred.Deferred<RouteOutcome>>;
  /** Inbox keys covered by the current attempt (grows when the resolver drains folded messages). */
  keys: string[];
  /** Succeeds when the current attempt must be cancelled (`interrupt` mode). */
  signal: Deferred.Deferred<void>;
}

/**
 * Per-conversation event policy for `batchWindowMs` and `midRun`. Pure bookkeeping plus two Effects
 * that wait; the engine owns the turn itself. Strict router only, never for simulations.
 */
export class ConversationPolicy {
  private readonly batches = new Map<string, Batch>();
  private readonly running = new Map<string, RunningTurn>();

  /**
   * Hold `entry` for the route's window together with later envelopes from the same sender in the
   * same conversation, then run `flush` once with the combined input. Every caller gets the outcome
   * of the combined turn. `onBatched` fires once for a window that joined more than one envelope.
   */
  batch(
    entry: TurnEntry,
    flush: (combined: TurnEntry) => Effect.Effect<RouteOutcome>,
    onBatched: (size: number, sourceIds: ReadonlyArray<string>) => Effect.Effect<void>,
  ): Effect.Effect<RouteOutcome> {
    const self = this;
    const batchKey = `${entry.key}:${entry.msg.senderId}`;
    return Effect.suspend(() => {
      const open = self.batches.get(batchKey);
      if (open) {
        open.msgs.push(entry.msg);
        open.keys.push(...entry.keys);
        return Deferred.await(open.done);
      }
      const batch: Batch = { msgs: [entry.msg], keys: [...entry.keys], done: Effect.runSync(Deferred.make<RouteOutcome>()) };
      self.batches.set(batchKey, batch);
      return Effect.gen(function* () {
        yield* Effect.sleep(entry.route.batchWindowMs ?? 0);
        self.batches.delete(batchKey);
        const combined = combineMessages(entry.msg, batch.msgs.slice(1));
        if (batch.msgs.length > 1) yield* onBatched(batch.msgs.length, sourceIdsOf(combined));
        const outcome = yield* flush({ ...entry, msg: combined, keys: batch.keys });
        yield* Deferred.succeed(batch.done, outcome);
        return outcome;
      }).pipe(
        // An interrupted leader (shutdown) must not leave joiners waiting forever.
        Effect.ensuring(Effect.suspend(() => {
          self.batches.delete(batchKey);
          return Deferred.interrupt(batch.done);
        })),
      );
    });
  }

  /** The running turn of a conversation, when its route folds or interrupts. */
  runningFor(key: string): RunningTurn | undefined {
    return this.running.get(key);
  }

  /** Register the running turn of `key`. */
  open(key: string, keys: ReadonlyArray<string>): RunningTurn {
    const turn: RunningTurn = { pending: [], waiters: [], keys: [...keys], signal: Effect.runSync(Deferred.make<void>()) };
    this.running.set(key, turn);
    return turn;
  }

  /**
   * Forget the running turn and give every waiter the final outcome. With no outcome (the turn was
   * interrupted, for example on shutdown) the waiters are interrupted too, never left hanging.
   */
  close(key: string, outcome: RouteOutcome | undefined): Effect.Effect<void> {
    const turn = this.running.get(key);
    this.running.delete(key);
    if (!turn) return Effect.void;
    return Effect.asVoid(
      Effect.forEach(turn.waiters, (w) => (outcome ? Deferred.succeed(w, outcome) : Deferred.interrupt(w))),
    );
  }

  /**
   * Add an envelope to the running turn and wait for its final outcome. Undefined when the turn
   * already holds `max` pending envelopes (the caller reports backpressure).
   */
  absorb(
    turn: RunningTurn,
    entry: TurnEntry,
    mode: "fold" | "interrupt",
    max: number,
  ): Effect.Effect<RouteOutcome | undefined> {
    if (turn.pending.length >= max) return Effect.succeed(undefined);
    const waiter = Effect.runSync(Deferred.make<RouteOutcome>());
    turn.pending.push({ msg: entry.msg, keys: entry.keys });
    turn.waiters.push(waiter);
    return Effect.zipRight(mode === "interrupt" ? Deferred.succeed(turn.signal, undefined) : Effect.void, Deferred.await(waiter));
  }

  /** Start a new attempt: a fresh signal, already tripped when something is waiting in `interrupt` mode. */
  arm(turn: RunningTurn, keys: ReadonlyArray<string>, mode: "fold" | "interrupt"): void {
    turn.keys = [...keys];
    turn.signal = Effect.runSync(Deferred.make<void>());
    if (mode === "interrupt" && turn.pending.length > 0) Effect.runSync(Deferred.succeed(turn.signal, undefined));
  }

  /** Resolver-facing drain for `fold`: texts in order, each returned once and counted into the attempt. */
  take(turn: RunningTurn): ReadonlyArray<string> {
    const taken = turn.pending;
    turn.pending = [];
    turn.keys.push(...taken.flatMap((p) => p.keys));
    return taken.map((p) => p.msg.content);
  }

  /** Take everything still pending (for the next attempt). */
  drain(turn: RunningTurn): { readonly msgs: ReadonlyArray<InboundMessage>; readonly keys: ReadonlyArray<string> } {
    const taken = turn.pending;
    turn.pending = [];
    return { msgs: taken.map((p) => p.msg), keys: taken.flatMap((p) => p.keys) };
  }
}
