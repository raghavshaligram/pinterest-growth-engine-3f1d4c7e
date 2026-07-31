#!/usr/bin/env bun
// Produces all three blog-post image assets in one command, via two
// different methods:
//  - Hero: the AI image model (same as scripts/generate-hero.ts --
//    locked style block + this post's heroSubject).
//  - OG card and Pinterest pin: a code-generated typographic template
//    (scripts/lib/featured-image-template.ts, ported from the
//    generate-featured-image.py Raghav supplied) -- no image-model
//    call, no cost. Both need the headline rendered as legible text
//    (a wordless illustration gets no saves as a Pinterest pin, and OG
//    unfurls benefit from a readable title), which is exactly what the
//    typographic template exists to do; the AI illustration stays
//    scoped to the article hero only.
//
// Run:
//   npm run blog-images -- <slug>
//   (equivalently: bun run scripts/generate-blog-images.ts <slug>)
//
// Requires the same env vars as generate-hero.ts for the hero step
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGRATIONS_ENC_KEY,
// BLOG_IMAGE_USER_ID) plus BLOG_IMAGE_FONT_DIR (or the default
// /root/.fonts) pointing at the three Inter/Inter Display font files
// the template needs -- see docs/blog-image-spec.md.
//
// Doesn't attempt to judge any of the three results. Prints the hero
// prompt (so a bad hero can be diagnosed) and all three output paths,
// then stops.
import { requirePostMeta, buildHeroPrompt, renderBlogImage, saveImage, heroOutputPath, ogOutputPath, pinOutputPath } from "./lib/blog-image-gen";
import { renderFeaturedImages } from "./lib/featured-image-template";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run blog-images -- <slug>");
    process.exit(1);
  }

  const meta = requirePostMeta(slug);

  // 1. Hero -- AI image model, heroSubject only.
  const heroPrompt = buildHeroPrompt(meta);
  const heroPath = heroOutputPath(slug);
  console.log(`[blog-images] === Hero (AI image model) ===`);
  console.log(`[blog-images] Prompt sent:\n${heroPrompt}\n`);
  const hero = await renderBlogImage({ prompt: heroPrompt, size: "1536x1024" });
  saveImage(hero.imageBytes, heroPath);
  console.log(`[blog-images] Saved ${hero.imageBytes.byteLength} bytes to ${heroPath} (${hero.modelUsed})\n`);

  // 2 & 3. OG card + Pinterest pin -- typographic template, no image
  // model, no cost. Both come from the same post metadata (title,
  // eyebrow, keywords, readTimeMinutes) in src/lib/blog-posts.ts.
  console.log(`[blog-images] === OG card + Pinterest pin (typographic template, no image-model call) ===`);
  const { ogPng, pinPng } = renderFeaturedImages({
    title: meta.title,
    eyebrow: meta.eyebrow,
    keywords: meta.keywords,
    readTimeMinutes: meta.readTimeMinutes,
  });
  const ogPath = ogOutputPath(slug);
  const pinPath = pinOutputPath(slug);
  saveImage(ogPng, ogPath);
  saveImage(pinPng, pinPath);
  console.log(`[blog-images] Saved ${ogPng.byteLength} bytes to ${ogPath} (1200x630)`);
  console.log(`[blog-images] Saved ${pinPng.byteLength} bytes to ${pinPath} (1000x1500)\n`);

  console.log(`[blog-images] Done -- review all three under public/blog/${slug}-{hero,og,pin}.png. If the hero is wrong, edit heroSubject for "${slug}" in src/lib/blog-posts.ts. If the OG/pin text or keywords are wrong, edit title/eyebrow/keywords/readTimeMinutes for "${slug}" instead -- neither needs a script change.`);
}

main().catch((err) => {
  console.error("[blog-images] Failed:", err);
  process.exit(1);
});
