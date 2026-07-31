// Blog post metadata registry. There's currently a single blog post,
// served at the hardcoded /learn route (src/routes/learn.tsx) -- this
// registry exists independently of routing, purely so the featured-
// image generation scripts (scripts/generate-hero.ts, scripts/generate-
// blog-images.ts) have one place to look up a post's metadata. Future
// posts get an entry here whether or not routing has grown a real
// /blog/{slug} structure yet.
//
// heroSubject is the only thing that varies the AI-generated hero --
// its illustration style is locked in docs/blog-image-spec.md and is
// never edited here or per-post. eyebrow/keywords/readTimeMinutes feed
// the code-generated typographic template (scripts/lib/featured-image-
// template.ts) that produces the OG card and Pinterest pin -- no image
// model involved for those two.
export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  /**
   * One paragraph describing what the hero illustration depicts for
   * this post -- concrete objects/shapes/composition, not style
   * language (style is entirely covered by the locked block in
   * docs/blog-image-spec.md). The generation scripts concatenate
   * `<locked style block> + "\n\n" + heroSubject` as the full prompt
   * sent to the image model for the hero only.
   */
  heroSubject: string;
  /** Small tag shown above the headline on the OG card / Pinterest pin, e.g. "Keyword research". */
  eyebrow: string;
  /** Keyword pills shown in the OG card / Pinterest pin's keyword field. */
  keywords: string[];
  /** Shown as "{n} min read" in the OG card / Pinterest pin footer. */
  readTimeMinutes: number;
}

export const BLOG_POSTS: PostMeta[] = [
  {
    // Metadata key only -- decoupled from the live route, which is
    // still hardcoded at /learn (see src/routes/learn.tsx). Not a
    // change to the site's URL structure.
    slug: "pinterest-keyword-research",
    title: "How to Find Pinterest Keywords That Actually Drive Traffic",
    description:
      "A practical guide to Pinterest keyword research: guided search, Pinterest Trends, SERP analysis, competitor board mining, and exactly where to place keywords in your pins.",
    heroSubject:
      "A single large magnifying glass, rendered as a thin near-black outline circle with a short angled handle, positioned slightly left of centre. Its lens is filled with pale pink #FFF5F6. Radiating outward to the right from behind the lens: a branching network of thin grey lines connecting eight to ten small rounded-rectangle nodes of varying widths, arranged in three loose tiers, like a keyword tree. Three of the nodes are filled solid red #E60023; the rest are white with thin grey outlines. The branches thin as they extend right, fading into empty space.",
    eyebrow: "Keyword research",
    keywords: ["guided search", "Pinterest Trends", "SERP analysis", "board names", "alt text", "long-tail"],
    readTimeMinutes: 12,
  },
];

export function findPostMeta(slug: string): PostMeta | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
