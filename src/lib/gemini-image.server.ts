// Server-only. Google Gemini native image generation (direct API call
// to generativelanguage.googleapis.com -- NOT via Replicate's
// google/nano-banana-2 wrapper, which replicate.server.ts already
// covers as the "replicate" provider). Auth via the x-goog-api-key
// header (a ?key= query param also works per Google's docs, but the
// header form keeps the key out of logs/URLs). Synchronous;  the
// generated image comes back as base64 in
// candidates[0].content.parts[].inlineData.data.
//
// Google ships new Gemini model ids fairly often -- gemini-2.5-flash-image
// was the current native-image-output model confirmed from official docs
// at implementation time. If this starts 404ing, check
// ai.google.dev/gemini-api/docs/image-generation for the current id.
const GEMINI_MODEL = "gemini-2.5-flash-image";

export async function geminiGenerateImage(opts: {
  apiKey: string;
  prompt: string;
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": opts.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "2:3" },
        },
      }),
    },
  );
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Gemini: ${resp.status} -- check your API key`);
  }
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);

  const j = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error("Gemini: response had no inline image data");

  const imageBytes = Uint8Array.from(Buffer.from(imagePart.inlineData.data, "base64"));
  const contentType = imagePart.inlineData.mimeType ?? "image/png";
  return { id: `gemini:${Date.now()}`, imageBytes, contentType };
}
