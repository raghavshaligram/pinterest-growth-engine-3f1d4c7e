// Server-only. Pinterest publishing adapter.
// Default mode is direct Pinterest API v5 publishing using the user's own
// OAuth access_token, obtained by authorizing Pinspider's single shared app
// (see pinterest-oauth.server.ts:pinterestAppConfig — there's no per-user
// Pinterest app anymore). A user can instead route publishing through their
// own automation (Make.com, Zapier, etc.) by setting publish_mode: "webhook"
// and saving a webhook_url on their Pinterest integration config (see
// integrations.server.ts / integrations.functions.ts).
import { pinterestApiBaseUrl, type PinterestEnvironment } from "./pinterest-environment";
export type PublishInput = {
  boardId: string; // Pinterest board id (native)
  title: string;
  description: string;
  link: string;
  imageUrl: string; // publicly reachable URL (24h signed Supabase Storage URL)
  altText?: string;
};

export type PublishResult =
  | { mode: "api"; pinterestPinId: string }
  | { mode: "webhook"; ok: true; pinterestPinId?: string; status?: string; raw?: unknown };

export interface PinterestClient {
  mode: "api" | "webhook";
  publish(input: PublishInput & { userId: string; scheduledPinId: string }): Promise<PublishResult>;
}

// Publish by POSTing to the user's own automation endpoint (Make.com,
// Zapier, etc.) instead of Pinterest directly. Payload field names
// deliberately mirror what apiPublish sends to Pinterest itself, so a
// webhook receiver built from the documented shape (shown in Settings →
// Integrations) can forward the fields straight through to Pinterest's own
// pin-create call if it wants to.
export async function webhookPublish(
  input: PublishInput & { webhookUrl: string },
): Promise<PublishResult> {
  const r = await fetch(input.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board_id: input.boardId,
      title: input.title,
      description: input.description,
      alt_text: input.altText ?? null,
      link: input.link,
      image_url: input.imageUrl,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Webhook ${r.status}: ${text}`);
  let parsed: unknown = undefined;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* not JSON — treat as success */ }
  const obj = (parsed && typeof parsed === "object") ? parsed as Record<string, unknown> : {};
  const status = typeof obj.status === "string" ? obj.status : undefined;
  const pinId = typeof obj.pinterest_pin_id === "string" ? obj.pinterest_pin_id
    : typeof obj.pinterestPinId === "string" ? obj.pinterestPinId
    : typeof obj.pin_id === "string" ? obj.pin_id
    : undefined;
  const error = typeof obj.error === "string" ? obj.error : undefined;
  if (status === "failed" || error) throw new Error(error ?? "Webhook reported failure");
  return { mode: "webhook", ok: true, pinterestPinId: pinId, status, raw: parsed };
}

// Pinterest's own numeric error code for "you are not permitted to
// access that resource" -- fires for several distinct permission
// reasons, but the specific, verbatim message Pinterest returns for a
// Trial-access app trying to create a Pin against the production host
// is a confirmed, known string (checked directly, not guessed):
// {"code":29,"message":"Apps with Trial access may not create Pins in
// production https://api.pinterest.com - use API Sandbox
// https://api-sandbox.pinterest.com instead."}
// Matched on that specific substring rather than the bare code alone,
// since code 29 is a shared/generic code Pinterest reuses for other
// permission failures too -- a bare-code match would mislabel an
// unrelated permission error as an environment mismatch.
const PINTEREST_TRIAL_ENVIRONMENT_MISMATCH_HINT = "trial access may not create pins in production";

function describePinterestPublishError(status: number, rawText: string, environment: PinterestEnvironment): string {
  let parsed: { code?: number; message?: string } = {};
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Not JSON -- fall through to the generic message below.
  }
  if (parsed.code === 29 && (parsed.message ?? "").toLowerCase().includes(PINTEREST_TRIAL_ENVIRONMENT_MISMATCH_HINT)) {
    return environment === "production"
      ? "Pinterest rejected this pin (error 29): this app's Trial access only allows creating Pins in Pinterest's Sandbox, not production. Map this site to a sandbox connection, or request Standard access from Pinterest to publish to production."
      : "Pinterest rejected this pin (error 29) as an environment mismatch, even though this connection is marked sandbox — the stored token may have been issued for the wrong environment. Reconnect or re-enter this connection's token.";
  }
  return `Pinterest v5 pin create ${status}: ${rawText}`;
}

// Publish straight to Pinterest v5 using the caller's own OAuth access token.
// https://developers.pinterest.com/docs/api/v5/#operation/pins/create
export async function apiPublish(
  input: PublishInput & { accessToken: string; environment: PinterestEnvironment },
): Promise<PublishResult> {
  const r = await fetch(`${pinterestApiBaseUrl(input.environment)}/pins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      board_id: input.boardId,
      title: input.title,
      description: input.description,
      alt_text: input.altText,
      link: input.link,
      media_source: {
        source_type: "image_url",
        url: input.imageUrl,
      },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(describePinterestPublishError(r.status, text, input.environment));
  let json: { id?: string };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Pinterest v5 pin create: non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!json.id) throw new Error(`Pinterest v5 pin create: response had no pin id: ${text.slice(0, 200)}`);
  return { mode: "api", pinterestPinId: json.id };
}

// Pinterest account metrics, used only for onboarding tier reconciliation
// (see publishing-profile.server.ts:reconcileTier). Pinterest's v5 API has
// no "account created at" field, so there's no direct way to verify a
// user's self-reported account age — this instead pulls the counters
// that DO exist (pins/boards/followers) as an activity-level sanity
// check against what they claimed.
// https://developers.pinterest.com/docs/api/v5/#operation/user_account/get
export type PinterestAccountMetrics = {
  username?: string;
  accountType?: string;
  boardCount?: number;
  pinCount?: number;
  followerCount?: number;
  followingCount?: number;
  monthlyViews?: number;
};

export async function fetchUserAccount(accessToken: string): Promise<PinterestAccountMetrics> {
  // Always production: this is only ever called via reconcileTier
  // (publishing-profile.server.ts) against the legacy single-account
  // `integrations` row, which predates and has no environment column at
  // all -- that flow was never sandbox-capable to begin with.
  const r = await fetch(`${pinterestApiBaseUrl("production")}/user_account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Pinterest v5 user_account ${r.status}: ${text}`);
  let json: Record<string, unknown>;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Pinterest v5 user_account: non-JSON response: ${text.slice(0, 200)}`);
  }
  return {
    username: typeof json.username === "string" ? json.username : undefined,
    accountType: typeof json.account_type === "string" ? json.account_type : undefined,
    boardCount: typeof json.board_count === "number" ? json.board_count : undefined,
    pinCount: typeof json.pin_count === "number" ? json.pin_count : undefined,
    followerCount: typeof json.follower_count === "number" ? json.follower_count : undefined,
    followingCount: typeof json.following_count === "number" ? json.following_count : undefined,
    monthlyViews: typeof json.monthly_views === "number" ? json.monthly_views : undefined,
  };
}

// Builds the publisher for one SITE (not the account as a whole) --
// resolves that site's mapped pinterest_connection_id, reads its
// publish_mode/webhook_url, and (for API mode) gets a guaranteed-valid,
// on-demand-refreshed access token scoped to that specific connection.
// Replaces the old makePinterestClient(userId), which read one shared
// account-wide `integrations` row regardless of which site was actually
// publishing -- exactly the mechanism that made the site-isolation bug
// possible in the first place. publisher.server.ts is the only caller,
// and now calls this once per scheduled pin (resolving that pin's own
// site), not once per batch.
export async function makePinterestClientForSite(params: { siteId: string; userId: string }): Promise<PinterestClient> {
  const { getPinterestConnectionForSite, getValidPinterestAccessToken } = await import("./pinterest-connections.server");
  const conn = await getPinterestConnectionForSite(params.siteId, params.userId);

  if (conn.publish_mode === "webhook") {
    return {
      mode: "webhook",
      publish: async (i) => {
        if (!conn.webhook_url) {
          throw new Error(
            'Webhook URL missing for this site\'s Pinterest connection — add one in Settings → Integrations, or switch that connection to "api" mode to publish directly instead.',
          );
        }
        return webhookPublish({ ...i, webhookUrl: conn.webhook_url });
      },
    };
  }

  return {
    mode: "api",
    publish: async (i) => {
      // accessToken and environment come from the exact same read (see
      // getValidPinterestAccessToken) so they can never drift apart --
      // the token that's used is always sent to the host it was
      // actually issued for.
      const { accessToken, environment } = await getValidPinterestAccessToken(conn.connectionId, params.userId);
      return apiPublish({ ...i, accessToken, environment });
    },
  };
}
