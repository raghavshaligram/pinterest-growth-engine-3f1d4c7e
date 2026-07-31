// Shared chrome for the two public, unauthenticated legal pages
// (/privacy, /terms). Deliberately NOT PinShell -- PinShell assumes an
// authenticated user (sidebar nav, sign-out, SiteProvider) and renders
// full-height/overflow-hidden, which is wrong for a long scrolling
// document that needs to be reachable and fully readable with no
// session at all. This reuses the same design tokens (styles.css) and
// the same header lockup pattern as auth.tsx (the other public page)
// instead of inventing new colors/type -- no new design system.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

export function LegalPageShell({
  title, lastUpdated, intro, children,
}: {
  title: string;
  lastUpdated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/auth">
            <Logo size={28} withWordmark />
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link to="/learn" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">Learn</Link>
            <Link to="/privacy" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">Terms</Link>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        {intro && <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">{intro}</div>}
        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <LegalFooter />
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

// Small reusable bits so section content stays plain JSX (paragraphs,
// lists) without every route re-typing the same Tailwind classes.
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function LegalEmail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="font-medium text-primary hover:underline">
      {address}
    </a>
  );
}

// maxWidthClassName/contactEmail are opt-in so the two existing legal
// pages render byte-identical to before (default 3xl width, no email
// link) -- the landing page (routes/index.tsx) is the only caller that
// passes a wider container and a contact email, rather than this
// component forking into two near-duplicate footers.
export function LegalFooter({
  maxWidthClassName = "max-w-3xl", contactEmail,
}: {
  maxWidthClassName?: string;
  contactEmail?: string;
}) {
  return (
    <footer className="border-t border-border">
      <div className={`mx-auto flex ${maxWidthClassName} flex-col gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}>
        <span>&copy; {new Date().getFullYear()} Pinspider</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/learn" className="hover:text-foreground">Learn</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms of Service</Link>
          {contactEmail && (
            <a href={`mailto:${contactEmail}`} className="hover:text-foreground">{contactEmail}</a>
          )}
          <Link to="/auth" className="hover:text-foreground">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
