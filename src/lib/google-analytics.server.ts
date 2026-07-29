// Server-only. GA4 Admin API (property listing) + Data API (session
// reporting) wrappers, plus the per-connection token/refresh plumbing
// they both need. Read-through only, by design (see Insights page spec):
// nothing here ever persists a GA4 report result -- every call hits the
// live API and the result lives only in the request/response, with
// react-query caching it client-side per session (cleared on refresh).
import { decrypt, encrypt } from "./crypto.server";

type StoredTokens = { access_token: string; refresh_token: string; expires_at: number };

type GoogleConnectionRow = {
  id: string;
  user_id: string;
  token_ciphertext: string;
};

// Returns a definitely-valid access token for a connection, refreshing
// and persisting the new one first if the stored token is expired (or
// about to be, within a minute) -- every caller below goes through this
// rather than ever reading token_ciphertext's access_token directly.
export async function getValidAccessToken(connectionId: string, userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("id, user_id, token_ciphertext")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("Google connection not found");

  const row = data as GoogleConnectionRow;
  const tokens = JSON.parse(decrypt(row.token_ciphertext)) as StoredTokens;

  const oneMinute = 60_000;
  if (tokens.expires_at - Date.now() > oneMinute) {
    return tokens.access_token;
  }

  // Expired (or about to be) -- refresh and persist the new access
  // token before returning it. refresh_token itself doesn't rotate on a
  // normal refresh, so it's carried through unchanged.
  const { googleAppConfig, refreshAccessToken } = await import("./google-oauth.server");
  const { clientId, clientSecret } = googleAppConfig();
  const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken: tokens.refresh_token });
  const nextTokens: StoredTokens = {
    access_token: refreshed.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  await supabaseAdmin
    .from("google_connections")
    .update({ token_ciphertext: encrypt(JSON.stringify(nextTokens)), updated_at: new Date().toISOString() })
    .eq("id", connectionId);
  return nextTokens.access_token;
}

export type Ga4PropertyOption = { propertyId: string; displayName: string; accountName: string };

// Admin API: every GA4 property this Google account can access, across
// every GA account it belongs to -- accountSummaries is the one Admin
// API call that returns both levels (account name + its properties) in
// a single request, instead of listing accounts then properties per
// account.
export async function listGa4Properties(accessToken: string): Promise<Ga4PropertyOption[]> {
  const r = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`GA4 Admin API ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[];
  };
  const out: Ga4PropertyOption[] = [];
  for (const acc of data.accountSummaries ?? []) {
    for (const prop of acc.propertySummaries ?? []) {
      if (!prop.property) continue;
      out.push({
        propertyId: prop.property, // "properties/123456789"
        displayName: prop.displayName ?? prop.property,
        accountName: acc.displayName ?? "Google Analytics account",
      });
    }
  }
  return out;
}

export type UtmContentSessions = { utmContent: string; sessions: number };
export type Ga4SessionsReport = {
  // Only rows with a real (tagged) utm_content value -- what the
  // Insights page joins against pin_briefs.
  rows: UtmContentSessions[];
  // Sum of ALL sessions GA4 returned for the range, tagged or not --
  // kept separate from `rows` specifically so callers can tell "GA4
  // returned traffic but none of it was UTM-tagged" (rawTotalSessions >
  // 0, rows.length === 0) apart from "there's genuinely no traffic in
  // this range at all" (rawTotalSessions === 0). Collapsing those two
  // into one empty-array result would make it impossible for the
  // Insights page to show the right one of its two distinct empty
  // states.
  rawTotalSessions: number;
};

// Data API: sessions grouped by sessionManualContent (GA4's dimension
// for the utm_content query parameter -- see src/lib/utm.ts for where
// Pinspider stamps utm_content=<brief_id> onto every published pin's
// destination link) over the trailing `days` days. Untagged rows
// (direct visits, other channels, pins published before this feature
// existed -- GA4 reports these with value "(not set)", not as missing
// rows) are excluded from `rows` since they can never join to a
// brief_id, but still counted into `rawTotalSessions`.
export async function runGa4SessionsByUtmContent(
  accessToken: string,
  propertyId: string,
  days = 30,
): Promise<Ga4SessionsReport> {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "sessionManualContent" }],
      metrics: [{ name: "sessions" }],
      limit: 500,
    }),
  });
  if (!r.ok) throw new Error(`GA4 Data API ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  };
  const all = (data.rows ?? []).map((row) => ({
    utmContent: row.dimensionValues?.[0]?.value ?? "",
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
  }));
  const rawTotalSessions = all.reduce((sum, r) => sum + r.sessions, 0);
  const rows = all.filter((r) => r.utmContent && r.utmContent !== "(not set)");
  return { rows, rawTotalSessions };
}
