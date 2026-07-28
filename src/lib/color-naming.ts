function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

// Turns a hex code into a plain-language color description so it can be
// dropped into an image-generation prompt without the model ever seeing
// (and sometimes literally rendering, as text on the pin) the hex code
// itself. See describeColors() below for the actual call site.
export function hexToColorName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "a neutral tone";
  const { h, s, l } = rgbToHsl(rgb);

  if (s < 12) {
    if (l > 92) return "white";
    if (l > 80) return "off-white";
    if (l > 60) return "light gray";
    if (l > 35) return "gray";
    if (l > 15) return "charcoal";
    return "near-black";
  }

  const lightMod = l > 82 ? "pale " : l > 62 ? "soft " : l < 22 ? "deep " : l < 38 ? "dark " : "";
  const muted = s < 32 && l >= 22 && l <= 78;

  let base: string;
  if (h < 15 || h >= 345) base = "red";
  else if (h < 40) base = l < 45 ? "brown" : "orange";
  else if (h < 65) base = l > 85 ? "cream" : "gold";
  else if (h < 90) base = "yellow-green";
  else if (h < 150) base = "green";
  else if (h < 180) base = "teal";
  else if (h < 200) base = "cyan";
  else if (h < 230) base = "blue";
  else if (h < 260) base = "indigo";
  else if (h < 290) base = "purple";
  else if (h < 330) base = "magenta";
  else base = "pink";

  if (base === "brown") return "warm brown";
  if (base === "green" && muted) {
    return (lightMod === "deep " || lightMod === "dark ") ? "deep forest green" : "sage green";
  }

  const prefix = lightMod || (muted ? "muted " : "");
  return `${prefix}${base}`.trim();
}

// Accepts a mix of hex codes and already-descriptive strings (some brand
// color fields are free text) and normalizes to descriptive names only.
export function describeColors(colors: string[]): string {
  return colors
    .filter(Boolean)
    .map((c) => (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.trim()) ? hexToColorName(c) : c))
    .join(", ");
}
