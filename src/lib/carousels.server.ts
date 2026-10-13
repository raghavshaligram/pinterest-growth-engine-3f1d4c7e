// Server-only. Instagram carousel lane: pick a blog post, write a listicle carousel from the page's own text,
// make Nano Banana 2 photos, render slides (text set by code in the render-carousel edge function), and hand
// approved carousels to the Make.com Instagram webhook. Mirrors the Pinterest autopilot, but separate tables.
import { getErrorMessage } from "@/lib/error-message";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
const posts = (db: Db) => db.from("carousel_posts");
const slides = (db: Db) => db.from("carousel_slides");
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export const WINDOW_START_UTC = 12; // 17:30 IST
export const WINDOW_END_UTC = 16;

export async function getSetting(db: Db, key: string, fallback = ""): Promise<string> {
  const { data } = await db.from("autopilot_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? fallback;
}
export async function perDay(db: Db): Promise<number> {
  const n = Math.round(Number(await getSetting(db, "carousels_per_day", "1")));
  return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 1;
}
async function log(db: Db, userId: string, level: "info" | "error", message: string, payload?: unknown) {
  await db.from("publish_logs").insert({ user_id: userId, level, message: `[carousel] ${message}`, payload: payload ?? null });
}

/* ---------------------------- 1. brief writer ---------------------------- */

function pageText(html: string): string {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
  const art = h.match(/<article[\s\S]*?<\/article>/i) ?? h.match(/<main[\s\S]*?<\/main>/i);
  if (art) h = art[0];
  h = h.replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n").replace(/<[^>]+>/g, " ");
  h = h.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, " ");
  return h.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, 14000);
}

async function pickPage(db: Db, userId: string): Promise<{ id: string; url: string; title: string | null; site_id: string; site_url: string } | null> {
  const { data: used } = await posts(db).select("page_id").eq("user_id", userId).neq("status", "rejected");
  const usedIds = new Set((used ?? []).map((r: any) => r.page_id));
  const { data: pages } = await db.from("pages")
    .select("id, url, title, site_id, sites(url)")
    .eq("user_id", userId).eq("excluded", false).eq("status", "active").not("analysis", "is", null)
    .order("last_crawled_at", { ascending: false }).limit(400);
  const host = (await getSetting(db, "carousel_site_host", "harvestmath.com")).toLowerCase();
  const cand = (pages ?? []).filter((p: any) => String(p.sites?.url ?? "").toLowerCase().includes(host) && !usedIds.has(p.id) && !/\/(calculators?|tools?|about|contact|privacy|terms)(\/|$)/i.test(p.url));
  if (!cand.length) return null;
  const score = (p: any) => (/\/blog\//i.test(p.url) ? 2 : 0) + (/\b(\d+|best|ways|mistakes|tips|ideas|mistake|signs|plants?)\b/i.test(p.title ?? "") ? 1 : 0) + Math.random() * 0.5;
  cand.sort((a: any, b: any) => score(b) - score(a));
  const p = cand[0];
  return { id: p.id, url: p.url, title: p.title, site_id: p.site_id, site_url: p.sites?.url ?? p.url };
}

type Draft = {
  title: string; caption: string; hashtags: string[];
  cover: { heading: string; subline?: string; photo_prompt: string; alt?: string };
  items: { heading: string; body: string; photo_prompt: string; alt?: string }[];
  outro: { heading: string; body?: string; photo_prompt?: string };
};

const SYSTEM = `You write Instagram listicle carousels for a gardening website. Facts must come ONLY from the page text provided: never invent numbers, dates, chemical rates or claims. If the page gives a number, use it exactly.
Rules:
- 5 to 7 list items. Cover heading is the listicle title, max 9 words, uppercase-friendly, starts with the count when the list has one.
- Each item: heading max 7 words, body 1 to 2 short sentences (max 24 words) that give a concrete tip or number from the page.
- Never use em dashes or en dashes. Plain, direct language.
- photo_prompt: a photorealistic editorial garden photo for that slide, natural light, real plants and tools, no people, no text, no logos, no watermark, subject centred. Describe pictures only; never ask for words in the image.
- caption: first line is a hook, then 3 to 4 short lines recapping value, then "Full guide: link in bio". No emojis overload (max 2). No em dashes.
- hashtags: 6 to 8, lowercase, no spaces, relevant to the topic.
- outro heading: a save/share prompt, max 6 words. outro body: one line pointing to the free calculators and guide on the site. outro photo_prompt: a soft, bright background scene (plants, light), same rules as the other photo prompts.
Return JSON: {"title":"","caption":"","hashtags":[],"cover":{"heading":"","subline":"","photo_prompt":"","alt":""},"items":[{"heading":"","body":"","photo_prompt":"","alt":""}],"outro":{"heading":"","body":"","photo_prompt":""}}`;

export async function writeCarouselForUser(userId: string, opts?: { pageId?: string }): Promise<{ created: string | null; reason?: string }> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  let page: Awaited<ReturnType<typeof pickPage>>;
  if (opts?.pageId) {
    const { data: p } = await db.from("pages").select("id, url, title, site_id, sites(url)").eq("id", opts.pageId).eq("user_id", userId).maybeSingle();
    page = p ? { id: p.id, url: p.url, title: p.title, site_id: p.site_id, site_url: (p as any).sites?.url ?? p.url } : null;
  } else page = await pickPage(db, userId);
  if (!page) return { created: null, reason: "no unused page found" };

  const res = await fetch(page.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; PinspiderBot/1.0)" } });
  if (!res.ok) throw new Error(`could not fetch ${page.url}: ${res.status}`);
  const text = pageText(await res.text());
  if (text.length < 600) return { created: null, reason: "page text too short" };

  const { resolveCopyConnection } = await import("./provider-resolution.server");
  const { data: site } = await db.from("sites").select("copy_connection_override_id").eq("id", page.site_id).maybeSingle();
  const copy = await resolveCopyConnection(userId, (site as any)?.copy_connection_override_id ?? null);
  const gen = copy.provider === "anthropic" ? (await import("./anthropic.server")).anthropicJSON : (await import("./openai.server")).openaiJSON;
  const model = copy.provider === "anthropic" ? "claude-sonnet-5" : "gpt-4o-mini";
  const user = `PAGE URL: ${page.url}\nPAGE TITLE: ${page.title ?? ""}\n\nPAGE TEXT:\n${text}`;
  const draft = (await (gen as any)({ apiKey: copy.apiKey, model, system: SYSTEM, user })) as Draft;
  if (!draft?.items?.length || !draft.cover?.heading) throw new Error("model returned an unusable carousel");

  const clean = (s: string | undefined | null) => (s ?? "").replace(/[–—]/g, ",").replace(/\s+/g, " ").trim();
  const items = draft.items.slice(0, 7);
  const tags = (draft.hashtags ?? []).map((t) => "#" + String(t).replace(/^#/, "").replace(/\s+/g, "").toLowerCase()).slice(0, 8);
  const design = (await getSetting(db, "carousel_design", "openai")) === "code" ? "code" : "openai";
  const { data: post, error } = await posts(db).insert({
    design, user_id: userId, site_id: page.site_id, page_id: page.id, page_url: page.url, site_url: page.site_url,
    title: clean(draft.title) || clean(draft.cover.heading), caption: clean(draft.caption).replace(/ Full guide/, "\n\nFull guide"), hashtags: tags.join(" "), status: "photos",
  }).select("id").single();
  if (error) throw error;
  const rows = [
    { kind: "cover", number: null, heading: clean(draft.cover.heading), body: clean(draft.cover.subline), photo_prompt: draft.cover.photo_prompt, alt_text: clean(draft.cover.alt) },
    ...items.map((it, i) => ({ kind: "item", number: i + 1, heading: clean(it.heading), body: clean(it.body), photo_prompt: it.photo_prompt, alt_text: clean(it.alt) })),
    { kind: "outro", number: null, heading: clean(draft.outro?.heading) || "Save this for later", body: clean(draft.outro?.body), photo_prompt: design === "openai" ? (draft.outro?.photo_prompt || draft.cover.photo_prompt) : null, alt_text: clean(draft.cover.alt) },
  ].map((r, i) => ({ ...r, carousel_id: post.id, user_id: userId, position: i + 1 }));
  const ins = await slides(db).insert(rows);
  if (ins.error) throw ins.error;
  await log(db, userId, "info", `drafted "${draft.title}" with ${rows.length} slides from ${page.url}`);
  return { created: post.id };
}

/* ------------------------ 2. photos + slide rendering ------------------------ */

const PHOTO_WRAP = (p: string) =>
  `${p}\nPhotorealistic editorial photograph, natural daylight, shallow depth of field, rich true-to-life colour. The subject sits in the centre of the frame with calm space around it. No text, no letters, no numbers, no logos, no watermark, no people, no hands.`;

// OpenAI draws the whole slide, text included. One shared style block keeps every slide in a carousel consistent.
// Output is 2:3; Instagram wants 4:5, so the renderer centre-crops about 8% off the top and bottom: keep text out of that zone.
const OPENAI_STYLE = `Instagram carousel slide, portrait. Style: bright, airy, natural-light garden photograph filling the whole slide as a softly blurred background, warm and true-to-life colour. Text is set in a clean, friendly rounded sans-serif, dark forest green (#1f4d2b) on soft frosted translucent white rounded cards, with a few lime-yellow (#d9e84a) accents. Every line of text is perfectly spelled, crisp and horizontally centred or neatly left-aligned inside its card with even padding. Keep all text and badges at least 11% away from the top and bottom edges and 6% from the sides. Use exactly the words given below and no other words, numbers, labels, logos or watermarks.`;

function openaiSlidePrompt(s: { kind: string; number: number | null; heading: string; body: string | null; photo_prompt: string | null }, total: number, host: string): string {
  const scene = s.photo_prompt ? `Background photo: ${s.photo_prompt}` : "Background photo: a bright, softly blurred garden scene.";
  if (s.kind === "cover") {
    return `${OPENAI_STYLE}\n${scene}\nLAYOUT: cover. One large frosted card in the upper half holds the title in big bold type, with the key word in a larger brush-script style. ${s.body ? `Under the title, a small lime-yellow pill reads the sub-line.` : ""} A tiny "${host}" pill sits in the upper right corner.\nTITLE: "${s.heading}"${s.body ? `\nSUB-LINE: "${s.body}"` : ""}`;
  }
  if (s.kind === "outro") {
    return `${OPENAI_STYLE}\n${scene}\nLAYOUT: closing slide. A large frosted card in the middle holds a bold heading, one short line under it, and a lime-yellow rounded button.\nHEADING: "${s.heading}"${s.body ? `\nLINE: "${s.body}"` : ""}\nBUTTON: "Link in bio"\nSMALL TEXT under the button: "${host}"`;
  }
  return `${OPENAI_STYLE}\n${scene}\nLAYOUT: list slide ${s.number} of ${Math.max(1, total - 2)}. A round dark-green badge with a white number sits in the top-left corner. A frosted card near the top holds the bold heading. A second frosted card in the lower half holds the tip text in regular weight. The photo shows through between the cards.\nBADGE NUMBER: "${s.number}"\nHEADING: "${s.heading}"\nTIP: "${s.body ?? ""}"`;
}

async function makePhotos(db: Db, userId: string, limit: number) {
  const { data: pend } = await posts(db).select("id, page_id, site_id, design, site_url").eq("user_id", userId).eq("status", "photos").order("created_at").limit(2);
  let done = 0;
  for (const post of pend ?? []) {
    const { data: todo } = await slides(db).select("*").eq("carousel_id", post.id).is("photo_path", null).not("photo_prompt", "is", null).order("position").limit(limit - done);
    if (todo?.length && post.design === "openai") {
      const { earliestConnectionForProvider } = await import("./api-key-connections.server");
      const conn = await earliestConnectionForProvider(userId, "openai");
      if (!conn) throw new Error("No OpenAI key connected: add one in Settings > Integrations, or set carousel_design to 'code'.");
      const { openaiGenerateImage } = await import("./openai-image.server");
      const quality = ((await getSetting(db, "carousel_image_quality", "high")) as "low" | "medium" | "high");
      const { count: total } = await slides(db).select("id", { count: "exact", head: true }).eq("carousel_id", post.id);
      const host = String(post.site_url ?? "harvestmath.com").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      await Promise.all(todo.map(async (s: any) => {
        try {
          const r = await openaiGenerateImage({ apiKey: conn.apiKey, prompt: openaiSlidePrompt(s, total ?? 1, host), size: "1024x1536", quality });
          const path = `${userId}/carousels/${post.id}/raw-${String(s.position).padStart(2, "0")}-${Date.now()}.png`;
          const up = await db.storage.from("pins").upload(path, r.imageBytes, { contentType: r.contentType, upsert: true });
          if (up.error) throw up.error;
          await slides(db).update({ photo_path: path, image_path: null, error: null }).eq("id", s.id);
        } catch (e) {
          await slides(db).update({ error: getErrorMessage(e) }).eq("id", s.id);
        }
      }));
      done += todo.length;
    } else if (todo?.length) {
      const { resolveImageConnection } = await import("./provider-resolution.server");
      const { data: site } = await db.from("sites").select("image_connection_override_id").eq("id", post.site_id).maybeSingle();
      const conn = await resolveImageConnection(userId, (site as any)?.image_connection_override_id ?? null);
      const { renderPinImage } = await import("./pin-render.server");
      const { data: pg } = await db.from("pages").select("images").eq("id", post.page_id).maybeSingle();
      const imgs = Array.isArray((pg as any)?.images) ? ((pg as any).images as { src?: string }[]) : [];
      const refs = imgs.map((i) => i?.src ?? "").filter((s) => /^https?:\/\//i.test(s) && !/\.(svg|ico|gif)(\?|$)|logo|icon|avatar|sprite|favicon|badge|button/i.test(s)).slice(0, 2);
      await Promise.all(todo.map(async (s: any) => {
        try {
          const r = await renderPinImage({ provider: conn.provider as any, prompt: PHOTO_WRAP(s.photo_prompt), apiKey: conn.apiKey, referenceImageUrls: s.kind === "cover" ? refs : [] });
          const ext = r.contentType.includes("png") ? "png" : r.contentType.includes("jpeg") ? "jpg" : "webp";
          const path = `${userId}/carousels/${post.id}/photo-${String(s.position).padStart(2, "0")}-${Date.now()}.${ext}`;
          const up = await db.storage.from("pins").upload(path, r.imageBytes, { contentType: r.contentType, upsert: true });
          if (up.error) throw up.error;
          await slides(db).update({ photo_path: path, image_path: null, error: null }).eq("id", s.id);
        } catch (e) {
          await slides(db).update({ error: getErrorMessage(e) }).eq("id", s.id);
        }
      }));
      done += todo.length;
    }
    const { count } = await slides(db).select("id", { count: "exact", head: true }).eq("carousel_id", post.id).is("photo_path", null).not("photo_prompt", "is", null);
    if (!count) await posts(db).update({ status: "rendering", updated_at: new Date().toISOString() }).eq("id", post.id);
    if (done >= limit) break;
  }
  return done;
}

async function renderSlides(db: Db, userId: string, limit: number) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const { data: pend } = await posts(db).select("id").eq("user_id", userId).eq("status", "rendering").order("created_at").limit(2);
  let done = 0; const autoApprove = (await getSetting(db, "carousel_auto_approve", "false")) === "true";
  for (const post of pend ?? []) {
    const { data: todo } = await slides(db).select("id").eq("carousel_id", post.id).is("image_path", null).order("position").limit(limit - done);
    for (const s of todo ?? []) {
      const r = await fetch(`${base}/functions/v1/render-carousel`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" }, body: JSON.stringify({ slide_id: s.id }),
      });
      if (!r.ok) {
        const msg = `render failed ${r.status}: ${(await r.text()).slice(0, 300)}`;
        await slides(db).update({ error: msg }).eq("id", s.id);
        await log(db, userId, "error", msg);
      } else await slides(db).update({ error: null }).eq("id", s.id);
      done++;
    }
    const { count } = await slides(db).select("id", { count: "exact", head: true }).eq("carousel_id", post.id).is("image_path", null);
    if (!count) {
      if (autoApprove) await approveCarousel(db, userId, post.id);
      else await posts(db).update({ status: "review", updated_at: new Date().toISOString() }).eq("id", post.id);
    }
    if (done >= limit) break;
  }
  return done;
}

export async function buildCarouselsForUser(userId: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const photos = await makePhotos(db, userId, 4);
  const rendered = await renderSlides(db, userId, 4);
  return { photos, rendered };
}

/* ------------------------------ 3. approve + publish ------------------------------ */

export async function approveCarousel(db: Db, userId: string, id: string) {
  const cap = await perDay(db);
  const now = new Date();
  let day = now.getUTCHours() >= WINDOW_END_UTC ? new Date(now.getTime() + 86400000) : now;
  for (let i = 0; i < 60; i++) {
    const d = dayStr(day);
    const { count } = await posts(db).select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["approved", "published"]).eq("scheduled_for", d);
    if ((count ?? 0) < cap) {
      await posts(db).update({ status: "approved", scheduled_for: d, error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
      return d;
    }
    day = new Date(day.getTime() + 86400000);
  }
  throw new Error("no free day in the next 60 days");
}

export async function publishCarouselsForUser(userId: string, opts?: { force?: boolean; id?: string }) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  if (!opts?.force) {
    if ((await getSetting(db, "carousels_paused", "false")) === "true") return { published: 0, reason: "paused" };
    const h = new Date().getUTCHours();
    if (h < WINDOW_START_UTC || h >= WINDOW_END_UTC) return { published: 0, reason: "outside window" };
  }
  const webhook = await getSetting(db, "carousel_webhook_url");
  if (!/^https:\/\//.test(webhook)) return { published: 0, reason: "no carousel_webhook_url set" };
  const today = dayStr(new Date());
  const cap = await perDay(db);
  const { count: already } = await posts(db).select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "published").gte("published_at", `${today}T00:00:00Z`);
  const room = opts?.force ? 1 : Math.max(0, cap - (already ?? 0));
  if (!room) return { published: 0, reason: "daily cap reached" };
  let q = posts(db).select("*").eq("user_id", userId).eq("status", "approved").lte("scheduled_for", today).order("scheduled_for").limit(room);
  if (opts?.id) q = posts(db).select("*").eq("user_id", userId).eq("id", opts.id).limit(1);
  const { data: due } = await q;
  let published = 0;
  for (const p of due ?? []) {
    try {
      const { data: sl } = await slides(db).select("position, image_path, alt_text, heading").eq("carousel_id", p.id).order("position");
      if (!sl?.length || sl.some((s: any) => !s.image_path)) throw new Error("slides are not all rendered");
      const urls: string[] = [];
      for (const s of sl) {
        const signed = await db.storage.from("pins").createSignedUrl(s.image_path, 60 * 60 * 24);
        if (!signed.data?.signedUrl) throw new Error("could not sign slide url");
        urls.push(signed.data.signedUrl);
      }
      const caption = [p.caption, p.hashtags].filter(Boolean).join("\n\n");
      const body: Record<string, unknown> = {
        carousel_id: p.id, title: p.title, caption, page_url: p.page_url, slide_count: urls.length,
        image_urls: urls, alt_texts: sl.map((s: any) => s.alt_text || s.heading),
      };
      urls.forEach((u, i) => { body[`image_${i + 1}`] = u; }); // flat keys are easier to map in Make
      const r = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const txt = (await r.text()).slice(0, 500);
      if (!r.ok) throw new Error(`webhook ${r.status}: ${txt}`);
      await posts(db).update({ status: "published", published_at: new Date().toISOString(), publish_result: { webhook_status: r.status, response: txt }, error: null, updated_at: new Date().toISOString() }).eq("id", p.id);
      await log(db, userId, "info", `sent "${p.title}" to the Instagram webhook`, { id: p.id });
      published++;
    } catch (e) {
      const msg = getErrorMessage(e);
      await posts(db).update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", p.id);
      await log(db, userId, "error", `publish failed: ${msg}`, { id: p.id });
    }
  }
  return { published };
}

export async function briefStageForUser(userId: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  if ((await getSetting(db, "carousels_paused", "false")) === "true") return { created: null, reason: "paused" };
  // Keep a small buffer: do not write more drafts while 3 or more are waiting (review, approved or in progress).
  const { count } = await posts(db).select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["photos", "rendering", "review", "approved"]);
  if ((count ?? 0) >= 3) return { created: null, reason: "buffer full" };
  return writeCarouselForUser(userId);
}
