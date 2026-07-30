// Server-only. Shared provider-branching call extracted from
// image-worker.server.ts so the Pin Style Setup preview generator
// (pin-style-setup.functions.ts) can render a real sample pin through
// the exact same logic the batch worker uses, instead of a second,
// drifting copy of it.
//
// Single `apiKey: string` param rather than one optional field per
// provider -- only one provider is ever used per call, and that grew
// unwieldy once this covered 7 image providers instead of 2. Callers
// resolve the correct credential for whichever `provider` is selected
// (see image-worker.server.ts / pin-style-setup.functions.ts) before
// calling this.
import type { ImageProvider } from "@/lib/sites.functions";

export async function renderPinImage(opts: {
  provider: ImageProvider;
  prompt: string;
  apiKey: string;
}): Promise<{ imageBytes: Uint8Array; contentType: string; providerPredictionId: string; modelUsed: string }> {
  if (opts.provider === "openai") {
    const { openaiGenerateImage } = await import("./openai-image.server");
    const modelUsed = "gpt-image-1";
    const result = await openaiGenerateImage({ apiKey: opts.apiKey, model: modelUsed, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }
  if (opts.provider === "fal") {
    const { falGenerateImage } = await import("./fal-image.server");
    const modelUsed = "fal-ai/flux-pro/v1.1-ultra";
    const result = await falGenerateImage({ apiKey: opts.apiKey, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }
  if (opts.provider === "gemini") {
    const { geminiGenerateImage } = await import("./gemini-image.server");
    const modelUsed = "gemini-2.5-flash-image";
    const result = await geminiGenerateImage({ apiKey: opts.apiKey, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }
  if (opts.provider === "ideogram") {
    const { ideogramGenerateImage } = await import("./ideogram-image.server");
    const modelUsed = "ideogram-v3";
    const result = await ideogramGenerateImage({ apiKey: opts.apiKey, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }
  if (opts.provider === "recraft") {
    const { recraftGenerateImage } = await import("./recraft-image.server");
    const modelUsed = "recraftv4_1_pro";
    const result = await recraftGenerateImage({ apiKey: opts.apiKey, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }
  if (opts.provider === "stability") {
    const { stabilityGenerateImage } = await import("./stability-image.server");
    const modelUsed = "stable-image-ultra";
    const result = await stabilityGenerateImage({ apiKey: opts.apiKey, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }

  // replicate (default/existing) -- Nano Banana 2
  const { replicatePredict } = await import("./replicate.server");
  const modelUsed = "google/nano-banana-2";
  const input: Record<string, unknown> = { prompt: opts.prompt, aspect_ratio: "2:3" };
  const pred = await replicatePredict({ token: opts.apiKey, model: modelUsed, input, maxWaitMs: 90_000 });
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const imgResp = await fetch(outUrl);
  if (!imgResp.ok) throw new Error(`Replicate output download ${imgResp.status}`);
  const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = imgResp.headers.get("content-type") ?? "image/png";
  return { imageBytes, contentType, providerPredictionId: pred.id, modelUsed };
}
