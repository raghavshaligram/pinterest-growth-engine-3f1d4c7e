// Shared helper for scripts/generate-hero.ts and
// scripts/generate-blog-images.ts -- one place for: reading the locked
// style block out of docs/blog-image-spec.md, looking up a post's
// heroSubject, resolving the image-generation credential through the
// app's own resolution logic, and calling the app's own image-
// generation client. Neither CLI script duplicates any of this.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PostMeta } from "../../src/lib/blog-posts";
import { findPostMeta } from "../../src/lib/blog-posts";
import type { ImageProvider } from "../../src/lib/sites.functions";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SPEC_PATH = path.join(REPO_ROOT, "docs", "blog-image-spec.md");
const OUTPUT_DIR = path.join(REPO_ROOT, "public", "blog");

const STYLE_BLOCK_START = "<!-- LOCKED-STYLE-BLOCK:START -->";
const STYLE_BLOCK_END = "<!-- LOCKED-STYLE-BLOCK:END -->";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. See docs/blog-image-spec.md's "Credential / provider notes" section for what's needed.`,
    );
  }
  return value;
}

/** Reads the locked style block verbatim out of docs/blog-image-spec.md --
 *  never hardcoded in a script, so the spec file is the one source of
 *  truth for the constant part of every hero prompt. */
export function readStyleBlock(): string {
  const raw = fs.readFileSync(SPEC_PATH, "utf-8");
  const start = raw.indexOf(STYLE_BLOCK_START);
  const end = raw.indexOf(STYLE_BLOCK_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `Could not find the locked style block in ${SPEC_PATH} -- expected "${STYLE_BLOCK_START}" ... "${STYLE_BLOCK_END}" markers.`,
    );
  }
  return raw.slice(start + STYLE_BLOCK_START.length, end).trim();
}

/** Looks up a post's metadata by slug and refuses to proceed with an
 *  empty heroSubject, so a not-yet-written subject can't silently send
 *  a blank/style-only prompt to the image provider. */
export function requirePostMeta(slug: string): PostMeta {
  const meta = findPostMeta(slug);
  if (!meta) {
    throw new Error(`No post found for slug "${slug}" in src/lib/blog-posts.ts.`);
  }
  if (!meta.heroSubject.trim()) {
    throw new Error(
      `Post "${slug}" has an empty heroSubject in src/lib/blog-posts.ts -- add a one-paragraph description of what the hero illustration should depict, then re-run.`,
    );
  }
  return meta;
}

/** Locked style block + this post's subject -- the hero/OG prompt. */
export function buildHeroPrompt(meta: PostMeta): string {
  return `${readStyleBlock()}\n\n${meta.heroSubject.trim()}`;
}

/** Same as buildHeroPrompt, but for the Pinterest-pin variant: swaps the
 *  locked block's "Landscape 3:2 format." sentence for a vertical one,
 *  since Pinterest pins are vertical everywhere else in this app (see
 *  the hardcoded aspect_ratio: "2:3" in renderPinImage's Replicate
 *  branch). This is a script-level substitution done at generation
 *  time -- docs/blog-image-spec.md's own block is never edited. Flagged
 *  in scripts/generate-blog-images.ts's own output, and documented in
 *  the spec file's "OG card and Pinterest pin" section. */
export function buildPinPrompt(meta: PostMeta): string {
  const styleBlock = readStyleBlock();
  const verticalStyleBlock = styleBlock.replace(/Landscape 3:2 format\.?\s*$/, "Portrait 2:3 format.");
  if (verticalStyleBlock === styleBlock) {
    throw new Error(
      `Expected the locked style block to end with "Landscape 3:2 format." so it could be swapped for the Pinterest-pin variant, but didn't find it -- check docs/blog-image-spec.md hasn't changed shape.`,
    );
  }
  return `${verticalStyleBlock}\n\n${meta.heroSubject.trim()}`;
}

/** Resolves the image-generation credential through the app's own
 *  resolution logic (resolveImageConnection) -- the exact function real
 *  pin generation uses. The blog isn't a customer "site", so there's no
 *  site row to hang a credential off of; BLOG_IMAGE_USER_ID (a Supabase
 *  auth user id) stands in for that, with siteOverrideConnectionId left
 *  null, matching how a site with no override resolves. */
async function resolveBlogImageCredential() {
  const userId = requireEnv("BLOG_IMAGE_USER_ID");
  const { resolveImageConnection } = await import("../../src/lib/provider-resolution.server");
  return resolveImageConnection(userId, null);
}

/** Generates one image through the app's own image-generation client
 *  (renderPinImage) -- same function, same provider dispatch, same
 *  credentials as real pin generation. No separate API path. */
export async function renderBlogImage(opts: {
  prompt: string;
  size?: string;
}): Promise<{ imageBytes: Uint8Array; contentType: string; modelUsed: string }> {
  const resolved = await resolveBlogImageCredential();
  const { renderPinImage } = await import("../../src/lib/pin-render.server");
  // Same widen-then-pass pattern image-worker.server.ts already uses:
  // resolveImageConnection's ApiKeyProvider is a superset of
  // renderPinImage's ImageProvider (it also covers "anthropic", a
  // copy-only provider) -- images resolution's fallback chain is
  // ["openai"] only, so this is always actually an ImageProvider value
  // at runtime for this call path.
  const provider = resolved.provider as ImageProvider;
  const rendered = await renderPinImage({ provider, prompt: opts.prompt, apiKey: resolved.apiKey, size: opts.size });
  if (opts.size && provider !== "openai") {
    console.warn(
      `[blog-image-gen] Requested size ${opts.size}, but the resolved provider "${provider}" doesn't have a verified size override yet -- the image was generated at that provider's own default/aspect behavior instead. Only "openai" honors an explicit size today (see renderPinImage in src/lib/pin-render.server.ts).`,
    );
  }
  return rendered;
}

export function saveImage(bytes: Uint8Array, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);
}

export function heroOutputPath(slug: string): string {
  return path.join(OUTPUT_DIR, `${slug}-hero.png`);
}

export function ogOutputPath(slug: string): string {
  return path.join(OUTPUT_DIR, `${slug}-og.png`);
}

export function pinOutputPath(slug: string): string {
  return path.join(OUTPUT_DIR, `${slug}-pin.png`);
}
