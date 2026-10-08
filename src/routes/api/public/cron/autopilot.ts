// Hands-off steps that used to need a click. Each stage is one POST, called on a schedule by pg_cron
// (see supabase/migrations/20261003000000_autopilot_schedule.sql), so a daily run needs no one at the keyboard:
//
//   stage=analyze  pages that were crawled but not analyzed yet            (analyzePage button)
//   stage=plan     keeps a rolling 30-day content calendar: pins_per_day pins a day (setting, default 5), each a
//                  different page and pin theme, staggered so a page does not repeat too soon, and new blogs /
//                  calculators jump the line
//   stage=briefs   writes ONE pin per planned slot from today to today+2 (Generate pins button, but for exactly one
//                  pin, in that slot's theme)
//   stage=queue    draft slots inside the next HORIZON_DAYS -> queued       (Queue pins button)
//
// The other stages already have their own cron endpoints: crawl, images, materialize, publish.
// Every stage is idempotent: running one twice in a row only does whatever work is left.
import { createFileRoute } from "@tanstack/react-router";

const HORIZON_DAYS = 3;
const PLAN_DAYS = 30;       // length of the rolling calendar
const MAX_PAGE_GAP_DAYS = 21; // a page is not planned again within this many days (shrinks when the pool is small)
const DEFAULT_PINS_PER_DAY = 5;
const NEW_PAGE_DAYS = 14;   // pages first seen in the last N days get priority

type PlanRow = {
  id: string; user_id: string; plan_date: string; slot: number; page_id: string; template_id: string | null;
  theme_id: string | null; brief_id: string | null; status: string; last_error: string | null;
};
// The autopilot_plan table is newer than the generated Supabase types, so reach it through a loose accessor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function planTable(db: any) { return db.from("autopilot_plan"); }
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

// Pins per day comes from autopilot_settings ('pins_per_day'), default 5, clamped to 1..12.
async function pinsPerDay(db: any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await db.from("autopilot_settings").select("value").eq("key", "pins_per_day").maybeSingle();
  const n = Math.round(Number(data?.value));
  return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : DEFAULT_PINS_PER_DAY;
}

export const Route = createFileRoute("/api/public/cron/autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth, forEachUser } = await import("@/lib/cron.server");
        const bad = checkCronAuth(request);
        if (bad) return bad;
        const url = new URL(request.url);
        const stage = url.searchParams.get("stage");
        const limit = Math.max(1, Math.min(12, Number(url.searchParams.get("limit")) || 0));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getErrorMessage } = await import("@/lib/error-message");

        if (stage === "analyze") {
          const { analyzePageCore } = await import("@/lib/pages.functions");
          const out = await forEachUser(async (uid) => {
            const { data: pages } = await supabaseAdmin
              .from("pages").select("id")
              .eq("user_id", uid).eq("excluded", false).eq("status", "active").is("analysis", null)
              .order("last_crawled_at", { ascending: false }).limit(limit || 3);
            let done = 0; const errors: string[] = [];
            for (const p of pages ?? []) {
              try { await analyzePageCore({ supabase: supabaseAdmin, userId: uid }, { pageId: p.id }); done++; }
              catch (e) { errors.push(getErrorMessage(e)); }
            }
            return { analyzed: done, errors };
          });
          return Response.json(out);
        }

        if (stage === "plan") {
          const { chooseTheme, pageKindFor, seasonalBoost } = await import("@/lib/pin-themes");
          const out = await forEachUser(async (uid) => {
            const { data: pages } = await supabaseAdmin
              .from("pages").select("id, url, created_at, analysis")
              .eq("user_id", uid).eq("excluded", false).eq("status", "active").not("analysis", "is", null)
              .limit(2000);
            const cands = (pages ?? []).flatMap((p) => {
              const kind = pageKindFor(p.url);
              const a = p.analysis as { primary_keyword?: string; seasonality?: string } | null;
              if (!kind || !a?.primary_keyword) return [];
              return [{ id: p.id, url: p.url, kind, createdAt: new Date(p.created_at).getTime(), seasonality: a.seasonality }];
            });
            if (!cands.length) return { planned: 0, reason: "no analyzed blog or calculator pages yet" };

            const { data: rowsRaw } = await planTable(supabaseAdmin).select("*").eq("user_id", uid);
            const rows = (rowsRaw ?? []) as PlanRow[];
            const perDay = await pinsPerDay(supabaseAdmin);
            // One setting drives everything: the account's daily cap follows it.
            // The scheduler skips accounts that never completed the onboarding prompt (no profile row). Autopilot
            // creates a "warming" profile when there is none, so a hands-off setup does not stall on that prompt.
            const { data: profile } = await supabaseAdmin
              .from("account_publishing_profiles").select("user_id").eq("user_id", uid).maybeSingle();
            if (profile) {
              await supabaseAdmin.from("account_publishing_profiles")
                .update({ cap_mode: "manual", manual_cap: perDay, current_daily_cap: perDay }).eq("user_id", uid);
            } else {
              await supabaseAdmin.from("account_publishing_profiles").insert({
                user_id: uid, self_reported_age_bucket: "warming", reconciled_tier: "warming",
                cap_mode: "manual", manual_cap: perDay, current_daily_cap: perDay,
              });
            }
            // Fewer pins per day than before: drop future, not-yet-written slots above the new number.
            await planTable(supabaseAdmin).delete().eq("user_id", uid).gt("slot", perDay - 1)
              .gte("plan_date", dayStr(new Date())).is("brief_id", null);
            const gapDays = Math.max(3, Math.min(MAX_PAGE_GAP_DAYS, Math.floor(cands.length / perDay)));
            const taken = new Set(rows.map((r) => `${r.plan_date}#${r.slot}`));
            const lastPlanned = new Map<string, number>();   // page -> latest plan date (ms)
            const usedTemplates = new Map<string, Set<string>>();
            for (const r of rows) {
              const t = Date.parse(r.plan_date + "T00:00:00Z");
              lastPlanned.set(r.page_id, Math.max(lastPlanned.get(r.page_id) ?? 0, t));
              if (r.template_id) {
                if (!usedTemplates.has(r.page_id)) usedTemplates.set(r.page_id, new Set());
                usedTemplates.get(r.page_id)!.add(r.template_id);
              }
            }
            const recentKinds: string[] = rows
              .filter((r) => r.plan_date >= dayStr(new Date(Date.now() - 3 * 86_400_000)))
              .sort((a, b) => a.plan_date.localeCompare(b.plan_date))
              .map((r) => cands.find((c) => c.id === r.page_id)?.kind ?? "blog");

            // A page that has never been planned and is new (just published) jumps the queue: it takes the next
            // free-of-brief day from tomorrow on, instead of waiting for the calendar to reach it.
            const today0 = new Date(); today0.setUTCHours(0, 0, 0, 0);
            const newPages = cands
              .filter((c) => !lastPlanned.has(c.id) && Date.now() - c.createdAt < NEW_PAGE_DAYS * 86_400_000)
              .sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
            let bumped = 0;
            if (newPages.length) {
              const open = rows
                .filter((r) => r.plan_date > dayStr(today0) && !r.brief_id && !newPages.some((n) => n.id === r.page_id))
                .sort((a, b) => a.plan_date.localeCompare(b.plan_date));
              for (const n of newPages) {
                const slot = open.shift();
                if (!slot) break;
                const d = new Date(slot.plan_date + "T00:00:00Z");
                const { theme, template } = chooseTheme(new Date(d.getTime() + slot.slot * 86_400_000), n.kind, new Set(), n.url);
                const { error } = await planTable(supabaseAdmin)
                  .update({ page_id: n.id, template_id: template, theme_id: theme.id, status: "planned", last_error: null })
                  .eq("id", slot.id);
                if (error) throw error;
                lastPlanned.set(n.id, d.getTime());
                usedTemplates.set(n.id, new Set([template]));
                bumped++;
              }
            }
            const today = new Date(); today.setUTCHours(0, 0, 0, 0);
            const inserts: Record<string, unknown>[] = [];
            for (let i = 0; i < PLAN_DAYS; i++) {
              const date = new Date(today.getTime() + i * 86_400_000);
              const ds = dayStr(date);
              const pickedToday = new Set<string>();
              for (const r of rows) if (r.plan_date === ds) pickedToday.add(r.page_id);
              for (let slot = 0; slot < perDay; slot++) {
                if (taken.has(`${ds}#${slot}`)) continue;
                const scored = cands
                  .map((c) => {
                    if (pickedToday.has(c.id)) return null;
                    const last = lastPlanned.get(c.id);
                    const sinceDays = last == null ? Infinity : (date.getTime() - last) / 86_400_000;
                    if (sinceDays < gapDays) return null;
                    let score = last == null ? 60 : Math.min(60, sinceDays - gapDays);
                    if (Date.now() - c.createdAt < NEW_PAGE_DAYS * 86_400_000 && last == null) score += 100;
                    score += seasonalBoost(c.seasonality, date);
                    const n = recentKinds.length;
                    if (n >= 2 && recentKinds[n - 1] === c.kind && recentKinds[n - 2] === c.kind) score -= 40;
                    return { c, score: score + Math.random() * 5 };
                  })
                  .filter((x): x is { c: (typeof cands)[number]; score: number } => x !== null)
                  .sort((a, b) => b.score - a.score);
                // Pool smaller than the gap allows: reuse the page that has waited longest (a fresh format on the
                // same URL is still a fresh pin) rather than leaving the slot empty, but never twice in one day.
                const pick = scored[0]?.c
                  ?? [...cands].filter((c) => !pickedToday.has(c.id)).sort((a, b) => (lastPlanned.get(a.id) ?? 0) - (lastPlanned.get(b.id) ?? 0))[0];
                if (!pick) continue;
                // Each slot of the day gets a different theme: slot 0 is the weekday's theme, then the next ones.
                const { theme, template } = chooseTheme(new Date(date.getTime() + slot * 86_400_000), pick.kind, usedTemplates.get(pick.id) ?? new Set(), pick.url);
                inserts.push({ user_id: uid, plan_date: ds, slot, page_id: pick.id, template_id: template, theme_id: theme.id, status: "planned" });
                pickedToday.add(pick.id);
                lastPlanned.set(pick.id, date.getTime());
                if (!usedTemplates.has(pick.id)) usedTemplates.set(pick.id, new Set());
                usedTemplates.get(pick.id)!.add(template);
                recentKinds.push(pick.kind);
              }
            }
            if (inserts.length) {
              const { error } = await planTable(supabaseAdmin).insert(inserts);
              if (error) throw error;
            }
            return { planned: inserts.length, perDay, gapDays, bumpedNewPages: bumped, pool: cands.length };
          });
          return Response.json(out);
        }

        if (stage === "briefs") {
          const { generateBriefsCore } = await import("@/lib/briefs.functions");
          const { PIN_THEMES } = await import("@/lib/pin-themes");
          const out = await forEachUser(async (uid) => {
            const from = dayStr(new Date());
            const to = dayStr(new Date(Date.now() + (HORIZON_DAYS - 1) * 86_400_000));
            const { data: due } = await planTable(supabaseAdmin).select("*")
              .eq("user_id", uid).gte("plan_date", from).lte("plan_date", to)
              .in("status", ["planned", "error"]).is("brief_id", null).order("plan_date", { ascending: true }).order("slot", { ascending: true }).limit(limit || 1);
            let generated = 0; const errors: string[] = [];
            for (const row of (due ?? []) as PlanRow[]) {
              const theme = PIN_THEMES[row.theme_id ?? ""];
              try {
                const r = await generateBriefsCore(
                  { supabase: supabaseAdmin, userId: uid },
                  { pageId: row.page_id, count: 1, template: row.template_id ?? undefined,
                    theme: theme ? { label: theme.label, style: theme.style, angle: theme.angle } : undefined },
                );
                const briefId = r.ids?.[0] ?? null;
                if (!briefId) throw new Error("no brief was created");
                await planTable(supabaseAdmin).update({ brief_id: briefId, status: "briefed", last_error: null }).eq("id", row.id);
                generated++;
              } catch (e) {
                const msg = getErrorMessage(e);
                errors.push(msg);
                await planTable(supabaseAdmin).update({ status: "error", last_error: msg.slice(0, 500) }).eq("id", row.id);
              }
            }
            return { generated, errors };
          });
          return Response.json(out);
        }

        if (stage === "queue") {
          const horizon = new Date(Date.now() + HORIZON_DAYS * 24 * 3600 * 1000).toISOString();
          const out = await forEachUser(async (uid) => {
            // Only pins that belong to the autopilot plan are queued. Drafts made by hand (or by an older run) are
            // left alone: promoting them is how a backlog could be published all at once.
            const { data: planned } = await planTable(supabaseAdmin).select("brief_id")
              .eq("user_id", uid).not("brief_id", "is", null);
            const briefIds = ((planned ?? []) as { brief_id: string }[]).map((r) => r.brief_id);
            if (!briefIds.length) return { queued: 0, reason: "no planned pins" };
            const { data, error } = await supabaseAdmin
              .from("scheduled_pins").update({ status: "queued" })
              .eq("user_id", uid).eq("status", "draft").lte("scheduled_at", horizon)
              .in("brief_id", briefIds).select("id");
            if (error) throw error;
            return { queued: data?.length ?? 0 };
          });
          return Response.json(out);
        }

        return Response.json({ error: "stage must be analyze, plan, briefs or queue" }, { status: 400 });
      },
    },
  },
});
