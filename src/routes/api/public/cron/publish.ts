import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { processDuePinsForUser } = await import("@/lib/publisher.server");
        // At most 2 pins per run (every 15 minutes) so a backlog can never go out as one burst.
        const out = await forEachUser((uid) => processDuePinsForUser(uid, 2));
        return Response.json(out);
      },
    },
  },
});
