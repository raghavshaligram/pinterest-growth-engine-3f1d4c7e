// Server-only. Multi-connection Pinterest token storage, the one-time
// lazy backfill of the pre-existing single `integrations` row into this
// new table, the proactive refresh-token renewal job, AND (as of this
// pass) the actual publish-time/board-sync-time token + publish_mode
// resolution that makePinterestClient/syncPinterestBoards now go
// through instead of the legacy account-wide `integrations` row.
//
// Read-through/write-through pattern mirrors google-analytics.server.ts's
// getValidAccessToken closely, with two additions that live as plain
// (unencrypted, queryable) columns rather than inside the encrypted
// blob: refresh_token_expires_at (background job queries this directly)
// and publish_mode/webhook_url (the publish pipeline and Settings UI
// both need to read these without decrypting anything).
import { decrypt, encrypt } from "./crypto.server";
import { pinterestApiBaseUrl, type PinterestEnvironment } from "./pinterest-environment";
// Pure helper module (no React/browser imports) -- the client-only hook
// that shares these helpers lives in site-mapping-gate.ts instead.
import { withMapSiteLink, siteDisplayName } from "./site-mapping";

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
  publish_mode: "api" | "webhook";
  webhook_url: string | null;
  environment: PinterestEnvironment;
  token_source: "oauth" | "manual";
  // Only ever populated for token_source === "manual" -- Pinterest
  // issues no refresh_token for a manually-generated sandbox token, so
  // there's nothing for the background refresh job to renew; this is
  // what the UI warns from instead (see listPinterestConnectionsForUser).
  // null for oauth connections, where the background job keeps the
  // access token continuously valid and a raw expiry isn't meaningful
  // to show the user.
  daysToExpiry: number | null;
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
// touching or deleting the original -- kept as historical data only at
// this point; nothing else reads it anymore, see below), then maps
// every one of that user's EXISTING sites (as of this exact moment) to
// the new connection, since under the old model every one of those
// sites was, in effect, already relying on it. Sites created after this
// point get pinterest_connection_id = NULL by default, same as GA4.
async function backfillLegacyConnectionIfNeeded(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // The tombstone (pinterest_migrated_at on the legacy integrations row)
  // is checked FIRST and is the real source of truth for "has this user
  // already been migrated" -- deliberately independent of whether a
  // pinterest_connections row currently exists. A pure row-count check
  // can't tell "never migrated" apart from "migrated, then the user
  // disconnected their last connection on purpose" -- both read as zero
  // rows. Without this, a deliberate disconnect-to-zero would look
  // exactly like a fresh, unmigrated account on the very next read, and
  // this function would silently recreate an equivalent connection from
  // the never-deleted legacy row, undoing the disconnect.
  const { data: legacyRow, error: legacyErr } = await supabaseAdmin
    .from("integrations")
    .select("id, config_ciphertext, pinterest_migrated_at")
    .eq("user_id", userId)
    .eq("provider", "pinterest")
    .maybeSingle();
  // Same reasoning as the count-check error below: a real query error
  // must not be silently treated as "no legacy row, nothing to do" --
  // that would let a transient failure masquerade as an account that
  // was simply never migrated.
  if (legacyErr) throw legacyErr;
  if (!legacyRow) return; // never had a legacy Pinterest integration -- nothing to migrate, ever
  if (legacyRow.pinterest_migrated_at) return; // tombstoned: migration already happened at some point -- never re-run, regardless of current row count

  const { count, error: countErr } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  // A real error here (table not existing yet, a transient PostgREST
  // schema-cache lag right after a migration ran, etc.) must NOT be
  // silently treated as "0 rows, go ahead and migrate" -- that previously
  // let this function fall through to an insert that would also fail,
  // returning silently with nothing surfaced anywhere (looked like a
  // permanent hang rather than a transient, self-healing condition).
  if (countErr) throw countErr;
  if ((count ?? 0) > 0) {
    // Already migrated under the pre-tombstone guard (a row exists) but
    // never stamped -- this covers every account migrated before this
    // column existed. Stamp it now so a future disconnect-to-zero can't
    // re-trigger the backfill for this user either.
    await supabaseAdmin
      .from("integrations")
      .update({ pinterest_migrated_at: new Date().toISOString() })
      .eq("id", legacyRow.id);
    return;
  }

  let legacyCfg: { access_token?: string; refresh_token?: string; publish_mode?: "api" | "webhook"; webhook_url?: string } = {};
  try {
    legacyCfg = JSON.parse(decrypt(legacyRow.config_ciphertext));
  } catch {
    return; // corrupt/unreadable -- nothing safe to migrate (left un-tombstoned: if this ever becomes readable, e.g. a decrypt-key fix, it can still migrate on a later read)
  }
  if (!legacyCfg.access_token) return; // never actually connected -- nothing to migrate, and no connection for a future disconnect to ever undo, so leaving this un-tombstoned is harmless

  // The legacy flow never tracked token expiry at all (see
  // integrations.server.ts's PinterestConfig -- no expires_at field), so
  // there's nothing real to carry over here. access_token_expires_at: 0
  // means the very next read treats it as already-expired and due for a
  // refresh, which is the safe default rather than guessing a validity
  // window that was never actually recorded.
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
      // here the same way as an actually-near expiry, so this migrated
      // connection gets refreshed --and a real expiry populated-- on its
      // very next scheduled run rather than silently never being checked.
      refresh_token_expires_at: null,
      // Carry over the real prior value instead of resetting to the
      // 'api' column default -- an account that had deliberately opted
      // into webhook mode shouldn't silently flip back to direct API
      // publishing as a side effect of this restructure.
      publish_mode: legacyCfg.publish_mode === "webhook" ? "webhook" : "api",
      webhook_url: legacyCfg.webhook_url ?? null,
      // Explicit, not relying on the column default -- the legacy
      // single-account flow was always production/oauth, never sandbox,
      // so this migration path should say so outright rather than
      // silently inheriting whatever the DB default happens to be.
      environment: "production",
      token_source: "oauth",
    })
    .select("id")
    .single();
  // Don't tombstone on a failed insert -- leave this un-migrated so the
  // next read retries, same resilience intent as the countErr/legacyErr
  // throws above (a transient failure must stay retryable, not get
  // permanently stamped as "done" when nothing was actually created).
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

  // Tombstone LAST, only after the connection row and site mappings are
  // both actually in place -- this is the flag that permanently retires
  // the backfill for this user. A genuine future reconnect goes through
  // the normal OAuth flow (startPinterestConnectionOAuth / the
  // pinterest.callback.ts INSERT path) and never consults this column at
  // all, so tombstoning here can't block or interfere with that.
  await supabaseAdmin
    .from("integrations")
    .update({ pinterest_migrated_at: new Date().toISOString() })
    .eq("id", legacyRow.id);
}

export async function listPinterestConnectionsForUser(userId: string): Promise<PinterestConnectionSummary[]> {
  await backfillLegacyConnectionIfNeeded(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, label, pinterest_username, connected_at, publish_mode, webhook_url, environment, token_source, token_ciphertext")
    .eq("user_id", userId)
    .order("connected_at", { ascending: true });
  if (error) throw error;
  const now = Date.now();
  return (data ?? []).map((row) => {
    // Decrypt only for manual connections to compute daysToExpiry --
    // deliberately NOT decrypting every row on every list call (oauth
    // connections don't need this at all, and there should only ever be
    // a handful of dev-created manual connections per account, so this
    // stays cheap without needing a dedicated plain expiry column the
    // way refresh_token_expires_at has one for the background job).
    let daysToExpiry: number | null = null;
    if (row.token_source === "manual") {
      try {
        const tokens = JSON.parse(decrypt(row.token_ciphertext)) as StoredPinterestTokens;
        daysToExpiry = Math.ceil((tokens.access_token_expires_at - now) / (24 * 60 * 60 * 1000));
      } catch {
        daysToExpiry = null; // corrupt/unreadable -- don't block the whole list over one bad row
      }
    }
    return {
      id: row.id,
      label: row.label,
      pinterest_username: row.pinterest_username,
      connected_at: row.connected_at,
      publish_mode: row.publish_mode,
      webhook_url: row.webhook_url,
      environment: row.environment as PinterestEnvironment,
      token_source: row.token_source as "oauth" | "manual",
      daysToExpiry,
    };
  });
}

// Shared by both the on-demand path (getValidPinterestAccessToken, called
// at publish/sync time) and the proactive background job -- refreshes
// via Pinterest's refresh grant and persists the new tokens + a real
// refresh_token_expires_at, keeping the "how do we refresh and store it"
// logic in exactly one place.
async function refreshAndPersist(connectionId: string, refreshToken: string, environment: PinterestEnvironment): Promise<StoredPinterestTokens> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pinterestAppConfig, refreshPinterestToken } = await import("./pinterest-oauth.server");
  const { appId, appSecret } = pinterestAppConfig();
  const refreshed = await refreshPinterestToken({ appId, appSecret, refreshToken, environment });
  const now = Date.now();
  const nextTokens: StoredPinterestTokens = {
    access_token: refreshed.access_token,
    refresh_token: refreshToken, // Pinterest doesn't rotate this on a normal refresh
    access_token_expires_at: now + refreshed.expires_in * 1000,
  };
  const nextRefreshExpiresAt = refreshed.refresh_token_expires_in
    ? new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString()
    : new Date(now + 60 * 24 * 60 * 60 * 1000).toISOString(); // conservative 60-day fallback if Pinterest omits it
  await supabaseAdmin
    .from("pinterest_connections")
    .update({
      token_ciphertext: encrypt(JSON.stringify(nextTokens)),
      refresh_token_expires_at: nextRefreshExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
  return nextTokens;
}

export type ValidPinterestAccess = {
  accessToken: string;
  environment: PinterestEnvironment;
};

// On-demand check-and-refresh, used at actual publish/board-sync time --
// this is the piece that was missing before this pass (publishing used
// to just read whatever was stored, no refresh at all). Mirrors
// google-analytics.server.ts's getValidAccessToken. Returns environment
// alongside the token (not just the token alone) so every caller that
// needs to pick an API host gets it from the exact same read as the
// token itself -- there's no separate lookup a caller could get out of
// sync with, by construction.
export async function getValidPinterestAccessToken(connectionId: string, userId: string): Promise<ValidPinterestAccess> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, token_ciphertext, environment, token_source")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("Pinterest connection not found");

  const environment = data.environment as PinterestEnvironment;
  const tokenSource = data.token_source as "oauth" | "manual";
  const tokens = JSON.parse(decrypt(data.token_ciphertext)) as StoredPinterestTokens;
  const oneMinute = 60_000;
  if (tokens.access_token_expires_at - Date.now() > oneMinute) {
    return { accessToken: tokens.access_token, environment };
  }
  if (tokenSource === "manual") {
    // No refresh_token exists for a manually-entered token -- Pinterest
    // issues none for these (see addManualPinterestConnection). There is
    // nothing to refresh; the only fix is entering a fresh token.
    throw new Error(
      "This sandbox connection's manually-entered token has expired — enter a new one in Settings → Integrations.",
    );
  }
  if (!tokens.refresh_token) {
    throw new Error("This Pinterest connection has no refresh token stored — reconnect it in Settings → Integrations.");
  }
  const refreshed = await refreshAndPersist(connectionId, tokens.refresh_token, environment);
  return { accessToken: refreshed.access_token, environment };
}

export type SitePinterestConnection = {
  connectionId: string;
  publish_mode: "api" | "webhook";
  webhook_url: string | null;
};

// Resolves which Pinterest connection a SITE (not the account as a
// whole) actually publishes through -- the core of this pass's rewire.
// Throws a clear, actionable error if the site has no mapping yet,
// rather than silently falling back to any other connection the account
// might happen to have (that would just reintroduce the original
// cross-site leak in a new form).
export async function getPinterestConnectionForSite(siteId: string, userId: string): Promise<SitePinterestConnection> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: site, error: siteErr } = await supabaseAdmin
    .from("sites")
    .select("id, pinterest_connection_id, brand_name, url")
    .eq("id", siteId)
    .eq("user_id", userId)
    .single();
  if (siteErr || !site) throw new Error("Site not found");
  if (!site.pinterest_connection_id) {
    // Names the site and carries a deep link to that site's own
    // Connections section rather than pointing at the Sites page in
    // general -- on a multi-site account "go to the Sites page" leaves
    // the user to work out which card is at fault. The trailing token
    // is stripped and turned into a real link client-side (see
    // lib/site-mapping.ts).
    throw new Error(
      withMapSiteLink(
        `${siteDisplayName(site)} isn't mapped to a Pinterest account yet, so this pin has nowhere to publish.`,
        site.id,
      ),
    );
  }
  const { data: conn, error: connErr } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, publish_mode, webhook_url")
    .eq("id", site.pinterest_connection_id)
    .eq("user_id", userId)
    .single();
  if (connErr || !conn) {
    throw new Error("This site's mapped Pinterest connection no longer exists — re-map it in the site's Connections section.");
  }
  return { connectionId: conn.id, publish_mode: conn.publish_mode as "api" | "webhook", webhook_url: conn.webhook_url };
}

export const setPinterestConnectionPublishModeAndWebhook = async (
  connectionId: string,
  userId: string,
  publish_mode: "api" | "webhook",
  webhook_url: string | null,
) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("pinterest_connections")
    .update({ publish_mode, webhook_url, updated_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("user_id", userId);
  if (error) throw error;
};

// Proactive renewal -- called by the cron/pinterest-token-refresh.ts
// route, not on-demand at publish time (on-demand is
// getValidPinterestAccessToken above, now actually wired into the
// publish pipeline as of this pass). Refreshes every connection whose
// refresh_token_expires_at is within 7 days (including NULL, i.e.
// never-yet-checked rows like a freshly backfilled legacy connection),
// so a real expiry gets populated and refreshed well before Pinterest's
// ~60-day inactivity window would otherwise let the refresh_token itself
// go stale.
export async function refreshPinterestConnectionsNearingExpiry(): Promise<{
  checked: number;
  refreshed: number;
  errors: { id: string; message: string }[];
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const threshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("pinterest_connections")
    .select("id, token_ciphertext, environment")
    // Manual connections have no refresh_token to renew (Pinterest
    // issues none for a manually-generated sandbox token) -- filtered
    // out at the query level so they're never even fetched or
    // decrypted, not just skipped after the fact. "checked" below
    // therefore only ever counts oauth connections.
    .eq("token_source", "oauth")
    .or(`refresh_token_expires_at.lt.${threshold},refresh_token_expires_at.is.null`);
  if (error) throw error;

  const { getErrorMessage } = await import("./error-message");

  let refreshed = 0;
  const errors: { id: string; message: string }[] = [];
  for (const row of rows ?? []) {
    try {
      const tokens = JSON.parse(decrypt(row.token_ciphertext)) as StoredPinterestTokens;
      if (!tokens.refresh_token) throw new Error("No refresh_token stored for this connection");
      await refreshAndPersist(row.id, tokens.refresh_token, row.environment as PinterestEnvironment);
      refreshed++;
    } catch (e) {
      errors.push({ id: row.id, message: getErrorMessage(e) });
    }
  }
  return { checked: (rows ?? []).length, refreshed, errors };
}
