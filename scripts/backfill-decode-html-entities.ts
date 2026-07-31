// One-off backfill: decode HTML entities in already-crawled `pages` rows.
//
// crawlPage (src/lib/crawler.server.ts) extracts title/meta_description/h1/
// headings/image alt text via regex against raw HTML, with no entity
// decoding -- so any page crawled before that fix shipped can have literal
// `&mdash;`, `&amp;`, `&#8217;`, etc. sitting in these columns. This script
// re-decodes every existing row in place using the exact same
// decodeHtmlEntities() helper the crawler now uses going forward, so
// there's one decode implementation, not two that could drift.
//
// Run once, after applying the crawler fix, against your live database:
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/backfill-decode-html-entities.ts
//
// (or `npx tsx scripts/backfill-decode-html-entities.ts` if you're not on
// Bun -- no framework/route context is needed, just network access to
// Supabase.) Safe to re-run: rows with nothing left to decode are skipped,
// so a second run is a fast no-op.

import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { decodeHtmlEntities } from "../src/lib/crawler.server";

type Heading = { level: number; text: string };
type ImageRef = { src: string; alt: string | null };

type PageRow = {
  id: string;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  headings: Heading[] | null;
  images: ImageRef[] | null;
};

const PAGE_SIZE = 500;
const CONCURRENCY = 10;

function decodeHeadings(headings: Heading[] | null): { value: Heading[] | null; changed: boolean } {
  if (!headings || !headings.length) return { value: headings, changed: false };
  let changed = false;
  const value = headings.map((h) => {
    const text = decodeHtmlEntities(h.text ?? "");
    if (text !== h.text) changed = true;
    return { ...h, text };
  });
  return { value, changed };
}

function decodeImages(images: ImageRef[] | null): { value: ImageRef[] | null; changed: boolean } {
  if (!images || !images.length) return { value: images, changed: false };
  let changed = false;
  const value = images.map((img) => {
    if (img.alt === null || img.alt === undefined) return img;
    const alt = decodeHtmlEntities(img.alt);
    if (alt !== img.alt) changed = true;
    return { ...img, alt };
  });
  return { value, changed };
}

async function processRow(row: PageRow): Promise<boolean> {
  const title = row.title !== null ? decodeHtmlEntities(row.title) : null;
  const meta_description = row.meta_description !== null ? decodeHtmlEntities(row.meta_description) : null;
  const h1 = row.h1 !== null ? decodeHtmlEntities(row.h1) : null;
  const { value: headings, changed: headingsChanged } = decodeHeadings(row.headings);
  const { value: images, changed: imagesChanged } = decodeImages(row.images);

  const changed =
    title !== row.title ||
    meta_description !== row.meta_description ||
    h1 !== row.h1 ||
    headingsChanged ||
    imagesChanged;

  if (!changed) return false;

  const { error } = await supabaseAdmin
    .from("pages")
    .update({ title, meta_description, h1, headings, images })
    .eq("id", row.id);

  if (error) {
    console.error(`[backfill] Failed to update page ${row.id}: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    let query = supabaseAdmin
      .from("pages")
      .select("id, title, meta_description, h1, headings, images")
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch pages: ${error.message}`);
    const rows = (data ?? []) as PageRow[];
    if (!rows.length) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(processRow));
      updated += results.filter(Boolean).length;
    }

    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[backfill] Scanned ${scanned} pages, updated ${updated} so far...`);

    if (rows.length < PAGE_SIZE) break;
  }

  console.log(`[backfill] Done. Scanned ${scanned} pages, updated ${updated} rows with decoded entities.`);
}

main().catch((err) => {
  console.error("[backfill] Failed:", err);
  process.exit(1);
});
