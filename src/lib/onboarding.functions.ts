import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ApiKeyProvider } from "@/lib/api-key-connections.server";

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
  "text_provider_connected",
  "image_provider_connected",
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
    id: "text_provider_connected",
    title: "Connect a text provider",
    description: "Required for page analysis and pin copy -- connect OpenAI or Anthropic.",
    optional: false,
    wizardStep: 3,
  },
  {
    id: "image_provider_connected",
    title: "Connect an image provider",
    description: "Required for rendering pin artwork -- pins can't generate images without a connected image provider.",
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
const REQUIRED_FOR_GENERATION: readonly SetupStepId[] = ["site_connected", "brand_identity", "text_provider_connected", "image_provider_connected"];

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
  // Which text provider actually resolves for this account right now --
  // "openai" | "anthropic" if text_provider_connected is done, null if
  // it isn't. Computed via the exact same resolveCopyConnection
  // (provider-resolution.server.ts) analyzePage/generateBriefs/the SERP
  // summarizer call at generation time, not a separate approximation --
  // so this can't disagree with which provider a real generation call
  // would actually use. Purely a display concern (the Dashboard
  // checklist's completed row -- see components/DashboardEmptyState.tsx
  // -- shows "Text provider -- OpenAI"/"-- Anthropic" instead of a
  // generic checkmark); nothing here gates readyToGenerate or any other
  // boolean above.
  textProviderInUse: "openai" | "anthropic" | null;
  // Same idea as textProviderInUse, for the image-provider step --
  // which of the 7 IMAGE_PROVIDERS (sites.functions.ts) actually
  // resolves via resolveImageConnection right now, or null if nothing
  // does yet. Also purely a display concern.
  imageProviderInUse: ApiKeyProvider | null;
};

// Same has_value computation integrations.functions.ts:listIntegrations
// uses (decrypt config_ciphertext, check the one field that represents
// "a credential is actually configured") -- duplicated here in miniature
// rather than imported, since listIntegrations returns every provider's
// full metadata (last_error, timestamps, etc.) this only needs a yes/no.
//
// Text generation (page analysis, in pages.functions.ts:analyzePage, and
// pin copy, in briefs.functions.ts:generateBriefs) is provider-flexible:
// both resolve their actual connection via resolveCopyConnection
// (provider-resolution.server.ts), which accepts either an OpenAI or an
// Anthropic connection -- COPY_PROVIDERS (sites.functions.ts) is the
// canonical list of which providers count. This step is done once ANY
// of them has a working connection; it is NOT "OpenAI OR Replicate" --
// Replicate is a fully-supported opt-in IMAGE renderer (connect it in
// the wizard's image-provider sub-step or later in Settings), a
// completely separate role from text generation, and never counts here
// regardless of whether it's connected.
async function hasTextProviderCredential(userId: string): Promise<boolean> {
  // Multi-connection api_key_connections table (a user can hold several
  // keys per provider) -- this just needs "at least one connection
  // exists for at least one text provider," so earliestConnectionForProvider
  // (any real connection for that provider would do) checked across
  // COPY_PROVIDERS is the right existence check here, not a direct table
  // query duplicated a second way, and not the fuller
  // override/account-default resolution chain resolveCopyConnection does
  // at actual generation time -- this is only ever "has something been
  // connected at all," the same bar every other checklist step uses.
  const { earliestConnectionForProvider } = await import("./api-key-connections.server");
  const { COPY_PROVIDERS } = await import("./sites.functions");
  const results = await Promise.all(COPY_PROVIDERS.map((provider) => earliestConnectionForProvider(userId, provider)));
  return results.some(Boolean);
}

// Mirrors hasTextProviderCredential exactly, checked against
// IMAGE_PROVIDERS (sites.functions.ts, 7 entries) instead of
// COPY_PROVIDERS -- added because generateFirstBatch previously had no
// gate on this at all: an account could finish onboarding with only a
// text provider connected, click Generate, and have every queued image
// job fail silently inside processImageQueueForUser (image-worker.server.ts)
// while the UI showed a success toast. This existence check is what
// text_provider_connected already does for text; image_provider_connected
// (SETUP_STEPS, REQUIRED_FOR_GENERATION) closes the same gap for images.
async function hasImageProviderCredential(userId: string): Promise<boolean> {
  const { earliestConnectionForProvider } = await import("./api-key-connections.server");
  const { IMAGE_PROVIDERS } = await import("./sites.functions");
  const results = await Promise.all(IMAGE_PROVIDERS.map((provider) => earliestConnectionForProvider(userId, provider)));
  return results.some(Boolean);
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

    const [
      sitesRes, integrationsRes, imagesRes, onboardingRes, publishingProfileRes,
      textProviderConnected, imageProviderConnected, googleConnectionsRes,
      textProviderInUse, imageProviderInUse,
    ] = await Promise.all([
      s.from("sites").select("id, brand_name"),
      s.from("integrations").select("provider, status"),
      s.from("pin_images").select("id", { count: "exact", head: true }),
      s.from("account_onboarding").select("dismissed_onboarding_prompt").eq("user_id", context.userId).maybeSingle(),
      s.from("account_publishing_profiles").select("user_id").eq("user_id", context.userId).maybeSingle(),
      hasTextProviderCredential(context.userId),
      hasImageProviderCredential(context.userId),
      // Existence check only -- same "at least one row" bar every other
      // step here uses (site_connected, text_provider_connected via
      // hasTextProviderCredential). No per-property validation; that's
      // what the Insights page's own GA4 property picker is for.
      s.from("google_connections").select("id", { count: "exact", head: true }),
      // Real resolution (not just an existence check), for display only
      // -- see the SetupStatus.textProviderInUse doc comment above.
      // resolveCopyConnection(userId, null) mirrors analyzePage's own
      // call exactly (no site override -- this is an account-wide
      // question). Throws when nothing resolves at all, which is a
      // completely normal state here (a brand-new account with no text
      // provider connected yet), so it's caught and turned into null
      // rather than failing the whole setup-status fetch over it.
      (async () => {
        const { resolveCopyConnection } = await import("./provider-resolution.server");
        try {
          const conn = await resolveCopyConnection(context.userId, null);
          return conn.provider === "anthropic" ? "anthropic" as const : "openai" as const;
        } catch {
          return null;
        }
      })(),
      // Same idea, image side -- resolveImageConnection(userId, null) is
      // the exact call image-worker.server.ts makes when it actually
      // renders. Deliberately not scoped to any one site (no override
      // id passed), same account-wide question as text.
      (async () => {
        const { resolveImageConnection } = await import("./provider-resolution.server");
        try {
          const conn = await resolveImageConnection(context.userId, null);
          return conn.provider;
        } catch {
          return null;
        }
      })(),
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
      text_provider_connected: textProviderConnected,
      image_provider_connected: imageProviderConnected,
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
      textProviderInUse,
      imageProviderInUse,
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
