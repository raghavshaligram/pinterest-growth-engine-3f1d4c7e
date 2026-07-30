// Server-only. Recraft image generation (recraftv4_1_pro flagship
// model). Bearer auth, synchronous, OpenAI-images-shaped response
// (data[0].url or data[0].b64_json) per Recraft's own docs.
//
// UNVERIFIED DETAIL: requesting size "1024x1536" (a 2:3 portrait) --
// Recraft's docs describe the size format as "WxH" but the full
// enumerated list of supported sizes lives in a separate appendix page
// not available during this integration's research pass, and no live
// Recraft key was available to confirm. If generation requests start
// failing with a 4xx mentioning size, check that appendix and correct
// this constant.
const RECRAFT_MODEL = "recraftv4_1_pro";
const RECRAFT_SIZE_GUESS = "1024x1536";

export async function recraftGenerateImage(opts: {
  apiKey: string;
  prompt: string;
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const resp = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: opts.prompt,
      model: RECRAFT_MODEL,
      size: RECRAFT_SIZE_GUESS,
      response_format: "b64_json",
    }),
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Recraft: ${resp.status} -- check your API key`);
  }
  if (!resp.ok) throw new Error(`Recraft ${resp.status}: ${await resp.text()}`);

  const j = (await resp.json()) as { data?: { b64_json?: string; url?: string }[] };
  const first = j.data?.[0];
  if (!first) throw new Error("Recraft: empty response");

  const id = `recraft:${Date.now()}`;
  if (first.b64_json) {
    const imageBytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
    return { id, imageBytes, contentType: "image/png" };
  }
  if (first.url) {
    const imgResp = await fetch(first.url);
    if (!imgResp.ok) throw new Error(`Recraft: failed to download output ${imgResp.status}`);
    const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
    const contentType = imgResp.headers.get("content-type") ?? "image/png";
    return { id, imageBytes, contentType };
  }
  throw new Error("Recraft: response had neither b64_json nor url");
}
