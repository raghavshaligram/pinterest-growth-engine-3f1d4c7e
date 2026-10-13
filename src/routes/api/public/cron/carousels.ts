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
        if (stage === "brief") return Response.json(await forEachUser((u) => c.briefStageForUser(u)));
        if (stage === "build") return Response.json(await forEachUser((u) => c.buildCarouselsForUser(u)));
        if (stage === "publish") return Response.json(await forEachUser((u) => c.publishCarouselsForUser(u)));
        return Response.json({ error: "stage must be brief, build or publish" }, { status: 400 });
      },
    },
  },
});
