// OpenAI 호환 chat/completions 호출.
export const llmTimeoutMs = 20_000;

export type LlmResult = { ok: true; text: string } | { ok: false; skipped: boolean };

export function llmConfigured(): boolean {
  return Boolean(process.env.FLOW_LLM_API_KEY && process.env.FLOW_LLM_BASE_URL && process.env.FLOW_LLM_MODEL);
}

export async function complete(prompt: string): Promise<LlmResult> {
  const key = process.env.FLOW_LLM_API_KEY ?? "";
  const base = process.env.FLOW_LLM_BASE_URL ?? "";
  const model = process.env.FLOW_LLM_MODEL ?? "";
  if (!key || !base || !model) return { ok: false, skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llmTimeoutMs);
  try {
    const response = await fetch(new URL("chat/completions", base.endsWith("/") ? base : `${base}/`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, skipped: false };
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) return { ok: false, skipped: false };
    return { ok: true, text };
  } catch {
    return { ok: false, skipped: false };
  } finally {
    clearTimeout(timer);
  }
}
