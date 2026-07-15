import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { processDuePinsForUser } = await import("@/lib/publisher.server");
        const out = await forEachUser((uid) => processDuePinsForUser(uid, 25));
        return Response.json(out);
      },
    },
  },
});
