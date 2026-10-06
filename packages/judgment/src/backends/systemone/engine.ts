/**
 * Shared System One HTTP protocol engine.
 *
 * A `SystemOneProviderDescriptor` describes a provider's endpoint, limits, and
 * small wire-policy hooks; `makeSystemOneHttpBackend` turns it into a full
 * `JudgmentBackend`. Encoding/decoding is delegated to `wire.ts` so this file
 * stays focused on transport, limits, and error mapping.
 */

import { Effect } from "effect";
import {
  JudgmentBadResponse,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentTimeout,
  JudgmentUnauthorized,
  JudgmentUnsupported,
  type JudgmentBackend,
  type JudgmentCapabilities,
  type JudgmentEntry,
  type JudgmentError,
  type QuestionSpecs,
} from "../../types.js";
import { decodeSystemOneAnswers, encodeSystemOneRequest } from "./wire.js";

/** A System One-compatible provider wired to the shared HTTP engine. */
export interface SystemOneProviderDescriptor {
  /** Backend label. Surfaces in events and traces. */
  readonly name: string;
  /** Path appended to the resolved endpoint. Defaults to "/v1/systemone". */
  readonly path?: string;
  /** Resolve the base URL from an explicit config value and provider conventions. */
  readonly resolveEndpoint: (explicit?: string) => string;
  /** Model used when neither the call nor the config supplies one. */
  readonly defaultModel: string;
  /** Per-request timeout when config.timeoutMs is absent. */
  readonly defaultTimeoutMs: number;
  /** Wire-protocol limits enforced before the request (spec §6). */
  readonly limits: {
    readonly minQuestions: number;
    readonly maxQuestions: number;
    readonly minCriteria: number;
    readonly maxCriteria: number;
    /** Max serialized body bytes with no images. */
    readonly maxBodyBytes?: number;
    /** Present when the endpoint accepts the optional top-level images array. */
    readonly images?: {
      readonly maxBodyBytes: number;
      readonly max?: number;
    };
  };
  /** Optional auth/identity headers, closing over config. */
  readonly headers?: (config: SystemOneHttpConfig) => Record<string, string>;
  /** Extra request-body fields merged after encoding. */
  readonly extraBodyFields?: (config: SystemOneHttpConfig) => Record<string, unknown>;
  /** Optional remediation hint appended to mapped HTTP errors. */
  readonly describeHttpError?: (ctx: {
    readonly status: number;
    readonly body: string;
    readonly model: string;
  }) => string | undefined;
}

/** Runtime config for the engine, including test seams. */
export interface SystemOneHttpConfig {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
}

const isTimeoutError = (cause: unknown): cause is Error & { readonly name: "TimeoutError" } =>
  cause instanceof Error && cause.name === "TimeoutError";

const toJudgmentError =
  (timeoutMs: number) =>
  (cause: unknown): JudgmentError => {
    if (isTimeoutError(cause)) {
      return new JudgmentTimeout({ message: cause.message, timeoutMs });
    }
    return new JudgmentConnectionError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  };

const parseRetryAfterMs = (headers: Headers): number | undefined => {
  const retryAfterMs = headers.get("retry-after-ms");
  if (retryAfterMs !== null) {
    const parsed = Number(retryAfterMs);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const retryAfter = headers.get("Retry-After");
  if (retryAfter !== null) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed)) {
      return parsed * 1000;
    }
  }

  return undefined;
};

const buildHttpError = (
  response: Response,
  bodyText: string,
  model: string,
  descriptor: SystemOneProviderDescriptor,
): JudgmentError => {
  const { status } = response;
  const truncated = bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText;
  const hint = descriptor.describeHttpError?.({ status, body: bodyText, model });
  const message = hint ? `HTTP ${status}: ${truncated} (${hint})` : `HTTP ${status}: ${truncated}`;

  if (status === 401 || status === 403) {
    return new JudgmentUnauthorized({ message });
  }

  if (status === 429) {
    return new JudgmentRateLimited({
      message,
      retryAfterMs: parseRetryAfterMs(response.headers),
    });
  }

  return new JudgmentBadResponse({ message });
};

const enforceLimits = (
  descriptor: SystemOneProviderDescriptor,
  questions: QuestionSpecs,
  images: readonly string[] | undefined,
): Effect.Effect<void, JudgmentUnsupported> => {
  const { limits, name } = descriptor;
  const ids = Object.keys(questions);
  const count = ids.length;

  if (count < limits.minQuestions || count > limits.maxQuestions) {
    return Effect.fail(
      new JudgmentUnsupported({
        message: `${name} supports ${limits.minQuestions}..${limits.maxQuestions} questions, got ${count}`,
      }),
    );
  }

  for (const id of ids) {
    if (id.trim().length === 0) {
      return Effect.fail(
        new JudgmentUnsupported({
          message: `${name}: question key must be non-blank, got "${id}"`,
        }),
      );
    }

    const spec = questions[id];
    if (spec === undefined) {
      continue;
    }

    if (spec.type === "choice") {
      const labels = Object.keys(spec.criteria);
      if (labels.length < limits.minCriteria || labels.length > limits.maxCriteria) {
        return Effect.fail(
          new JudgmentUnsupported({
            message: `${name}: question "${id}" choice criteria count ${labels.length} outside ${limits.minCriteria}..${limits.maxCriteria}`,
          }),
        );
      }
      for (const label of labels) {
        if (label.trim().length === 0) {
          return Effect.fail(
            new JudgmentUnsupported({
              message: `${name}: question "${id}" choice label must be non-blank, got "${label}"`,
            }),
          );
        }
      }
    } else if (spec.type === "score") {
      const levels = spec.criteria.length;
      if (levels < limits.minCriteria || levels > limits.maxCriteria) {
        return Effect.fail(
          new JudgmentUnsupported({
            message: `${name}: question "${id}" score criteria count ${levels} outside ${limits.minCriteria}..${limits.maxCriteria}`,
          }),
        );
      }
    }
  }

  if (images !== undefined && images.length > 0) {
    if (limits.images === undefined) {
      return Effect.fail(
        new JudgmentUnsupported({
          message: `${name}: images are not supported`,
        }),
      );
    }
    if (limits.images.max !== undefined && images.length > limits.images.max) {
      return Effect.fail(
        new JudgmentUnsupported({
          message: `${name}: images count ${images.length} exceeds maximum ${limits.images.max}`,
        }),
      );
    }
  }

  return Effect.void;
};

const measureBody = (
  descriptor: SystemOneProviderDescriptor,
  images: readonly string[] | undefined,
  body: string,
): Effect.Effect<void, JudgmentUnsupported> => {
  const { limits, name } = descriptor;
  const hasImages = images !== undefined && images.length > 0;
  const ceiling = hasImages ? limits.images?.maxBodyBytes : limits.maxBodyBytes;

  if (ceiling === undefined) {
    return Effect.void;
  }

  const bytes = new TextEncoder().encode(body).length;
  if (bytes > ceiling) {
    const ceilingLabel = hasImages ? "images" : "text";
    return Effect.fail(
      new JudgmentUnsupported({
        message: `${name}: serialized body ${bytes} bytes exceeds ${ceilingLabel} ceiling ${ceiling}`,
      }),
    );
  }

  return Effect.void;
};

/**
 * Build a `JudgmentBackend` from a System One provider descriptor.
 *
 * The returned backend enforces descriptor.limits before encoding, serializes
 * the request once, and maps HTTP/fetch failures onto the existing
 * `JudgmentError` union.
 */
export const makeSystemOneHttpBackend = (
  descriptor: SystemOneProviderDescriptor,
  config: SystemOneHttpConfig = {},
): JudgmentBackend => {
  const { limits, name } = descriptor;

  const capabilities: JudgmentCapabilities = {
    maxQuestions: limits.maxQuestions,
    supportedKinds: ["noul", "choice", "score"],
    distributions: true,
    calibrated: true,
    images: limits.images !== undefined,
    modelCatalog: false,
  };

  return {
    name,
    capabilities,
    evaluate: ({ state, questions, model: callModel, images }) => {
      const model = callModel ?? config.model ?? descriptor.defaultModel;
      const timeoutMs = config.timeoutMs ?? descriptor.defaultTimeoutMs;
      const url = `${descriptor.resolveEndpoint(config.baseUrl)}${descriptor.path ?? "/v1/systemone"}`;

      const baseHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const descriptorHeaders = descriptor.headers?.(config) ?? {};
      const configHeaders = config.headers ?? {};
      const headers = { ...baseHeaders, ...descriptorHeaders, ...configHeaders };

      const fetch_ = config.fetch ?? globalThis.fetch;

      return enforceLimits(descriptor, questions, images).pipe(
        Effect.map(() =>
          encodeSystemOneRequest({
            model,
            state,
            questions,
            images: images?.length ? images : undefined,
          }),
        ),
        Effect.map((encoded) => {
          const extra = descriptor.extraBodyFields?.(config) ?? {};
          return { ...encoded, ...extra };
        }),
        Effect.flatMap((bodyObj) => {
          const body = JSON.stringify(bodyObj);
          return measureBody(descriptor, images, body).pipe(Effect.map(() => body));
        }),
        Effect.flatMap((body) =>
          Effect.tryPromise({
            try: () =>
              fetch_(url, {
                method: "POST",
                headers,
                body,
                signal: AbortSignal.timeout(timeoutMs),
              }),
            catch: toJudgmentError(timeoutMs),
          }),
        ),
        Effect.flatMap((response) => {
          if (!response.ok) {
            return Effect.tryPromise({
              try: () => response.text(),
              catch: (cause) =>
                new JudgmentBadResponse({
                  message: `HTTP ${response.status}: ${cause instanceof Error ? cause.message : String(cause)}`,
                }),
            }).pipe(
              Effect.flatMap((bodyText) =>
                Effect.fail(buildHttpError(response, bodyText, model, descriptor)),
              ),
            );
          }

          return Effect.tryPromise({
            try: () => response.json(),
            catch: (cause) =>
              new JudgmentBadResponse({
                message: `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
              }),
          }).pipe(Effect.flatMap((json) => decodeSystemOneAnswers(json, questions)));
        }),
      );
    },
  };
};
