// Server-only OpenAI helpers using the caller's own API key.
export async function openaiJSON<T = unknown>(opts: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
}): Promise<T> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json() as { choices: { message: { content: string } }[] };
  const content = j.choices[0].message.content;
  return JSON.parse(content) as T;
}
