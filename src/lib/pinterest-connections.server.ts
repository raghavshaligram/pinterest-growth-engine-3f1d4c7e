// Server-only. Multi-connection Pinterest token storage + the one-time
// lazy backfill of the pre-existing single `integrations` row into this
// new table, plus the proactive refresh-token renewal job.
//
// Read-through/write-through pattern mirrors google-analytics.server.ts's
// getValidAccessToken closely, with one addition: refresh_token_expires_at
// is a plain, queryable column (not buried in the encrypted blob) so the
// background job can select rows nearing expiry directly in SQL.
import { decrypt, encrypt } from "./crypto.server";

type StoredPinterestTokens = {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: number;
};

export type PinterestConnectionSummary = {
  id: string;
  label: string;
  pinterest_username: string | null;
  connected_at: string;
};

// One-time, idempotent migration of the old single-account model into
// the new multi-connection table. Runs on every listPinterestConnections
// call, but only ever DOES anything the first time it's called for a
// given user: it checks whether pinterest_connections already has rows
// for this user first, and if so returns immediately. This is what
// keeps it safe to leave wired into a normal read path rather than a
// one-off script -- it can never re-run its migration body for a user
// twice, so it can never re-attach a NEW site (created after the first
// backfill) to the old connection the way the original bug did.
//
// On first run for a user: copies the existing integrations row
// (provider='pinterest') into a new pinterest_connections row (without
// touching or deleting the original -- see the migration's own comment
// on why publisher.server.ts/syncPinterestBoards still need it), then
// maps every one of that user's EXISTING sites (as of this exact moment)
// to the new connection, since under the old model every one of those
// sites was, in effect, already relying on it. Sites created after this
// point get pinterest_connection_id = NULL by default, same as GA4.
async function backfillLegacyConnectionIfNeeded(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { count } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) > 0) return; // already migrated (or never had a legacy connection worth migrating)

  const { data: legacyRow } = await supabaseAdmin
    .from("integrations")
    .select("config_ciphertext")
    .eq("user_id", userId)
    .eq("provider", "pinterest")
    .maybeSingle();
  if (!legacyRow) return; // nothing to migrate for this user

  let legacyCfg: { access_token?: string; refresh_token?: string } = {};
  try {
    legacyCfg = JSON.parse(decrypt(legacyRow.config_ciphertext));
  } catch {
    return; // corrupt/unreadable -- nothing safe to migrate
  }
  if (!legacyCfg.access_token) return; // never actually connected

  // The legacy flow never tracked token expiry at all (see
  // integrations.server.ts's PinterestConfig -- no expires_at field), so
  // there's nothing real to carry over here. access_token_expires_at: 0
  // means the very next on-demand read treats it as already-expired and
  // due for a refresh, which is the safe default rather than guessing a
  // validity window that was never actually recorded.
  const storedTokens: StoredPinterestTokens = {
    access_token: legacyCfg.access_token,
    refresh_token: legacyCfg.refresh_token ?? "",
    access_token_expires_at: 0,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("pinterest_connections")
    .insert({
      user_id: userId,
      label: "Pinterest account (migrated)",
      token_ciphertext: encrypt(JSON.stringify(storedTokens)),
      // Unknown at migration time -- the background refresh job's own
      // "refresh_token_expires_at < now() + 7 days" check treats a NULL
      // here the same way as an actually-near expiry (see its query
      // below), so this migrated connection gets refreshed --and a real
      // expiry populated-- on its very next scheduled run rather than
      // silently never being checked.
      refresh_token_expires_at: null,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) return;

  // Map every existing site this user has right now -- all of them were
  // implicitly relying on the single legacy connection under the old
  // model, so none of them should regress to "Not connected" as a side
  // effect of this restructure.
  await supabaseAdmin
    .from("sites")
    .update({ pinterest_connection_id: inserted.id })
    .eq("user_id", userId)
    .is("pinterest_connection_id", null);
}

export async function listPinterestConnectionsForUser(userId: string): Promise<PinterestConnectionSummary[]> {
  await backfillLegacyConnectionIfNeeded(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, label, pinterest_username, connected_at")
    .eq("user_id", userId)
    .order("connected_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Proactive renewal -- called by the cron/pinterest-token-refresh.ts
// route, not on-demand at publish time (this task doesn't rewire
// publish-time token resolution -- see the migration's own comment).
// Refreshes every connection whose refresh_token_expires_at is within 7
// days (including NULL, i.e. never-yet-checked rows like a freshly
// backfilled legacy connection), so a real expiry gets populated and
// refreshed well before Pinterest's ~60-day inactivity window would
// otherwise let the refresh_token itself go stale.
export async function refreshPinterestConnectionsNearingExpiry(): Promise<{
  checked: number;
  refreshed: number;
  errors: { id: string; message: string }[];
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const threshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, token_ciphertext")
    .or(`refresh_token_expires_at.lt.${threshold},refresh_token_expires_at.is.null`);
  if (error) throw error;

  const { getErrorMessage } = await import("./error-message");
  const { pinterestAppConfig, refreshPinterestToken } = await import("./pinterest-oauth.server");
  const { appId, appSecret } = pinterestAppConfig();

  let refreshed = 0;
  const errors: { id: string; message: string }[] = [];
  for (const row of rows ?? []) {
    try {
      const tokens = JSON.parse(decrypt(row.token_ciphertext)) as StoredPinterestTokens;
      if (!tokens.refresh_token) throw new Error("No refresh_token stored for this connection");
      const refreshed_ = await refreshPinterestToken({ appId, appSecret, refreshToken: tokens.refresh_token });
      const now = Date.now();
      const nextTokens: StoredPinterestTokens = {
        access_token: refreshed_.access_token,
        refresh_token: tokens.refresh_token, // Pinterest doesn't rotate this on a normal refresh
        access_token_expires_at: now + refreshed_.expires_in * 1000,
      };
      const nextRefreshExpiresAt = refreshed_.refresh_token_expires_in
        ? new Date(now + refreshed_.refresh_token_expires_in * 1000).toISOString()
        : new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString(); // conservative 60-day fallback if Pinterest omits it
      await supabaseAdmin
        .from("pinterest_connections")
        .update({
          token_ciphertext: encrypt(JSON.stringify(nextTokens)),
          refresh_token_expires_at: nextRefreshExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      refreshed++;
    } catch (e) {
      errors.push({ id: row.id, message: getErrorMessage(e) });
    }
  }
  return { checked: (rows ?? []).length, refreshed, errors };
}
