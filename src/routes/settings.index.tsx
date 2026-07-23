// /settings just forwards to the integrations tab. Kept as a leaf
// (settings.index.tsx, not settings.tsx) so it does NOT become the
// parent layout of /settings/integrations — otherwise its redirect
// beforeLoad would fire for the child route too and produce an
// infinite redirect loop.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/integrations" });
  },
});
