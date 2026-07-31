// Server-only. Sitemap parser + page fetcher + content extraction.

interface SitemapUrl { loc: string; lastmod?: string }

// Extraction below is hand-rolled regex against raw HTML (see crawlPage),
// not an HTML parser -- so title/meta/heading/alt text comes out with
// literal entities still in it (`&mdash;`, `&amp;`, `&#8217;`, etc.)
// unless decoded explicitly. This matters beyond display: these are the
// exact strings analyzePage puts straight into its LLM prompt
// (pages.functions.ts) and that generateBriefs' prompt is built from in
// turn (briefs.functions.ts) -- an undecoded entity here reaches
// published pin copy, not just the crawl-preview screen. Named-entity
// table covers what actually shows up in real crawled HTML (not the
// full HTML5 spec -- no new dependency for that); numeric/hex entities
// are handled generically via String.fromCodePoint. Also exported for
// the one-off backfill script (scripts/backfill-decode-html-entities.ts)
// so both places decode identically instead of two implementations
// drifting apart.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
  nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™",
};

export function decodeHtmlEntities(input: string): string {
  if (!input) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const codePoint = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (Number.isNaN(codePoint)) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : match;
  });
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "PinspiderBot/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function extractTag(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

export async function parseSitemap(sitemapUrl: string, depth = 0): Promise<SitemapUrl[]> {
  if (depth > 3) return [];
  const xml = await fetchText(sitemapUrl);
  // Sitemap index
  if (/<sitemapindex/i.test(xml)) {
    const locs = extractTag(xml, "loc");
    const all: SitemapUrl[] = [];
    for (const loc of locs.slice(0, 50)) {
      try { all.push(...(await parseSitemap(loc, depth + 1))); } catch { /* ignore */ }
    }
    return all;
  }
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  return urlBlocks.map((b) => {
    const loc = extractTag(b, "loc")[0] ?? "";
    const lastmod = extractTag(b, "lastmod")[0];
    return { loc, lastmod };
  }).filter((u) => u.loc);
}

function stripTags(s: string) { return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function attr(html: string, tag: string, attrName: string, matchName: string, matchValue: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*${matchName}=["']${matchValue}["'][^>]*${attrName}=["']([^"']+)["'][^>]*>`, "i");
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<${tag}[^>]*${attrName}=["']([^"']+)["'][^>]*${matchName}=["']${matchValue}["'][^>]*>`, "i");
  const m2 = html.match(re2);
  return m2?.[1];
}

export interface CrawledPage {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null }[];
  jsonld: unknown[];
  content_hash: string;
  text_snippet: string;
}

export async function crawlPage(url: string): Promise<CrawledPage> {
  const html = await fetchText(url);
  const title = decodeHtmlEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim()) || null;
  const meta_description = (() => {
    const raw = attr(html, "meta", "content", "name", "description");
    return raw ? decodeHtmlEntities(raw) : null;
  })();
  const h1 = decodeHtmlEntities((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").trim());
  const headings: { level: number; text: string }[] = [];
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(html)) && headings.length < 30) {
    headings.push({ level: Number(m[1]), text: decodeHtmlEntities(stripTags(m[2]).slice(0, 200)) });
  }
  const images: { src: string; alt: string | null }[] = [];
  const iRe = /<img[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iRe.exec(html)) && images.length < 20) {
    const tag = im[0];
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    const altRaw = tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? null;
    const alt = altRaw !== null ? decodeHtmlEntities(altRaw) : null;
    if (src) images.push({ src, alt });
  }
  const jsonld: unknown[] = [];
  const jRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jRe.exec(html))) {
    try { jsonld.push(JSON.parse(jm[1].trim())); } catch { /* skip */ }
  }
  // Not decoded -- text_snippet only ever feeds content_hash (a raw-bytes
  // change-detection fingerprint, not anything an LLM or the UI reads
  // directly), so decoding here would just be wasted work with no
  // observable effect.
  const text_snippet = stripTags(html).slice(0, 6000);
  const { createHash } = await import("node:crypto");
  const content_hash = createHash("sha1").update(text_snippet).digest("hex");
  return { url, title, h1: h1 || null, meta_description, headings, images, jsonld, content_hash, text_snippet };
}
