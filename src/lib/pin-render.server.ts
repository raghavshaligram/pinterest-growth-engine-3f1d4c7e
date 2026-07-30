// Server-only. Shared provider-branching call extracted from
// image-worker.server.ts so the Pin Style Setup preview generator
// (pin-style-setup.functions.ts) can render a real sample pin through
// the exact same OpenAI/Replicate logic the batch worker uses, instead
// of a second, drifting copy of it.
//
// Deliberately does NOT accept a reference logo image anymore. An
// earlier version of this function passed the site's logo to the
// provider as a compositing reference (OpenAI referenceImageUrls /
// Replicate image_input) -- that didn't reliably composite the logo
// into the generated scene (see logo-composite.server.ts's own comment
// for the root cause). Logo placement is now a fully separate,
// deterministic post-processing step (compositeLogoOntoPin) applied by
// the caller AFTER this function returns a plain, logo-free render.
import type { ImageProvider } from "@/lib/sites.functions";

export async function renderPinImage(opts: {
  provider: ImageProvider;
  prompt: string;
  openaiApiKey?: string | null;
  replicateToken?: string | null;
}): Promise<{ imageBytes: Uint8Array; contentType: string; providerPredictionId: string; modelUsed: string }> {
  if (opts.provider === "openai") {
    const { openaiGenerateImage } = await import("./openai-image.server");
    if (!opts.openaiApiKey) throw new Error("OpenAI not configured -- connect it in Settings > Integrations");
    const modelUsed = "gpt-image-1";
    const result = await openaiGenerateImage({ apiKey: opts.openaiApiKey, model: modelUsed, prompt: opts.prompt });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }

  const { replicatePredict } = await import("./replicate.server");
  if (!opts.replicateToken) throw new Error("Replicate not configured -- connect it in Settings > Integrations");
  const modelUsed = "google/nano-banana-2";
  const input: Record<string, unknown> = { prompt: opts.prompt, aspect_ratio: "2:3" };
  const pred = await replicatePredict({ token: opts.replicateToken, model: modelUsed, input, maxWaitMs: 90_000 });
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const imgResp = await fetch(outUrl);
  if (!imgResp.ok) throw new Error(`Replicate output download ${imgResp.status}`);
  const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = imgResp.headers.get("content-type") ?? "image/png";
  return { imageBytes, contentType, providerPredictionId: pred.id, modelUsed };
}
