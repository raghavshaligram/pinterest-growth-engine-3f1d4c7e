// Supabase edge function: sets a Pinterest pin (1000x1500) from a photo plus a headline, all text drawn by code.
// Same look as the Instagram carousel cover: full-bleed photo, frosted card with a dark-green headline, lime brand pill.
// Body: { photo_path, headline, brand, out_path }. Called by the Pinspider image worker with the service role key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import satori from "https://esm.sh/satori@0.12.2";
import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const W = 1000, H = 1500;
const GREEN = "#1f4d2b", LIME = "#d9e84a", INK = "#111111", FROST = "rgba(255,255,255,0.88)";

// deno-lint-ignore no-explicit-any
type N = any;
const el = (type: string, style: Record<string, unknown>, children?: N): N => ({ type, props: { style: { display: "flex", ...style }, children } });

let ready: Promise<{ name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" }[]> | null = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const wasm = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then((r) => r.arrayBuffer());
      await initWasm(wasm);
      const f = async (w: number) => (await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-${w}-normal.woff`)).arrayBuffer();
      const [a, b, c] = await Promise.all([f(500), f(700), f(800)]);
      return [
        { name: "Montserrat", data: a, weight: 500 as const, style: "normal" as const },
        { name: "Montserrat", data: b, weight: 700 as const, style: "normal" as const },
        { name: "Montserrat", data: c, weight: 800 as const, style: "normal" as const },
      ];
    })();
  }
  return ready;
}

function fit(text: string, base: number, min: number, perLine: number, lines: number): number {
  let size = base;
  while (size > min && text.length > Math.floor(perLine * (base / size)) * lines) size -= 4;
  return size;
}

function toDataUri(bytes: Uint8Array, type: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

function tree(photo: string | null, headline: string, brand: string): N {
  const size = fit(headline, 112, 64, 11, 4);
  return el("div", { width: W, height: H, position: "relative", flexDirection: "column", background: "#2c6b3d", fontFamily: "Montserrat", overflow: "hidden" }, [
    photo ? { type: "img", props: { src: photo, style: { position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover" } } } : null,
    el("div", { position: "absolute", left: 0, top: 0, width: W, height: H, background: "linear-gradient(180deg, rgba(255,255,255,0.0) 60%, rgba(10,30,15,0.5) 100%)" }),
    el("div", { position: "absolute", left: 56, right: 56, top: 150, flexDirection: "column", alignItems: "center", background: FROST, borderRadius: 48, padding: "52px 40px" },
      el("div", { color: GREEN, fontSize: size, fontWeight: 800, lineHeight: 1.06, textAlign: "center", justifyContent: "center", textTransform: "uppercase" }, headline)),
    el("div", { position: "absolute", left: 0, right: 0, bottom: 70, justifyContent: "center" },
      el("div", { background: LIME, color: INK, fontSize: 30, fontWeight: 800, padding: "14px 34px", borderRadius: 40, letterSpacing: 2 }, brand.toUpperCase())),
  ]);
}

Deno.serve(async (req) => {
  try {
    const { photo_path, headline, brand, out_path } = await req.json();
    if (!photo_path || !headline || !out_path) throw new Error("photo_path, headline, out_path required");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const dl = await db.storage.from("pins").download(photo_path);
    if (dl.error) throw dl.error;
    const photo = toDataUri(new Uint8Array(await dl.data.arrayBuffer()), dl.data.type || "image/png");
    const host = String(brand ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const fonts = await init();
    const svg = await satori(tree(photo, String(headline).trim(), host), { width: W, height: H, fonts });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
    const up = await db.storage.from("pins").upload(out_path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw up.error;
    return Response.json({ ok: true, path: out_path });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
