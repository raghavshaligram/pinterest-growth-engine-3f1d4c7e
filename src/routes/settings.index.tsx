// Standalone route -- bare /settings just forwards to the integrations
// tab. settings.integrations.tsx is its own top-level PinShell route
// now, so this is a redirect-only sibling, not a parent with an
// Outlet.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/integrations" });
  },
});
