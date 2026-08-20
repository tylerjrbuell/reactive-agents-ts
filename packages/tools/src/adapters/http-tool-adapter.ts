import { Data } from "effect";

export class HttpToolError extends Data.TaggedError("HttpToolError")<{
  readonly message: string;
  readonly status?: number;
  readonly url: string;
}> {}

export interface HttpToolOptions {
  readonly buildUrl: (args: Record<string, unknown>) => string;
  readonly maxRetries?: number;
  readonly retryOn?: readonly number[];
  readonly emptyResultValue?: unknown;
  readonly headers?: Record<string, string>;
}

const DEFAULT_RETRY_ON = [429, 502, 503, 504];

/**
 * Standard fetch-based tool handler: builds a URL from decoded tool args,
 * retries transient status codes (429/502/503/504 by default) with linear
 * backoff, treats 204/empty-body responses as `emptyResultValue` (or throws
 * if not provided), and raises `HttpToolError` with the status code on any
 * other non-2xx response instead of leaving handlers to invent their own
 * status handling per tool.
 */
export function fetchJsonTool(
  options: HttpToolOptions,
): (args: Record<string, unknown>) => Promise<unknown> {
  const { buildUrl, maxRetries = 2, retryOn = DEFAULT_RETRY_ON, emptyResultValue, headers } = options;

  return async (args: Record<string, unknown>): Promise<unknown> => {
    const url = buildUrl(args);
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, headers ? { headers } : undefined);
      lastStatus = response.status;

      if (response.status === 204 || response.status === 205) {
        if (emptyResultValue !== undefined) return emptyResultValue;
        throw new HttpToolError({ message: `Empty response (${response.status}) with no emptyResultValue configured`, status: response.status, url });
      }

      if (response.ok) {
        const text = await response.text();
        if (text.length === 0) {
          if (emptyResultValue !== undefined) return emptyResultValue;
          throw new HttpToolError({ message: "Empty body on 2xx response with no emptyResultValue configured", status: response.status, url });
        }
        return JSON.parse(text);
      }

      if (retryOn.includes(response.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new HttpToolError({
        message: `Request to ${url} failed with status ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        status: response.status,
        url,
      });
    }

    throw new HttpToolError({ message: `Exhausted retries for ${url}`, status: lastStatus, url });
  };
}
