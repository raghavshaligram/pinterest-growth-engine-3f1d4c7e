// Pure slide layout for Instagram carousels (1080x1350). Text is always set by code, never by the image model,
// so alignment and spelling are exact. Returns a satori element tree (plain objects, no JSX).
export const W = 1080;
export const H = 1350;
const GREEN = "#1f4d2b";
const LIME = "#d9e84a";
const CREAM = "#f7f5ec";
const INK = "#111111";

export type Slide = {
  kind: "cover" | "item" | "outro" | "fit";
  position: number;
  total: number;
  number?: number | null;
  heading: string;
  body?: string | null;
  photo?: string | null; // data URI
  brand: string; // e.g. harvestmath.com
};

// deno-lint-ignore no-explicit-any
type N = any;
const el = (type: string, style: Record<string, unknown>, children?: N): N => ({ type, props: { style: { display: "flex", ...style }, children } });
const img = (src: string, style: Record<string, unknown>): N => ({ type: "img", props: { src, style: { objectFit: "cover", ...style } } });

function dots(s: Slide): N {
  return el("div", { gap: 10 }, Array.from({ length: s.total }, (_, i) =>
    el("div", { width: i + 1 === s.position ? 34 : 12, height: 12, borderRadius: 6, background: i + 1 === s.position ? LIME : "rgba(255,255,255,0.45)" })));
}

function fit(text: string, base: number, min: number, perLine: number, lines: number): number {
  // crude fit: shrink font until the text should fit in `lines` lines of `perLine` chars at `base`
  let size = base;
  while (size > min && text.length > Math.floor(perLine * (base / size)) * lines) size -= 4;
  return size;
}

export function buildSlideTree(s: Slide): N {
  // "fit": the image model already drew the whole slide (2:3). Centre-crop it to Instagram's 4:5 (1080x1350).
  if (s.kind === "fit") {
    return el("div", { width: W, height: H, background: "#ffffff" }, s.photo ? img(s.photo, { width: W, height: H, objectPosition: "50% 50%" }) : null);
  }
  const root = (children: N, bg = GREEN) =>
    el("div", { width: W, height: H, position: "relative", flexDirection: "column", background: bg, fontFamily: "Montserrat", overflow: "hidden" }, children);
  const FROST = "rgba(255,255,255,0.88)";
  const photo = (p?: string | null) => p ? img(p, { position: "absolute", left: 0, top: 0, width: W, height: H }) : el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, background: "#2c6b3d" });
  const badge = (n: string) => el("div", { position: "absolute", left: 56, top: 56, width: 88, height: 88, borderRadius: 44, background: GREEN, border: "6px solid #ffffff", color: "#ffffff", fontSize: 44, fontWeight: 800, alignItems: "center", justifyContent: "center" }, n);
  const brandPill = el("div", { position: "absolute", right: 56, top: 70, background: LIME, color: INK, fontSize: 24, fontWeight: 800, padding: "10px 22px", borderRadius: 40, letterSpacing: 2 }, s.brand.toUpperCase());
  const progress = el("div", { position: "absolute", left: 0, right: 0, bottom: 44, justifyContent: "center" },
    el("div", { gap: 10, background: "rgba(255,255,255,0.8)", padding: "12px 20px", borderRadius: 30, alignItems: "center" }, Array.from({ length: s.total }, (_, i) =>
      el("div", { width: i + 1 === s.position ? 34 : 12, height: 12, borderRadius: 6, background: i + 1 === s.position ? GREEN : "rgba(31,77,43,0.3)" }))));

  if (s.kind === "cover") {
    const size = fit(s.heading, 100, 60, 16, 4);
    return root([
      photo(s.photo),
      el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, background: "linear-gradient(180deg, rgba(255,255,255,0.0) 55%, rgba(10,30,15,0.55) 100%)" }),
      brandPill,
      el("div", { position: "absolute", left: 56, right: 56, top: 170, flexDirection: "column", alignItems: "center", background: FROST, borderRadius: 48, padding: "48px 40px" }, [
        el("div", { color: GREEN, fontSize: size, fontWeight: 800, lineHeight: 1.06, textAlign: "center", justifyContent: "center", textTransform: "uppercase" }, s.heading),
        s.body ? el("div", { marginTop: 26, background: LIME, color: INK, fontSize: 34, fontWeight: 700, padding: "12px 30px", borderRadius: 40, textAlign: "center" }, s.body) : null,
      ]),
      el("div", { position: "absolute", left: 0, right: 0, bottom: 120, justifyContent: "center", color: "#ffffff", fontSize: 30, fontWeight: 800, letterSpacing: 3 }, "SWIPE TO SEE ALL"),
      progress,
    ]);
  }

  if (s.kind === "outro") {
    return root([
      brandPill,
      el("div", { position: "absolute", left: 72, right: 72, top: 260, bottom: 220, flexDirection: "column", justifyContent: "center", alignItems: "center" }, [
        el("div", { color: "#ffffff", fontSize: fit(s.heading, 92, 56, 18, 4), fontWeight: 800, lineHeight: 1.08, textAlign: "center", justifyContent: "center", textTransform: "uppercase" }, s.heading),
        s.body ? el("div", { color: CREAM, fontSize: 38, fontWeight: 600, lineHeight: 1.3, textAlign: "center", justifyContent: "center", marginTop: 40 }, s.body) : null,
        el("div", { marginTop: 56, background: LIME, color: INK, fontSize: 40, fontWeight: 800, padding: "26px 48px", borderRadius: 60 }, `Link in bio  \u2022  ${s.brand}`),
      ]),
      progress,
    ]);
  }

  // item slide: full-bleed photo, frosted heading card on top, frosted tip card at the bottom
  const hSize = fit(s.heading, 66, 46, 22, 2);
  const bSize = fit(s.body ?? "", 38, 30, 40, 5);
  return root([
    photo(s.photo),
    badge(String(s.number ?? "")),
    brandPill,
    el("div", { position: "absolute", left: 56, right: 56, top: 176, background: FROST, borderRadius: 40, padding: "30px 40px", justifyContent: "center" },
      el("div", { color: GREEN, fontSize: hSize, fontWeight: 800, lineHeight: 1.1, textAlign: "center", justifyContent: "center" }, s.heading)),
    s.body ? el("div", { position: "absolute", left: 56, right: 56, bottom: 130, background: FROST, borderRadius: 40, padding: "34px 40px" },
      el("div", { color: "#222222", fontSize: bSize, fontWeight: 600, lineHeight: 1.3 }, s.body)) : null,
    progress,
  ]);
}
