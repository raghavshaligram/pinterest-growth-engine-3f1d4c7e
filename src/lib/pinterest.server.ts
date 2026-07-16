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
  | { mode: "export"; ok: true }
  | { mode: "webhook"; ok: true };

export interface PinterestClient {
  mode: "api" | "apify" | "export" | "webhook";
  publish(input: PublishInput & { userId: string }): Promise<PublishResult>;
}

const WEBHOOK_URL = "https://hook.eu1.make.com/clrkvdlzl3w6id6bhtb8jwg8bj0pt0jq";

export async function webhookPublish(input: PublishInput & { userId: string }): Promise<PublishResult> {
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId,
      boardId: input.boardId,
      title: input.title,
      description: input.description,
      link: input.link,
      imageUrl: input.imageUrl,
      altText: input.altText ?? null,
      publishedAt: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`Webhook ${r.status}: ${await r.text()}`);
  return { mode: "webhook", ok: true };
}

export async function makePinterestClient(_userId: string): Promise<PinterestClient> {
  return { mode: "webhook", publish: (i) => webhookPublish(i) };
}
