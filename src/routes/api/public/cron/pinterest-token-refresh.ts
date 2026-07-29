// Proactive Pinterest refresh-token renewal. Separate cadence from every
// other cron route here -- this isn't a per-user sweep via
// cron.server.ts's forEachUser (that iterates distinct user_ids from the
// `integrations` table, which would miss a user who only ever holds
// pinterest_connections rows and no `integrations` row at all); it
// queries pinterest_connections directly instead, since that's the
// actual thing being refreshed.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/pinterest-token-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { refreshPinterestConnectionsNearingExpiry } = await import("@/lib/pinterest-connections.server");
        const out = await refreshPinterestConnectionsNearingExpiry();
        return Response.json(out);
      },
    },
  },
});
