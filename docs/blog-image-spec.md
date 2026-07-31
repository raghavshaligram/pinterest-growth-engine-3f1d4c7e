# Blog hero-image spec

This is the locked prompt spec for every blog post's featured/hero
illustration. `scripts/generate-hero.ts` and `scripts/generate-blog-
images.ts` read the style block below directly out of this file (see
the `LOCKED-STYLE-BLOCK` markers) -- it is not copy-pasted into the
scripts, so this file is the single source of truth.

## Locked style block

**Never edit this block per-post.** It is the constant across every
post. The only thing that changes per post is that post's `heroSubject`
in `src/lib/blog-posts.ts` (one paragraph describing what the
illustration depicts), which gets concatenated onto this block at
generation time.

<!-- LOCKED-STYLE-BLOCK:START -->
Flat vector illustration, editorial tech-blog style. Pure 2D — no perspective, no isometric, no 3D. Clean geometric shapes with crisp edges, no gradients, no drop shadows, no textures. Background is flat near-white #FDFDFD, edge to edge, no border or frame. Palette strictly limited to: vivid red #E60023 as the single accent, near-black #111827 for linework and solid forms, cool grey #9CA3AF for secondary elements, pale pink #FFF5F6 for fills. No other colours. Linework is uniform-weight and thin. Composition is centred with generous negative space, subject occupying roughly the middle 60% of the frame. Absolutely no text, no letterforms, no numbers, no UI labels anywhere in the image. Landscape 3:2 format.
<!-- LOCKED-STYLE-BLOCK:END -->

## Rules (restated from the block above, for quick reference)

- Exactly **one** red (`#E60023`) element per illustration carries the
  emphasis -- it's the single accent, not a repeated color.
- **Never include text** in the image -- the post's H1 sits directly
  below the hero, so a text-free image is a hard requirement, not a
  style preference.
- Output size: **1536×1024** (matches the block's "Landscape 3:2
  format" sentence, and is one of gpt-image-1's three fixed size
  presets -- see the provider note below).
- Save to `public/blog/{slug}-hero.png`.

## Per-post subject

Each post's `heroSubject` (in `src/lib/blog-posts.ts`) is one
paragraph describing what the illustration depicts -- concrete
objects/shapes/composition, not style language (style is entirely
covered by the locked block above). The generation scripts concatenate
`<locked style block> + "\n\n" + heroSubject` as the full prompt sent
to the image provider.

## Credential / provider notes (script-level, not part of the prompt)

- Generation goes through the app's own image-generation client
  (`renderPinImage` in `src/lib/pin-render.server.ts`) and the app's
  own credential resolution (`resolveImageConnection` in
  `src/lib/provider-resolution.server.ts`) -- the same functions real
  pin generation uses. No separate API path, no second set of
  credentials.
- `resolveImageConnection` is keyed on a Supabase `userId` (it resolves
  that account's default/earliest-connected image provider). The blog
  isn't a customer "site", so there's no existing site row to hang this
  off of -- the scripts require a `BLOG_IMAGE_USER_ID` env var (the
  Supabase auth user id whose connected image-provider key should be
  used for blog assets) and call `resolveImageConnection(userId, null)`
  exactly like production code does for a site with no override.
- The requested 1536×1024 size is only honored when the resolved
  provider is **OpenAI** (`gpt-image-1` supports exactly three size
  presets: `1024x1024`, `1536x1024`, `1024x1536`, plus `auto` --
  confirmed against OpenAI's API reference). `resolveImageConnection`'s
  fallback chain defaults to `openai` for any account with no explicit
  image-provider default, so this is the common case. If the resolved
  account has explicitly set a different image provider as its
  default, the script still generates an image but a warning is printed
  since `renderPinImage`'s other 6 provider branches don't yet accept a
  size override (only the OpenAI branch does -- an additive, backward-
  compatible change; see the comment in `pin-render.server.ts`).

## `npm run blog-images` -- OG card and Pinterest pin (beyond the hero)

**Correction (superseding an earlier version of this section):** the OG
card and Pinterest pin do NOT use the AI image model at all -- neither
as a copy of the hero nor as a separate generation. Both need the
headline rendered as legible text (a wordless illustration gets no
saves as a Pinterest pin, and OG unfurls benefit from a readable
title), which the locked style block above explicitly forbids ("no
text, no letterforms... anywhere in the image") since it's written for
the article hero specifically, where the H1 sits directly below.

Instead, both are produced by a code-generated **typographic template**
-- a direct TypeScript port of `generate-featured-image.py` (supplied
by Raghav) at `scripts/lib/featured-image-template.ts`. No image-model
call, no cost, fully deterministic. One template, two crops:

- **OG card**: 1200×630, saved to `public/blog/{slug}-og.png`.
- **Pinterest pin**: 1000×1500 (2:3), saved to `public/blog/{slug}-pin.png`.

Design vocabulary is lifted from the article page itself: white ground,
a 6px `#E60023` top bar, the same red vertical rule that precedes every
H2 (here beside the headline), Inter Display Black for the headline
(tight negative tracking, matching the article), an eyebrow pill above
the headline, a keyword-pill field (matching the article's Example
callout KeywordPill component) below it, and a footer with a red dot +
"pinspider.com" on the left and "{n} min read" on the right.

Per-post inputs -- `title`, `eyebrow`, `keywords`, and `readTimeMinutes`
on `PostMeta` (`src/lib/blog-posts.ts`) -- drive both crops; there's no
separate prompt to write for these two, and no AI result to judge. If
the rendered text/keywords are wrong, the fix is those `PostMeta`
fields, not the script.

### Font files required (not shipped in this repo)

The template needs the real Inter / Inter Display font files at
generation time (same requirement `generate-featured-image.py` already
had):

- `InterDisplay-Black.ttf`
- `Inter-Bold.ttf`
- `Inter-SemiBold.ttf`

Default location: `/root/.fonts` (matching the Python original).
Overridable via the `BLOG_IMAGE_FONT_DIR` env var for machines where
`/root` isn't writable or the fonts live elsewhere. Get them from
Inter's official static distribution (rsms.me/inter or Google Fonts) --
note the web app itself only loads "Inter" up to weight 700 from Google
Fonts' CDN (see `__root.tsx`), not "Inter Display" or weight 900
(Black), so these three files need to be provisioned separately; they
aren't already present anywhere in this repo or its CDN font-loading.

### New dependencies

`fontkit` (text measurement, for the same greedy line-wrapping the
Python original does with PIL's `ImageFont.getbbox`) and
`@resvg/resvg-js` (SVG → PNG rasterization, in place of `cairosvg`) --
both added to `package.json` devDependencies. Run `bun install` (or
`npm install`) after applying this change before `npm run blog-images`
will work; a patch can't install packages or update the lockfile for
you.
