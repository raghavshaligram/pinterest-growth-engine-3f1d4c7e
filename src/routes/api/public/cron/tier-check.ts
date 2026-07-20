// Weekly cap-adjustment sweep. Separate cadence from cron/materialize.ts
// (nightly) — this only recomputes account_publishing_profiles'
// current_daily_cap (see weekly-tier-check.server.ts); it doesn't touch
// scheduled_pins at all.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/tier-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { runWeeklyCapCheck } = await import("@/lib/weekly-tier-check.server");
        const out = await forEachUser((uid) => runWeeklyCapCheck(uid));
        return Response.json(out);
      },
    },
  },
});
