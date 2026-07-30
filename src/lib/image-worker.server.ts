// Server-only. Image generation worker driving Replicate + Storage.
import { createHash } from "node:crypto";
import { getErrorMessage } from "@/lib/error-message";
import type { SiteVertical, TemplateId } from "@/lib/briefs.functions";
import type { ImageProvider, LogoPlacement } from "@/lib/sites.functions";

export async function processImageQueueForUser(userId: string, limit = 5, opts?: { pageId?: string; briefId?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getIntegration, markIntegration } = await import("./integrations.server");
  const { buildThemedPinPrompt } = await import("./briefs.functions");

  // Provider is now chosen per-site (sites.image_provider), so we can't
  // gate the whole queue on a single provider's config the way this used
  // to. Fetch both up front and only bail out entirely if NEITHER is
  // configured; per-job provider checks below handle the rest.
  const [replicateCfg, openaiCfg] = await Promise.all([
    getIntegration(userId, "replicate"),
    getIntegration(userId, "openai"),
  ]);
  if (!replicateCfg && !openaiCfg) return { processed: 0, note: "No image provider configured" };

  let briefIdFilter: string[] | null = null;
  if (opts?.briefId) {
    briefIdFilter = [opts.briefId];
  } else if (opts?.pageId) {
    const { data: pageBriefs } = await supabaseAdmin
      .from("pin_briefs").select("id").eq("user_id", userId).eq("page_id", opts.pageId);
    briefIdFilter = (pageBriefs ?? []).map((b) => b.id);
    if (!briefIdFilter.length) return { processed: 0 };
  }

  const q = supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "generate_image")
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("created_at")
    .limit(limit);
  const { data: jobs, error } = briefIdFilter
    ? await q.in("payload->>brief_id", briefIdFilter)
    : await q;
  if (error) throw error;
  if (!jobs?.length) return { processed: 0 };


  let ok = 0, fail = 0, skipped = 0;
  const runOne = async (job: typeof jobs[number]) => {
    const payload = (job.payload ?? {}) as { brief_id?: string; force?: boolean };
    const briefId = payload.brief_id;
    if (!briefId) return;
    // Declared here (not inside the try block) so the catch block below
    // can report a failure against whichever provider was actually in
    // play, even if the failure happened after provider resolution.
    let provider: ImageProvider = "openai";
    await supabaseAdmin.from("jobs").update({ status: "running", attempts: job.attempts + 1 }).eq("id", job.id);
    try {
      const { data: brief, error: briefErr } = await supabaseAdmin
        .from("pin_briefs")
        .select("*, pages(url, title, analysis, site_id, excluded, sites(url, brand_name, brand_colors, brand_font, vertical, image_provider, display_mode, name_mode, logo_url, logo_placement, accent_color))")
        .eq("id", briefId)
        .single();
      // Previously this discarded `error` entirely and always threw the
      // generic "brief missing" on any failure -- including query errors
      // that have nothing to do with the brief being missing (e.g. a
      // PostgREST schema-cache-lag PGRST204 on a newly added column,
      // which is exactly what silently broke here right after the
      // vertical-column migration shipped). Surface the real reason.
      if (briefErr) throw briefErr;
      if (!brief) throw new Error("brief missing");
      const page = (brief as {
        pages?: {
          url?: string; title?: string | null; analysis?: unknown; excluded?: boolean;
          sites?: {
            url?: string; brand_name?: string | null; brand_colors?: unknown; brand_font?: string | null;
            vertical?: SiteVertical | null; image_provider?: ImageProvider | null;
            display_mode?: "logo" | "text" | null; name_mode?: "brand_name" | "domain" | null; logo_url?: string | null;
            logo_placement?: LogoPlacement | null; accent_color?: string | null;
          };
        };
      }).pages;

      // Belt-and-suspenders: a page can be excluded after this job was
      // already queued (or queued via a path that doesn't check
      // exclusion, e.g. runFullPipeline's image-queueing step -- see the
      // matching fix there). Never spend provider credits rendering a
      // page the user explicitly opted out of. Leave the brief's own
      // status untouched; just retire the job.
      if (page?.excluded) {
        await supabaseAdmin.from("jobs").update({ status: "done", last_error: "skipped: page excluded" }).eq("id", job.id);
        skipped++;
        return;
      }
      const siteUrl = page?.sites?.url ?? page?.url ?? "";
      const brandHost = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, "") : "";
      const brandColors = Array.isArray(page?.sites?.brand_colors) ? page!.sites!.brand_colors as string[] : [];
      const analysis = (page?.analysis ?? {}) as { topic?: string; primary_keyword?: string };

      // Resolve a signed URL for the site's logo ONLY when display_mode
      // is actually 'logo' and a logo has really been uploaded -- per
      // spec, an unset logo_url always falls back to text mode even if
      // display_mode says 'logo' (a site that flips the toggle before
      // uploading anything shouldn't silently lose its brand text).
      let logoSignedUrl: string | null = null;
      if (page?.sites?.display_mode === "logo" && page.sites.logo_url) {
        const signed = await supabaseAdmin.storage.from("pins").createSignedUrl(page.sites.logo_url, 3600);
        logoSignedUrl = signed.data?.signedUrl ?? null;
      }
      const hasLogo = Boolean(logoSignedUrl);
      // If image_prompt was manually edited after the brief was created
      // (image_prompt_edited_at set -- see trg_pin_briefs_image_prompt_edit),
      // it's already final/themed: use it as-is instead of re-deriving via
      // buildThemedPinPrompt, which would silently discard the edit.
      const briefRow = brief as { image_prompt_edited_at?: string | null; template_id?: string | null };
      // template_id is the classifier's stored shape decision (see
      // generateBriefs in briefs.functions.ts). Reusing it here on
      // re-render keeps the SAME shape the brief was originally
      // classified into. Only legacy briefs generated before this
      // column existed have no stored value -- those fall back to the
      // narrower style-label regex inside buildThemedPinPrompt itself.
      const themedPrompt = briefRow.image_prompt_edited_at
        ? brief.image_prompt
        : buildThemedPinPrompt({
            title: brief.title,
            cta: brief.cta,
            templateId: (briefRow.template_id as TemplateId | null) ?? null,
            style: brief.style,
            topic: analysis.topic,
            primaryKeyword: analysis.primary_keyword,
            brandHost,
            brandColors,
            brandFont: page?.sites?.brand_font,
            vertical: page?.sites?.vertical,
            middlePrompt: brief.image_prompt,
            brandName: page?.sites?.brand_name,
            displayMode: page?.sites?.display_mode,
            nameMode: page?.sites?.name_mode,
            hasLogo,
          });

      const promptHash = createHash("sha1").update(themedPrompt + (payload.force ? `:${Date.now()}` : "")).digest("hex");
      if (!payload.force) {
        const { data: existing } = await supabaseAdmin
          .from("pin_images").select("id").eq("prompt_hash", promptHash).maybeSingle();
        if (existing) {
          await supabaseAdmin.from("pin_briefs").update({ status: "ready" }).eq("id", brief.id);
          await supabaseAdmin.from("jobs").update({ status: "done" }).eq("id", job.id);
          ok++; return;
        }
      }

      provider = page?.sites?.image_provider ?? "openai";

      const { renderPinImage } = await import("./pin-render.server");
      const rendered = await renderPinImage({
        provider,
        prompt: themedPrompt,
        openaiApiKey: openaiCfg?.api_key,
        replicateToken: replicateCfg?.api_token,
      });
      let imageBytes = rendered.imageBytes;
      let contentType = rendered.contentType;
      const providerPredictionId = rendered.providerPredictionId;
      const modelUsed = rendered.modelUsed;

      // Deterministic logo compositing -- see logo-composite.server.ts's
      // own comment for why this replaced asking the model to draw the
      // logo itself. Only runs when there's really a logo to place;
      // otherwise the model's own (text) render is used as-is.
      if (hasLogo && logoSignedUrl) {
        const { compositeLogoOntoPin } = await import("./logo-composite.server");
        const logoResp = await fetch(logoSignedUrl);
        if (!logoResp.ok) throw new Error(`Failed to fetch logo for compositing: ${logoResp.status}`);
        const logoBytes = new Uint8Array(await logoResp.arrayBuffer());
        const composited = await compositeLogoOntoPin({
          baseImageBytes: imageBytes,
          logoBytes,
          placement: (page?.sites?.logo_placement as LogoPlacement | null) ?? "bottom-center",
          accentColor: page?.sites?.accent_color ?? null,
        });
        imageBytes = composited.imageBytes;
        contentType = composited.contentType;
      }

      const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : "webp";
      const path = `${userId}/${brief.id}-${promptHash.slice(0, 8)}.${ext}`;
      const up = await supabaseAdmin.storage.from("pins").upload(path, imageBytes, { contentType, upsert: true });
      if (up.error) throw up.error;

      await supabaseAdmin.from("pin_images").insert({
        user_id: userId,
        brief_id: brief.id,
        storage_path: path,
        prompt_hash: promptHash,
        // Column predates multi-provider support; reused here to store
        // whichever provider's generation id came back (OpenAI's is a
        // locally-minted "openai:<timestamp>" id, not a real prediction
        // id -- the actual provider is recorded in meta.provider below).
        replicate_prediction_id: providerPredictionId,
        meta: { model: modelUsed, provider, content_type: contentType },
      });
      await supabaseAdmin.from("pin_briefs").update({ status: "ready" }).eq("id", brief.id);
      await supabaseAdmin.from("jobs").update({ status: "done" }).eq("id", job.id);
      await markIntegration(userId, provider, "ok");
      ok++;
    } catch (e) {
      const msg = getErrorMessage(e);
      await supabaseAdmin.from("jobs").update({ status: "failed", last_error: msg }).eq("id", job.id);
      // Without this, a brief whose render already failed stays stuck at
      // status="image_pending" forever -- indistinguishable in the UI
      // from one that's still queued/rendering ("Waiting to render...").
      await supabaseAdmin.from("pin_briefs").update({ status: "failed" }).eq("id", briefId);
      await markIntegration(userId, provider, "error", msg);
      fail++;
    }
  };

  // Process in parallel with bounded concurrency to stay under worker time budget.
  const concurrency = 4;
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (idx < jobs.length) {
        const j = jobs[idx++];
        await runOne(j);
      }
    }),
  );
  return { processed: jobs.length, ok, fail, skipped };
}
