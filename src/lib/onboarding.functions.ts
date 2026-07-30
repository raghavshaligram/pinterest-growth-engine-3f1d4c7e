import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------
// The single canonical definition of "what does a fully set-up Pinspider
// account look like" -- every one of the three first-time-user surfaces
// (the onboarding wizard's step-dots, the post-skip "Finish setup"
// banner, and the empty-state Dashboard's checklist card) renders off
// this list and off getSetupStatus() below, instead of each surface
// carrying its own copy of "has a site been added yet" logic that could
// silently drift out of sync with the others.
//
// wizardStep maps each item to the onboarding wizard step (routes/
// onboarding.tsx) that resolves it -- used by the gate hook
// (onboarding-gate.tsx) to send a user straight to the right step
// instead of always restarting at step 1.
// ---------------------------------------------------------------------

export const SETUP_STEP_IDS = [
  "site_connected",
  "brand_identity",
  "image_generation",
  "pinterest_connected",
  "first_batch",
  "google_connected",
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStepMeta = {
  id: SetupStepId;
  title: string;
  description: string;
  optional: boolean;
  wizardStep: 1 | 2 | 3 | 4 | 5 | 6;
};

// Wizard is now 6 steps (Site, Brand, API keys, Pinterest, Crawl,
// Complete) -- API keys before Pinterest deliberately: nothing works
// without a key, whereas Pinterest is only needed at publish time, so
// asking for OAuth before the user has seen any generated output is
// the wrong friction ordering. Google Analytics isn't its own step at
// all -- it's a dismissible card on the Complete step (see
// routes/onboarding.tsx:StepComplete), same visibility as a dedicated
// step would give it, one less step, no "skip" click required.
export const SETUP_STEPS: readonly SetupStepMeta[] = [
  {
    id: "site_connected",
    title: "Connect a site",
    description: "Add the website, Etsy shop, or store you want to grow on Pinterest.",
    optional: false,
    wizardStep: 1,
  },
  {
    id: "brand_identity",
    title: "Set your brand identity",
    description: "Name and accent color so generated pins actually look like your brand.",
    optional: false,
    wizardStep: 2,
  },
  {
    id: "image_generation",
    title: "Connect OpenAI",
    description: "Required for page analysis and pin copy -- Replicate is an optional extra for image rendering, connected in the same step.",
    optional: false,
    wizardStep: 3,
  },
  {
    id: "pinterest_connected",
    title: "Connect Pinterest",
    description: "Required to finish setup -- publishing needs a connected account. You can still generate and review pins before this step; only auto-publishing needs it.",
    optional: false,
    wizardStep: 4,
  },
  {
    id: "first_batch",
    title: "Generate your first batch",
    description: "Crawl a page and create your first set of pin images.",
    optional: false,
    wizardStep: 5,
  },
  {
    id: "google_connected",
    title: "Connect Google Analytics",
    description: "Optional -- only needed to see which pins are driving traffic back to your site on the Insights page.",
    optional: true,
    wizardStep: 6,
  },
] as const;

// The steps a pipeline-triggering action (Generate briefs, Render
// images, Generate All) actually needs -- Pinterest is deliberately
// excluded, matching the spec: you can generate and review pins with no
// Pinterest connection at all, you just can't auto-publish them.
const REQUIRED_FOR_GENERATION: readonly SetupStepId[] = ["site_connected", "brand_identity", "image_generation"];

export type SetupStatus = {
  steps: Record<SetupStepId, boolean>;
  // True once every REQUIRED_FOR_GENERATION step is done -- what the
  // gate hook (useSetupGate) keys off of to decide whether a pipeline
  // action may run. Doesn't include first_batch (that's the thing the
  // gated actions are FOR) or pinterest_connected (optional).
  readyToGenerate: boolean;
  // True once first_batch is also done -- what the empty-state
  // Dashboard uses to decide whether to show the real masonry feed.
  hasFirstBatch: boolean;
  // True once every NON-optional step is done, i.e. readyToGenerate AND
  // hasFirstBatch -- "onboarding is genuinely complete." Always computed
  // live from real data, never a stored flag, so it can't drift out of
  // sync with reality the way a one-time "mark complete" write could.
  // Deliberately does NOT require pinterest_connected (optional forever,
  // even once "done").
  isFullyOnboarded: boolean;
  // The ONE thing that actually needs to persist: whether the user
  // explicitly clicked "Skip setup" (or finished the wizard) at some
  // point. This -- not isFullyOnboarded -- is what suppresses the
  // forced auto-redirect-into-the-wizard on future logins; the
  // Finish-setup banner shows precisely when this is true AND
  // isFullyOnboarded is still false.
  dismissedOnboarding: boolean;
  // First not-yet-done step in wizard order, walking ALL steps
  // including optional ones (pinterest_connected) -- so an account
  // that's done everything required but still has an unanswered
  // Pinterest age-bucket question correctly resumes there, instead of
  // that gap being invisible because it's "only" optional. Gating logic
  // (useSetupGate) only ever consults this when readyToGenerate is
  // false, so returning an optional step's wizardStep here can never
  // force-block a pipeline action on something optional -- see firstMissing().
  firstMissingWizardStep: 1 | 2 | 3 | 4 | 5 | 6 | null;
};

// Same has_value computation integrations.functions.ts:listIntegrations
// uses (decrypt config_ciphertext, check the one field that represents
// "a credential is actually configured") -- duplicated here in miniature
// rather than imported, since listIntegrations returns every provider's
// full metadata (last_error, timestamps, etc.) this only needs a yes/no.
//
// Deliberately OpenAI only, not "OpenAI OR Replicate" -- generateBriefs
// (briefs.functions.ts) hard-requires an OpenAI key unconditionally, for
// page analysis and pin copy, regardless of which provider a site
// renders images with. Replicate is a fully-supported opt-in image
// renderer (connect it in the wizard's image-provider sub-step or later
// in Settings), but it can never substitute for OpenAI here -- a site
// configured for Replicate-only rendering with no OpenAI key would still
// hard-fail the very first pipeline step, so gating this step on
// "either provider" would let a genuinely broken setup read as "ready."
async function hasOpenAiCredential(userId: string): Promise<boolean> {
  // OpenAI moved from the old single-row `integrations` table to the
  // multi-connection api_key_connections table (a user can now hold
  // several OpenAI keys) -- this just needs "at least one exists,"
  // same yes/no this always returned, so earliestConnectionForProvider
  // (any real connection would do) is the right check here, not a
  // direct table query duplicated a second way.
  const { earliestConnectionForProvider } = await import("./api-key-connections.server");
  const conn = await earliestConnectionForProvider(userId, "openai");
  return Boolean(conn);
}

function firstMissing(steps: Record<SetupStepId, boolean>): 1 | 2 | 3 | 4 | 5 | 6 | null {
  // Every step, in wizard order, optional included -- see the
  // firstMissingWizardStep doc comment above for why optional steps
  // still need to participate here even though they never block
  // readyToGenerate/the gate.
  for (const step of SETUP_STEPS) {
    if (!steps[step.id]) return step.wizardStep;
  }
  return null;
}

export const getSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SetupStatus> => {
    const s = context.supabase;

    const [sitesRes, integrationsRes, imagesRes, onboardingRes, publishingProfileRes, openaiConnected, googleConnectionsRes] = await Promise.all([
      s.from("sites").select("id, brand_name"),
      s.from("integrations").select("provider, status"),
      s.from("pin_images").select("id", { count: "exact", head: true }),
      s.from("account_onboarding").select("dismissed_onboarding_prompt").eq("user_id", context.userId).maybeSingle(),
      s.from("account_publishing_profiles").select("user_id").eq("user_id", context.userId).maybeSingle(),
      hasOpenAiCredential(context.userId),
      // Existence check only -- same "at least one row" bar every other
      // step here uses (site_connected, image_generation via
      // hasOpenAiCredential). No per-property validation; that's what
      // the Insights page's own GA4 property picker is for.
      s.from("google_connections").select("id", { count: "exact", head: true }),
    ]);

    const sites = sitesRes.data ?? [];
    const siteConnected = sites.length > 0;
    const brandIdentity = sites.some((r: { brand_name: string | null }) => (r.brand_name ?? "").trim().length > 0);
    // Pinterest sets status:"ok" directly from the OAuth callback on a
    // successful token exchange (see api/public/pinterest.callback.ts) --
    // unlike openai/replicate, whose status only ever changes via the
    // explicit "Test" button, so status is the right signal here, not
    // has_value (which pinterest doesn't even expose a form field for).
    const pinterestOAuthOk = (integrationsRes.data ?? []).some(
      (r: { provider: string; status: string }) => r.provider === "pinterest" && r.status === "ok",
    );
    // "Connected" also requires the self-reported age-bucket question to
    // have been answered (account_publishing_profiles row exists) -- an
    // account can have a working Pinterest OAuth token from months ago
    // and still never have gone through that prompt (it shipped later
    // than Pinterest connect did). Bundling both here is what lets the
    // wizard correctly resume on "just the age-bucket question" for an
    // account that already did everything else, instead of treating
    // Pinterest as fully done the moment the token exists.
    const pinterestConnected = pinterestOAuthOk && Boolean(publishingProfileRes.data);
    const firstBatch = (imagesRes.count ?? 0) > 0;
    const googleConnected = (googleConnectionsRes.count ?? 0) > 0;

    const steps: Record<SetupStepId, boolean> = {
      site_connected: siteConnected,
      brand_identity: brandIdentity,
      image_generation: openaiConnected,
      pinterest_connected: pinterestConnected,
      first_batch: firstBatch,
      google_connected: googleConnected,
    };

    // Deliberately unchanged by pinterest_connected's move from optional
    // to required, and unaffected by google_connected existing at all --
    // readyToGenerate/isFullyOnboarded answer "can this account generate
    // and review pins," not "has every wizard screen been completed."
    // Generating and reviewing pins without Pinterest connected is
    // correct, intentional behavior (it's what lets someone evaluate
    // output quality before granting account access) -- the wizard's own
    // step-reachability chain (routes/onboarding.tsx) is what enforces
    // "required to finish the wizard," entirely separate from this.
    const readyToGenerate = REQUIRED_FOR_GENERATION.every((id) => steps[id]);
    const isFullyOnboarded = readyToGenerate && firstBatch;

    return {
      steps,
      readyToGenerate,
      hasFirstBatch: firstBatch,
      isFullyOnboarded,
      dismissedOnboarding: onboardingRes.data?.dismissed_onboarding_prompt ?? false,
      firstMissingWizardStep: firstMissing(steps),
    };
  });

// Called when the wizard's Completion step (step 5) is reached, or when
// "Skip setup" is clicked at any point -- either way persists
// dismissed_onboarding_prompt=true, the one flag that suppresses the
// forced auto-redirect-into-the-wizard on future logins (see
// PinShell.tsx:OnboardingRedirectGuard). Deliberately does NOT claim
// onboarding is "complete" -- isFullyOnboarded is always recomputed live
// from real data by getSetupStatus, so a skip (or an early Finish click,
// before generation has actually produced anything yet) can never make
// the app think something's done that isn't. completed_at/skipped_at
// are kept purely for the distinct timestamp each reason represents,
// not as something read back to decide anything.
export const dismissOnboardingPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { reason: "completed" | "skipped" }) =>
    z.object({ reason: z.enum(["completed", "skipped"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("account_onboarding").upsert(
      {
        user_id: context.userId,
        dismissed_onboarding_prompt: true,
        completed_at: data.reason === "completed" ? now : undefined,
        skipped_at: data.reason === "skipped" ? now : undefined,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

// Lets Settings' "Setup guide" link re-arm the forced auto-redirect for
// future logins if the account still isn't fully onboarded -- re-running
// the wizard from there shouldn't require clearing any real data, just
// this one suppression flag. Not currently wired to any UI action (the
// "Setup guide" link just navigates straight into the wizard instead),
// kept available for that to call later.
export const resetOnboardingDismissal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("account_onboarding").upsert(
      { user_id: context.userId, dismissed_onboarding_prompt: false, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return { ok: true };
  });
