#!/usr/bin/env bun
// Produces all three blog-post image assets in one command: hero, OG
// card, and Pinterest pin. There was no existing OG-image script in
// this repo to extend (checked before building this) -- this is a new
// script, built on the exact same shared helper as
// scripts/generate-hero.ts (scripts/lib/blog-image-gen.ts): same
// locked style block, same heroSubject, same image-generation client,
// same credential resolution. No separate prompt logic, no second API
// path, no second set of credentials.
//
// Run:
//   npm run blog-images -- <slug>
//   (equivalently: bun run scripts/generate-blog-images.ts <slug>)
//
// Asset decisions (flagged -- not explicitly specified in the original
// request; see docs/blog-image-spec.md's "OG card and Pinterest pin"
// section for the full reasoning):
//  - Hero: 1536x1024 landscape, per the locked spec -- identical to
//    what generate-hero.ts produces on its own.
//  - OG card: reuses the hero image as-is (copied to <slug>-og.png,
//    no separate prompt/generation). The locked block ends in
//    "Landscape 3:2 format", so a separately-composed OG asset would
//    either contradict that fixed sentence or require guessing an
//    unspecified crop/dimension.
//  - Pinterest pin: a genuinely separate, vertical (2:3, size
//    "1024x1536") generation, because Pinterest pins are vertical
//    everywhere else in this app -- reusing the landscape hero here
//    would look wrong on the platform it's for.
//
// Same as generate-hero.ts: doesn't judge the results. Prints every
// prompt and output path, then stops.
import fs from "node:fs";
import {
  requirePostMeta,
  buildHeroPrompt,
  buildPinPrompt,
  renderBlogImage,
  saveImage,
  heroOutputPath,
  ogOutputPath,
  pinOutputPath,
} from "./lib/blog-image-gen";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run blog-images -- <slug>");
    process.exit(1);
  }

  const meta = requirePostMeta(slug);

  // 1. Hero
  const heroPrompt = buildHeroPrompt(meta);
  const heroPath = heroOutputPath(slug);
  console.log(`[blog-images] === Hero ===`);
  console.log(`[blog-images] Prompt sent:\n${heroPrompt}\n`);
  const hero = await renderBlogImage({ prompt: heroPrompt, size: "1536x1024" });
  saveImage(hero.imageBytes, heroPath);
  console.log(`[blog-images] Saved ${hero.imageBytes.byteLength} bytes to ${heroPath} (${hero.modelUsed})\n`);

  // 2. OG card -- reuses the hero image, see file header note.
  const ogPath = ogOutputPath(slug);
  fs.copyFileSync(heroPath, ogPath);
  console.log(`[blog-images] === OG card ===`);
  console.log(`[blog-images] Reused the hero image (no separate prompt) -- copied to ${ogPath}\n`);

  // 3. Pinterest pin -- separate vertical generation, see file header note.
  const pinPrompt = buildPinPrompt(meta);
  const pinPath = pinOutputPath(slug);
  console.log(`[blog-images] === Pinterest pin ===`);
  console.log(`[blog-images] Prompt sent:\n${pinPrompt}\n`);
  const pin = await renderBlogImage({ prompt: pinPrompt, size: "1024x1536" });
  saveImage(pin.imageBytes, pinPath);
  console.log(`[blog-images] Saved ${pin.imageBytes.byteLength} bytes to ${pinPath} (${pin.modelUsed})\n`);

  console.log(`[blog-images] Done -- review all three under public/blog/${slug}-{hero,og,pin}.png. If any is wrong, edit heroSubject for "${slug}" in src/lib/blog-posts.ts and re-run.`);
}

main().catch((err) => {
  console.error("[blog-images] Failed:", err);
  process.exit(1);
});
