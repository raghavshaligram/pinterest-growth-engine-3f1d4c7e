import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/carousels")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const stage = new URL(request.url).searchParams.get("stage");
        const c = await import("@/lib/carousels.server");
        // Only accounts listed in autopilot_settings.carousel_user_ids (comma separated) run the carousel lane.
        // Empty or missing means nobody runs it, so a second account on this app is never touched by accident.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const allowed = new Set((await c.getSetting(supabaseAdmin, "carousel_user_ids", "")).split(",").map((x) => x.trim()).filter(Boolean));
        const only = <T,>(fn: (u: string) => Promise<T>) => (u: string) => (allowed.has(u) ? fn(u) : Promise.resolve({ skipped: "not enabled for this account" }));
        if (stage === "brief") return Response.json(await forEachUser(only((u) => c.briefStageForUser(u))));
        if (stage === "build") return Response.json(await forEachUser(only((u) => c.buildCarouselsForUser(u))));
        if (stage === "publish") return Response.json(await forEachUser(only((u) => c.publishCarouselsForUser(u))));
        return Response.json({ error: "stage must be brief, build or publish" }, { status: 400 });
      },
    },
  },
});
