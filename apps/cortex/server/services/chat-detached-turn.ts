/**
 * A chat turn detached from the SSE connection that started it.
 *
 * The streamed chat turn used to live exactly as long as its request: closing or
 * reloading the page dropped the connection, which aborted the run (a live approval
 * or question wait went with it). Here the turn is pumped to its end in the
 * background into a replayable event buffer, and any number of connections attach
 * to it (`attach`): the one that started it, and the one a reloaded page opens.
 * Stop stays explicit (`ChatSessionService.stopTurn`); a dropped connection no
 * longer stops anything.
 *
 * Events are numbered by absolute position (`id:` on the wire). A reconnecting
 * client sends the last id it saw (`cursor`) and gets every later event, so a
 * flaky connection resumes without a gap. The buffer is bounded
 * ({@link MAX_BUFFERED_EVENTS}); a reader that fell behind the oldest kept event
 * resumes from it.
 */
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { causeLineOf, type StepEvent } from "@reactive-agents/ui-core";

/** What a chat turn's SSE carries: the runtime's stream events plus Cortex's live strategy `StepEvent`s (strategy-steps.ts). */
export type ChatStreamEvent = AgentStreamEvent | StepEvent;

/** Most events kept for replay per turn; older ones are dropped first. */
export const MAX_BUFFERED_EVENTS = 20_000;
/** How long a finished turn stays attachable (a client that reconnects just after the end still gets its last events). */
export const FINISHED_TURN_RETENTION_MS = 60_000;

const isTerminal = (e: ChatStreamEvent): boolean =>
  e._tag === "StreamCompleted" || e._tag === "StreamError" || e._tag === "StreamCancelled";

/** One buffered event with its absolute position. */
export interface NumberedEvent {
  readonly id: number;
  readonly event: ChatStreamEvent;
}

/** What a reconnecting client needs to draw the turn before its events arrive. */
export interface DetachedTurnInfo {
  readonly sessionId: string;
  /** The user message the turn answers (it is stored with the turn only when the turn ends). */
  readonly message: string;
  readonly startedAt: number;
  /** True until the turn's stream ended. */
  readonly active: boolean;
}

/** One running (or just finished) turn with its replay buffer. */
export class DetachedTurn {
  readonly startedAt = Date.now();
  private events: ChatStreamEvent[] = [];
  /** Absolute id of `events[0]` (events dropped from the front advance it). */
  private base = 0;
  private done = false;
  private readonly wake = new Set<() => void>();
  private readonly settle: Promise<void>;
  private resolveSettle: () => void = () => {};

  constructor(
    readonly sessionId: string,
    readonly message: string,
  ) {
    this.settle = new Promise<void>((r) => {
      this.resolveSettle = r;
    });
  }

  /** Resolves once the source stream has fully ended (the producer's cleanup, e.g. persisting the turn, has run). */
  whenEnded(): Promise<void> {
    return this.settle;
  }

  /** True until the turn's stream ended. */
  get active(): boolean {
    return !this.done;
  }

  /** Info for a client that attaches after the fact. */
  info(): DetachedTurnInfo {
    return { sessionId: this.sessionId, message: this.message, startedAt: this.startedAt, active: !this.done };
  }

  /** Append an event and wake the readers. */
  push(event: ChatStreamEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_BUFFERED_EVENTS) {
      const drop = this.events.length - MAX_BUFFERED_EVENTS;
      this.events.splice(0, drop);
      this.base += drop;
    }
    this.notify();
  }

  /** Mark the stream ended; readers drain what is buffered, then finish. */
  end(): void {
    this.done = true;
    this.resolveSettle();
    this.notify();
  }

  /** Oldest absolute id still buffered. */
  get oldestId(): number {
    return this.base;
  }

  /** One past the newest absolute id. */
  get nextId(): number {
    return this.base + this.events.length;
  }

  private notify(): void {
    const waiting = [...this.wake];
    this.wake.clear();
    for (const w of waiting) w();
  }

  /**
   * Replay from `fromId` (0 = the start), then follow live events until the turn
   * ends or `signal` aborts. An id older than the buffer resumes from the oldest.
   */
  async *attach(fromId = 0, signal?: AbortSignal): AsyncGenerator<NumberedEvent> {
    let next = Math.max(fromId, 0);
    for (;;) {
      if (signal?.aborted) return;
      if (next < this.base) next = this.base;
      while (next < this.base + this.events.length) {
        const event = this.events[next - this.base]!;
        const id = next;
        next += 1;
        yield { id, event };
        if (isTerminal(event)) return;
      }
      if (this.done) return;
      // Wait for the next event, the turn's end, or the reader leaving.
      await new Promise<void>((resolve) => {
        const wakeUp = (): void => {
          signal?.removeEventListener("abort", wakeUp);
          this.wake.delete(wakeUp);
          resolve();
        };
        this.wake.add(wakeUp);
        signal?.addEventListener("abort", wakeUp, { once: true });
      });
    }
  }
}

/** The session's detached turns (one in flight per session, plus the one that just finished). */
export class DetachedTurns {
  private readonly turns = new Map<string, DetachedTurn>();

  /**
   * Run `source` to its end in the background, buffering every event, and return the
   * turn to attach to. A source that throws ends the turn with a `StreamError`.
   * `retentionMs` is how long the finished turn stays attachable.
   */
  start(
    sessionId: string,
    message: string,
    source: AsyncIterable<ChatStreamEvent>,
    retentionMs = FINISHED_TURN_RETENTION_MS,
  ): DetachedTurn {
    const turn = new DetachedTurn(sessionId, message);
    this.turns.set(sessionId, turn);
    void (async () => {
      try {
        for await (const event of source) turn.push(event);
      } catch (e) {
        turn.push({ _tag: "StreamError", cause: causeLineOf(e) ?? "Chat stream failed" });
      } finally {
        turn.end();
        const timer = setTimeout(() => {
          if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
        }, retentionMs);
        // A pending retention timer must not keep the process (or a test run) alive.
        timer.unref?.();
      }
    })();
    return turn;
  }

  /** The session's turn: running, or finished within the retention window. */
  get(sessionId: string): DetachedTurn | undefined {
    return this.turns.get(sessionId);
  }

  /** The session's turn only while it is still running. */
  running(sessionId: string): DetachedTurn | undefined {
    const t = this.turns.get(sessionId);
    return t?.active ? t : undefined;
  }
}

/** One SSE frame: `id:` (the event's absolute position, the client's resume cursor) then the event. */
export const sseFrame = ({ id, event }: NumberedEvent): string => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
