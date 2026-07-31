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

These two additional assets weren't given their own style/size spec in
the original request, so the choices below are the script's own
(flagged, not silently assumed):

- **OG card**: reuses the hero image as-is (same landscape 1536×1024
  file, copied to `public/blog/{slug}-og.png`). The locked block above
  ends in "Landscape 3:2 format", so a separately-composed OG asset
  would either contradict that fixed sentence or require guessing an
  unspecified crop/dimension. Reusing the hero avoids both -- OG
  platforms auto-scale/crop regardless of the exact source dimensions.
- **Pinterest pin**: generated as a genuinely separate, vertical
  (2:3, size `1024x1536`) image, saved to `public/blog/{slug}-pin.png`.
  Pinterest pins are vertical everywhere else in this app (see the
  hardcoded `aspect_ratio: "2:3"` in the Replicate branch of
  `renderPinImage`), so reusing the landscape hero for an actual
  Pinterest pin would look wrong on the platform it's meant for.
  The script swaps only the locked block's final "Landscape 3:2
  format." sentence for "Portrait 2:3 format." at generation time --
  this file's own block is never edited; the substitution happens in
  `scripts/lib/blog-image-gen.ts`.
