// Faithful TypeScript port of generate-featured-image.py (supplied by
// Raghav) -- the code-generated typographic template used for the OG
// card and Pinterest pin. One template, two crops, no image-model call
// and no cost: builds an SVG string from post metadata (title, eyebrow,
// keywords, read time) using the same layout formulas as the Python
// original, then rasterizes it with the real Inter / Inter Display font
// files (see FONT_DIR below) via @resvg/resvg-js.
//
// Design vocabulary matches the article page itself: white ground,
// #E60023 accent, Inter Display tight-tracked, the red vertical rule
// that precedes every H2, and the keyword-pill component used inside
// Example callouts.
//
// Deliberately mirrors the Python original's structure/variable names
// (measure/wrapToWidth/pill/pillField/build) rather than being
// restructured, so the two stay easy to compare and keep in sync if the
// Python source changes.
//
// The AI image model is NOT used anywhere in this file -- see
// docs/blog-image-spec.md: the model is for the article hero only. A
// wordless illustration doesn't work as an OG card or Pinterest pin,
// both of which need the headline rendered as legible text.
import * as fontkit from "fontkit";
import { Resvg } from "@resvg/resvg-js";

export interface FeaturedImagePost {
  title: string;
  eyebrow: string;
  keywords: string[];
  readTimeMinutes: number;
}

const RED = "#E60023";
const INK = "#111827";
const MUTED = "#9CA3AF";
const PILL_BORDER = "#EFEFEF";
const WASH = "#FFF5F6";

// Same convention the Python original used (/root/.fonts) -- these
// three files must exist on whatever machine runs `npm run blog-images`.
// Overridable via BLOG_IMAGE_FONT_DIR for local/dev machines where
// /root isn't writable or fonts live elsewhere. See docs/blog-image-
// spec.md for where to get them (Inter's official static distribution).
const FONT_DIR = process.env.BLOG_IMAGE_FONT_DIR ?? "/root/.fonts";
const F_BLACK = `${FONT_DIR}/InterDisplay-Black.ttf`;
const F_BOLD = `${FONT_DIR}/Inter-Bold.ttf`;
const F_SEMI = `${FONT_DIR}/Inter-SemiBold.ttf`;

const fontCache = new Map<string, fontkit.Font>();
function loadFont(fontPath: string): fontkit.Font {
  let font = fontCache.get(fontPath);
  if (!font) {
    font = fontkit.openSync(fontPath) as fontkit.Font;
    fontCache.set(fontPath, font);
  }
  return font;
}

// Roughly matches ImageFont.truetype(font_path, size).getbbox(text)[2]
// for wrapping purposes -- fontkit gives the shaped run's total advance
// width in font units, scaled to the point size. (This is an
// advance-width measure rather than PIL's ink-bbox measure; the two can
// differ by a few px at most, which doesn't matter for a wrapping
// heuristic whose max_w already has margin built in.)
function measure(text: string, fontPath: string, size: number): number {
  const font = loadFont(fontPath);
  const run = font.layout(text);
  return (run.advanceWidth / font.unitsPerEm) * size;
}

// Greedy wrap accounting for negative letter-spacing -- direct port of
// wrap_to_width().
function wrapToWidth(text: string, fontPath: string, size: number, maxW: number, tracking: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = `${cur} ${w}`.trim();
    const width = measure(trial, fontPath, size) + tracking * (trial.length - 1);
    if (width <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Keyword pill, matching the article's KeywordPill component. Direct
// port of pill() -- including the original's `fill` value, which is
// "#FFFFFF" regardless of `ghost` in the Python source (the ghost/
// non-ghost branches evaluate to the same string there); preserved
// as-is rather than "fixed", since this is a port, not a redesign.
function pill(
  x: number,
  y: number,
  label: string,
  opts: { size?: number; opacity?: number; ghost?: boolean } = {},
): { svg: string; width: number } {
  const { size = 17, opacity = 1.0, ghost = false } = opts;
  const tw = measure(label, F_SEMI, size);
  const w = tw + 34;
  const h = size + 20;
  const fill = "#FFFFFF";
  const stroke = PILL_BORDER;
  const svg =
    `<g opacity="${opacity}">` +
    `<rect x="${x}" y="${y}" width="${w.toFixed(0)}" height="${h}" rx="${h / 2}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
    `<text x="${(x + w / 2).toFixed(0)}" y="${(y + h / 2 + size * 0.35).toFixed(0)}" text-anchor="middle" ` +
    `font-family="Inter" font-weight="600" font-size="${size}" fill="${ghost ? MUTED : INK}">` +
    `${escapeXml(label)}</text></g>`;
  return { svg, width: w };
}

// Lay pills out in rows, wrapping at maxW. Direct port of pill_field().
function pillField(
  x: number,
  y: number,
  labels: string[],
  maxW: number,
  opts: { size?: number; gap?: number; opacity?: number } = {},
): string {
  const { size = 17, gap = 10, opacity = 0.55 } = opts;
  const out: string[] = [];
  let cx = x;
  let cy = y;
  const rowH = size + 20 + gap;
  for (const label of labels) {
    let { svg, width } = pill(cx, cy, label, { size, opacity, ghost: true });
    if (cx + width > x + maxW && cx > x) {
      cx = x;
      cy += rowH;
      ({ svg, width } = pill(cx, cy, label, { size, opacity, ghost: true }));
    }
    out.push(svg);
    cx += width + gap;
  }
  return out.join("");
}

interface BuildOpts {
  width: number;
  height: number;
  title: string;
  eyebrow: string;
  keywords: string[];
  readTime: number;
  pad: number;
  titleSize: number;
  ruleGap: number;
}

// Direct port of build() -- same formulas/magic numbers, unchanged.
function buildCardSvg(opts: BuildOpts): string {
  const { width, height, title, eyebrow, keywords, readTime, pad, titleSize, ruleGap } = opts;
  const tracking = -titleSize * 0.045;
  const textW = width - pad * 2 - ruleGap;
  const lines = wrapToWidth(title, F_BLACK, titleSize, textW, tracking);
  const lineH = titleSize * 1.1;

  const isTall = height > width;

  // Vertical placement: headline block sits above centre on the tall
  // crop so the pill field has room beneath it.
  const blockH = lines.length * lineH;
  const top = isTall ? pad + 150 : (height - blockH) / 2 - 10;

  const ruleH = blockH - (lineH - titleSize) * 0.4;

  const headline = lines
    .map(
      (line, i) =>
        `<text x="${pad + ruleGap}" y="${(top + titleSize * 0.82 + i * lineH).toFixed(0)}" ` +
        `font-family="Inter Display" font-weight="900" font-size="${titleSize}" ` +
        `letter-spacing="${tracking.toFixed(2)}" fill="${INK}">${escapeXml(line)}</text>`,
    )
    .join("");

  let { svg: eyebrowSvg } = pill(pad, pad, eyebrow, { size: Math.trunc(titleSize * 0.2) });
  eyebrowSvg = eyebrowSvg.replace(`fill="${INK}"`, `fill="${RED}"`).replace('fill="#FFFFFF" stroke', `fill="${WASH}" stroke`);

  // Keyword field
  const fieldX = pad;
  const fieldY = isTall ? top + blockH + 90 : top + blockH + 56;
  const fieldW = width - pad * 2;
  const fieldSize = isTall ? 19 : 16;
  const field = pillField(fieldX, fieldY, keywords, fieldW, { size: fieldSize });

  const footY = height - pad;
  const footer =
    `<circle cx="${pad + 13}" cy="${footY - 13}" r="13" fill="${RED}"/>` +
    `<text x="${pad + 36}" y="${footY - 7}" font-family="Inter" font-weight="700" ` +
    `font-size="20" fill="${INK}" letter-spacing="-0.3">pinspider.com</text>` +
    `<text x="${width - pad}" y="${footY - 7}" text-anchor="end" font-family="Inter" ` +
    `font-weight="600" font-size="17" fill="${MUTED}">${readTime} min read</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <rect x="0" y="0" width="${width}" height="6" fill="${RED}"/>
  ${eyebrowSvg}
  <rect x="${pad}" y="${(top + (lineH - titleSize) * 0.15).toFixed(0)}" width="7" height="${ruleH.toFixed(0)}" rx="3.5" fill="${RED}"/>
  ${headline}
  ${field}
  ${footer}
</svg>`;
}

function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [F_BLACK, F_BOLD, F_SEMI],
      loadSystemFonts: false,
      defaultFontFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}

/** Builds both crops for one post: OG (1200x630) and Pinterest pin
 *  (1000x1500), matching the Python original's render() params (pad/
 *  titleSize/ruleGap per crop) exactly. Returns PNG bytes for each --
 *  the caller decides file paths/naming (see
 *  scripts/generate-blog-images.ts). No image-model call, no cost. */
export function renderFeaturedImages(post: FeaturedImagePost): { ogPng: Buffer; pinPng: Buffer } {
  const ogSvg = buildCardSvg({
    width: 1200,
    height: 630,
    title: post.title,
    eyebrow: post.eyebrow,
    keywords: post.keywords,
    readTime: post.readTimeMinutes,
    pad: 64,
    titleSize: 62,
    ruleGap: 34,
  });
  const pinSvg = buildCardSvg({
    width: 1000,
    height: 1500,
    title: post.title,
    eyebrow: post.eyebrow,
    keywords: post.keywords,
    readTime: post.readTimeMinutes,
    pad: 72,
    titleSize: 76,
    ruleGap: 40,
  });
  return {
    ogPng: svgToPng(ogSvg),
    pinPng: svgToPng(pinSvg),
  };
}
