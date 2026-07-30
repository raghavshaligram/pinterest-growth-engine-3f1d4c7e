import { getErrorMessage } from "@/lib/error-message";
// Shared cron helper: authenticate via Supabase anon key header.
export function checkCronAuth(request: Request): Response | null {
  const apikey = request.headers.get("apikey");
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!apikey || !expected || apikey !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  return null;
}

export async function forEachUser(cb: (userId: string) => Promise<unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Previously iterated distinct user_ids from `integrations` -- used
  // as a stand-in for "every real active account." That broke as a
  // side effect of the multi-connection restructure: a user whose ONLY
  // credential was one of the 8 providers that moved to
  // api_key_connections (e.g. just an OpenAI key, no Apify/Pinterest)
  // would no longer have any `integrations` row at all, so every cron
  // job driven by this (image rendering, publishing, crawling, tier
  // checks, SERP sweeps) would silently stop running for them. `sites`
  // is a strictly more correct proxy for "a real account" anyway --
  // nothing in this app is possible before adding a site, so this
  // actually closes a narrower pre-existing gap too (an account mid-
  // onboarding with a site but zero credentials yet was never iterated
  // before either).
  const { data, error } = await supabaseAdmin.from("sites").select("user_id");
  if (error) throw error;
  const users = Array.from(new Set((data ?? []).map((r) => r.user_id)));
  const results: Record<string, unknown> = {};
  for (const u of users) {
    try { results[u] = await cb(u); } catch (e) { results[u] = { error: getErrorMessage(e) }; }
  }
  return { users: users.length, results };
}
