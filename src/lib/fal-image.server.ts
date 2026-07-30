// Server-only. fal.ai image generation (FLUX1.1 [pro] ultra) via the
// documented queue pattern: submit -> poll status -> fetch result --
// fal's own docs recommend this queue flow over the synchronous
// fal.run/ variant for anything non-trivial. Auth header is literally
// "Key <token>" (not "Bearer"), fal's own convention, confirmed from
// their official docs at implementation time (docs.fal.ai). No live
// fal.ai credentials were available to test this end-to-end -- shapes
// below are transcribed directly from fal's request/response schema
// docs, not empirically verified.
const FAL_MODEL = "fal-ai/flux-pro/v1.1-ultra";

export async function falGenerateImage(opts: {
  apiKey: string;
  prompt: string;
  maxWaitMs?: number;
}): Promise<{ id: string; imageBytes: Uint8Array; contentType: string }> {
  const submit = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt, aspect_ratio: "2:3" }),
  });
  if (submit.status === 401 || submit.status === 403) {
    throw new Error(`fal.ai: ${submit.status} -- check your API key`);
  }
  if (!submit.ok) throw new Error(`fal.ai submit ${submit.status}: ${await submit.text()}`);
  const job = (await submit.json()) as { request_id: string; status_url: string; response_url: string };

  const cap = opts.maxWaitMs ?? 90_000;
  const start = Date.now();
  let status = "IN_QUEUE";
  while (status !== "COMPLETED") {
    if (Date.now() - start > cap) throw new Error("fal.ai: timed out waiting for generation");
    await new Promise((res) => setTimeout(res, 2500));
    const s = await fetch(job.status_url, { headers: { Authorization: `Key ${opts.apiKey}` } });
    if (!s.ok) throw new Error(`fal.ai status ${s.status}`);
    const sj = (await s.json()) as { status: string };
    status = sj.status;
    if (status === "ERROR") throw new Error("fal.ai: generation failed");
  }

  const result = await fetch(job.response_url, { headers: { Authorization: `Key ${opts.apiKey}` } });
  if (!result.ok) throw new Error(`fal.ai result ${result.status}: ${await result.text()}`);
  const rj = (await result.json()) as { images?: { url: string; content_type?: string }[] };
  const first = rj.images?.[0];
  if (!first?.url) throw new Error("fal.ai: response had no image url");

  const imgResp = await fetch(first.url);
  if (!imgResp.ok) throw new Error(`fal.ai: failed to download output ${imgResp.status}`);
  const imageBytes = new Uint8Array(await imgResp.arrayBuffer());
  const contentType = first.content_type ?? imgResp.headers.get("content-type") ?? "image/png";
  return { id: job.request_id, imageBytes, contentType };
}
