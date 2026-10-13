// Supabase edge function: renders ONE carousel slide to a 1080x1350 PNG.
// Body: { slide_id }. Called by the Pinspider cron with the service role key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { renderSlide } from "./render.ts";

function toDataUri(bytes: Uint8Array, type: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

Deno.serve(async (req) => {
  try {
    const { slide_id } = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: s, error } = await db.from("carousel_slides").select("*, carousel_posts(site_url, design)").eq("id", slide_id).single();
    if (error || !s) throw new Error(error?.message ?? "slide not found");
    const { count } = await db.from("carousel_slides").select("id", { count: "exact", head: true }).eq("carousel_id", s.carousel_id);
    let photo: string | null = null;
    if (s.photo_path) {
      const dl = await db.storage.from("pins").download(s.photo_path);
      if (dl.error) throw dl.error;
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      photo = toDataUri(buf, dl.data.type || "image/png");
    }
    const host = String(s.carousel_posts?.site_url ?? "harvestmath.com").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const png = s.carousel_posts?.design === "openai"
      ? await renderSlide({ kind: "fit", position: s.position, total: count ?? 1, heading: "", photo, brand: host })
      : await renderSlide({
      kind: s.kind, position: s.position, total: count ?? 1, number: s.number,
      heading: s.heading, body: s.body, photo, brand: host,
    });
    const path = `${s.user_id}/carousels/${s.carousel_id}/slide-${String(s.position).padStart(2, "0")}-${Date.now()}.png`;
    const up = await db.storage.from("pins").upload(path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw up.error;
    await db.from("carousel_slides").update({ image_path: path }).eq("id", slide_id);
    return Response.json({ ok: true, path });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
