// Server-only publisher. Publishes due pins via the user's Pinterest client
// (direct API by default, Make.com webhook if the user opted into publish_mode: "webhook").
export async function processDuePinsForUser(userId: string, limit = 25, onlyId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { makePinterestClient } = await import("./pinterest.server");
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

  const client = await makePinterestClient(userId);
  let ok = 0, fail = 0;
  // No publish mode produces "exported" results anymore (dead "export" mode
  // removed), but the field is kept at 0 for compatibility with schedule.tsx's
  // result toast, which still reads r.exported as a fallback.
  const exported = 0;

  for (const sp of due) {
    try {
      await supabaseAdmin.from("scheduled_pins").update({ status: "publishing", attempts: sp.attempts + 1 }).eq("id", sp.id);
      const { data: brief } = await supabaseAdmin.from("pin_briefs").select("*, pages(url)").eq("id", sp.brief_id).single();
      const { data: img } = await supabaseAdmin.from("pin_images").select("*").eq("id", sp.image_id!).single();
      const { data: board } = await supabaseAdmin.from("boards").select("*").eq("id", sp.board_id!).single();
      if (!brief || !img || !board) throw new Error("Missing brief/image/board");

      const signed = await supabaseAdmin.storage.from("pins").createSignedUrl(img.storage_path, 60 * 60 * 24);
      const imageUrl = signed.data?.signedUrl;
      if (!imageUrl) throw new Error("Could not sign image URL");

      // Direct-API mode needs a real Pinterest board id — an unsynced board
      // (created locally, never synced from Pinterest) can't be published to
      // yet, so fail fast with a clear message instead of a confusing
      // Pinterest 400.
      if (client.mode === "api" && !board.pinterest_board_id) {
        throw new Error(
          'Board is not linked to a Pinterest board — run "Sync boards" in Settings → Integrations, or set publish_mode to "webhook" for this account.',
        );
      }

      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      const input = {
        userId,
        scheduledPinId: sp.id,
        boardId: board.pinterest_board_id ?? board.id,
        title: brief.title,
        description: brief.description,
        link: pageUrl,
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
      const msg = e instanceof Error ? e.message : String(e);
      fail++;
      await supabaseAdmin.from("scheduled_pins").update({ status: "failed", last_error: msg }).eq("id", sp.id);
      await supabaseAdmin.from("publish_logs").insert({
        user_id: userId, scheduled_pin_id: sp.id, level: "error", message: msg,
      });
    }
  }
  return { processed: due.length, ok, fail, exported };
}
