// Blog post metadata registry. There's currently a single blog post,
// served at the hardcoded /learn route (src/routes/learn.tsx) -- this
// registry exists independently of routing, purely so the hero-image
// generation scripts (scripts/generate-hero.ts, scripts/generate-blog-
// images.ts) have one place to look up a post's slug -> heroSubject.
// Future posts get an entry here whether or not routing has grown a
// real /blog/{slug} structure yet.
//
// heroSubject is the ONLY thing that varies per post -- illustration
// style is locked in docs/blog-image-spec.md and is never edited here
// or per-post.
export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  /**
   * One paragraph describing what the hero illustration depicts for
   * this post -- concrete objects/shapes/composition, not style
   * language (style is entirely covered by the locked block in
   * docs/blog-image-spec.md). The generation scripts concatenate
   * `<locked style block> + "\n\n" + heroSubject` as the full prompt.
   */
  heroSubject: string;
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
    // TODO(Raghav): supply the hero subject paragraph for this post.
    // Left empty on purpose rather than guessed -- the generation
    // scripts refuse to run against an empty heroSubject (see
    // requirePostMeta in scripts/lib/blog-image-gen.ts), so this can't
    // silently send a blank-subject prompt to the image provider.
    heroSubject: "",
  },
];

export function findPostMeta(slug: string): PostMeta | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
