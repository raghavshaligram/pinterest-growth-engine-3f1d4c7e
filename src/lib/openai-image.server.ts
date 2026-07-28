// Server-only. OpenAI's Images API as a second image-generation provider
// alongside Replicate (see replicate.server.ts). Text-to-image goes
// through /v1/images/generations; if reference image URLs are supplied,
// /v1/images/edits is used instead for compositing (multipart/form-data,
// up to 16 reference images per OpenAI's docs).
//
// Deliberately does NOT mirror replicatePredict's {id, output: string |
// string[]} return shape -- OpenAI returns base64 (b64_json) by default,
// not a fetchable URL, so this returns decoded bytes directly instead of
// faking a data: URL that a downstream fetch() might not reliably handle.
export async function openaiGenerateImage(opts: {
  apiKey: string;
  model?: string; // defaults to "gpt-image-1"
  prompt: string;
  size?: string;
  quality?: "low" | "medium" | "high";
  referenceImageUrls?: string[];
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const model = opts.model ?? "gpt-image-1";
  const useEdits = !!opts.referenceImageUrls?.length;

  let resp: Response;
  if (useEdits) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    if (opts.size) form.append("size", opts.size);
    if (opts.quality) form.append("quality", opts.quality);
    for (const [i, url] of (opts.referenceImageUrls ?? []).entries()) {
      const imgResp = await fetch(url);
      if (!imgResp.ok) throw new Error(`OpenAI edits: failed to fetch reference image ${i}: ${imgResp.status}`);
      const blob = await imgResp.blob();
      form.append("image[]", blob, `reference-${i}.png`);
    }
    resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
  } else {
    resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.quality ? { quality: opts.quality } : {}),
      }),
    });
  }

  if (resp.status === 402 || resp.status === 429) {
    const body = await resp.text();
    throw new Error(`OpenAI image: ${resp.status} -- check billing/quota. ${body}`);
  }
  if (!resp.ok) throw new Error(`OpenAI image ${resp.status}: ${await resp.text()}`);

  const j = (await resp.json()) as { data?: { b64_json?: string; url?: string }[] };
  const first = j.data?.[0];
  if (!first) throw new Error("OpenAI image: empty response");

  const id = `openai:${Date.now()}`;

  if (first.b64_json) {
    const imageBytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
    return { id, imageBytes, contentType: "image/png" };
  }
  if (first.url) {
    const imgResp = await fetch(first.url);
    if (!imgResp.ok) throw new Error(`OpenAI image: failed to download output ${imgResp.status}`);
    const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
    const contentType = imgResp.headers.get("content-type") ?? "image/png";
    return { id, imageBytes, contentType };
  }
  throw new Error("OpenAI image: response had neither b64_json nor url");
}
