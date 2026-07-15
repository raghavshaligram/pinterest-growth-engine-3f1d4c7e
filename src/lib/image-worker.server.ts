// Server-only. Image generation worker driving Replicate + Storage.
import { createHash } from "node:crypto";

export async function processImageQueueForUser(userId: string, limit = 5) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getIntegration, markIntegration } = await import("./integrations.server");
  const { replicatePredict } = await import("./replicate.server");
  const { buildThemedPinPrompt } = await import("./briefs.functions");

  const cfg = await getIntegration(userId, "replicate");
  if (!cfg) return { processed: 0, note: "Replicate not configured" };

  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "generate_image")
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  if (!jobs?.length) return { processed: 0 };

  let ok = 0, fail = 0;
  for (const job of jobs) {
    const payload = (job.payload ?? {}) as { brief_id?: string; force?: boolean };
    const briefId = payload.brief_id;
    if (!briefId) continue;
    await supabaseAdmin.from("jobs").update({ status: "running", attempts: job.attempts + 1 }).eq("id", job.id);
    try {
      const { data: brief } = await supabaseAdmin
        .from("pin_briefs")
        .select("*, pages(url, title, analysis, site_id, sites(url, brand_colors))")
        .eq("id", briefId)
        .single();
      if (!brief) throw new Error("brief missing");
      const page = (brief as { pages?: { url?: string; title?: string | null; analysis?: unknown; sites?: { url?: string; brand_colors?: unknown } } }).pages;
      const siteUrl = page?.sites?.url ?? page?.url ?? "";
      const brandHost = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, "") : "";
      const brandColors = Array.isArray(page?.sites?.brand_colors) ? page!.sites!.brand_colors as string[] : [];
      const analysis = (page?.analysis ?? {}) as { topic?: string; primary_keyword?: string };
      const themedPrompt = buildThemedPinPrompt({
        title: brief.title,
        cta: brief.cta,
        style: brief.style,
        topic: analysis.topic,
        primaryKeyword: analysis.primary_keyword,
        brandHost,
        brandColors,
        middlePrompt: brief.image_prompt,
      });

      const promptHash = createHash("sha1").update(themedPrompt + (payload.force ? `:${Date.now()}` : "")).digest("hex");
      if (!payload.force) {
        const { data: existing } = await supabaseAdmin
          .from("pin_images").select("id").eq("prompt_hash", promptHash).maybeSingle();
        if (existing) {
          await supabaseAdmin.from("pin_briefs").update({ status: "ready" }).eq("id", brief.id);
          await supabaseAdmin.from("jobs").update({ status: "done" }).eq("id", job.id);
          ok++; continue;
        }
      }

      const pred = await replicatePredict({
        token: cfg.api_token,
        model: "google/nano-banana-2",
        input: {
          prompt: themedPrompt,
          aspect_ratio: "2:3",
        },
      });
      const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;

      // Download and upload to Storage
      const imgResp = await fetch(outUrl);
      if (!imgResp.ok) throw new Error(`Replicate output download ${imgResp.status}`);
      const bytes = new Uint8Array(await imgResp.arrayBuffer());
      const contentType = imgResp.headers.get("content-type") ?? "image/png";
      const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : "webp";
      const path = `${userId}/${brief.id}-${promptHash.slice(0, 8)}.${ext}`;
      const up = await supabaseAdmin.storage.from("pins").upload(path, bytes, { contentType, upsert: true });
      if (up.error) throw up.error;

      await supabaseAdmin.from("pin_images").insert({
        user_id: userId,
        brief_id: brief.id,
        storage_path: path,
        prompt_hash: promptHash,
        replicate_prediction_id: pred.id,
        meta: { model: "google/nano-banana-2", content_type: contentType },
      });
      await supabaseAdmin.from("pin_briefs").update({ status: "ready" }).eq("id", brief.id);
      await supabaseAdmin.from("jobs").update({ status: "done" }).eq("id", job.id);
      await markIntegration(userId, "replicate", "ok");
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("jobs").update({ status: "failed", last_error: msg }).eq("id", job.id);
      await markIntegration(userId, "replicate", "error", msg);
      fail++;
    }
  }
  return { processed: jobs.length, ok, fail };
}
