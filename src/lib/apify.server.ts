// Server-only. Apify actor runner tuned for the Pinterest search scraper.
export async function runApifyActor<T = unknown>(opts: {
  token: string;
  actorId: string; // e.g. "fatihtahta~pinterest-scraper-search"
  input: Record<string, unknown>;
  maxWaitMs?: number;
}): Promise<T[]> {
  const runResp = await fetch(
    `https://api.apify.com/v2/acts/${opts.actorId}/runs?token=${encodeURIComponent(opts.token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.input),
    },
  );
  if (!runResp.ok) throw new Error(`Apify run ${runResp.status}: ${await runResp.text()}`);
  const runJson = await runResp.json() as { data: { id: string; defaultDatasetId: string; status: string } };
  const runId = runJson.data.id;
  const dsId = runJson.data.defaultDatasetId;
  const cap = opts.maxWaitMs ?? 3 * 60 * 1000;
  const start = Date.now();
  let status = runJson.data.status;
  while (status === "READY" || status === "RUNNING") {
    if (Date.now() - start > cap) throw new Error("Apify: run timed out");
    await new Promise((res) => setTimeout(res, 4000));
    const s = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(opts.token)}`);
    if (!s.ok) throw new Error(`Apify status ${s.status}`);
    const sJson = await s.json() as { data: { status: string } };
    status = sJson.data.status;
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify run finished as ${status}`);
  const items = await fetch(
    `https://api.apify.com/v2/datasets/${dsId}/items?token=${encodeURIComponent(opts.token)}&clean=1&format=json`,
  );
  if (!items.ok) throw new Error(`Apify dataset ${items.status}`);
  return await items.json() as T[];
}
