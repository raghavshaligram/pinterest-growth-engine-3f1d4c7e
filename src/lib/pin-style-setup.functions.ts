import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEMPLATE_LABELS, type TemplateId } from "@/lib/briefs.functions";

// Exactly the two templates named in the Pin Style Setup spec -- one
// discrete/card-based shape (quick_tip_grid) and one single-statement
// shape (quote_stat_card) -- picked to show two visually distinct real
// renders of the same brand inputs rather than N near-duplicates.
const SAMPLE_TEMPLATES: { templateId: TemplateId; title: (brand: string) => string; cta: string }[] = [
  { templateId: "quick_tip_grid", title: (brand) => `5 Quick Tips From ${brand}`, cta: "See All Tips →" },
  { templateId: "quote_stat_card", title: (brand) => `Why ${brand} Works`, cta: "Learn More →" },
];

export type StyleSample = {
  templateId: TemplateId;
  label: string;
  color: string;
  signedUrl: string;
};

// Generates 2 REAL sample pins through the exact same render path batch
// generation uses (renderPinImage/buildThemedPinPrompt), from the
// site's actual brand inputs -- not mockups. Deliberately does NOT
// write pin_briefs/pin_images rows: these are throwaway previews for a
// "does this look right" decision, not real content, so they shouldn't
// inflate the site's pin count or show up on the Pins page. They're
// stored under their own storage-path prefix (style-samples/) so
// there's no risk of them being mistaken for real generated pins
// elsewhere in the app.
export const generateStyleSamples = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { siteId: string }) => z.object({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ samples: StyleSample[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildThemedPinPrompt } = await import("@/lib/briefs.functions");
    const { renderPinImage } = await import("@/lib/pin-render.server");

    const { data: site, error } = await context.supabase.from("sites").select("*").eq("id", data.siteId).single();
    if (error || !site) throw error ?? new Error("Site not found");

    const { resolveImageConnection } = await import("@/lib/provider-resolution.server");
    let resolved;
    try {
      resolved = await resolveImageConnection(context.userId, site.image_connection_override_id as string | null);
    } catch {
      throw new Error("No image generation provider is connected yet -- add one in Settings > Integrations before previewing pin style.");
    }
    const { provider, apiKey } = resolved;

    const brandHost = new URL(site.url).hostname.replace(/^www\./, "");
    const brandDisplay = site.brand_name || brandHost;
    const brandColors = Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : [];

    const samples: StyleSample[] = [];
    for (const t of SAMPLE_TEMPLATES) {
      const prompt = buildThemedPinPrompt({
        title: t.title(brandDisplay),
        cta: t.cta,
        templateId: t.templateId,
        topic: brandDisplay,
        brandHost,
        brandColors,
        brandFont: site.brand_font,
        vertical: site.vertical as Parameters<typeof buildThemedPinPrompt>[0]["vertical"],
      });

      const rendered = await renderPinImage({
        provider,
        prompt,
        apiKey,
      });

      const ext = rendered.contentType.includes("png") ? "png" : rendered.contentType.includes("jpeg") ? "jpg" : "webp";
      const path = `${context.userId}/style-samples/${site.id}/${t.templateId}-${Date.now()}.${ext}`;
      const up = await supabaseAdmin.storage.from("pins").upload(path, rendered.imageBytes, {
        contentType: rendered.contentType,
        upsert: true,
      });
      if (up.error) throw up.error;
      const signed = await supabaseAdmin.storage.from("pins").createSignedUrl(path, 3600);

      const tag = TEMPLATE_LABELS[t.templateId];
      samples.push({ templateId: t.templateId, label: tag.label, color: tag.color, signedUrl: signed.data?.signedUrl ?? "" });
    }

    return { samples };
  });

// Marks Pin Style Setup as completed for this site -- the batch-
// generation gate (generateBriefs' style_locked_at check,
// useSiteStyleGate client-side) reads this same column. Intentionally
// a separate, explicit action rather than something upsertSite sets as
// a side effect of any brand save, so "locked" only ever means the user
// actually saw real sample renders and confirmed them.
export const lockPinStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { siteId: string }) => z.object({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sites")
      .update({ style_locked_at: new Date().toISOString() })
      .eq("id", data.siteId);
    if (error) throw error;
    return { ok: true };
  });
