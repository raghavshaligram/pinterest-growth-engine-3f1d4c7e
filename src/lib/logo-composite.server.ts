// Server-only. Deterministically composites a site's uploaded logo onto
// an already-generated pin image.
//
// ARCHITECTURE (v2) -- this replaces two prior attempts, both of which
// relied on the image-generation model to reliably leave/render space
// for the logo, which it didn't:
//   v0: pass the logo as a reference image to the provider and ask it to
//       place the logo itself. OpenAI's /v1/images/edits treats a
//       supplied reference image as the base canvas to EDIT, not a small
//       asset to insert into a separately-described new scene, so this
//       produced an edited logo, not a themed pin with the logo in it.
//   v1: ask the model to render a completely blank solid-color bar at an
//       assumed position ("flush to the very bottom edge, same position
//       as a URL bar") and composite the logo into that assumed pixel
//       fraction of the canvas afterward. This still trusted the model
//       to leave a distinct, correctly-positioned blank zone every time
//       -- it didn't: on quick_tip_grid the CTA pill rendered all the way
//       to the bottom with no separate strip at all, so the logo landed
//       on top of the CTA text instead of a blank bar.
//
// v2 (this file) stops asking the model to reserve ANY space for the
// logo. buildThemedPinPrompt (briefs.functions.ts) instead asks for
// content that ends with the CTA band flush against the canvas's real
// bottom edge -- nothing below it, no zone to get wrong. Here, in code:
//   1. Read the model's ACTUAL returned image dimensions (never assume a
//      fixed pixel size -- neither provider is ever given an exact
//      `size`/dimensions parameter, so nothing is pixel-guaranteed).
//   2. GROW the canvas by appending a brand-accent-color band below the
//      model's fully-intact output (never crop, resize, or overlay onto
//      the model's real content -- it is blitted in unmodified).
//   3. Composite the logo into that guaranteed-clean synthesized band.
// There is no "hope the model left blank space" step anywhere in this
// path anymore -- the band is created by us, not detected or assumed.
import { Jimp, JimpMime } from "jimp";
import type { LogoPlacement } from "@/lib/sites.functions";

// The synthesized band's height as a fraction of the CONTENT image's
// own height (i.e. the model's actual output, before this band is
// appended) -- matches the visual weight the old URL-bar zone had,
// except now guaranteed to exist rather than assumed to have been
// rendered by the model.
const BAND_HEIGHT_FRACTION_OF_CONTENT = 0.075;
const LOGO_MAX_HEIGHT_FRACTION_OF_BAND = 0.68;
const SIDE_MARGIN_FRACTION = 0.04;
// Safe dark-neutral fallback -- accent_color is DB-trigger-assigned on
// every site (see 20260720120000_site_accent_color.sql) so this should
// never actually be hit, but a malformed/missing value here would
// otherwise throw mid-render rather than degrade gracefully.
const FALLBACK_BAND_COLOR = 0x2d2a26ff;

function parseHexColor(hex: string | null | undefined): number {
  // Jimp color ints are 0xRRGGBBAA. Built via arithmetic rather than a
  // left-shift -- `<<` coerces to a SIGNED 32-bit int in JS, so any accent
  // color whose red channel is >= 0x80 (e.g. "#8067AD") produced a
  // negative number here and crashed Jimp's buffer write. Multiplication
  // avoids the sign issue entirely.
  if (!hex) return FALLBACK_BAND_COLOR;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return FALLBACK_BAND_COLOR;
  return parseInt(m[1], 16) * 256 + 0xff;
}

export async function compositeLogoOntoPin(opts: {
  baseImageBytes: Uint8Array;
  logoBytes: Uint8Array;
  placement: LogoPlacement;
  accentColor?: string | null;
}): Promise<{ imageBytes: Uint8Array; contentType: string }> {
  const [content, logo] = await Promise.all([
    Jimp.read(Buffer.from(opts.baseImageBytes)),
    Jimp.read(Buffer.from(opts.logoBytes)),
  ]);

  const canvasW = content.width;
  const contentH = content.height;
  const bandH = Math.max(1, Math.round(contentH * BAND_HEIGHT_FRACTION_OF_CONTENT));
  const totalH = contentH + bandH;

  // Fresh, taller canvas filled with the brand accent color -- the
  // synthesized band. The model's content is blitted onto it unmodified
  // (no crop/resize/stretch of the model's actual output); everything
  // below contentH is guaranteed solid and empty until the logo is
  // placed into it below.
  const canvas = new Jimp({ width: canvasW, height: totalH, color: parseHexColor(opts.accentColor) });
  canvas.blit({ src: content, x: 0, y: 0 });

  const margin = Math.round(canvasW * SIDE_MARGIN_FRACTION);
  const maxLogoH = Math.max(1, Math.round(bandH * LOGO_MAX_HEIGHT_FRACTION_OF_BAND));
  logo.resize({ h: maxLogoH });
  // Height-constrained resize preserves aspect ratio, but a very wide
  // wordmark-style logo could still overflow the side margins after
  // that -- re-constrain by width too so placement math below never
  // goes negative or off-canvas.
  const maxLogoW = Math.max(1, canvasW - 2 * margin);
  if (logo.width > maxLogoW) {
    logo.resize({ w: maxLogoW });
  }

  const y = contentH + Math.round((bandH - logo.height) / 2);
  const x =
    opts.placement === "bottom-left" ? margin
    : opts.placement === "bottom-right" ? canvasW - logo.width - margin
    : Math.round((canvasW - logo.width) / 2);

  canvas.blit({ src: logo, x, y });

  const imageBytes = await canvas.getBuffer(JimpMime.png);
  return { imageBytes, contentType: "image/png" };
}
