import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The carousel tables are newer than the generated Supabase types, so they are reached through loose accessors.

export type CarouselSlide = {
  id: string; position: number; kind: "cover" | "item" | "outro"; number: number | null; heading: string; body: string | null;
  photo_prompt: string | null; alt_text: string | null; error: string | null; image_url: string | null; has_photo: boolean;
};
export type CarouselRow = {
  id: string; title: string; caption: string | null; hashtags: string | null; status: string; scheduled_for: string | null;
  published_at: string | null; error: string | null; page_url: string | null; created_at: string; slides: CarouselSlide[];
};

export const listCarousels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data: ps } = await db.from("carousel_posts").select("*").eq("user_id", context.userId).neq("status", "rejected").order("created_at", { ascending: false }).limit(30);
    const ids = (ps ?? []).map((p: any) => p.id);
    const { data: ss } = ids.length ? await db.from("carousel_slides").select("*").in("carousel_id", ids).order("position") : { data: [] };
    const out: CarouselRow[] = [];
    for (const p of ps ?? []) {
      const slides: CarouselSlide[] = [];
      for (const s of (ss ?? []).filter((x: any) => x.carousel_id === p.id)) {
        let image_url: string | null = null;
        if (s.image_path) image_url = (await db.storage.from("pins").createSignedUrl(s.image_path, 3600)).data?.signedUrl ?? null;
        slides.push({ id: s.id, position: s.position, kind: s.kind, number: s.number, heading: s.heading, body: s.body, photo_prompt: s.photo_prompt, alt_text: s.alt_text, error: s.error, image_url, has_photo: !!s.photo_path });
      }
      out.push({ id: p.id, title: p.title, caption: p.caption, hashtags: p.hashtags, status: p.status, scheduled_for: p.scheduled_for, published_at: p.published_at, error: p.error, page_url: p.page_url, created_at: p.created_at, slides });
    }
    return out;
  });

export const generateCarouselNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i?: { pageId?: string }) => z.object({ pageId: z.string().uuid().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { writeCarouselForUser } = await import("./carousels.server");
    return writeCarouselForUser(context.userId, { pageId: data.pageId });
  });

export const buildCarouselsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildCarouselsForUser } = await import("./carousels.server");
    return buildCarouselsForUser(context.userId);
  });

export const carouselAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; action: "approve" | "unapprove" | "reject" | "publish_now" | "retry" }) =>
    z.object({ id: z.string().uuid(), action: z.enum(["approve", "unapprove", "reject", "publish_now", "retry"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const c = await import("./carousels.server");
    const { data: row } = await (db as any).from("carousel_posts").select("id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!row) throw new Error("carousel not found");
    const upd = (patch: Record<string, unknown>) => (db as any).from("carousel_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", data.id);
    if (data.action === "approve" || data.action === "retry") return { scheduled_for: await c.approveCarousel(db, context.userId, data.id) };
    if (data.action === "unapprove") { await upd({ status: "review", scheduled_for: null }); return {}; }
    if (data.action === "reject") { await upd({ status: "rejected" }); return {}; }
    // publish_now: approve if needed, then send straight away, ignoring the posting window and the daily cap
    await upd({ status: "approved", scheduled_for: new Date().toISOString().slice(0, 10), error: null });
    return c.publishCarouselsForUser(context.userId, { force: true, id: data.id });
  });

export const editSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; heading?: string; body?: string; regeneratePhoto?: boolean }) =>
    z.object({ id: z.string().uuid(), heading: z.string().min(1).max(160).optional(), body: z.string().max(400).optional(), regeneratePhoto: z.boolean().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: s } = await db.from("carousel_slides").select("id, carousel_id, carousel_posts(design)").eq("id", data.id).maybeSingle();
    if (!s) throw new Error("slide not found");
    // In the openai design the text is part of the picture, so any text edit means drawing the slide again.
    const redraw = !!data.regeneratePhoto || (s.carousel_posts?.design === "openai" && (data.heading !== undefined || data.body !== undefined));
    const patch: Record<string, unknown> = { image_path: null };
    if (data.heading !== undefined) patch.heading = data.heading.replace(/[–—]/g, ",");
    if (data.body !== undefined) patch.body = data.body.replace(/[–—]/g, ",");
    if (redraw) patch.photo_path = null;
    await db.from("carousel_slides").update(patch).eq("id", data.id);
    // back to the build queue; an approved carousel goes back to review so it is not posted half-edited
    await db.from("carousel_posts").update({ status: redraw ? "photos" : "rendering", scheduled_for: null, updated_at: new Date().toISOString() }).eq("id", s.carousel_id);
    return {};
  });

export const saveCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; caption: string; hashtags: string }) => z.object({ id: z.string().uuid(), caption: z.string().max(2000), hashtags: z.string().max(400) }).parse(i))
  .handler(async ({ data, context }) => {
    await (context.supabase as any).from("carousel_posts").update({ caption: data.caption.replace(/[–—]/g, ","), hashtags: data.hashtags, updated_at: new Date().toISOString() }).eq("id", data.id);
    return {};
  });

const SETTING_KEYS = ["carousel_webhook_url", "carousels_per_day", "carousel_auto_approve", "carousels_paused"] as const;
export const getCarouselSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data } = await (db as any).from("autopilot_settings").select("key, value").in("key", [...SETTING_KEYS]);
    const m: Record<string, string> = {};
    for (const r of data ?? []) m[r.key] = r.value;
    return { webhook_set: /^https:\/\//.test(m.carousel_webhook_url ?? ""), per_day: Number(m.carousels_per_day ?? 1), auto_approve: m.carousel_auto_approve === "true", paused: m.carousels_paused === "true" };
  });

export const saveCarouselSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { webhook_url?: string; per_day?: number; auto_approve?: boolean; paused?: boolean }) =>
    z.object({ webhook_url: z.string().url().startsWith("https://").optional(), per_day: z.number().int().min(1).max(3).optional(), auto_approve: z.boolean().optional(), paused: z.boolean().optional() }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const rows: { key: string; value: string }[] = [];
    if (data.webhook_url) rows.push({ key: "carousel_webhook_url", value: data.webhook_url });
    if (data.per_day) rows.push({ key: "carousels_per_day", value: String(data.per_day) });
    if (data.auto_approve !== undefined) rows.push({ key: "carousel_auto_approve", value: String(data.auto_approve) });
    if (data.paused !== undefined) rows.push({ key: "carousels_paused", value: String(data.paused) });
    if (rows.length) await (db as any).from("autopilot_settings").upsert(rows, { onConflict: "key" });
    return {};
  });
