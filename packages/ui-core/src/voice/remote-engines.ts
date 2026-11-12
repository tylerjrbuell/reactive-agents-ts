/**
 * Remote speech engines: record or play audio in the browser, do the recognition or
 * synthesis on a server route. The routes' contract is tiny and engine-neutral:
 *
 * - transcribe: `POST <url>` with the recorded audio as the body (its media type as
 *   `content-type`; `?language=` optional) answers `{ text }` or `{ error }`;
 * - speak: `POST <url>` with `{ text, voice?, speed? }` answers audio bytes or `{ error }`;
 * - voices: `GET <url>` answers `{ voices: VoiceInfo[] }`.
 *
 * Cortex implements the routes over any OpenAI-compatible `/v1/audio/*` server, so
 * keys stay on the server. Browser globals are injected, so the engines are tested
 * without a DOM.
 */
import { causeMessage, type VoiceFetch, type SttEngine, SttError, SttHandle, SttHandlers, SttStartOptions, TtsEngine, TtsError, TtsHandle, TtsHandlers, TtsSpeakOptions, VoiceInfo } from "./types.js";
import { exclusive } from "./speech-coordinator.js";

/** Root-mean-square level (0 to 1) of unsigned-byte time-domain samples (128 = silence). */
export function rmsOf(bytes: ArrayLike<number>): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const v = ((bytes[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

/** The slice of a `MediaStream` the engine uses. */
export interface MediaStreamLike {
  getTracks(): ReadonlyArray<{ stop(): void }>;
}

/** The slice of a `MediaRecorder` the engine drives. */
export interface RecorderLike {
  readonly mimeType: string;
  ondataavailable: ((e: { readonly data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(timesliceMs?: number): void;
  stop(): void;
}

/** A `MediaRecorder` constructor. */
export type RecorderCtor = new (stream: MediaStreamLike) => RecorderLike;

/** Starts watching a stream for sound; calls `onSound` while it is louder than the threshold. Returns a disposer. */
export type SoundProbe = (stream: MediaStreamLike, onSound: () => void) => () => void;

/** The slice of an `AudioContext` the default probe uses. */
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStreamLike): { connect(node: unknown): void };
  createAnalyser(): { fftSize: number; getByteTimeDomainData(a: Uint8Array): void };
  close(): Promise<void>;
}

/** Watch a stream's loudness through an `AudioContext`; polls every 100 ms. */
export function analyserProbe(
  makeContext: () => AudioContextLike,
  threshold = 0.02,
  setIntervalFn: (fn: () => void, ms: number) => unknown = (fn, ms) => globalThis.setInterval(fn, ms),
  clearIntervalFn: (h: unknown) => void = (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
): SoundProbe {
  return (stream, onSound) => {
    let ctx: AudioContextLike;
    try {
      ctx = makeContext();
    } catch {
      return () => undefined;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(1024);
    const timer = setIntervalFn(() => {
      analyser.getByteTimeDomainData(buf);
      if (rmsOf(buf) > threshold) onSound();
    }, 100);
    return () => {
      clearIntervalFn(timer);
      void ctx.close().catch(() => undefined);
    };
  };
}

/** Dependencies of {@link createRemoteStt}. */
export interface RemoteSttDeps {
  readonly id?: string;
  readonly label?: string;
  /** Route that takes audio and answers `{ text }`. */
  readonly url: string;
  readonly fetch: VoiceFetch;
  readonly getUserMedia: (() => Promise<MediaStreamLike>) | undefined;
  readonly Recorder: RecorderCtor | undefined;
  /** Optional sound detection; without it silence cannot end a session on its own. */
  readonly probe?: SoundProbe;
  /** Longest recording before it stops by itself (default 120 s). */
  readonly maxSeconds?: number;
  /** Largest recording the server takes; longer is refused before upload (default 25 MB). */
  readonly maxBytes?: number;
}

const micError = (cause: unknown): SttError => {
  const name = typeof cause === "object" && cause !== null && "name" in cause ? String((cause as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { kind: "permission-denied", message: "Microphone access is blocked. Allow it in the browser's site settings, then try again." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { kind: "no-microphone", message: "No microphone was found. Connect one and try again." };
  }
  return { kind: "other", message: "Could not open the microphone." };
};

const errorText = async (res: Response, fallback: string): Promise<string> => {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    /* not JSON */
  }
  return `${fallback} (HTTP ${res.status}).`;
};

/** Listening through a server route: record in the browser, transcribe on the server. */
export function createRemoteStt(deps: RemoteSttDeps): SttEngine {
  return {
    id: deps.id ?? "server",
    label: deps.label ?? "Server (OpenAI-compatible)",
    available: () =>
      deps.getUserMedia !== undefined && deps.Recorder !== undefined
        ? { ok: true }
        : { ok: false, reason: "This browser cannot record audio (it needs a secure page, https or localhost, and MediaRecorder)." },
    start(opts: SttStartOptions, h: SttHandlers): SttHandle {
      let stopRequested = false;
      let aborted = false;
      let ended = false;
      let stream: MediaStreamLike | null = null;
      let recorder: RecorderLike | null = null;
      let disposeProbe: (() => void) | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      const abortCtl = new AbortController();
      const chunks: Blob[] = [];
      let bytes = 0;
      const release = (): void => {
        if (maxTimer !== null) clearTimeout(maxTimer);
        maxTimer = null;
        disposeProbe?.();
        disposeProbe = null;
        for (const t of stream?.getTracks() ?? []) t.stop();
        stream = null;
      };
      const end = (): void => {
        if (ended) return;
        ended = true;
        release();
        h.onEnd();
      };

      const upload = async (mime: string): Promise<void> => {
        if (aborted) return end();
        if (bytes === 0) return end();
        if (bytes > (deps.maxBytes ?? 25 * 1024 * 1024)) {
          h.onError?.({ kind: "too-long", message: "That recording is too long to transcribe. Say less at a time." });
          return end();
        }
        h.onProcessing?.();
        const url = opts.language !== undefined && opts.language !== "" ? `${deps.url}?language=${encodeURIComponent(opts.language)}` : deps.url;
        try {
          const res = await deps.fetch(url, {
            method: "POST",
            headers: { "content-type": mime },
            body: new Blob(chunks, { type: mime }),
            signal: abortCtl.signal,
          });
          if (aborted) return end();
          if (!res.ok) {
            h.onError?.({ kind: "server", message: await errorText(res, "Transcription failed") });
            return end();
          }
          const body: unknown = await res.json();
          const text = typeof body === "object" && body !== null && "text" in body ? String((body as { text: unknown }).text) : "";
          if (text.trim() !== "") h.onFinal?.(text.trim());
        } catch (cause) {
          if (!aborted) h.onError?.({ kind: "network", message: `Could not reach Cortex to transcribe${causeMessage(cause) ? `: ${causeMessage(cause)}` : "."}` });
        }
        end();
      };

      const finish = (): void => {
        if (recorder !== null && !ended) recorder.stop();
        else end();
      };

      void (async () => {
        if (deps.getUserMedia === undefined || deps.Recorder === undefined) {
          h.onError?.({ kind: "unsupported", message: "This browser cannot record audio." });
          return end();
        }
        try {
          stream = await deps.getUserMedia();
        } catch (cause) {
          h.onError?.(micError(cause));
          return end();
        }
        if (aborted || stopRequested) return end();
        const rec = new deps.Recorder(stream);
        recorder = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
            bytes += e.data.size;
          }
        };
        rec.onerror = () => {
          h.onError?.({ kind: "other", message: "Recording failed." });
          end();
        };
        rec.onstop = () => {
          release();
          void upload(rec.mimeType !== "" ? rec.mimeType : "audio/webm");
        };
        disposeProbe = deps.probe?.(stream, () => h.onActivity?.()) ?? null;
        maxTimer = setTimeout(finish, (deps.maxSeconds ?? 120) * 1000);
        rec.start(250);
      })();

      return {
        stop: () => {
          stopRequested = true;
          finish();
        },
        abort: () => {
          aborted = true;
          abortCtl.abort();
          if (recorder !== null) recorder.onstop = null;
          end();
        },
      };
    },
  };
}

/** The slice of an `HTMLAudioElement` the engine plays through. */
export interface AudioLike {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onplaying: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

/** Dependencies of {@link createRemoteTts}. */
export interface RemoteTtsDeps {
  readonly id?: string;
  readonly label?: string;
  /** Route that takes `{ text, voice?, speed? }` and answers audio. */
  readonly speakUrl: string;
  /** Route that answers `{ voices }`. */
  readonly voicesUrl: string;
  readonly fetch: VoiceFetch;
  readonly createAudio: ((src: string) => AudioLike) | undefined;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

const CACHE_LIMIT = 6;

/** Speaking through a server route: the server synthesizes, the browser plays. */
export function createRemoteTts(deps: RemoteTtsDeps): TtsEngine {
  return exclusive(createRemoteTtsUnguarded(deps));
}

function createRemoteTtsUnguarded(deps: RemoteTtsDeps): TtsEngine {
  type Fetched = { readonly ok: true; readonly blob: Blob } | { readonly ok: false; readonly error: TtsError };
  const cache = new Map<string, { promise: Promise<Fetched>; ctl: AbortController }>();

  const fetchAudio = (text: string, o: TtsSpeakOptions): { promise: Promise<Fetched>; ctl: AbortController } => {
    const key = `${o.voice ?? ""}|${o.rate ?? 1}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const ctl = new AbortController();
    const promise = (async (): Promise<Fetched> => {
      try {
        const res = await deps.fetch(deps.speakUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, ...(o.voice !== undefined && o.voice !== "" ? { voice: o.voice } : {}), speed: o.rate ?? 1 }),
          signal: ctl.signal,
        });
        if (!res.ok) return { ok: false, error: { kind: "server", message: await errorText(res, "Speech synthesis failed") } };
        return { ok: true, blob: await res.blob() };
      } catch (cause) {
        const message = `Could not reach Cortex for speech${causeMessage(cause) ? `: ${causeMessage(cause)}` : "."}`;
        return { ok: false, error: { kind: "network", message } };
      }
    })();
    const entry = { promise, ctl };
    cache.set(key, entry);
    void promise.then((r) => {
      if (!r.ok) cache.delete(key);
    });
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.get(oldest)?.ctl.abort();
      cache.delete(oldest);
    }
    return entry;
  };

  return {
    id: deps.id ?? "server",
    label: deps.label ?? "Server (OpenAI-compatible)",
    available: () =>
      deps.createAudio !== undefined ? { ok: true } : { ok: false, reason: "This browser cannot play audio." },
    async voices(): Promise<readonly VoiceInfo[]> {
      try {
        const res = await deps.fetch(deps.voicesUrl);
        if (!res.ok) return [];
        const body: unknown = await res.json();
        if (typeof body === "object" && body !== null && "voices" in body && Array.isArray((body as { voices: unknown }).voices)) {
          return (body as { voices: VoiceInfo[] }).voices;
        }
      } catch {
        /* no list: the server's default voice is used */
      }
      return [];
    },
    prefetch(text, o) {
      if (text.trim() !== "") void fetchAudio(text, o);
    },
    speak(text: string, o: TtsSpeakOptions, h: TtsHandlers): TtsHandle {
      let cancelled = false;
      let audio: AudioLike | null = null;
      let url: string | null = null;
      let paused = false;
      const cleanup = (): void => {
        if (url !== null) deps.revokeObjectURL(url);
        url = null;
      };
      const fail = (error: TtsError): void => {
        if (!cancelled) h.onError(error);
      };
      void (async () => {
        try {
          const fetched = await fetchAudio(text, o).promise;
          if (cancelled) return;
          if (!fetched.ok) return fail(fetched.error);
          if (deps.createAudio === undefined) return fail({ kind: "unsupported", message: "This browser cannot play audio." });
          url = deps.createObjectURL(fetched.blob);
          const a = deps.createAudio(url);
          audio = a;
          a.onplaying = () => {
            if (!cancelled) h.onStart?.();
          };
          a.onended = () => {
            cleanup();
            if (!cancelled) h.onEnd();
          };
          a.onerror = () => {
            cleanup();
            fail({ kind: "playback", message: "The audio could not be played." });
          };
          await a.play();
        } catch (cause) {
          if (cancelled) return;
          const name = typeof cause === "object" && cause !== null && "name" in cause ? String((cause as { name: unknown }).name) : "";
          // play() was interrupted (pause(), element removed, source swapped): a normal stop, not a failure.
          // A user pause stays paused; any other interruption ends the utterance so a queue moves on.
          if (name === "AbortError") {
            cleanup();
            if (!paused) h.onEnd();
            return;
          }
          if (name === "NotAllowedError") return fail({ kind: "playback", message: "The browser blocked audio until you interact with the page. Press play again." });
          // Anything else thrown once the audio exists is a playback problem, not an unreachable server.
          if (audio !== null) return fail({ kind: "playback", message: "The audio could not be played." });
          fail({ kind: "network", message: `Could not reach Cortex for speech${causeMessage(cause) ? `: ${causeMessage(cause)}` : "."}` });
        }
      })();
      return {
        pause: () => {
          paused = true;
          audio?.pause();
        },
        resume: () => {
          paused = false;
          void audio?.play().catch(() => undefined);
        },
        cancel: () => {
          cancelled = true;
          audio?.pause();
          cleanup();
        },
      };
    },
  };
}
