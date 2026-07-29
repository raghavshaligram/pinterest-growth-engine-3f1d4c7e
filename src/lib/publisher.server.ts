import { getErrorMessage } from "@/lib/error-message";
// Server-only publisher. Publishes due pins via the SITE's own mapped
// Pinterest connection (direct API by default, or that connection's own
// webhook if it's set to publish_mode: "webhook") -- resolved per
// scheduled pin, not once for the whole batch, since different pins in
// the same batch can belong to different sites mapped to different
// Pinterest connections. Previously this read one account-wide
// `integrations` row for the entire batch regardless of site, which was
// the actual root cause of the site-isolation bug (a site's pins would
// silently publish through whichever Pinterest account the account
// happened to have connected, not necessarily the one that site was
// meant to use).
export async function processDuePinsForUser(userId: string, limit = 25, onlyId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { makePinterestClientForSite } = await import("./pinterest.server");
  const nowIso = new Date().toISOString();
  let q = supabaseAdmin
    .from("scheduled_pins")
    .select("id, brief_id, image_id, board_id, attempts, scheduled_at")
    .eq("user_id", userId)
    .eq("status", "queued")
    .limit(limit);
  if (onlyId) q = q.eq("id", onlyId);
  else q = q.lte("scheduled_at", nowIso);
  const { data: due, error } = await q;
  if (error) throw error;
  if (!due?.length) return { processed: 0 };

  let ok = 0, fail = 0;
  // No publish mode produces "exported" results anymore (dead "export" mode
  // removed), but the field is kept at 0 for compatibility with schedule.tsx's
  // result toast, which still reads r.exported as a fallback.
  const exported = 0;

  for (const sp of due) {
    try {
      await supabaseAdmin.from("scheduled_pins").update({ status: "publishing", attempts: sp.attempts + 1 }).eq("id", sp.id);
      // pages(url, site_id) -- site_id is what resolves this specific
      // pin's Pinterest connection below; url is still the destination
      // link's source, same as before.
      const { data: brief } = await supabaseAdmin.from("pin_briefs").select("*, pages(url, site_id)").eq("id", sp.brief_id).single();
      const { data: img } = await supabaseAdmin.from("pin_images").select("*").eq("id", sp.image_id!).single();
      const { data: board } = await supabaseAdmin.from("boards").select("*").eq("id", sp.board_id!).single();
      if (!brief || !img || !board) throw new Error("Missing brief/image/board");

      const siteId = (brief as { pages?: { site_id?: string } }).pages?.site_id;
      if (!siteId) throw new Error("Could not resolve which site this pin belongs to");
      const client = await makePinterestClientForSite({ siteId, userId });

      const signed = await supabaseAdmin.storage.from("pins").createSignedUrl(img.storage_path, 60 * 60 * 24);
      const imageUrl = signed.data?.signedUrl;
      if (!imageUrl) throw new Error("Could not sign image URL");

      // Direct-API mode needs a real Pinterest board id — an unsynced board
      // (created locally, never synced from Pinterest) can't be published to
      // yet, so fail fast with a clear message instead of a confusing
      // Pinterest 400.
      if (client.mode === "api" && !board.pinterest_board_id) {
        throw new Error(
          'Board is not linked to a Pinterest board — run "Sync boards" on the Boards page, or switch this site\'s Pinterest connection to "webhook" mode in Settings → Integrations.',
        );
      }

      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      // Tag the destination link with UTM params keyed on brief.id so
      // GA4's sessionManualContent dimension can be joined back to a
      // specific brief/template on the Insights page.
      const { buildUtmLink } = await import("./utm");
      const taggedLink = buildUtmLink(pageUrl, brief.id);
      const input = {
        userId,
        scheduledPinId: sp.id,
        boardId: board.pinterest_board_id ?? board.id,
        title: brief.title,
        description: brief.description,
        link: taggedLink,
        imageUrl,
        altText: brief.alt_text ?? undefined,
      };

      const result = await client.publish(input);
      const pinId = result.pinterestPinId ?? null;
      await supabaseAdmin.from("scheduled_pins").update({
        status: "published",
        pinterest_pin_id: pinId,
        published_at: new Date().toISOString(),
      }).eq("id", sp.id);
      await supabaseAdmin.from("publish_logs").insert({
        user_id: userId, scheduled_pin_id: sp.id, level: "info", message: `Published via ${result.mode}${pinId ? ` (${pinId})` : ""}`,
      });
      ok++;
    } catch (e) {
      const msg = getErrorMessage(e);
      fail++;
      await supabaseAdmin.from("scheduled_pins").update({ status: "failed", last_error: msg }).eq("id", sp.id);
      await supabaseAdmin.from("publish_logs").insert({
        user_id: userId, scheduled_pin_id: sp.id, level: "error", message: msg,
      });
    }
  }
  return { processed: due.length, ok, fail, exported };
}
