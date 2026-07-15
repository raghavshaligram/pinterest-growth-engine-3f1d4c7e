// Server-only. Replicate image generation (Nano Banana 2).
export async function replicatePredict(opts: {
  token: string;
  model: string; // e.g. "google/nano-banana-2"
  input: Record<string, unknown>;
  maxWaitMs?: number;
}): Promise<{ id: string; output: string | string[]; }> {
  const create = await fetch(`https://api.replicate.com/v1/models/${opts.model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ input: opts.input }),
  });
  if (create.status === 402) throw new Error("Replicate: insufficient credit — top up your account.");
  if (!create.ok) throw new Error(`Replicate create ${create.status}: ${await create.text()}`);
  let pred = await create.json() as { id: string; status: string; output?: string | string[]; error?: string };
  const cap = opts.maxWaitMs ?? 5 * 60 * 1000;
  const start = Date.now();
  while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
    if (Date.now() - start > cap) throw new Error("Replicate: timed out");
    await new Promise((res) => setTimeout(res, 3000));
    const r = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Bearer ${opts.token}` },
    });
    if (!r.ok) throw new Error(`Replicate poll ${r.status}`);
    pred = await r.json();
  }
  if (pred.status !== "succeeded" || !pred.output) throw new Error(`Replicate: ${pred.status} ${pred.error ?? ""}`);
  return { id: pred.id, output: pred.output };
}
