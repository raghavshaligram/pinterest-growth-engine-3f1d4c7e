// Server-only. Stability AI image generation (Stable Image Ultra --
// SD3.5-Large-based flagship). Bearer auth, multipart/form-data,
// synchronous. Requesting `Accept: image/*` returns the raw image
// bytes directly in the HTTP body (rather than base64-in-JSON), which
// this uses since it avoids an extra decode step.
export async function stabilityGenerateImage(opts: {
  apiKey: string;
  prompt: string;
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const form = new FormData();
  form.append("prompt", opts.prompt);
  form.append("aspect_ratio", "2:3");
  form.append("output_format", "png");

  const resp = await fetch("https://api.stability.ai/v2beta/stable-image/generate/ultra", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "image/*" },
    body: form,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Stability AI: ${resp.status} -- check your API key`);
  }
  if (!resp.ok) throw new Error(`Stability AI ${resp.status}: ${await resp.text()}`);

  const imageBytes = new Uint8Array(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") ?? "image/png";
  return { id: `stability:${Date.now()}`, imageBytes, contentType };
}
