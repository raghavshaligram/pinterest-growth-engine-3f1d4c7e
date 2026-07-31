// Public landing page. Unlike every authenticated route (dashboard.tsx,
// schedule.tsx, etc.), this does NOT set ssr:false or check auth in
// beforeLoad -- there's no data to fetch and the content is fully
// static, so it renders as real server-rendered HTML on first paint
// (same reasoning as privacy.tsx/terms.tsx). An already-logged-in
// visitor is bounced to /dashboard via a client-side session check
// after mount, mirroring auth.tsx's own existing "already signed in ->
// redirect" effect exactly, rather than a server-side beforeLoad guard
// that would require ssr:false and hide this page from anyone without
// a session -- including Pinterest's own review of it.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { LegalFooter } from "@/components/LegalPageShell";
import { Globe, Wand2, Calendar, BarChart3 } from "lucide-react";

const CONTACT_EMAIL = "support@pinspider.com";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pinspider — Pinterest SEO & Auto-Pinning" },
      { name: "description", content: "Pinspider crawls your site, generates on-brand pin images and copy, schedules them to your Pinterest boards, and tracks what's working with Google Analytics." },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: Globe,
    title: "Crawls your site",
    description: "Add a site and its sitemap; Pinspider reads each page's content so every pin is grounded in what's actually there.",
  },
  {
    icon: Wand2,
    title: "Generates pin images and copy",
    description: "On-brand pin images and Pinterest-ready titles, descriptions, and hashtags, generated from that page content using the AI provider you connect.",
  },
  {
    icon: Calendar,
    title: "Schedules to your boards",
    description: "Queue pins to the Pinterest boards you choose, on a schedule you set, and publish automatically from there.",
  },
  {
    icon: BarChart3,
    title: "Tracks performance via Google Analytics",
    description: "Connect Google Analytics to see which pins are actually driving traffic back to your site, per site.",
  },
] as const;

function LandingPage() {
  const navigate = useNavigate();

  // Same pattern as auth.tsx: check for an existing session once,
  // client-side, after mount -- not a beforeLoad guard, so the page
  // itself always renders first.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo size={28} withWordmark />
          <div className="flex items-center gap-5">
            <Link to="/learn" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Learn
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
            >
              Log in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-primary" />
            Pinterest growth engine
          </div>
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">
            Turn your website into a steady stream of <span className="text-gradient-primary">Pinterest pins</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Pinspider crawls the pages you add, generates on-brand pin images and copy from them, and schedules
            the results to your own Pinterest boards -- so new pages keep turning into new pins without you
            doing it by hand.
          </p>
          <div className="mt-8">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-md bg-gradient-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow transition-all hover:brightness-110 hover:-translate-y-0.5"
            >
              Log in to Pinspider
            </Link>
          </div>
        </section>

        <section className="border-t border-border bg-card/40">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="rounded-lg border border-border bg-card p-5">
                  <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary-soft">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <h3 className="font-display text-base">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <DashboardScreenshot />
        </section>
      </main>

      <LegalFooter maxWidthClassName="max-w-6xl" contactEmail={CONTACT_EMAIL} />
    </div>
  );
}

// Placeholder image slot for the real dashboard screenshot. This page
// is server-rendered (no ssr:false -- see the file header), which means
// an <img> pointed at a file that doesn't exist yet gets requested by
// the browser as soon as the SSR'd HTML streams in, before React
// hydrates and can attach an onError handler -- the fallback-on-error
// approach tried here previously lost that race and left the browser's
// native broken-image icon on screen instead of swapping to a
// placeholder. Flipping a plain boolean instead of depending on a
// client-side error event sidesteps the race entirely: nothing ever
// requests a missing file, so there's nothing to fail.
//
// To wire in the real screenshot: save it at
// public/marketing/dashboard-screenshot.png and flip this to true.
const HAS_SCREENSHOT = false;

function DashboardScreenshot() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
      </div>
      {HAS_SCREENSHOT ? (
        <img
          src="/marketing/dashboard-screenshot.png"
          alt="Pinspider dashboard showing scheduled and published pins"
          className="block w-full"
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-muted/30 px-6 text-center">
          <span className="text-sm font-medium text-muted-foreground">Dashboard screenshot</span>
          <span className="text-xs text-muted-foreground">
            Drop the image in at public/marketing/dashboard-screenshot.png, then set HAS_SCREENSHOT to true above.
          </span>
        </div>
      )}
    </div>
  );
}
