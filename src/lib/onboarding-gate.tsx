// Shared client-side hook pair used by the "Finish setup" banner, the
// empty-state Dashboard, and every pipeline-triggering action's gate
// check. Both read the exact same getSetupStatus() query (same
// queryKey, so they share one cached fetch across every consumer on a
// page instead of each component re-querying independently), keeping
// the wizard's step-dots, the banner, the checklist card, and the gate
// logic from ever disagreeing about "is setup done" -- there is
// deliberately no second, looser client-side notion of readiness
// anywhere in this app.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { getSetupStatus, type SetupStatus } from "@/lib/onboarding.functions";
import { runFullPipeline } from "@/lib/schedule.functions";
import { runImageWorker } from "@/lib/briefs.functions";

export const SETUP_STATUS_QUERY_KEY = ["setup-status"] as const;

export function useSetupStatus() {
  const fn = useServerFn(getSetupStatus);
  return useQuery({ queryKey: SETUP_STATUS_QUERY_KEY, queryFn: () => fn() });
}

// Wraps a pipeline-triggering action (Generate briefs, Render images,
// Generate All): if the account isn't ready to generate yet, this sends
// the user into the onboarding wizard at the first missing required
// step instead of letting the action run and fail (or silently no-op)
// server-side. `guard` returns true if the action was allowed to run,
// false if it redirected instead -- callers should skip firing their
// mutation when it returns false.
export function useSetupGate() {
  const { data, isLoading } = useSetupStatus();
  const navigate = useNavigate();

  function guard(): boolean {
    // Status hasn't loaded yet -- err toward letting the action attempt
    // to run rather than blocking on an unresolved query forever; the
    // server-side checks each of these functions already has (e.g.
    // generateBriefs' resolveCopyConnection, which throws if nothing
    // resolves) still apply as a backstop if this somehow lets an
    // unready account through.
    if (isLoading || !data) return true;
    if (data.readyToGenerate) return true;
    navigate({ to: "/onboarding", search: { step: data.firstMissingWizardStep ?? 1 } });
    return false;
  }

  return { guard, status: data, statusLoading: isLoading };
}

// "Generate your first batch" -- the Dashboard empty-state's own CTA
// (DashboardEmptyState.tsx). The onboarding wizard's crawl step used to
// share this exact mutation but now runs its own smaller, page-scoped,
// cancellable batch instead (see FIRST_BATCH_PAGE_CAP/StepCrawlPreview
// in routes/onboarding.tsx) -- this hook's scope below is specific to
// the Dashboard button alone. Chains the same two calls Pages' "Generate
// All" button uses (runFullPipeline to analyze/brief/queue images, then
// one pass of runImageWorker to actually render a first handful of
// them) so a brand-new account sees real pin images shortly after
// clicking, instead of only a queued job that waits for the nightly
// cron. Values named (not just inline literals) so DashboardEmptyState's
// disclosure copy can state the real numbers this call uses, rather
// than a second hardcoded literal that could silently drift from it.
export const FIRST_BATCH_MAX_ANALYZE = 25;
export const FIRST_BATCH_MAX_BRIEF_PAGES = 10;
export const FIRST_BATCH_MAX_IMAGES = 20;

export function useGenerateFirstBatch() {
  const qc = useQueryClient();
  const pipelineFn = useServerFn(runFullPipeline);
  const workerFn = useServerFn(runImageWorker);

  return useMutation({
    mutationFn: async () => {
      const pipeline = await pipelineFn({
        data: { maxAnalyze: FIRST_BATCH_MAX_ANALYZE, maxBriefs: FIRST_BATCH_MAX_BRIEF_PAGES, maxImages: FIRST_BATCH_MAX_IMAGES },
      });
      const worker = await workerFn();
      return { pipeline, worker };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["scheduled"] });
      qc.invalidateQueries({ queryKey: ["dash-logs"] });
    },
  });
}
