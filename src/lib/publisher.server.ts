// Server-only publisher. Chooses API vs Apify vs export mode per user integrations.
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
  let ok = 0, fail = 0, exported = 0;

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

      const pageUrl = (brief as { pages?: { url?: string } }).pages?.url ?? "";
      const input = {
        boardId: board.pinterest_board_id ?? board.id,
        title: brief.title,
        description: brief.description,
        link: pageUrl,
        imageUrl,
        altText: brief.alt_text ?? undefined,
      };

      if (client.mode === "export") {
        await supabaseAdmin.from("scheduled_pins").update({
          status: "exported",
          published_at: new Date().toISOString(),
        }).eq("id", sp.id);
        await supabaseAdmin.from("publish_logs").insert({
          user_id: userId, scheduled_pin_id: sp.id, level: "info", message: "Exported (no Pinterest credentials)",
        });
        exported++;
      } else {
        const result = await client.publish(input);
        await supabaseAdmin.from("scheduled_pins").update({
          status: "published",
          pinterest_pin_id: result.mode === "api" ? result.pinterestPinId : null,
          published_at: new Date().toISOString(),
        }).eq("id", sp.id);
        await supabaseAdmin.from("publish_logs").insert({
          user_id: userId, scheduled_pin_id: sp.id, level: "info", message: `Published via ${result.mode}`,
        });
        ok++;
      }
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
