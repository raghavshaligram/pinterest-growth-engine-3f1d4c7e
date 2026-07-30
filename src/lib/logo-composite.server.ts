// Server-only. Deterministically composites a site's uploaded logo onto
// an already-generated pin image, at a fixed pixel position within the
// LOCKED LAYOUT's footer zone.
//
// This exists because the FIRST attempt at logo compositing (asking the
// image-generation model itself to "place the logo in the footer bar"
// via reference-image input + prompt instruction, see git history on
// pin-render.server.ts) didn't reliably work -- OpenAI's /v1/images/edits
// treats a supplied reference image as the base canvas to edit, not as a
// small asset to insert into a separately-described new scene, so
// handing it just the logo produced an edited version of the logo
// itself rather than a themed pin with the logo composited in. This is
// the same root-cause pattern as the earlier hex-code/palette-swatch
// leaks in buildThemedPinPrompt: relying on a generative model to
// faithfully execute a precise compositional instruction from text
// alone is unreliable. The fix there was translating hex codes to
// plain-language color names and stripping literal leaks defensively;
// the fix here is the same philosophy taken further -- don't ask the
// model to place the logo at all. Instead:
//   1. buildThemedPinPrompt asks for a plain, blank, solid-color footer
//      bar when display_mode is 'logo' (no text, no logo, nothing) --
//      see its own wantsLogo branch.
//   2. This module composites the real logo image onto that blank bar
//      afterward, in code, where placement is exact and guaranteed
//      rather than hoped for.
import { Jimp, JimpMime } from "jimp";
import type { LogoPlacement } from "@/lib/sites.functions";

// The footer/URL-bar zone is only ever described in relative terms in
// the prompt ("a thin, full-width bar flush to the very bottom edge") --
// there's no exact pixel contract with the image model for where that
// bar actually lands, so this is a deliberate, conservative estimate of
// its height as a fraction of the canvas, chosen to comfortably contain
// that bar without encroaching on the CTA band above it.
const FOOTER_ZONE_HEIGHT_FRACTION = 0.07;
const LOGO_MAX_HEIGHT_FRACTION_OF_ZONE = 0.68;
const SIDE_MARGIN_FRACTION = 0.04;

export async function compositeLogoOntoPin(opts: {
  baseImageBytes: Uint8Array;
  logoBytes: Uint8Array;
  placement: LogoPlacement;
}): Promise<{ imageBytes: Uint8Array; contentType: string }> {
  const [base, logo] = await Promise.all([
    Jimp.read(Buffer.from(opts.baseImageBytes)),
    Jimp.read(Buffer.from(opts.logoBytes)),
  ]);

  const canvasW = base.width;
  const canvasH = base.height;
  const zoneH = Math.round(canvasH * FOOTER_ZONE_HEIGHT_FRACTION);
  const zoneTop = canvasH - zoneH;
  const maxLogoH = Math.max(1, Math.round(zoneH * LOGO_MAX_HEIGHT_FRACTION_OF_ZONE));

  // Height-constrained resize -- Jimp scales width to match
  // proportionally when only `h` is given, so the logo's own aspect
  // ratio (square, wide wordmark, tall mark, whatever was uploaded) is
  // always preserved rather than stretched.
  logo.resize({ h: maxLogoH });

  const margin = Math.round(canvasW * SIDE_MARGIN_FRACTION);
  const y = zoneTop + Math.round((zoneH - logo.height) / 2);
  const x =
    opts.placement === "bottom-left" ? margin
    : opts.placement === "bottom-right" ? canvasW - logo.width - margin
    : Math.round((canvasW - logo.width) / 2);

  base.blit({ src: logo, x, y });

  const imageBytes = await base.getBuffer(JimpMime.png);
  return { imageBytes, contentType: "image/png" };
}
