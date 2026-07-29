// Server-only. Shared provider-branching call extracted from
// image-worker.server.ts so the Pin Style Setup preview generator
// (pin-style-setup.functions.ts) can render a real sample pin through
// the exact same OpenAI/Replicate logic the batch worker uses, instead
// of a second, drifting copy of it. This is also the one place that
// knows how to pass a reference logo image into either provider for
// compositing (see the referenceImageUrl param below).
import type { ImageProvider } from "@/lib/sites.functions";

export async function renderPinImage(opts: {
  provider: ImageProvider;
  prompt: string;
  openaiApiKey?: string | null;
  replicateToken?: string | null;
  // Signed URL to the site's uploaded logo -- only ever passed when the
  // caller has already confirmed display_mode is 'logo' AND a real
  // logo_url exists (see image-worker.server.ts and
  // pin-style-setup.functions.ts's own "wantsLogo" resolution); this
  // function doesn't re-derive that decision, it just composites
  // whatever reference image it's given.
  referenceImageUrl?: string | null;
}): Promise<{ imageBytes: Uint8Array; contentType: string; providerPredictionId: string; modelUsed: string }> {
  if (opts.provider === "openai") {
    const { openaiGenerateImage } = await import("./openai-image.server");
    if (!opts.openaiApiKey) throw new Error("OpenAI not configured -- connect it in Settings > Integrations");
    const modelUsed = "gpt-image-1";
    const result = await openaiGenerateImage({
      apiKey: opts.openaiApiKey,
      model: modelUsed,
      prompt: opts.prompt,
      // openaiGenerateImage itself switches to /v1/images/edits (the
      // compositing-capable endpoint) whenever this is non-empty -- see
      // its own comment.
      referenceImageUrls: opts.referenceImageUrl ? [opts.referenceImageUrl] : undefined,
    });
    return { imageBytes: result.imageBytes, contentType: result.contentType, providerPredictionId: result.id, modelUsed };
  }

  const { replicatePredict } = await import("./replicate.server");
  if (!opts.replicateToken) throw new Error("Replicate not configured -- connect it in Settings > Integrations");
  const modelUsed = "google/nano-banana-2";
  const input: Record<string, unknown> = { prompt: opts.prompt, aspect_ratio: "2:3" };
  // Nano Banana 2's image-conditioned/editing mode takes reference
  // images via `image_input` (an array of URLs) -- same param used
  // whether this is a fresh composite or an edit of an existing image.
  if (opts.referenceImageUrl) input.image_input = [opts.referenceImageUrl];
  const pred = await replicatePredict({ token: opts.replicateToken, model: modelUsed, input, maxWaitMs: 90_000 });
  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const imgResp = await fetch(outUrl);
  if (!imgResp.ok) throw new Error(`Replicate output download ${imgResp.status}`);
  const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = imgResp.headers.get("content-type") ?? "image/png";
  return { imageBytes, contentType, providerPredictionId: pred.id, modelUsed };
}
