// Server-only Anthropic helpers using the caller's own API key. Mirrors
// openaiJSON's exact contract (openai.server.ts) so briefs.functions.ts
// can call either interchangeably based on a site's copy_provider.
//
// Anthropic's Messages API has no "response_format: json_object" mode
// the way OpenAI's does, so JSON-only output is enforced by instruction
// (appended to the system prompt) plus defensive parsing here: strip a
// leading/trailing ```json fence if the model wraps its answer in one
// anyway, since Claude models do this occasionally even when told not
// to.
export async function anthropicJSON<T = unknown>(opts: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
}): Promise<T> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "claude-sonnet-5",
      max_tokens: 4096,
      system: `${opts.system}\n\nRespond with ONLY valid JSON -- no markdown code fence, no commentary before or after it.`,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { content: { type: string; text?: string }[] };
  const raw = j.content.find((c) => c.type === "text")?.text ?? "";
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as T;
}
