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
  const { data, error } = await supabaseAdmin.from("integrations").select("user_id");
  if (error) throw error;
  const users = Array.from(new Set((data ?? []).map((r) => r.user_id)));
  const results: Record<string, unknown> = {};
  for (const u of users) {
    try { results[u] = await cb(u); } catch (e) { results[u] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return { users: users.length, results };
}
