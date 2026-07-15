// Server-only. Sitemap parser + page fetcher + content extraction.

interface SitemapUrl { loc: string; lastmod?: string }

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "PinForgeBot/1.0" } });
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
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || null;
  const meta_description = attr(html, "meta", "content", "name", "description") ?? null;
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").trim();
  const headings: { level: number; text: string }[] = [];
  const hRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(html)) && headings.length < 30) {
    headings.push({ level: Number(m[1]), text: stripTags(m[2]).slice(0, 200) });
  }
  const images: { src: string; alt: string | null }[] = [];
  const iRe = /<img[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iRe.exec(html)) && images.length < 20) {
    const tag = im[0];
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? null;
    if (src) images.push({ src, alt });
  }
  const jsonld: unknown[] = [];
  const jRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jRe.exec(html))) {
    try { jsonld.push(JSON.parse(jm[1].trim())); } catch { /* skip */ }
  }
  const text_snippet = stripTags(html).slice(0, 6000);
  const { createHash } = await import("node:crypto");
  const content_hash = createHash("sha1").update(text_snippet).digest("hex");
  return { url, title, h1: h1 || null, meta_description, headings, images, jsonld, content_hash, text_snippet };
}
