// Server-only. Ideogram image generation (v3 Generate endpoint).
// Auth header is "Api-Key" (not Bearer/x-api-key) per Ideogram's own
// docs. Body is multipart/form-data, synchronous response.
//
// UNVERIFIED DETAIL: Ideogram's aspect_ratio enum has a portrait 2:3
// value, but the exact string casing wasn't fully expanded in the docs
// pass done for this integration (no live Ideogram key was available to
// confirm against the real API). "2x3" is used below as the
// best-available guess based on Ideogram's documented naming
// convention for other ratios -- if generation requests start failing
// with a 4xx mentioning aspect_ratio, check the live enum list at
// developer.ideogram.ai and correct this constant.
const IDEOGRAM_ASPECT_RATIO_GUESS = "2x3";

export async function ideogramGenerateImage(opts: {
  apiKey: string;
  prompt: string;
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const form = new FormData();
  form.append("prompt", opts.prompt);
  form.append("aspect_ratio", IDEOGRAM_ASPECT_RATIO_GUESS);
  form.append("rendering_speed", "DEFAULT");

  const resp = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
    method: "POST",
    headers: { "Api-Key": opts.apiKey },
    body: form,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Ideogram: ${resp.status} -- check your API key`);
  }
  if (!resp.ok) throw new Error(`Ideogram ${resp.status}: ${await resp.text()}`);

  const j = (await resp.json()) as { data?: { url: string }[] };
  const first = j.data?.[0];
  if (!first?.url) throw new Error("Ideogram: empty response");

  const imgResp = await fetch(first.url);
  if (!imgResp.ok) throw new Error(`Ideogram: failed to download output ${imgResp.status}`);
  const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = imgResp.headers.get("content-type") ?? "image/png";
  return { id: `ideogram:${Date.now()}`, imageBytes, contentType };
}
