import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/serp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getIntegration, DEFAULT_APIFY_ACTOR } = await import("@/lib/integrations.server");
        const { runApifyActor } = await import("@/lib/apify.server");
        const out = await forEachUser(async (uid) => {
          const cfg = await getIntegration(uid, "apify");
          if (!cfg) return { swept: 0 };
          const { data: kws } = await supabaseAdmin
            .from("keywords").select("keyword").eq("user_id", uid).eq("tracked", true).limit(20);
          let swept = 0;
          for (const { keyword } of kws ?? []) {
            try {
              const items = await runApifyActor<{ pinUrl?: string; title?: string; description?: string; imageUrl?: string; boardName?: string; saves?: number }>({
                token: cfg.api_token,
                actorId: cfg.actor_id ?? DEFAULT_APIFY_ACTOR,
                input: { searches: [keyword], maxItems: 25 },
              });
              await supabaseAdmin.from("serp_snapshots").insert({
                user_id: uid, keyword,
                top_pins: items.slice(0, 25).map((p) => ({
                  url: p.pinUrl, title: p.title, description: p.description, image: p.imageUrl, board: p.boardName, saves: p.saves,
                })) as unknown as never,
              });
              swept++;
            } catch { /* skip */ }
          }
          return { swept };
        });
        return Response.json(out);
      },
    },
  },
});
