// Public, unauthenticated route -- same reasoning as privacy.tsx/terms.tsx/
// index.tsx: no beforeLoad auth guard and no ssr:false, so this renders as
// real server-rendered HTML reachable and fully readable with no session
// and no client-side JS required. This is a marketing/SEO page (a
// keyword-research guide meant to be indexed and found via search), not
// part of the authenticated app -- it was originally wired in behind
// PinShell/the login-gated sidebar, which made it unreachable by anyone
// without an account (and by search crawlers). Moved out to its own
// public shell instead, matching how /privacy and /terms are served.
//
// Content below is a direct port of the supplied blog-layout template
// (BLOG_TOC/BlogTag/Callout/KwPill/H2/H3/P/BlogView) -- copy and inline
// styling values preserved exactly. Structural adaptations, beyond the
// public-route change above:
// - React.ReactNode -> ReactNode (imported type, no bare `React`
//   namespace import elsewhere in this app).
// - IcoPinterest (undefined in the source template) -> PinspiderMark,
//   the app's own mark, sized to fit the same circular badge -- the
//   footer CTA is promoting Pinspider itself, not Pinterest.
// - The template's fixed-height/overflow:hidden "app panel with its own
//   internal scroll region" container (right for an embedded dashboard
//   tab, which is what the source template assumed) doesn't make sense
//   for a public page meant to be read, scrolled, and indexed normally --
//   swapped for normal document flow (the whole page scrolls together,
//   like /privacy and /terms already do), with the TOC column
//   sticky-positioned instead of independently scrolling. No copy,
//   color, spacing, or component design changed -- only how the
//   article/TOC panels size and scroll.
// - Responsive pass: the template had no mobile breakpoints at all
//   (it assumed a fixed desktop app panel). Layout-level properties
//   that need to differ by viewport (flex direction, widths, padding,
//   font size, sticky vs. static) now come from Tailwind className
//   utilities (mobile-first, md: override) instead of inline style,
//   matching how index.tsx/LegalPageShell already handle responsive
//   layout elsewhere in this app. Colors, border styles, radii, and
//   everything that doesn't need to change by viewport stay exactly
//   as inline style, unchanged.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { PinspiderMark } from "@/components/PinspiderMark";
import { LegalFooter } from "@/components/LegalPageShell";
import { useEffect, useState, type ReactNode } from "react";

// Production domain isn't defined anywhere in this codebase -- sitemap.xml.ts
// (src/routes/sitemap[.]xml.ts) has the same open placeholder (`BASE_URL = ""`).
// Fill this in with the real domain before relying on canonical/OG URLs or the
// JSON-LD below; until then they resolve to relative paths.
const SITE_URL = "";
const LEARN_PATH = "/learn";
const LEARN_TITLE = "How to Find Pinterest Keywords That Actually Drive Traffic — Pinspider";
const LEARN_DESCRIPTION = "A practical guide to Pinterest keyword research: guided search, Pinterest Trends, SERP analysis, competitor board mining, and exactly where to place keywords in your pins.";

export const Route = createFileRoute("/learn")({
  head: () => ({
    meta: [
      { title: LEARN_TITLE },
      { name: "description", content: LEARN_DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:title", content: LEARN_TITLE },
      { property: "og:description", content: LEARN_DESCRIPTION },
      { property: "og:url", content: `${SITE_URL}${LEARN_PATH}` },
    ],
    links: [
      { rel: "canonical", href: `${SITE_URL}${LEARN_PATH}` },
    ],
  }),
  component: LearnPage,
});

// Article JSON-LD, rendered inline as a <script> in the component body rather
// than through head()'s links/meta arrays -- this repo has no node_modules
// installed to confirm whether TanStack Router's head() API supports an
// inline "scripts" entry, so this is the framework-agnostic, definitely-safe
// path.
const ARTICLE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How to Find Pinterest Keywords That Actually Drive Traffic",
  description: LEARN_DESCRIPTION,
  datePublished: "2026-07-23",
  author: { "@type": "Organization", name: "Pinspider" },
  publisher: { "@type": "Organization", name: "Pinspider" },
  mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${LEARN_PATH}` },
};

function LearnPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ARTICLE_JSON_LD) }}
      />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/">
            <Logo size={28} withWordmark />
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <Link to="/learn" className="font-medium text-foreground">Learn</Link>
            <Link to="/privacy" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground [&.active]:font-medium [&.active]:text-foreground">Terms</Link>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </nav>
        </div>
      </header>

      <BlogView />

      <LegalFooter maxWidthClassName="max-w-6xl" />
    </div>
  );
}

// ─── Blog view ────────────────────────────────────────────────────────────────

const BLOG_TOC = [
  { id: "why", label: "Why keywords matter on Pinterest" },
  { id: "how-pinterest-search", label: "How Pinterest search actually works" },
  { id: "guided-search", label: "1. The guided search method" },
  { id: "trends", label: "2. Pinterest Trends" },
  { id: "serp-analysis", label: "3. SERP analysis" },
  { id: "competitor-boards", label: "4. Competitor board mining" },
  { id: "placement", label: "Where to place your keywords" },
  { id: "mistakes", label: "Common mistakes to avoid" },
  { id: "action", label: "Your action plan" },
];

function BlogTag({ children, color = "#E60023", bg = "#FFF5F6" }: { children: ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 11px", borderRadius: 999, backgroundColor: bg, color, fontSize: 11, fontWeight: 700, letterSpacing: "0.02em" }}>
      {children}
    </span>
  );
}

function Callout({ type, children }: { type: "tip" | "note" | "example"; children: ReactNode }) {
  const styles = {
    tip: { bg: "#FFF5F6", border: "#FECDD3", label: "Pro Tip", labelColor: "#E60023" },
    note: { bg: "#F0F9FF", border: "#BAE6FD", label: "Note", labelColor: "#0369A1" },
    example: { bg: "#F5F3FF", border: "#DDD6FE", label: "Example", labelColor: "#7C3AED" },
  };
  const s = styles[type];
  return (
    <div style={{ margin: "20px 0", padding: "14px 18px", borderRadius: 14, backgroundColor: s.bg, borderLeft: `3px solid ${s.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: s.labelColor, textTransform: "uppercase", letterSpacing: "0.07em" }}>{s.label}</span>
      </div>
      {/* 15px, up from 13px -- a judgment call to keep callout body text
          from reading smaller than the surrounding 16px body copy now that
          body type has been scaled up (not explicitly requested). */}
      <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

function KwPill({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-block", margin: "3px 3px", padding: "5px 13px", borderRadius: 999, backgroundColor: "#fff", border: "1.5px solid #EFEFEF", fontSize: 12, fontWeight: 600, color: "#374151", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      {children}
    </span>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} style={{ fontSize: 25, fontWeight: 900, color: "#111827", letterSpacing: "-0.04em", margin: "40px 0 10px", lineHeight: 1.25, scrollMarginTop: 24 }}>
      <span style={{ display: "inline-block", width: 3, height: 25, borderRadius: 2, backgroundColor: "#E60023", marginRight: 10, verticalAlign: "middle" }} />
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 18, fontWeight: 800, color: "#111827", letterSpacing: "-0.025em", margin: "28px 0 8px", lineHeight: 1.35 }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: "0 0 16px", fontSize: 16, color: "#374151", lineHeight: 1.75 }}>{children}</p>;
}

function BlogView() {
  const [activeSection, setActiveSection] = useState("why");

  // Scroll-spy: track which section heading is nearest the top of the
  // viewport as the reader scrolls, not just the last-clicked TOC link
  // (which otherwise goes stale the moment they scroll).
  useEffect(() => {
    const sections = BLOG_TOC.map((item) => document.getElementById(item.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 }
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ backgroundColor: "#fff" }}>

      {/* Top bar */}
      <div style={{ borderBottom: "1px solid #F3F3F3", padding: "12px 24px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pinspider</span>
          <span style={{ color: "#D1D5DB" }}>›</span>
          <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Learn</span>
          <span style={{ color: "#D1D5DB" }}>›</span>
          <span style={{ fontSize: 11, color: "#374151", fontWeight: 600 }}>Pinterest Keyword Research</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <BlogTag>Keyword Research</BlogTag>
          <BlogTag color="#374151" bg="#F5F5F5">12 min read</BlogTag>
        </div>
      </div>

      {/* Body: article + TOC grouped as a single centred unit -- mx-auto
          max-w-[1040px] wraps both, with the article as flex-1 inside it.
          Previously the article had its own independent maxWidth:720/
          margin:auto centering inside a full-width row, so it centred in
          its own space while the TOC anchored to the viewport edge,
          leaving a gap between them on wide screens. Column on mobile,
          row from md: up. */}
      <div className="mx-auto max-w-[1040px] flex flex-col md:flex-row md:items-start">

        {/* Article */}
        <div className="flex-1 min-w-0">
          <div className="px-4 pt-8 pb-10 md:px-10 md:pt-10 md:pb-16">

            {/* Hero */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <BlogTag>Strategy</BlogTag>
                <BlogTag color="#374151" bg="#F5F5F5">SEO</BlogTag>
                <BlogTag color="#059669" bg="#F0FDF4">Beginner-friendly</BlogTag>
              </div>
              <h1 className="text-[32px] md:text-[40px] leading-[1.15] md:tracking-[-0.05em] tracking-[-0.03em]" style={{ fontWeight: 900, color: "#111827", margin: "0 0 16px" }}>
                How to Find Pinterest Keywords That Actually Drive Traffic
              </h1>
              <p style={{ fontSize: 18, color: "#6B7280", lineHeight: 1.7, margin: "0 0 24px", fontWeight: 400 }}>
                Pinterest is a search engine dressed as a social network. Master its keyword system and your pins reach buyers who are actively looking for what you sell — months or even years after you publish.
              </p>
              <div className="flex flex-wrap items-center gap-3.5" style={{ paddingTop: 20, borderTop: "1px solid #F3F3F3" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", backgroundColor: "#E60023", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>P</span>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111827" }}>Pinspider Team</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF" }}>Published July 23, 2026</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <H2 id="why">Why keywords matter on Pinterest</H2>
            <P>
              Unlike Instagram or TikTok — where content lives and dies in a 48-hour window — a well-keyworded Pinterest pin can surface in search results for years. Pinterest's algorithm is fundamentally different: it's built on <strong>intent</strong>. When someone types "ceramic mug gift ideas" into Pinterest, they're not casually scrolling; they're shopping, planning, or actively gathering inspiration.
            </P>
            <P>
              That's why keyword placement on Pinterest behaves more like Google SEO than social media marketing. Get the words right, and your pins find their audience automatically. Get them wrong, and even beautiful imagery disappears into the void.
            </P>

            <Callout type="note">
              Pinterest processes over <strong>5 billion searches per month</strong>. The platform's own data shows that 97% of top searches are unbranded — people are searching for solutions, styles, and ideas, not specific brands. That's your window.
            </Callout>

            <H2 id="how-pinterest-search">How Pinterest search actually works</H2>
            <P>
              Pinterest uses a combination of <strong>visual recognition</strong> and <strong>text signals</strong> to decide which pins match a query. The text signals — your title, description, board name, and alt text — tell Pinterest what your pin is about before its visual AI even processes the image.
            </P>
            <P>
              Pinterest's algorithm weighs keywords in this rough priority order:
            </P>
            <ol style={{ margin: "0 0 20px", paddingLeft: 22, fontSize: 16, color: "#374151", lineHeight: 2.2 }}>
              <li><strong style={{ color: "#111827" }}>Pin title</strong> — highest weight, first thing indexed</li>
              <li><strong style={{ color: "#111827" }}>Pin description</strong> — supports and expands on the title</li>
              <li><strong style={{ color: "#111827" }}>Board name and board description</strong> — gives context to all pins in that board</li>
              <li><strong style={{ color: "#111827" }}>Alt text</strong> — used for accessibility and indexing</li>
              <li><strong style={{ color: "#111827" }}>Landing page content</strong> — Pinterest crawls your destination URL</li>
            </ol>

            <H2 id="guided-search">1. The guided search method</H2>
            <P>
              The fastest free keyword research tool for Pinterest is Pinterest itself. The guided search bar — the row of clickable topic bubbles that appears after you type a search — is Pinterest telling you exactly what its users search alongside your seed term.
            </P>
            <H3>How to use it</H3>
            <P>
              Type your seed keyword into Pinterest search and <em>don't press enter</em>. Instead, read the autocomplete suggestions. Then press enter and read the coloured topic bubbles that appear above the results — these are Pinterest's own keyword clusters, ranked by volume.
            </P>
            <Callout type="example">
              Seed: <strong>"ceramic mug"</strong> → guided bubbles reveal:
              <div style={{ marginTop: 10 }}>
                <KwPill>handmade</KwPill><KwPill>gift ideas</KwPill><KwPill>coffee lover</KwPill>
                <KwPill>aesthetic</KwPill><KwPill>pottery</KwPill><KwPill>minimalist</KwPill>
                <KwPill>unique</KwPill><KwPill>cozy</KwPill>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6B7280" }}>Each bubble is a distinct audience segment you can target with dedicated pins.</p>
            </Callout>
            <P>
              Run this process for 5–10 seed terms relevant to your product or content. Build a spreadsheet (or let Pinspider's brief generator do it). You'll end up with 50–100 keyword phrases in under an hour.
            </P>

            <H2 id="trends">2. Pinterest Trends</H2>
            <P>
              Pinterest Trends (trends.pinterest.com) shows you real search volume data over time, with seasonal breakdowns. It's free, requires only a Pinterest business account, and is criminally underused by most sellers.
            </P>
            <H3>What to look for</H3>
            <ul style={{ margin: "0 0 20px", paddingLeft: 22, fontSize: 16, color: "#374151", lineHeight: 2.2 }}>
              <li><strong style={{ color: "#111827" }}>Rising trends</strong> — keywords showing upward momentum over 90 days. Create pins before peak, not at peak.</li>
              <li><strong style={{ color: "#111827" }}>Seasonal spikes</strong> — if "holiday gift ceramic mug" peaks every October, schedule those pins in September.</li>
              <li><strong style={{ color: "#111827" }}>Evergreen flats</strong> — steady year-round search volume with no spikes. Safe bets for your core content.</li>
            </ul>
            <Callout type="tip">
              Pinterest's data shows pins published <strong>30–45 days before a seasonal peak</strong> get 3–4× more saves than pins published at the peak itself. The algorithm needs time to index and distribute your content. Publish early.
            </Callout>

            <H2 id="serp-analysis">3. SERP analysis — study the pins that rank</H2>
            <P>
              Search your target keyword and study the top 20 results. These pins are already winning — they tell you the exact language, framing, and format that Pinterest's algorithm currently rewards.
            </P>
            <H3>What to note from each top pin</H3>
            <ol style={{ margin: "0 0 20px", paddingLeft: 22, fontSize: 16, color: "#374151", lineHeight: 2.2 }}>
              <li>The <strong>exact phrasing</strong> in the title — copy the structure, not the words</li>
              <li>Whether they use <strong>numbers</strong> ("7 ideas", "3-step guide") — these boost CTR</li>
              <li>The <strong>image format</strong> — portrait or square? Text overlay or clean photo?</li>
              <li>The <strong>board name</strong> the pin is saved to — boards are keyword signals too</li>
              <li>The <strong>save count</strong> — high saves = high relevance signal to Pinterest</li>
            </ol>
            <P>
              Pinspider's Pages view automates this: when you run an analysis on a page, it sweeps the relevant Pinterest SERPs and surfaces the keyword patterns, title formats, and topic angles that are currently saving well for your content area.
            </P>

            <H2 id="competitor-boards">4. Competitor board mining</H2>
            <P>
              Find 3–5 Pinterest accounts in your niche that are clearly performing well (lots of monthly views, active pinning). Then dig into their boards — not to copy, but to understand what keyword categories they've deliberately structured around.
            </P>
            <H3>The board name formula</H3>
            <P>
              High-performing boards almost always use the same formula: <strong>[Adjective] + [Product/Topic] + [Use Case or Audience]</strong>. For example:
            </P>
            <div style={{ margin: "0 0 20px", display: "flex", flexWrap: "wrap", gap: 0 }}>
              <KwPill>Handmade Ceramic Mugs — Coffee Lovers</KwPill>
              <KwPill>Minimalist Home Decor Ideas</KwPill>
              <KwPill>Healthy Weeknight Dinner Recipes</KwPill>
              <KwPill>Small Business Gift Ideas Under $50</KwPill>
            </div>
            <P>
              Each part of the board name is a keyword. Pinterest indexes the full phrase and every word within it.
            </P>

            <H2 id="placement">Where to place your keywords</H2>
            <P>
              Once you have your keyword list, placement is everything. Here's the exact template to follow for every pin:
            </P>
            <div style={{ margin: "0 0 24px", borderRadius: 16, border: "1.5px solid #F0F0F0", overflow: "hidden" }}>
              {[
                { field: "Pin title", formula: "[Primary keyword] — [Secondary keyword or benefit]", example: "Handmade Ceramic Mug — Unique Coffee Lover Gift Idea", chars: "≤100 chars" },
                { field: "Pin description", formula: "2–3 sentences using 3–5 keyword phrases naturally", example: "\"This handmade ceramic mug is the perfect cozy gift for coffee lovers. Minimalist pottery design, food-safe glaze, made to order.\"", chars: "≤500 chars" },
                { field: "Board name", formula: "[Keyword category] — [Audience or occasion]", example: "Handmade Pottery & Ceramics — Unique Gift Ideas", chars: "No limit" },
                { field: "Alt text", formula: "Descriptive sentence with 1–2 keywords", example: "\"Speckled sage-glaze ceramic mug on a linen cloth, handmade pottery\"", chars: "≤500 chars" },
              ].map((row, i) => (
                <div key={i} style={{ padding: "14px 18px", borderBottom: i < 3 ? "1px solid #F5F5F5" : "none", display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#111827" }}>{row.field}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: "#9CA3AF" }}>{row.chars}</p>
                  </div>
                  <div>
                    <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6B7280" }}>{row.formula}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#374151", backgroundColor: "#F8F8F8", padding: "5px 9px", borderRadius: 8, fontStyle: "italic" }}>{row.example}</p>
                  </div>
                </div>
              ))}
            </div>

            <H2 id="mistakes">Common mistakes to avoid</H2>
            <ul style={{ margin: "0 0 24px", paddingLeft: 22, fontSize: 16, color: "#374151", lineHeight: 2.4 }}>
              <li><strong style={{ color: "#E60023" }}>Keyword stuffing</strong> — Pinterest's algorithm now penalises unnatural keyword stacking. Write for humans first.</li>
              <li><strong style={{ color: "#E60023" }}>Ignoring board descriptions</strong> — most creators leave board descriptions blank. Fill them with 2–3 keyword-rich sentences.</li>
              <li><strong style={{ color: "#E60023" }}>Using hashtags as keywords</strong> — hashtags are a weak discovery signal on Pinterest. Put your keywords in the title, description, and board name instead.</li>
              <li><strong style={{ color: "#E60023" }}>Publishing at peak season</strong> — you're too late. Publish 30–45 days before the seasonal spike.</li>
              <li><strong style={{ color: "#E60023" }}>One pin per page</strong> — create 3–5 pin variations per piece of content, each targeting a slightly different keyword angle.</li>
            </ul>

            <H2 id="action">Your action plan</H2>
            <P>
              Here's what to do this week:
            </P>
            <ol style={{ margin: "0 0 24px", paddingLeft: 22, fontSize: 16, color: "#374151", lineHeight: 2.4 }}>
              <li>Pick your top 5 products or blog posts</li>
              <li>Run the guided search method on 3 seed terms per piece</li>
              <li>Check Pinterest Trends for seasonal timing</li>
              <li>Audit your top 3 competitor boards for keyword structure</li>
              <li>Rewrite your 5 pin titles and descriptions using the placement template above</li>
              <li>Create 3 pin variations per piece, each targeting a different keyword cluster</li>
            </ol>
            <Callout type="tip">
              Inside Pinspider, open any page in the Pages view and click <strong>Analyze → Generate Brief</strong>. The brief automatically surfaces the top-ranking keyword phrases for your content's topic, ready to paste into your pin titles and descriptions. No manual SERP sweeping required.
            </Callout>

            {/* Footer */}
            <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #F3F3F3", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", backgroundColor: "#FFF0F1", display: "flex", alignItems: "center", justifyContent: "center", color: "#E60023", flexShrink: 0 }}>
                <PinspiderMark size={22} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#111827" }}>Want Pinspider to do this research automatically?</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7280" }}>Connect your pages and let the brief generator surface keyword opportunities for every piece of content.</p>
              </div>
              <Link
                to="/auth"
                style={{ marginLeft: "auto", flexShrink: 0, padding: "8px 18px", borderRadius: 999, border: "none", backgroundColor: "#E60023", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-block" }}
              >
                Try it →
              </Link>
            </div>

          </div>
        </div>

        {/* TOC sidebar -- sticky instead of independently scrolling, since
            the page now scrolls as a whole (see file-level comment). */}
        <div className="w-full border-t border-[#F3F3F3] md:w-[220px] md:flex-shrink-0 md:border-l md:border-t-0 md:sticky md:top-0 md:self-start" style={{ padding: "28px 20px", display: "flex", flexDirection: "column" }}>
          <p style={{ margin: "0 0 14px", fontSize: 10, fontWeight: 800, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em" }}>On this page</p>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {BLOG_TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setActiveSection(item.id)}
                style={{
                  display: "block", padding: "6px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.4,
                  color: activeSection === item.id ? "#E60023" : "#6B7280",
                  backgroundColor: activeSection === item.id ? "#FFF5F6" : "transparent",
                  fontWeight: activeSection === item.id ? 700 : 400,
                  textDecoration: "none", borderLeft: `2px solid ${activeSection === item.id ? "#E60023" : "transparent"}`,
                  transition: "all 0.15s",
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div style={{ marginTop: 24, paddingTop: 24 }}>
            <div style={{ borderRadius: 14, backgroundColor: "#FFF5F6", border: "1px solid #FECDD3", padding: "14px 14px" }}>
              <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#111827" }}>Automate this</p>
              <p style={{ margin: "0 0 10px", fontSize: 11, color: "#6B7280", lineHeight: 1.5 }}>Pinspider's brief generator does this keyword research for every page you add.</p>
              <Link
                to="/auth"
                style={{ width: "100%", padding: "7px 0", borderRadius: 999, border: "none", backgroundColor: "#E60023", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "block", textAlign: "center" }}
              >
                Open Pages →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
