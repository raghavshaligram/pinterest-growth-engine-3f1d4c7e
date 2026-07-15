// Server-only. Pinterest publishing adapter with three modes.
export type PublishInput = {
  boardId: string; // Pinterest board id (native) or internal board id for export
  title: string;
  description: string;
  link: string;
  imageUrl: string; // publicly reachable URL
  altText?: string;
};

export type PublishResult =
  | { mode: "api"; pinterestPinId: string }
  | { mode: "apify"; jobRunId: string }
  | { mode: "export"; ok: true };

export interface PinterestClient {
  mode: "api" | "apify" | "export";
  publish(input: PublishInput): Promise<PublishResult>;
}

export async function pinterestApiPublish(token: string, input: PublishInput): Promise<PublishResult> {
  const r = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      board_id: input.boardId,
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 500),
      link: input.link,
      alt_text: input.altText?.slice(0, 500),
      media_source: { source_type: "image_url", url: input.imageUrl },
    }),
  });
  if (!r.ok) throw new Error(`Pinterest API ${r.status}: ${await r.text()}`);
  const j = await r.json() as { id: string };
  return { mode: "api", pinterestPinId: j.id };
}

export async function makePinterestClient(userId: string): Promise<PinterestClient> {
  const { getIntegration } = await import("./integrations.server");
  const pin = await getIntegration(userId, "pinterest");
  if (pin?.access_token) {
    const token = pin.access_token;
    return { mode: "api", publish: (i) => pinterestApiPublish(token, i) };
  }
  // Export mode — the publisher just marks the scheduled_pin as 'exported' and it appears in the export ZIP.
  return {
    mode: "export",
    publish: async () => ({ mode: "export", ok: true }),
  };
}
