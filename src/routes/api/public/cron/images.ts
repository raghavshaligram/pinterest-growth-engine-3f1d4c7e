import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/images")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const { processImageQueueForUser } = await import("@/lib/image-worker.server");
        const out = await forEachUser((uid) => processImageQueueForUser(uid, 10));
        return Response.json(out);
      },
    },
  },
});
