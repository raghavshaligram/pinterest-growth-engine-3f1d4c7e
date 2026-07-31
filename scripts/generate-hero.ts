#!/usr/bin/env bun
// Generates one blog post's hero image: the locked style block
// (docs/blog-image-spec.md) concatenated with that post's heroSubject
// (src/lib/blog-posts.ts), sent through the app's own image-generation
// client and credential resolution (see scripts/lib/blog-image-gen.ts
// for exactly which functions this reuses -- no separate API path, no
// second set of credentials).
//
// Run:
//   npm run hero -- <slug>
//   (equivalently: bun run scripts/generate-hero.ts <slug>)
//
// Requires the same env vars the app itself needs to resolve a
// provider connection -- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// INTEGRATIONS_ENC_KEY -- plus BLOG_IMAGE_USER_ID (see
// docs/blog-image-spec.md's "Credential / provider notes").
//
// Doesn't attempt to judge the result. Prints the full prompt and the
// output path, then stops. If the image is wrong, the fix is
// heroSubject in src/lib/blog-posts.ts, not this script.
import { requirePostMeta, buildHeroPrompt, renderBlogImage, saveImage, heroOutputPath } from "./lib/blog-image-gen";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run hero -- <slug>");
    process.exit(1);
  }

  const meta = requirePostMeta(slug);
  const prompt = buildHeroPrompt(meta);
  const outPath = heroOutputPath(slug);

  console.log(`[hero] Post: ${slug}`);
  console.log(`[hero] Prompt sent:\n${prompt}\n`);

  const rendered = await renderBlogImage({ prompt, size: "1536x1024" });
  saveImage(rendered.imageBytes, outPath);

  console.log(`[hero] Saved ${rendered.imageBytes.byteLength} bytes to ${outPath}`);
  console.log(`[hero] Model: ${rendered.modelUsed}`);
  console.log(`[hero] Done -- review the image at ${outPath}. If it's wrong, edit heroSubject for "${slug}" in src/lib/blog-posts.ts and re-run.`);
}

main().catch((err) => {
  console.error("[hero] Failed:", err);
  process.exit(1);
});
