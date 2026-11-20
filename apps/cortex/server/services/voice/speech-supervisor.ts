/**
 * Keeps a local Speaches (OpenAI-compatible speech) container running for Settings · Voice.
 *
 * Keep-running is opt-in (`localSpeech.keepRunning`, default off, set through `POST /api/voice/local/keep-running`).
 * When on, Cortex checks the endpoint at startup, when voice is used, and on a timer; if it is
 * down it starts the existing container, else creates it, then downloads the configured models
 * through the server's own model API. Docker itself restarts it after a crash or reboot
 * (`--restart unless-stopped`). Switching it off stops the container (`docker stop`; it is kept for
 * a fast restart). Start and Stop also work by hand with keep-running off (`startServer`, `stopServer`).
 * Port and hardware (`localSpeech.port`, `localSpeech.device`) change through `configure`, which
 * re-creates the Cortex container when it runs on another port or image.
 *
 * This runs `docker` on the owner's machine, so the surface is fixed in code, not in settings:
 * - only a loopback endpoint (`localhost`, `127.0.0.1`, `::1`) with an explicit port and a `/v1` path;
 *   Cortex calls it as `127.0.0.1` whatever loopback form was typed, because the container is
 *   published on IPv4 loopback only (`[::1]` and an IPv6-first `localhost` would be refused);
 * - one container name (`cortex-speaches`) and two allowlisted image tags, never from input;
 * - argv arrays through the injected `DockerRunner` (real = `execFile`, no shell);
 * - the port is published as `127.0.0.1:<port>:8000`; no privileged flags; the only mount is the
 *   named Hugging Face cache volume; `--gpus all` only with the GPU image and an nvidia runtime in `docker info`;
 * - a container that carries the name but not an allowlisted image is never touched (not started,
 *   stopped or removed); one with an allowlisted image is Cortex's own, so on another port or image
 *   it is removed (`docker rm -f cortex-speaches`) and created again (models stay in the cache volume);
 * - single-flight, 3 attempts with exponential backoff, then `failed` until Retry;
 * - docker's stderr never leaves here beyond a scrubbed 300-character tail.
 *
 * Free space for the model cache is measured with `docker exec cortex-speaches df -Pk <cache>`, only on
 * Cortex's own running container (rules and wording: `speech-disk.ts`). A download is refused below
 * `MIN_FREE_FOR_DOWNLOAD_BYTES`, and a failed download or docker call that reads as ENOSPC (or a 5xx
 * with the cache nearly full) is reported as Docker's disk being full.
 */
import { execFile } from "node:child_process";
import { diskFullSentence, isDiskFullText, MIN_FREE_FOR_DOWNLOAD_BYTES, parseDfAvailableBytes } from "./speech-disk.js";
import { applyLocalSpeechConfig, type LocalSpeechConfigPatch } from "./local-speech-config.js";
import { NO_LOCAL_ENDPOINT, resolveSpeechTarget, type SpeechTarget } from "./speech-target.js";
import type { LocalSpeechDevice, VoiceSettings } from "./voice-settings.js";

export { resolveSpeechTarget, supervisedBaseUrl, type SpeechTarget } from "./speech-target.js";

/** The one container Cortex creates and manages. (A hand-made `speaches` container is never touched.) */
export const SPEECH_CONTAINER = "cortex-speaches";
/** The only images Cortex will run. */
export const SPEECH_IMAGES = {
  cpu: "ghcr.io/speaches-ai/speaches:latest-cpu",
  cuda: "ghcr.io/speaches-ai/speaches:latest-cuda",
} as const;
/** Named volume that caches downloaded models across container re-creations. */
export const SPEECH_CACHE_VOLUME = "hf-hub-cache";
const CACHE_MOUNT = "/home/ubuntu/.cache/huggingface/hub";
/** Port the Speaches image listens on inside the container. */
const INNER_PORT = 8000;
/** Failed attempts before the supervisor stops until Retry. */
export const MAX_ATTEMPTS = 3;

/** Result of one docker call. `spawnError` is set when `docker` could not be started at all. */
export interface DockerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError?: "not-found" | "permission" | "other";
}

/** The seam to docker. Real: `execDockerRunner`. Tests pass a fake. Arguments are argv entries, never a shell string. */
export interface DockerRunner {
  run(args: readonly string[], timeoutMs: number): Promise<DockerResult>;
}

/** Runs the `docker` binary with `execFile` (no shell). */
export const execDockerRunner: DockerRunner = {
  run: (args, timeoutMs) =>
    new Promise<DockerResult>((resolve) => {
      execFile("docker", [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err === null) return resolve({ code: 0, stdout, stderr });
        const code: unknown = (err as { code?: unknown }).code;
        if (code === "ENOENT") return resolve({ code: -1, stdout, stderr, spawnError: "not-found" });
        if (code === "EACCES") return resolve({ code: -1, stdout, stderr, spawnError: "permission" });
        if (typeof code === "number") return resolve({ code, stdout, stderr });
        return resolve({ code: -1, stdout, stderr: stderr || err.message, spawnError: "other" });
      });
    }),
};

/**
 * Where the supervisor is. `disabled`: keep-running off and nothing done by hand. `unavailable`: no
 * local Speaches endpoint to supervise. `stopping` / `stopped`: Stop, or keep-running switched off.
 */
export type SpeechPhase = "disabled" | "unavailable" | "checking" | "starting" | "downloading" | "ready" | "stopping" | "stopped" | "failed";

/** Body of `GET /api/voice/local/status`. */
export interface SpeechStatus {
  readonly phase: SpeechPhase;
  /** The opt-in. */
  readonly keepRunning: boolean;
  /** A local Speaches endpoint is configured, so the opt-in can be offered. */
  readonly eligible: boolean;
  /** One plain sentence for the person (never docker output). */
  readonly message: string;
  /** Scrubbed last failure, or null. */
  readonly lastError: string | null;
  readonly attempts: number;
  /** Three failures in a row: nothing runs again until Retry. */
  readonly locked: boolean;
  readonly container: string;
  /** `127.0.0.1:<port>` being supervised, or null. */
  readonly endpoint: string | null;
  readonly models: readonly string[];
  /** The port the server is (or will be) published on: the supervised endpoint's, else the saved `localSpeech.port`. */
  readonly port: number;
  /** Saved hardware choice. */
  readonly device: LocalSpeechDevice;
  /** The server answered its health check at the last look; `null` = not looked yet. */
  readonly running: boolean | null;
  /**
   * Free space in the model cache as the container sees it (on Docker Desktop: Docker's VM disk, not the
   * computer's), at the last measure; `null` = not measured (no own running container, or docker not allowed).
   */
  readonly cache: { readonly freeBytes: number; readonly checkedAt: number } | null;
}

/** A refusal sentence, or the status after the action started. */
export type SpeechAction = { readonly ok: true; readonly status: SpeechStatus } | { readonly ok: false; readonly error: string };

/** Control characters out, whitespace collapsed, last 300 characters. */
export function scrubDockerText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `…${flat.slice(-299)}` : flat;
}

function dockerProblem(r: DockerResult): string {
  if (isDiskFullText(r.stderr)) return diskFullSentence(null);
  if (r.spawnError === "not-found") return "Docker was not found on this machine. Install Docker, or start the speech server yourself.";
  if (r.spawnError === "permission" || /permission denied/i.test(r.stderr)) {
    return "Docker refused access (permission denied). Add your user to the docker group or start Docker, then press Retry.";
  }
  if (/cannot connect to the docker daemon|is the docker daemon running|error during connect/i.test(r.stderr)) {
    return "The Docker daemon is not running. Start Docker, then press Retry.";
  }
  const tail = scrubDockerText(r.stderr || r.stdout);
  return tail === "" ? "Docker failed without a message." : `Docker failed: ${tail}`;
}

/** Everything the supervisor reads or calls; every field but `settings` and `docker` has a default. */
export interface SpeechSupervisorDeps {
  readonly settings: { get(): VoiceSettings; set(settings: VoiceSettings): boolean };
  readonly docker: DockerRunner;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the server to answer after docker started it. Default 120 s. */
  readonly healthWaitMs?: number;
  /** First backoff after a failed attempt; doubles each time. Default 10 s. */
  readonly backoffBaseMs?: number;
  /** Timer period while enabled. Default 60 s. */
  readonly intervalMs?: number;
}

/** Why `ensure` ran. `manual` (Retry, enabling) ignores the backoff and the attempt cap. */
export type EnsureReason = "startup" | "timer" | "use" | "manual";

/** The supervisor. One per Cortex server. */
export interface SpeechSupervisor {
  status(): SpeechStatus;
  /**
   * Look whether the server answers (throttled, skipped while work runs), then the status. With
   * `measureDisk` (the caller may run docker) and the server up, also measures the model cache's free
   * space, at most once a minute; otherwise no docker.
   */
  probe(opts?: { readonly measureDisk?: boolean }): Promise<SpeechStatus>;
  /** Bring the server up if it is down. Single-flight; resolves with the final status. A no-op while the opt-in is off. */
  ensure(reason: EnsureReason): Promise<SpeechStatus>;
  /** Save the opt-in and forget past failures. On: start an `ensure`. Off: stop the Cortex container (resolves after the stop). */
  setKeepRunning(enabled: boolean): Promise<SpeechAction>;
  /** Start the server now, keep-running or not (work continues in the background; `settled` waits for it). */
  startServer(): SpeechAction;
  /** Stop the Cortex container (`docker stop`) and switch keep-running off, so the timer does not start it again. */
  stopServer(): Promise<SpeechAction>;
  /** Save port / hardware; when the server runs (or keep-running is on) bring it up again on the new settings. */
  configure(patch: LocalSpeechConfigPatch): Promise<SpeechAction>;
  /** Run again after a failure: `ensure("manual")` with keep-running on, else `startServer`. */
  retry(): Promise<SpeechStatus>;
  /** The work in flight, or the status now. */
  settled(): Promise<SpeechStatus>;
  /** True when the opt-in is on and `direction`'s endpoint is the supervised one. */
  supervises(direction: "stt" | "tts"): boolean;
  /** Start a background check if enabled and the last one is old (cheap, for read-only calls). */
  touch(): void;
  /** Check now if enabled and run the timer. */
  start(): void;
  /** Stop the timer. */
  stop(): void;
}

const sleepReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Target = Extract<SpeechTarget, { ok: true }>;
/** `idle`: nothing done since start or the last settings change. */
type InnerPhase = Exclude<SpeechPhase, "disabled" | "unavailable"> | "idle";

/** Build the supervisor. */
export function createSpeechSupervisor(deps: SpeechSupervisorDeps): SpeechSupervisor {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepReal;
  const healthWaitMs = deps.healthWaitMs ?? 120_000;
  const backoffBaseMs = deps.backoffBaseMs ?? 10_000;
  const intervalMs = deps.intervalMs ?? 60_000;
  const TOUCH_GAP_MS = 15_000;
  const PROBE_GAP_MS = 2_000;

  let phase: InnerPhase = "idle";
  let message = "";
  let lastError: string | null = null;
  let attempts = 0;
  let nextAttemptAt = 0;
  let lastCheckAt = 0;
  let lastProbeAt = Number.NEGATIVE_INFINITY;
  let serverUp: boolean | null = null;
  let policyChecked = false;
  let inflight: Promise<SpeechStatus> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cache: { freeBytes: number; checkedAt: number } | null = null;
  const DISK_GAP_MS = 60_000;

  const keepRunning = (): boolean => deps.settings.get().localSpeech.keepRunning;

  function status(): SpeechStatus {
    const settings = deps.settings.get();
    const target = resolveSpeechTarget(settings);
    const on = settings.localSpeech.keepRunning;
    const shown: SpeechPhase = !target.ok ? "unavailable" : phase === "idle" ? (on ? "checking" : "disabled") : phase;
    const idleMessage = on ? "Checking the local speech server." : "Cortex is not managing the local speech server.";
    return {
      phase: shown,
      keepRunning: on,
      eligible: target.ok,
      message: !target.ok ? target.reason : phase === "idle" ? idleMessage : message,
      lastError: shown === "failed" ? lastError : null,
      attempts,
      locked: attempts >= MAX_ATTEMPTS,
      container: SPEECH_CONTAINER,
      endpoint: target.ok ? new URL(target.origin).host : null,
      models: target.ok ? target.models : [],
      port: target.ok ? target.port : settings.localSpeech.port,
      device: settings.localSpeech.device,
      running: serverUp,
      cache,
    };
  }

  const set = (p: InnerPhase, m: string): void => {
    phase = p;
    message = m;
  };

  const timeoutSignal = (ms: number): AbortSignal => AbortSignal.timeout(ms);

  async function get2xx(url: string, ms = 4000): Promise<Response | null> {
    try {
      const res = await doFetch(url, { signal: timeoutSignal(ms), redirect: "manual" });
      if (res.ok) return res;
      await res.body?.cancel().catch(() => undefined);
      return null;
    } catch {
      return null;
    }
  }

  async function healthy(target: Target): Promise<boolean> {
    const a = await get2xx(`${target.origin}/health`);
    if (a !== null) {
      await a.body?.cancel().catch(() => undefined);
      return true;
    }
    const b = await get2xx(`${target.apiBase}/models`);
    if (b !== null) {
      await b.body?.cancel().catch(() => undefined);
      return true;
    }
    return false;
  }

  async function waitHealthy(target: Target): Promise<boolean> {
    const stepMs = 1000;
    for (let waited = 0; waited <= healthWaitMs; waited += stepMs) {
      if (await healthy(target)) return true;
      await sleep(stepMs);
    }
    return false;
  }

  interface Inspected {
    readonly running: boolean;
    readonly policy: string;
    readonly image: string;
    readonly bindings: string;
  }

  const INSPECT_FORMAT =
    "{{.State.Running}}|{{.HostConfig.RestartPolicy.Name}}|{{.Config.Image}}|{{range $p, $b := .HostConfig.PortBindings}}{{$p}}={{range $b}}{{.HostIp}}:{{.HostPort}},{{end}};{{end}}";

  /** `missing`, an `Inspected`, or a docker problem sentence. */
  async function inspect(): Promise<"missing" | Inspected | { readonly problem: string }> {
    const r = await deps.docker.run(["inspect", "--format", INSPECT_FORMAT, SPEECH_CONTAINER], 15_000);
    if (r.code !== 0) {
      if (r.spawnError === undefined && /no such (object|container)/i.test(r.stderr)) return "missing";
      return { problem: dockerProblem(r) };
    }
    const [running = "", policy = "", image = "", ...rest] = r.stdout.trim().split("|");
    return { running: running === "true", policy, image, bindings: rest.join("|") };
  }

  const isInspected = (x: Awaited<ReturnType<typeof inspect>>): x is Inspected => typeof x === "object" && !("problem" in x);
  /** An allowlisted image: the container is Cortex's own (a name alone is not enough). */
  const ownImage = (image: string): boolean => image === SPEECH_IMAGES.cpu || image === SPEECH_IMAGES.cuda;
  const ownBinding = (bindings: string, port: number): boolean => bindings.includes(`${INNER_PORT}/tcp=127.0.0.1:${port},;`);
  const fitsDevice = (image: string, device: LocalSpeechDevice): boolean => (device === "auto" ? ownImage(image) : image === SPEECH_IMAGES[device]);

  async function ensurePolicy(i: Inspected): Promise<void> {
    if (i.policy === "unless-stopped" || i.policy === "always") return;
    // Best effort: the container is up either way.
    await deps.docker.run(["update", "--restart", "unless-stopped", SPEECH_CONTAINER], 15_000);
  }

  /** Create the container for `target`. Returns a problem sentence, or undefined when docker accepted it. */
  async function create(target: Target, device: LocalSpeechDevice): Promise<string | undefined> {
    let gpu = false;
    if (device !== "cpu") {
      const info = await deps.docker.run(["info", "--format", "{{json .Runtimes}}"], 15_000);
      if (info.code !== 0 && info.spawnError !== undefined) return dockerProblem(info);
      gpu = info.code === 0 && /"nvidia"/.test(info.stdout);
      if (device === "cuda" && !gpu) {
        return "Docker lists no NVIDIA runtime, so the GPU image cannot reach the GPU. Choose CPU or Auto, or install the NVIDIA Container Toolkit, then press Retry.";
      }
    }
    const image = gpu ? SPEECH_IMAGES.cuda : SPEECH_IMAGES.cpu;
    const args = [
      "run",
      "--detach",
      "--name",
      SPEECH_CONTAINER,
      "--restart",
      "unless-stopped",
      "--publish",
      `127.0.0.1:${target.port}:${INNER_PORT}`,
      "--volume",
      `${SPEECH_CACHE_VOLUME}:${CACHE_MOUNT}`,
      ...(gpu ? ["--gpus", "all"] : []),
      image,
    ];
    // An image pull can take minutes.
    const run = await deps.docker.run(args, 15 * 60_000);
    return run.code === 0 ? undefined : dockerProblem(run);
  }

  /** Remove Cortex's own container and create it again (port or image changed). Callers check `ownImage` first. */
  async function recreate(target: Target, device: LocalSpeechDevice): Promise<string | undefined> {
    const rm = await deps.docker.run(["rm", "--force", SPEECH_CONTAINER], 60_000);
    if (rm.code !== 0) return dockerProblem(rm);
    return create(target, device);
  }

  /** Start, re-create or create the container. Returns a problem sentence, or undefined when docker accepted the start. */
  async function bringUp(target: Target): Promise<string | undefined> {
    const device = deps.settings.get().localSpeech.device;
    const found = await inspect();
    if (found === "missing") return create(target, device);
    if (!isInspected(found)) return found.problem;
    if (!ownImage(found.image)) {
      return `A container named ${SPEECH_CONTAINER} already exists but is not the Cortex speech server (its image is not one Cortex runs), so Cortex leaves it alone. Remove or rename it: docker rm -f ${SPEECH_CONTAINER}`;
    }
    if (!ownBinding(found.bindings, target.port) || !fitsDevice(found.image, device)) return recreate(target, device);
    if (!found.running) {
      const s = await deps.docker.run(["start", SPEECH_CONTAINER], 60_000);
      if (s.code !== 0) return dockerProblem(s);
    }
    await ensurePolicy(found);
    return undefined;
  }

  /**
   * The server answers: check once (after start or a settings change) that Cortex's own container
   * has a restart policy and runs the chosen image; re-create it when the hardware changed.
   * Returns a problem sentence, or undefined.
   */
  async function checkRunning(target: Target): Promise<string | undefined> {
    if (policyChecked) return undefined;
    policyChecked = true;
    const found = await inspect();
    if (!isInspected(found) || !ownImage(found.image)) return undefined;
    const device = deps.settings.get().localSpeech.device;
    if (found.running && ownBinding(found.bindings, target.port) && !fitsDevice(found.image, device)) {
      set("starting", "Switching the local speech server to the chosen hardware.");
      const problem = await recreate(target, device);
      if (problem !== undefined) return problem;
      return (await waitHealthy(target)) ? undefined : "The speech server did not answer after its container was re-created. First start can take a while (image download); press Retry to keep waiting.";
    }
    await ensurePolicy(found);
    return undefined;
  }

  async function installedModels(target: Target): Promise<ReadonlySet<string> | null> {
    const res = await get2xx(`${target.apiBase}/models`, 15_000);
    if (res === null) return null;
    try {
      const body: unknown = await res.json();
      const data = typeof body === "object" && body !== null && "data" in body ? (body as { data: unknown }).data : [];
      const ids = Array.isArray(data) ? data.map((m) => (typeof m === "object" && m !== null && "id" in m ? (m as { id: unknown }).id : null)) : [];
      return new Set(ids.filter((id): id is string => typeof id === "string"));
    } catch {
      return null;
    }
  }

  /**
   * Free bytes in the model cache inside Cortex's own running container (`docker exec ... df -Pk`), or
   * `null` when it cannot be measured. Never runs in a container Cortex does not own.
   */
  async function measureCache(): Promise<number | null> {
    const found = await inspect();
    if (!isInspected(found) || !ownImage(found.image) || !found.running) return null;
    const r = await deps.docker.run(["exec", SPEECH_CONTAINER, "df", "-Pk", CACHE_MOUNT], 10_000);
    const free = r.code === 0 ? parseDfAvailableBytes(r.stdout) : null;
    if (free !== null) cache = { freeBytes: free, checkedAt: now() };
    return free;
  }

  /** A download error body, capped and scrubbed (only matched against, never shown). */
  async function errorText(res: Response): Promise<string> {
    try {
      return scrubDockerText((await res.text()).slice(0, 4000));
    } catch {
      return "";
    }
  }

  /** Download what the server lacks. Returns a problem sentence, or undefined. */
  async function ensureModels(target: Target): Promise<string | undefined> {
    const have = await installedModels(target);
    if (have === null) return "The speech server is up but did not list its models.";
    const missing = target.models.filter((m) => !have.has(m));
    if (missing.length === 0) return undefined;
    const before = await measureCache();
    if (before !== null && before < MIN_FREE_FOR_DOWNLOAD_BYTES) return diskFullSentence(before);
    /** After a failed download: ENOSPC in the text, or a server-side failure with the cache nearly full, names the cause; else `fallback`. */
    const failed = async (fallback: string, text: string, serverSide: boolean): Promise<string> => {
      const free = await measureCache();
      if (isDiskFullText(text) || (serverSide && free !== null && free < MIN_FREE_FOR_DOWNLOAD_BYTES)) return diskFullSentence(free);
      return fallback;
    };
    for (const [i, model] of missing.entries()) {
      set("downloading", `Downloading model ${i + 1} of ${missing.length}: ${model}`);
      const url = `${target.apiBase}/models/${model.split("/").map(encodeURIComponent).join("/")}`;
      try {
        const res = await doFetch(url, { method: "POST", signal: timeoutSignal(15 * 60_000), redirect: "manual" });
        if (!res.ok) return failed(`Downloading ${model} failed (the speech server answered HTTP ${res.status}).`, await errorText(res), res.status >= 500);
        await res.body?.cancel().catch(() => undefined);
      } catch (e) {
        // A dropped connection or the time limit: the server may have died on a full disk.
        return failed(`Downloading ${model} failed (the speech server did not finish in time).`, String(e), true);
      }
    }
    return undefined;
  }

  function fail(problem: string): SpeechStatus {
    attempts += 1;
    lastError = scrubDockerText(problem);
    nextAttemptAt = now() + backoffBaseMs * 2 ** (attempts - 1);
    set("failed", attempts >= MAX_ATTEMPTS ? "The local speech server could not be started. Fix the problem, then press Retry." : "The local speech server is not ready yet; Cortex will try again shortly.");
    return status();
  }

  async function run(target: Target): Promise<SpeechStatus> {
    lastCheckAt = now();
    if (phase !== "ready") set("checking", "Checking the local speech server.");
    let up = await healthy(target);
    serverUp = up;
    if (!up) {
      set("starting", "Starting the local speech server.");
      const problem = await bringUp(target);
      if (problem !== undefined) return fail(problem);
      up = await waitHealthy(target);
      serverUp = up;
      if (!up) return fail("The speech server did not answer after its container started. First start can take a while (image download); press Retry to keep waiting.");
      policyChecked = true;
    } else {
      const problem = await checkRunning(target);
      if (problem !== undefined) return fail(problem);
    }
    const problem = await ensureModels(target);
    if (problem !== undefined) return fail(problem);
    attempts = 0;
    lastError = null;
    nextAttemptAt = 0;
    serverUp = true;
    set("ready", "The local speech server is running.");
    return status();
  }

  /** Run `task` after the work in flight (if any); it becomes the work in flight. */
  function exclusive(task: () => Promise<SpeechStatus>): Promise<SpeechStatus> {
    const prior = inflight;
    const p: Promise<SpeechStatus> = (prior === null ? Promise.resolve() : prior.then(() => undefined, () => undefined)).then(task).finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  }

  /** Bring `target` up, joining the work in flight. */
  function launch(target: Target): Promise<SpeechStatus> {
    return inflight ?? exclusive(() => run(target));
  }

  async function stopContainer(): Promise<SpeechStatus> {
    set("stopping", "Stopping the local speech server.");
    const target = resolveSpeechTarget(deps.settings.get());
    const found = await inspect();
    if (!isInspected(found) && found !== "missing") {
      lastError = scrubDockerText(found.problem);
      set("failed", "The local speech server could not be stopped.");
      return status();
    }
    let note = "The local speech server is stopped.";
    if (found === "missing") note = "Cortex has no speech server container to stop.";
    else if (!ownImage(found.image)) note = `The container named ${SPEECH_CONTAINER} is not one Cortex runs, so Cortex left it alone.`;
    else if (found.running) {
      const r = await deps.docker.run(["stop", SPEECH_CONTAINER], 60_000);
      if (r.code !== 0) {
        lastError = scrubDockerText(dockerProblem(r));
        set("failed", "The local speech server could not be stopped.");
        return status();
      }
    }
    serverUp = target.ok ? await healthy(target) : null;
    lastProbeAt = now();
    if (serverUp === true) note = `${note} A server Cortex did not start still answers on this port.`;
    lastError = null;
    set("stopped", note);
    return status();
  }

  function ensure(reason: EnsureReason): Promise<SpeechStatus> {
    if (inflight !== null) return inflight;
    if (!keepRunning()) return Promise.resolve(status());
    const target = resolveSpeechTarget(deps.settings.get());
    if (!target.ok) return Promise.resolve(status());
    if (reason !== "manual") {
      if (attempts >= MAX_ATTEMPTS) return Promise.resolve(status());
      if (phase === "failed" && now() < nextAttemptAt) return Promise.resolve(status());
    }
    return launch(target);
  }

  function reset(): void {
    phase = "idle";
    message = "";
    lastError = null;
    attempts = 0;
    nextAttemptAt = 0;
    policyChecked = false;
  }

  const saveKeepRunning = (on: boolean): boolean => {
    const s = deps.settings.get();
    return deps.settings.set({ ...s, localSpeech: { ...s.localSpeech, keepRunning: on } });
  };

  function startServer(): SpeechAction {
    const target = resolveSpeechTarget(deps.settings.get());
    if (!target.ok) return { ok: false, error: target.reason };
    attempts = 0;
    nextAttemptAt = 0;
    void launch(target);
    return { ok: true, status: status() };
  }

  async function stopServer(): Promise<SpeechAction> {
    if (keepRunning() && !saveKeepRunning(false)) return { ok: false, error: "Could not save the setting." };
    attempts = 0;
    nextAttemptAt = 0;
    return { ok: true, status: await exclusive(stopContainer) };
  }

  return {
    status,
    async probe(opts) {
      const target = resolveSpeechTarget(deps.settings.get());
      if (!target.ok || inflight !== null || now() - lastProbeAt < PROBE_GAP_MS) return status();
      lastProbeAt = now();
      serverUp = await healthy(target);
      if (opts?.measureDisk === true && serverUp && (cache === null || now() - cache.checkedAt >= DISK_GAP_MS)) await measureCache();
      return status();
    },
    ensure,
    async setKeepRunning(enabled) {
      if (enabled && !resolveSpeechTarget(deps.settings.get()).ok) return { ok: false, error: NO_LOCAL_ENDPOINT };
      if (!saveKeepRunning(enabled)) return { ok: false, error: "Could not save the setting." };
      reset();
      if (enabled) {
        void ensure("manual");
        return { ok: true, status: status() };
      }
      return { ok: true, status: await exclusive(stopContainer) };
    },
    startServer,
    stopServer,
    async configure(patch) {
      const next = applyLocalSpeechConfig(deps.settings.get(), patch);
      if (!next.ok) return { ok: false, error: next.error };
      if (!next.changed) return { ok: true, status: status() };
      if (!deps.settings.set(next.settings)) return { ok: false, error: "Could not save the setting." };
      reset();
      serverUp = null;
      const found = await inspect();
      const ownRunning = isInspected(found) && ownImage(found.image) && found.running;
      const target = resolveSpeechTarget(next.settings);
      // Bring it back on the new port / image when it ran, or when Cortex keeps it running.
      // Queued after any work in flight, which ran on the old settings.
      if (target.ok && (ownRunning || next.settings.localSpeech.keepRunning)) void exclusive(() => run(target));
      return { ok: true, status: status() };
    },
    retry() {
      attempts = 0;
      nextAttemptAt = 0;
      if (keepRunning()) return ensure("manual");
      const target = resolveSpeechTarget(deps.settings.get());
      return target.ok ? launch(target) : Promise.resolve(status());
    },
    settled: () => inflight ?? Promise.resolve(status()),
    supervises(direction) {
      if (!keepRunning()) return false;
      const t = resolveSpeechTarget(deps.settings.get());
      return t.ok && t.directions.includes(direction);
    },
    touch() {
      if (keepRunning() && now() - lastCheckAt >= TOUCH_GAP_MS) void ensure("use");
    },
    start() {
      if (timer !== null) return;
      if (keepRunning()) void ensure("startup");
      timer = setInterval(() => void ensure("timer"), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
