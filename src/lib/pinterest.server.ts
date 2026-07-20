// Server-only. Pinterest publishing adapter.
// Default mode is direct Pinterest API v5 publishing using the user's own
// OAuth access_token, obtained by authorizing Pinspider's single shared app
// (see pinterest-oauth.server.ts:pinterestAppConfig — there's no per-user
// Pinterest app anymore). A user can instead route publishing through their
// own automation (Make.com, Zapier, etc.) by setting publish_mode: "webhook"
// and saving a webhook_url on their Pinterest integration config (see
// integrations.server.ts / integrations.functions.ts).
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

// Publish straight to Pinterest v5 using the caller's own OAuth access token.
// https://developers.pinterest.com/docs/api/v5/#operation/pins/create
export async function apiPublish(
  input: PublishInput & { accessToken: string },
): Promise<PublishResult> {
  const r = await fetch("https://api.pinterest.com/v5/pins", {
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
  if (!r.ok) throw new Error(`Pinterest v5 pin create ${r.status}: ${text}`);
  let json: { id?: string };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Pinterest v5 pin create: non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!json.id) throw new Error(`Pinterest v5 pin create: response had no pin id: ${text.slice(0, 200)}`);
  return { mode: "api", pinterestPinId: json.id };
}

// Builds the publisher for one user based on their stored Pinterest
// integration. Defaults to direct-API publishing; publishes to the user's
// own webhook_url instead only if they've explicitly opted into
// publish_mode: "webhook" and saved a URL.
export async function makePinterestClient(userId: string): Promise<PinterestClient> {
  const { getIntegration } = await import("./integrations.server");
  const cfg = await getIntegration(userId, "pinterest");

  if (cfg?.publish_mode === "webhook") {
    return {
      mode: "webhook",
      publish: async (i) => {
        const webhookUrl = cfg?.webhook_url;
        if (!webhookUrl) {
          throw new Error(
            'Webhook URL missing — add your Webhook URL in Settings → Integrations, or set publish_mode to "api" to publish directly instead.',
          );
        }
        return webhookPublish({ ...i, webhookUrl });
      },
    };
  }

  return {
    mode: "api",
    publish: async (i) => {
      const accessToken = cfg?.access_token;
      if (!accessToken) {
        throw new Error(
          'Pinterest access token missing — connect Pinterest in Settings → Integrations, or set publish_mode to "webhook" to use your own automation instead.',
        );
      }
      return apiPublish({ ...i, accessToken });
    },
  };
}
