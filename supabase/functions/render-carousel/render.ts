import satori from "https://esm.sh/satori@0.12.2";
import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";
import { buildSlideTree, H, W, type Slide } from "./layout.ts";

let ready: Promise<{ fonts: { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" }[] }> | null = null;

function init() {
  if (!ready) {
    ready = (async () => {
      const wasm = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then((r) => r.arrayBuffer());
      await initWasm(wasm);
      const f = async (w: number) =>
        (await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/montserrat@latest/latin-${w}-normal.woff`)).arrayBuffer();
      const [a, b, c] = await Promise.all([f(500), f(700), f(800)]);
      return {
        fonts: [
          { name: "Montserrat", data: a, weight: 500 as const, style: "normal" as const },
          { name: "Montserrat", data: b, weight: 700 as const, style: "normal" as const },
          { name: "Montserrat", data: c, weight: 800 as const, style: "normal" as const },
        ],
      };
    })();
  }
  return ready;
}

export async function renderSlide(slide: Slide): Promise<Uint8Array> {
  const { fonts } = await init();
  const svg = await satori(buildSlideTree(slide), { width: W, height: H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return png;
}
