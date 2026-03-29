import { ref, readonly } from "vue";

export function useAgent(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body">,
) {
  const output = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function run(prompt: string, body?: Record<string, unknown>): Promise<string> {
    loading.value = true;
    error.value = null;
    output.value = null;
    try {
      const res = await fetch(endpoint, {
        ...requestInit,
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestInit?.headers },
        body: JSON.stringify({ prompt, ...body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { output?: string; result?: string };
      const result = data.output ?? data.result ?? "";
      output.value = result;
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { output: readonly(output), loading: readonly(loading), error: readonly(error), run };
}
