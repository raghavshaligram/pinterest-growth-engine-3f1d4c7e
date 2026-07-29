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
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStepMeta = {
  id: SetupStepId;
  title: string;
  description: string;
  optional: boolean;
  wizardStep: 1 | 2 | 3 | 4;
};

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
    description: "Publish straight to your account. Optional -- you can generate and review pins without it.",
    optional: true,
    wizardStep: 3,
  },
  {
    id: "first_batch",
    title: "Generate your first batch",
    description: "Crawl a page and create your first set of pin images.",
    optional: false,
    wizardStep: 4,
  },
] as const;

// The steps a pipeline-triggering action (Generate briefs, Render
// images, Generate All) actually needs -- Pinterest is deliberately
// excluded, matching the spec: you can generate and review pins with no
// Pinterest connection at all, you just can't auto-publish them.
const REQUIRED_FOR_GENERATION: readonly SetupStepId[] = ["site_connected", "brand_identity", "image_generation"];

export type SetupStatus = {
  steps: Record<SetupStepId, boolean>;
  hasCompletedOnboarding: boolean;
  // True once every REQUIRED_FOR_GENERATION step is done -- what the
  // Finish-setup banner and the gate hook key off of. Doesn't include
  // first_batch (that's the thing the gated actions are for) or
  // pinterest_connected (optional).
  readyToGenerate: boolean;
  // True once first_batch is also done -- what the empty-state
  // Dashboard uses to decide whether to show the real masonry feed.
  hasFirstBatch: boolean;
  // First not-yet-done required step, in wizard order -- null once
  // readyToGenerate is true. Used to send a gated action straight back
  // into the wizard at the right step instead of always step 1.
  firstMissingWizardStep: 1 | 2 | 3 | 4 | null;
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decrypt } = await import("./crypto.server");
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("config_ciphertext")
    .eq("user_id", userId)
    .eq("provider", "openai")
    .maybeSingle();
  if (!data) return false;
  try {
    const cfg = JSON.parse(decrypt(data.config_ciphertext)) as Record<string, unknown>;
    return Boolean(cfg.api_key);
  } catch {
    return false;
  }
}

function firstMissing(steps: Record<SetupStepId, boolean>): 1 | 2 | 3 | 4 | null {
  for (const stepId of REQUIRED_FOR_GENERATION) {
    if (!steps[stepId]) {
      return SETUP_STEPS.find((s) => s.id === stepId)!.wizardStep as 1 | 2 | 3;
    }
  }
  return null;
}

export const getSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SetupStatus> => {
    const s = context.supabase;

    const [sitesRes, integrationsRes, imagesRes, onboardingRes, openaiConnected] = await Promise.all([
      s.from("sites").select("id, brand_name"),
      s.from("integrations").select("provider, status"),
      s.from("pin_images").select("id", { count: "exact", head: true }),
      s.from("account_onboarding").select("has_completed_onboarding").eq("user_id", context.userId).maybeSingle(),
      hasOpenAiCredential(context.userId),
    ]);

    const sites = sitesRes.data ?? [];
    const siteConnected = sites.length > 0;
    const brandIdentity = sites.some((r: { brand_name: string | null }) => (r.brand_name ?? "").trim().length > 0);
    // Pinterest sets status:"ok" directly from the OAuth callback on a
    // successful token exchange (see api/public/pinterest.callback.ts) --
    // unlike openai/replicate, whose status only ever changes via the
    // explicit "Test" button, so status is the right signal here, not
    // has_value (which pinterest doesn't even expose a form field for).
    const pinterestConnected = (integrationsRes.data ?? []).some(
      (r: { provider: string; status: string }) => r.provider === "pinterest" && r.status === "ok",
    );
    const firstBatch = (imagesRes.count ?? 0) > 0;

    const steps: Record<SetupStepId, boolean> = {
      site_connected: siteConnected,
      brand_identity: brandIdentity,
      image_generation: openaiConnected,
      pinterest_connected: pinterestConnected,
      first_batch: firstBatch,
    };

    const readyToGenerate = REQUIRED_FOR_GENERATION.every((id) => steps[id]);

    return {
      steps,
      hasCompletedOnboarding: onboardingRes.data?.has_completed_onboarding ?? false,
      readyToGenerate,
      hasFirstBatch: firstBatch,
      firstMissingWizardStep: firstMissing(steps),
    };
  });

// Called when the wizard's Completion step (step 5) is reached, or when
// "Skip setup" is clicked at any point -- either way stops the
// auto-redirect-on-first-login (see PinShell.tsx). Real step completion
// is always recomputed live by getSetupStatus, never stored here, so a
// skip can never make the app think something's done that isn't.
export const markOnboardingDone = createServerFn({ method: "POST" })
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
        has_completed_onboarding: true,
        completed_at: data.reason === "completed" ? now : undefined,
        skipped_at: data.reason === "skipped" ? now : undefined,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

// Lets Settings offer "Restart setup guide" -- re-running the wizard
// (e.g. to connect Pinterest later) shouldn't require clearing real data,
// just the one flag that stops the auto-redirect.
export const resetOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("account_onboarding").upsert(
      { user_id: context.userId, has_completed_onboarding: false, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return { ok: true };
  });
