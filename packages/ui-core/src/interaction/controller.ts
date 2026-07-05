import type { FetchLike } from "../stream/connect.js";

/** Uniform result of a client→server durable-rail POST (interaction/approval). */
export interface InteractionResult {
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
}

const postJson = async (
  fetchImpl: FetchLike,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<InteractionResult> => {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { success: boolean; output: string };
    return { success: json.success, output: json.output };
  } catch (err) {
    return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
  }
};

/** Answer a durable `request_user_input` interaction; run resumes server-side. */
export const respondToInteraction = (opts: {
  readonly endpoint: string;
  readonly runId: string;
  readonly interactionId: string;
  readonly value: unknown;
  readonly fetchImpl?: FetchLike;
}): Promise<InteractionResult> =>
  postJson(opts.fetchImpl ?? fetch, opts.endpoint, {
    runId: opts.runId,
    interactionId: opts.interactionId,
    value: opts.value,
  });

/** Approve or deny a durable approval gate; run resumes with the decision. */
export const decideApproval = (opts: {
  readonly endpoint: string;
  readonly runId: string;
  readonly gateId: string;
  readonly decision: "approve" | "deny";
  readonly reason?: string;
  readonly fetchImpl?: FetchLike;
}): Promise<InteractionResult> =>
  postJson(opts.fetchImpl ?? fetch, opts.endpoint, {
    runId: opts.runId,
    gateId: opts.gateId,
    decision: opts.decision,
    reason: opts.reason,
  });
