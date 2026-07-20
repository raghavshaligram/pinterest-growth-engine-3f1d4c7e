// Server-only. Pinterest publishing adapter.
// Default mode is direct Pinterest API v5 publishing using the user's own
// OAuth access_token (same integration record boards.functions.ts's
// syncPinterestBoards reads). A user can opt back into the legacy Make.com
// webhook by setting publish_mode: "webhook" on their saved Pinterest
// integration config (see integrations.server.ts / integrations.functions.ts).
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

const WEBHOOK_URL = "https://hook.eu1.make.com/clrkvdlzl3w6id6bhtb8jwg8bj0pt0jq";

export async function webhookPublish(input: PublishInput & { userId: string; scheduledPinId: string }): Promise<PublishResult> {
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId,
      scheduledPinId: input.scheduledPinId,
      boardId: input.boardId,
      title: input.title,
      description: input.description,
      link: input.link,
      imageUrl: input.imageUrl,
      altText: input.altText ?? null,
      publishedAt: new Date().toISOString(),
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
// integration. Defaults to direct-API publishing; falls back to the shared
// Make.com webhook only if the user has explicitly opted into
// publish_mode: "webhook".
export async function makePinterestClient(userId: string): Promise<PinterestClient> {
  const { getIntegration } = await import("./integrations.server");
  const cfg = await getIntegration(userId, "pinterest");

  if (cfg?.publish_mode === "webhook") {
    return { mode: "webhook", publish: (i) => webhookPublish(i) };
  }

  return {
    mode: "api",
    publish: async (i) => {
      const accessToken = cfg?.access_token;
      if (!accessToken) {
        throw new Error(
          'Pinterest access token missing — connect Pinterest in Settings → Integrations, or set publish_mode to "webhook" to use Make.com instead.',
        );
      }
      return apiPublish({ ...i, accessToken });
    },
  };
}
