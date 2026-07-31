// The 5-step first-time-user onboarding wizard. Standalone route (no
// PinShell chrome) -- deliberately a focused, full-bleed flow like
// /auth rather than the sidebar app shell, since a brand-new account
// has nothing behind that sidebar yet. PinShell itself (see
// components/PinShell.tsx) is what auto-redirects a not-yet-onboarded
// user in here on first login, and what every gated pipeline action
// (Generate briefs/Render images/Generate All) redirects back into at
// the first missing step -- both read the exact same getSetupStatus()
// this page's step-dots read, via useSetupStatus() (see
// lib/onboarding-gate.tsx), so none of the three can ever disagree
// about what's actually done.
import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CheckCircle2, Loader2, FileText, KeyRound, LayoutDashboard, Check, ChevronDown, BarChart3, X, ExternalLink,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/Logo";
import { getErrorMessage } from "@/lib/error-message";
import { useSetupStatus, SETUP_STATUS_QUERY_KEY } from "@/lib/onboarding-gate";
import { dismissOnboardingPrompt, type SetupStatus } from "@/lib/onboarding.functions";
import {
  AddSiteWizard, ACCENT_PRESETS, TYPOGRAPHY_PRESETS, hostFromUrl,
} from "@/routes/sites";
import {
  listSites, upsertSite, type SiteType,
} from "@/lib/sites.functions";
import { crawlSite } from "@/lib/sites.functions";
import { getAccountProviderDefaults, setAccountProviderDefault } from "@/lib/account-provider-defaults.functions";
import { listPages, analyzePage } from "@/lib/pages.functions";
import { generateBriefs, renderImagesForPage } from "@/lib/briefs.functions";
import { listIntegrations } from "@/lib/integrations.functions";
import { listApiKeyConnections } from "@/lib/api-key-connections.functions";
import { getPublishingProfile } from "@/lib/publishing-profile.functions";
import {
  PinterestConnectButton, PublishingAgePrompt, FirstApiKeySetup, IMAGE_GEN_PROVIDERS, COPY_GEN_PROVIDERS,
  GoogleConnectionsCard, type GenProviderMeta,
} from "@/routes/settings.integrations";
import type { ApiKeyConnectionSummary } from "@/lib/api-key-connections.server";
import { ProviderPicker } from "@/components/ProviderPicker";
import { PinStyleSetupPanel } from "@/components/PinStyleSetupPanel";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) =>
    z.object({ step: z.coerce.number().int().min(1).max(6).optional() }).parse(search),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  head: () => ({ meta: [{ title: "Setup — Pinspider" }] }),
  component: () => <OnboardingWizard />,
});

type SiteRow = {
  id: string;
  url: string;
  site_type: SiteType;
  brand_name: string | null;
  tagline: string | null;
  accent_color: string | null;
  brand_colors: unknown;
  brand_font: string | null;
  brand_notes: string | null;
  sitemap_url: string | null;
  style_locked_at: string | null;
};

// Shared by every step 2+ component -- one cached query (queryKey
// "sites-switcher", the exact key SiteProvider/SiteSwitcher already use
// app-wide) instead of each step independently re-fetching the same
// list, so a save in one step is immediately visible to the next.
function useSitesList() {
  const fn = useServerFn(listSites);
  return useQuery({ queryKey: ["sites-switcher"], queryFn: () => fn() });
}

// ---------- Wizard shell ----------

function OnboardingWizard() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const dismissPrompt = useServerFn(dismissOnboardingPrompt);
  const { data: status } = useSetupStatus();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>((search.step as 1 | 2 | 3 | 4 | 5 | 6) ?? 1);
  const [siteId, setSiteId] = useState<string | null>(null);
  const autoResumedRef = useRef(false);

  // A gated action (see onboarding-gate.tsx:useSetupGate) can navigate
  // here with a new ?step= while this route is already mounted -- sync
  // local state to that instead of only reading it once at mount. Also
  // how the Pinterest/Google OAuth round trips resume at the right step
  // (pinterest.callback.ts / google.callback.ts redirect back with
  // ?step=N on success) -- step lives in the URL, not client memory, so
  // it survives the full page navigation away and back.
  useEffect(() => {
    if (search.step && search.step !== step) { setStep(search.step as 1 | 2 | 3 | 4 | 5 | 6); autoResumedRef.current = true; }
  }, [search.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume at the first genuinely-incomplete step, not always step 1 --
  // e.g. an account that already has a site/brand/API keys set up
  // (HarvestMath) should land straight on whatever's actually still
  // missing (could be just Pinterest, or just the age-bucket question).
  // Only does this once per mount, and only when the URL didn't already
  // say where to go (an explicit ?step= -- from the gate hook, the
  // Settings "Setup guide" link, or the step-dots below -- always wins).
  useEffect(() => {
    if (autoResumedRef.current || search.step || !status) return;
    autoResumedRef.current = true;
    if (status.isFullyOnboarded) { setStep(6); return; }
    const target = status.firstMissingWizardStep;
    if (target && target !== 1) setStep(target);
  }, [status, search.step]);

  const { data: sites, isLoading: sitesLoading } = useSitesList();
  useEffect(() => {
    // Seed the working site once the list resolves and nothing's been
    // explicitly chosen yet (e.g. resuming mid-wizard via the gate,
    // where step 1 never ran this session to hand us an id directly) --
    // most recently created site, since this is a single-account app
    // and that's overwhelmingly the one still being set up.
    if (!siteId && sites && sites.length > 0) {
      setSiteId((sites[sites.length - 1] as SiteRow).id);
    }
  }, [sites, siteId]);

  // Setup state must be derived from current data on every render, never
  // from a stored/URL-supplied step that can go stale -- e.g. "Finish
  // setup" navigating here with a ?step= computed from a setup-status
  // snapshot taken before the user deleted every site. The moment a
  // fresh status resolves with no site at all, restart at step 1
  // unconditionally, regardless of what step the URL asked for or what
  // step this session had already reached. Runs on every status
  // load/refetch (not gated by autoResumedRef like the step-selection
  // effect below), since "the only site got deleted" can become true at
  // any point while the wizard is already open, not just at mount.
  useEffect(() => {
    if (!status) return;
    if (!status.steps.site_connected && step !== 1) {
      setStep(1);
      setSiteId(null);
    }
  }, [status, step]);

  // Same idea, one level more specific: a step already holding a real
  // siteId (site_connected is true -- at least one site still exists)
  // can still be pointing at a site that was itself deleted, e.g. one
  // of several sites removed from the Sites page in another tab while
  // this wizard sat open on step 2/3/5 for that exact site. Once the
  // sites list has actually resolved (not mid-fetch -- an empty result
  // while still loading isn't the same signal as "confirmed gone"),
  // treat a siteId that no longer matches any row as gone and restart
  // at step 1 rather than letting StepBrandIdentity/StepApiKeys/
  // StepCrawlPreview render indefinitely against an undefined site.
  useEffect(() => {
    if (sitesLoading || !sites) return;
    if (siteId && !sites.some((s) => (s as SiteRow).id === siteId) && step !== 1) {
      setStep(1);
      setSiteId(null);
    }
  }, [sites, sitesLoading, siteId, step]);

  // Both handlers prime the setup-status cache directly (setQueryData)
  // BEFORE navigating, rather than only invalidating it -- invalidate
  // triggers a background refetch but doesn't wait for it, so a
  // navigate() fired right after can land PinShell's
  // OnboardingRedirectGuard on the previous (stale, dismissedOnboarding:
  // false) cached value and immediately bounce straight back into this
  // wizard before the real refetch ever resolves. This was the actual
  // cause of "Skip does nothing" -- setting the field synchronously
  // here closes that race; invalidateQueries afterward still reconciles
  // with the server in the background as a backstop.
  async function handleSkip() {
    try {
      await dismissPrompt({ data: { reason: "skipped" } });
    } catch {
      // Non-fatal -- worst case the auto-redirect fires again next
      // login, which just re-offers the wizard, not a broken state.
    }
    qc.setQueryData(SETUP_STATUS_QUERY_KEY, (old: SetupStatus | undefined) => old ? { ...old, dismissedOnboarding: true } : old);
    qc.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
    navigate({ to: "/dashboard" });
  }

  async function handleFinish() {
    try {
      await dismissPrompt({ data: { reason: "completed" } });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
    qc.setQueryData(SETUP_STATUS_QUERY_KEY, (old: SetupStatus | undefined) => old ? { ...old, dismissedOnboarding: true } : old);
    qc.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
    navigate({ to: "/dashboard" });
  }

  // A dot is reachable if its step's own requirement is already
  // satisfied per real data (so a user who lands mid-wizard can freely
  // review/edit any already-done step) or if it's the current/an
  // earlier step reached naturally this session. Never lets you jump
  // AHEAD of a step whose data dependency (siteId, an integration,
  // etc.) genuinely isn't ready yet. Steps 3 (API keys) and 4
  // (Pinterest) are both required to finish the wizard -- step 4 isn't
  // reachable until step 3's real done-signal (readyToGenerate) is
  // true, and step 5 isn't reachable until step 4's (pinterest_connected)
  // is true. Google Analytics is a dismissible card ON step 6, not a
  // gate -- step 6 only depends on step 5 being reachable, never on
  // google_connected.
  function isStepReachable(n: 1 | 2 | 3 | 4 | 5 | 6): boolean {
    if (n <= step) return true;
    if (!status) return false;
    if (n === 2) return status.steps.site_connected;
    if (n === 3) return status.steps.site_connected && status.steps.brand_identity;
    if (n === 4) return status.steps.site_connected && status.steps.brand_identity && status.readyToGenerate;
    if (n === 5) return isStepReachable(4) && status.steps.pinterest_connected;
    if (n === 6) return isStepReachable(5);
    return true;
  }
  // A dot shows as done/checked based on the SAME per-step real-data
  // signal the checklist card and banner use, not just "is it behind
  // the current step" -- landing straight on step 5 should still show
  // 1-4 checked, not merely filled-in because they're numerically lower.
  function isStepDone(n: 1 | 2 | 3 | 4 | 5 | 6): boolean {
    if (!status) return n < step;
    if (n === 1) return status.steps.site_connected;
    if (n === 2) return status.steps.brand_identity;
    if (n === 3) return status.readyToGenerate; // API keys connected
    if (n === 4) return status.steps.pinterest_connected;
    if (n === 5) return status.hasFirstBatch;
    return status.isFullyOnboarded;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF9" }} className="flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <span className="font-semibold">Pinspider setup</span>
          </div>
          {step < 6 && (
            <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
              Skip setup
            </Button>
          )}
        </div>

        <div className="mb-8 flex items-center justify-center gap-2">
          {([1, 2, 3, 4, 5, 6] as const).map((n) => {
            const reachable = isStepReachable(n);
            const done = isStepDone(n);
            return (
              <button
                key={n}
                type="button"
                aria-label={`Step ${n}`}
                disabled={!reachable}
                onClick={() => reachable && setStep(n)}
                className="flex items-center justify-center rounded-full transition-all"
                style={{
                  width: n === step ? 24 : 8, height: 8, border: "none", padding: 0,
                  background: done ? "#10B981" : n <= step ? "#E60023" : "#E5E5E5",
                  cursor: reachable ? "pointer" : "default",
                }}
              />
            );
          })}
        </div>

        <Card className="p-6 sm:p-8">
          {step === 1 && (
            <StepWelcome
              onSiteReady={(site) => { setSiteId(site.id); setStep(2); }}
              onSkip={handleSkip}
            />
          )}
          {step === 2 && (siteId
            ? <StepBrandIdentity siteId={siteId} onNext={() => setStep(3)} onBack={() => setStep(1)} />
            : <CenteredSpinner />)}
          {step === 3 && (siteId
            ? <StepApiKeys siteId={siteId} onNext={() => setStep(4)} onBack={() => setStep(2)} />
            : <CenteredSpinner />)}
          {step === 4 && (
            <StepPinterest onNext={() => setStep(5)} onBack={() => setStep(3)} />
          )}
          {step === 5 && (siteId
            ? <StepCrawlPreview siteId={siteId} onNext={() => setStep(6)} onBack={() => setStep(4)} onAdjustBrand={() => setStep(2)} />
            : <CenteredSpinner />)}
          {step === 6 && (
            <StepComplete siteId={siteId} onFinish={handleFinish} />
          )}
        </Card>
      </div>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------- Step 1: Welcome + Add-a-site ----------

function StepWelcome({
  onSiteReady, onSkip,
}: {
  onSiteReady: (site: { id: string; url: string }) => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="font-display text-2xl">Welcome to Pinspider</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Pinspider crawls your site, writes on-brand pin copy, generates pin images, and schedules them
          straight to Pinterest. First, tell us what you want to grow.
        </p>
      </div>
      {/* Reused as-is, per spec -- the wizard's own X/cancel control here
          doubles as "skip setup" (there's no parent toggle to close back
          into, unlike its use on the Sites page) rather than being a
          dead button. */}
      <AddSiteWizard
        onCancel={onSkip}
        onCreated={(site) => site && onSiteReady(site)}
        showStyleSetupStep={false}
      />
    </div>
  );
}

// ---------- Step 2: Brand identity (vibe-filtered accent picker) ----------

const VIBE_OPTIONS: { key: string; label: string; blurb: string; accents: string[] }[] = [
  { key: "warm_rustic", label: "Warm & rustic", blurb: "Earthy, cozy, handcrafted", accents: ["#F97316", "#EAB308", "#E60023", "#6B7280"] },
  { key: "clean_modern", label: "Clean & modern", blurb: "Crisp, minimal, confident", accents: ["#3B82F6", "#111111", "#14B8A6", "#6B7280"] },
  { key: "bold_playful", label: "Bold & playful", blurb: "Punchy, energetic, fun", accents: ["#E60023", "#EC4899", "#F97316", "#8B5CF6"] },
  { key: "elegant_editorial", label: "Elegant & editorial", blurb: "Refined, magazine-like", accents: ["#111111", "#8B5CF6", "#6B7280", "#14B8A6"] },
  { key: "minimal_neutral", label: "Minimal & neutral", blurb: "Understated, quiet, calm", accents: ["#111111", "#6B7280", "#3B82F6"] },
];

function StepBrandIdentity({
  siteId, onNext, onBack,
}: {
  siteId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: sites } = useSitesList();
  const site = (sites ?? []).find((s) => (s as SiteRow).id === siteId) as SiteRow | undefined;
  const upsert = useServerFn(upsertSite);

  const [vibe, setVibe] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string>("#E60023");
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [typography, setTypography] = useState("");
  const [notes, setNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (site && !seededRef.current) {
      seededRef.current = true;
      setAccentColor(site.accent_color ?? "#E60023");
      setBrandColors(Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : []);
      setTypography(site.brand_font ?? "");
      setNotes(site.brand_notes ?? "");
    }
  }, [site]);

  const saveMut = useMutation({
    mutationFn: () => upsert({
      data: {
        id: siteId,
        url: site!.url,
        site_type: site!.site_type,
        accent_color: accentColor,
        brand_colors: brandColors,
        brand_font: typography || undefined,
        brand_notes: notes || undefined,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      onNext();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!site) return <CenteredSpinner />;

  const activeVibe = VIBE_OPTIONS.find((v) => v.key === vibe);
  const swatchSet = activeVibe?.accents ?? ACCENT_PRESETS;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">How would you describe {site.brand_name || "your brand"}'s vibe?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This just pre-filters the accent-color picker below to a relevant subset — pick any color either way.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {VIBE_OPTIONS.map((v) => {
          const active = vibe === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => { setVibe(v.key); if (!v.accents.includes(accentColor)) setAccentColor(v.accents[0]); }}
              className="rounded-lg border p-4 text-left transition-colors hover:border-neutral-400"
              style={{ borderColor: active ? "#E60023" : "#E5E5E5", borderWidth: active ? 2 : 1, background: active ? "#FCE9EA" : "transparent" }}
            >
              <div className="font-medium">{v.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{v.blurb}</div>
            </button>
          );
        })}
      </div>

      <div>
        <Label className="mb-2 block">Accent color</Label>
        <div className="flex flex-wrap items-center gap-2">
          {swatchSet.map((hex) => {
            const active = accentColor === hex;
            return (
              <button
                key={hex} type="button" onClick={() => setAccentColor(hex)}
                title={hex} aria-label={hex}
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: hex, boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #111111" : "0 0 0 1px rgba(0,0,0,0.08)" }}
              >
                {active && <Check className="h-4 w-4 text-white" />}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium">
        <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />Advanced
      </button>

      {advancedOpen && (
        <div className="space-y-4 border-t border-border pt-4">
          <div>
            <Label className="mb-2 block">Brand palette <span className="font-normal text-muted-foreground">(optional, extra colors for image gen)</span></Label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((hex) => {
                const active = brandColors.includes(hex);
                return (
                  <button
                    key={hex} type="button"
                    onClick={() => setBrandColors((cur) => (cur.includes(hex) ? cur.filter((c) => c !== hex) : [...cur, hex]))}
                    title={hex} aria-label={hex}
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ background: hex, boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #111111" : "0 0 0 1px rgba(0,0,0,0.08)" }}
                  >
                    {active && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Typography direction</Label>
            <Select value={typography || undefined} onValueChange={setTypography}>
              <SelectTrigger><SelectValue placeholder="Choose a pairing" /></SelectTrigger>
              <SelectContent>
                {TYPOGRAPHY_PRESETS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Brand notes for image gen</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Warm editorial photography, minimal overlays, no stock illustrations." />
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>Back</Button>
        <Button
          type="button"
          className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
          onClick={() => saveMut.mutate()}
          disabled={!vibe || saveMut.isPending}
        >
          {saveMut.isPending ? "Saving…" : "Continue →"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Step 3: API keys (OpenAI -> image provider) ----------
// Split out of what used to be a single combined "Integrations" step
// (OpenAI -> image provider -> Pinterest, all as sub-tabs of one
// screen) -- API keys now come before Pinterest (step 4): nothing
// works without a key, whereas Pinterest is only needed at publish
// time, so asking for OAuth before the user has seen any generated
// output was the wrong friction ordering. The sub-tab structure inside
// this one step is otherwise unchanged from before the split.

function StepApiKeys({
  siteId, onNext, onBack,
}: {
  siteId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: setupStatus } = useSetupStatus();
  // Land on whichever sub-tab is actually still relevant instead of
  // always "textprovider" -- an account that already has a text
  // provider connected should open straight on the image-provider
  // choice, not force a replay of an already-done sub-step. Computed
  // once at mount from whatever's already cached (this component's
  // parent already fetched the same query, so it's normally available
  // immediately, not a loading flash).
  const [sub, setSub] = useState<"textprovider" | "imagegen">(() => {
    if (!setupStatus) return "textprovider";
    return setupStatus.steps.text_provider_connected ? "imagegen" : "textprovider";
  });
  const listConns = useServerFn(listApiKeyConnections);
  const { data: connections } = useQuery({ queryKey: ["api-key-connections"], queryFn: () => listConns() });
  const setAccountDefault = useServerFn(setAccountProviderDefault);

  // Text provider: deliberately starts unselected, not defaulted to
  // OpenAI -- OpenAI is marked "Most common" in the UI below as a soft
  // hint, not preselected or gated on, so choosing Anthropic is exactly
  // as fast as choosing OpenAI. Only overridden by the effect below if
  // the account already has an explicit copy default set (a returning
  // user revisiting this step should see their real choice, not a blank
  // one).
  const [textProvider, setTextProvider] = useState<"openai" | "anthropic" | null>(null);
  const [imageProvider, setImageProvider] = useState<string>("openai");
  const getDefaults = useServerFn(getAccountProviderDefaults);
  const { data: providerDefaults } = useQuery({ queryKey: ["account-provider-defaults"], queryFn: () => getDefaults() });
  useEffect(() => {
    const defaultCopyConn = (connections ?? []).find((c) => c.id === providerDefaults?.default_copy_connection_id);
    if (defaultCopyConn?.provider === "openai" || defaultCopyConn?.provider === "anthropic") {
      setTextProvider(defaultCopyConn.provider);
    }
  }, [providerDefaults?.default_copy_connection_id, connections]);
  useEffect(() => {
    const defaultImageConn = (connections ?? []).find((c) => c.id === providerDefaults?.default_image_connection_id);
    if (defaultImageConn) setImageProvider(defaultImageConn.provider);
  }, [providerDefaults?.default_image_connection_id, connections]);

  const openaiConnections = (connections ?? []).filter((c) => c.provider === "openai");
  const anthropicConnections = (connections ?? []).filter((c) => c.provider === "anthropic");
  const textConnections = textProvider === "anthropic" ? anthropicConnections : openaiConnections;
  const imageConnections = (connections ?? []).filter((c) => c.provider === imageProvider);
  const anyTextConnected = openaiConnections.length > 0 || anthropicConnections.length > 0;
  const anyImageConnected = (connections ?? []).some((c) => IMAGE_GEN_PROVIDERS.some((p) => p.provider === c.provider));

  const saveTextProviderMut = useMutation({
    mutationFn: () => {
      const conn = textConnections[0];
      if (!conn || !textProvider) throw new Error("Add and save a key above first.");
      return setAccountDefault({ data: { kind: "copy", connectionId: conn.id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      qc.invalidateQueries({ queryKey: ["account-provider-defaults"] });
      setSub("imagegen");
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const saveImageProviderMut = useMutation({
    // Sets the ACCOUNT-level default image CONNECTION (not this
    // specific site) -- image_provider is no longer a per-site column
    // at all, and the account default is now a specific connection id,
    // not a provider name.
    mutationFn: () => {
      const conn = imageConnections[0];
      const providerTitle = IMAGE_GEN_PROVIDERS.find((p) => p.provider === imageProvider)?.title ?? imageProvider;
      if (!conn) throw new Error(`Add a ${providerTitle} key above first.`);
      return setAccountDefault({ data: { kind: "image", connectionId: conn.id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      qc.invalidateQueries({ queryKey: ["account-provider-defaults"] });
      onNext();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const invalidateIntegrations = () => {
    qc.invalidateQueries({ queryKey: ["integrations"] });
    qc.invalidateQueries({ queryKey: ["api-key-connections"] });
    qc.invalidateQueries({ queryKey: ["setup-status"] });
  };

  return (
    <div className="space-y-6">
      <SubStepTabs
        sub={sub}
        onChange={setSub}
        items={[
          { key: "textprovider", label: "Text provider", done: anyTextConnected },
          { key: "imagegen", label: "Image generation", done: anyImageConnected },
        ]}
      />

      {sub === "textprovider" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Powers reading your pages and writing your pin copy. Pick whichever provider you already have a key for, or connect a new one below.
          </p>
          <div className="flex gap-2">
            {COPY_GEN_PROVIDERS.map((meta) => (
              <button
                key={meta.provider}
                type="button"
                onClick={() => setTextProvider(meta.provider as "openai" | "anthropic")}
                className="flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium"
                style={{
                  borderColor: textProvider === meta.provider ? "#E60023" : "#E5E5E5",
                  background: textProvider === meta.provider ? "#FCE9EA" : "transparent",
                  color: textProvider === meta.provider ? "#E60023" : undefined,
                }}
              >
                {meta.title}
                {meta.provider === "openai" && (
                  <span className="text-[10px] font-normal text-muted-foreground">Most common</span>
                )}
              </button>
            ))}
          </div>
          {textProvider && (() => {
            const meta = COPY_GEN_PROVIDERS.find((p) => p.provider === textProvider)!;
            return (
              <div className="space-y-2">
                {meta.keyUrl && (
                  <a
                    href={meta.keyUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Get your {meta.title} key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <FirstApiKeySetup meta={meta} connections={textConnections} onChanged={invalidateIntegrations} />
              </div>
            );
          })()}
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => saveTextProviderMut.mutate()}
              disabled={saveTextProviderMut.isPending || !textProvider || textConnections.length === 0}
              title={!textProvider ? "Choose a provider above first." : textConnections.length === 0 ? "Add and save a key above to continue." : undefined}
            >
              {saveTextProviderMut.isPending ? "Saving…" : "Next →"}
            </Button>
          </div>
        </div>
      )}

      {sub === "imagegen" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose which model renders your pin images by default. Any site can be pinned to a specific key instead later, from that key's row in Settings → Integrations.
          </p>
          <ProviderPicker
            providers={IMAGE_GEN_PROVIDERS}
            recommendedProvider="openai"
            recommendedBadge="Recommended"
            renderProvider={(meta) => (
              <ImageProviderChoice
                meta={meta}
                connections={(connections ?? []).filter((c) => c.provider === meta.provider)}
                selected={imageProvider === meta.provider}
                onSelect={() => setImageProvider(meta.provider)}
                onChanged={invalidateIntegrations}
              />
            )}
          />
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setSub("textprovider")}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => saveImageProviderMut.mutate()}
              disabled={saveImageProviderMut.isPending || imageConnections.length === 0}
            >
              {saveImageProviderMut.isPending ? "Saving…" : "Next →"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// One provider's row inside the image-generation ProviderPicker -- a
// select pill, and (once selected) the same FirstApiKeySetup form every
// other provider entry point in the app uses. No per-provider custom
// UI beyond the pill label; ProviderPicker itself decides which
// providers are even visible without opening "Show more".
function ImageProviderChoice({
  meta, connections, selected, onSelect, onChanged,
}: {
  meta: GenProviderMeta;
  connections: ApiKeyConnectionSummary[];
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        className="rounded-full border px-4 py-1.5 text-sm font-medium"
        style={{
          borderColor: selected ? "#E60023" : "#E5E5E5",
          background: selected ? "#FCE9EA" : "transparent",
          color: selected ? "#E60023" : undefined,
        }}
      >
        {meta.title}
      </button>
      {selected && (
        <div className="mt-2">
          <FirstApiKeySetup meta={meta} connections={connections} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

// ---------- Step 4: Connect Pinterest ----------
// Required -- "Continue" stays disabled until status.steps.pinterest_connected
// is genuinely true (real OAuth token AND the age-bucket question
// answered, see onboarding.functions.ts:getSetupStatus), not just a
// local "did OAuth redirect back ok" flag. There's deliberately no
// "connect later"/skip control here, unlike the old combined step,
// since this step's whole point is that publishing needs it.

function StepPinterest({
  onNext, onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: setupStatus } = useSetupStatus();
  // Pinterest still lives in the legacy `integrations` table (its own
  // OAuth flow, untouched by the multi-connection restructure) --
  // openai/replicate live in api_key_connections instead.
  const listIntFn = useServerFn(listIntegrations);
  const { data: integrations } = useQuery({ queryKey: ["integrations"], queryFn: () => listIntFn() });
  const getProfile = useServerFn(getPublishingProfile);
  const [showAgePrompt, setShowAgePrompt] = useState(false);

  // Pinterest OAuth is a real cross-site redirect (Pinterest ->
  // pinterest.callback.ts -> back here), so this reads the real browser
  // URL on return rather than router state -- same pattern
  // settings.integrations.tsx already uses for the non-onboarding case.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const st = p.get("pinterest");
    if (st === "connected") {
      toast.success("Pinterest connected");
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      window.history.replaceState({}, "", window.location.pathname + "?step=4");
    } else if (st === "error") {
      toast.error(`Pinterest connect failed: ${p.get("reason") ?? "unknown"}`);
      window.history.replaceState({}, "", window.location.pathname + "?step=4");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinterestStatus = (integrations ?? []).find((i) => i.provider === "pinterest");
  const pinterestOk = pinterestStatus?.status === "ok";

  // Proactively surfaces the age-bucket question whenever Pinterest's
  // OAuth token exists but the profile doesn't -- not just in the
  // moment right after a fresh OAuth redirect above. An account can
  // have connected Pinterest long before this prompt existed (or before
  // this wizard existed at all) and never been asked -- landing on this
  // step, by any route, should always check for that gap rather than
  // only checking it on the one narrow path of a same-second OAuth
  // return.
  useEffect(() => {
    if (!pinterestOk) return;
    let cancelled = false;
    getProfile().then((profile) => { if (!cancelled && !profile) setShowAgePrompt(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pinterestOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // The real, canonical "is this step actually done" signal -- requires
  // both the OAuth token AND the age-bucket answer (see
  // onboarding.functions.ts's pinterest_connected computation), not just
  // pinterestOk, so "Continue" can't be clicked in the gap between a
  // successful OAuth return and the age prompt being answered.
  const stepDone = Boolean(setupStatus?.steps.pinterest_connected);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Publish straight to your Pinterest account — required to finish setup, since auto-publishing needs a connected account. You can still review and adjust every generated pin before it goes out.
      </p>
      <Card className="p-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="text-lg font-semibold">Pinterest</h3></div>
          {pinterestOk && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>}
        </div>
        {!pinterestOk && <PinterestConnectButton returnTo="onboarding" />}
      </Card>
      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>Back</Button>
        <Button
          type="button"
          className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
          onClick={onNext}
          disabled={!stepDone}
          title={!stepDone ? "Connect Pinterest above to continue -- required for auto-publishing." : undefined}
        >
          Continue →
        </Button>
      </div>
      <PublishingAgePrompt open={showAgePrompt} onOpenChange={setShowAgePrompt} />
    </div>
  );
}

function SubStepTabs({
  sub, onChange, items,
}: {
  sub: string;
  onChange: (v: "textprovider" | "imagegen") => void;
  items: { key: "textprovider" | "imagegen"; label: string; done: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => {
        const active = sub === it.key;
        return (
          <button
            key={it.key} type="button" onClick={() => onChange(it.key)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
            style={{ borderColor: active ? "#E60023" : "#E5E5E5", color: active ? "#E60023" : undefined, background: active ? "#FCE9EA" : "transparent" }}
          >
            {it.done && <Check className="h-3 w-3" />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Step 4: First crawl preview ----------

// Three-phase progress indicator for StepCrawlPreview -- Crawl / Choose
// pin style / Generate. Purely presentational (no new state, no new
// gating): style_locked_at is still what actually blocks generation,
// this just makes the sequence visible instead of the screen going
// from a spinner straight to an unlabeled panel with no explanation of
// why it's there or what happens after. Mirrors the wizard's own
// top-level step-dots color language (onboarding.tsx's Onboarding
// component: emerald done, Pinterest red current, gray upcoming)
// rather than inventing a new visual vocabulary for a 3-item version
// of the same idea.
function CrawlPhaseIndicator({ phase }: { phase: "crawl" | "style" | "generate" }) {
  const PHASES: { key: "crawl" | "style" | "generate"; label: string }[] = [
    { key: "crawl", label: "Crawl" },
    { key: "style", label: "Choose pin style" },
    { key: "generate", label: "Generate" },
  ];
  const currentIndex = PHASES.findIndex((p) => p.key === phase);
  return (
    <div className="mb-5 flex items-center justify-center gap-1.5 text-xs font-medium">
      {PHASES.map((p, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <div key={p.key} className="flex items-center gap-1.5">
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{
                background: done ? "#ECFDF5" : current ? "#FCE9EA" : "transparent",
                color: done ? "#059669" : current ? "#E60023" : "#9CA3AF",
              }}
            >
              {done
                ? <Check className="h-3 w-3" />
                : <span className="h-1.5 w-1.5 rounded-full" style={{ background: current ? "#E60023" : "#D1D5DB" }} />}
              {p.label}
            </span>
            {i < PHASES.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        );
      })}
    </div>
  );
}

// Upper bound on how many pages the wizard's first batch will ever touch
// in one run, regardless of how many pages the crawl discovered (a site
// can easily discover hundreds). Picked to be small enough that "N pages,
// N pins, your own API keys" is honestly statable and small enough that a
// first click is never a surprise bill -- see the batch loop below, which
// processes exactly one pin per selected page (never generateBriefs'
// usual count:10), so total pins generated == number of pages selected,
// always <= this cap.
const FIRST_BATCH_PAGE_CAP = 10;

function StepCrawlPreview({
  siteId, onNext, onBack, onAdjustBrand,
}: {
  siteId: string;
  onNext: () => void;
  onBack: () => void;
  onAdjustBrand: () => void;
}) {
  const qc = useQueryClient();
  const { data: sites } = useSitesList();
  const site = (sites ?? []).find((s) => (s as SiteRow).id === siteId) as SiteRow | undefined;
  const crawlFn = useServerFn(crawlSite);
  const listPagesFn = useServerFn(listPages);
  const analyzeFn = useServerFn(analyzePage);
  const generateBriefsFn = useServerFn(generateBriefs);
  const renderImagesForPageFn = useServerFn(renderImagesForPage);
  // "Generate first batch" calls generateBriefs under the hood, which is
  // gated on style_locked_at (see briefs.functions.ts) -- this is the
  // first point in onboarding where a real image provider is guaranteed
  // connected (step 3, just before this one), so it's the right place to
  // surface Pin Style Setup rather than forcing it back at step 1's site
  // creation, when no provider exists yet to render a real preview with.
  // Still the one thing that actually gates generation -- everything
  // below just makes that requirement visible in advance instead of
  // leaving the "Generate" control missing with no explanation.
  const styleLocked = Boolean(site?.style_locked_at);

  const crawlMut = useMutation({
    mutationFn: () => crawlFn({ data: { siteId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pages"] }),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  // Auto-trigger once, as soon as we know which site we're crawling.
  // crawlSite (sites.functions.ts) is a synchronous server call -- there's
  // no jobs-table row to poll for a real progress percentage, so
  // "in-flight" IS the live status here, same honesty standard the rest
  // of this app holds to (see e.g. dashboard.tsx's "no fabricated
  // numbers" pattern) rather than a fake progress bar.
  useEffect(() => {
    if (siteId && crawlMut.isIdle) crawlMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  type PreviewPage = { id: string; url: string; title: string | null; last_analyzed_at: string | null; pin_briefs?: { id: string }[] };
  const { data: pages } = useQuery({
    queryKey: ["onboarding-pages-preview", siteId],
    queryFn: () => listPagesFn({ data: { siteId } }) as Promise<PreviewPage[]>,
    enabled: crawlMut.isSuccess,
  });
  const preview = (pages ?? []).slice(0, 5);
  const discovered = crawlMut.data?.discovered ?? 0;

  // The actual candidate set for the first batch -- up to
  // FIRST_BATCH_PAGE_CAP pages, all individually selectable/deselectable
  // below (not just the 5-item "Found N pages" preview list above, which
  // stays display-only). Selection is seeded once the pages list resolves
  // (everything in the candidate set starts checked) and is never
  // re-seeded after that, so a partial run that gets cancelled doesn't
  // lose the user's choices when this list re-renders.
  const batchCandidates = (pages ?? []).slice(0, FIRST_BATCH_PAGE_CAP);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (selectedPageIds === null && batchCandidates.length > 0) {
      setSelectedPageIds(new Set(batchCandidates.map((p) => p.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  function toggleSelected(pageId: string) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  }
  const selectedCount = selectedPageIds?.size ?? 0;

  // Cancellable, page-by-page batch -- deliberately NOT runFullPipeline/
  // useGenerateFirstBatch (onboarding-gate.tsx), which processes up to 25
  // pages analyzed / up to 100 briefs across up to 10 pages / 20 images
  // rendered now with the rest silently queued for the nightly cron. That
  // scope is invisible to a first-time user and, at hundreds of
  // discovered pages, produces real BYOK billing with no way to see it
  // coming or stop it partway through. This instead reuses the exact
  // same page-scoped, idempotent functions the Pages detail view already
  // exposes per-page (routes/pages.$id.tsx: Analyze / Generate / Render),
  // looping over only the pages the user selected, one pin per page, so
  // "N pages selected" and "N pins generated" are the same number stated
  // on screen before the click. cancelRef lets Cancel take effect between
  // pages without an AbortController plumbed through three server calls --
  // the in-flight page finishes (can't interrupt a request already sent),
  // then the loop stops before starting the next one.
  const cancelRef = useRef(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; label: string | null } | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const batchMut = useMutation({
    mutationFn: async (pageIds: string[]) => {
      cancelRef.current = false;
      setCancelRequested(false);
      const candidateById = new Map(batchCandidates.map((p) => [p.id, p]));
      let done = 0;
      for (const pageId of pageIds) {
        if (cancelRef.current) break;
        const p = candidateById.get(pageId);
        setBatchProgress({ done, total: pageIds.length, label: p?.title || p?.url || null });
        if (!p?.last_analyzed_at) await analyzeFn({ data: { pageId } });
        if (cancelRef.current) break;
        const hasBrief = Boolean(p?.pin_briefs?.length);
        if (!hasBrief) await generateBriefsFn({ data: { pageId, count: 1 } });
        if (cancelRef.current) break;
        await renderImagesForPageFn({ data: { pageId } });
        done += 1;
        setBatchProgress({ done, total: pageIds.length, label: null });
      }
      return { done, total: pageIds.length, cancelled: cancelRef.current };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["pages"] });
      qc.invalidateQueries({ queryKey: ["onboarding-pages-preview", siteId] });
      qc.invalidateQueries({ queryKey: ["scheduled"] });
      qc.invalidateQueries({ queryKey: ["dash-logs"] });
      setBatchProgress(null);
      if (r.cancelled) {
        toast.info(`Stopped after ${r.done} of ${r.total} page${r.total === 1 ? "" : "s"}. The rest are untouched -- generate them any time from Pages.`);
      } else {
        onNext();
      }
    },
    onError: (e) => { setBatchProgress(null); toast.error(getErrorMessage(e)); },
  });

  // Drives CrawlPhaseIndicator above -- "crawl" until the mutation
  // succeeds (covers the pending AND error returns below too, since
  // both render before this component reaches its main return), "style"
  // once crawled but not yet locked, "generate" once locked. Never
  // "done" from inside this component -- once the batch actually
  // completes (not cancelled), onNext() advances the wizard past this
  // screen entirely, so there's no state where phase 3 needs to render
  // checked.
  const phase: "crawl" | "style" | "generate" = !crawlMut.isSuccess ? "crawl" : !styleLocked ? "style" : "generate";

  if (crawlMut.isPending || crawlMut.isIdle) {
    return (
      <div>
        <CrawlPhaseIndicator phase={phase} />
        <div className="space-y-3 py-10 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Crawling {site ? hostFromUrl(site.url) : "your site"}…</p>
        </div>
      </div>
    );
  }

  if (crawlMut.isError) {
    return (
      <div>
        <CrawlPhaseIndicator phase={phase} />
        <div className="space-y-4 py-6 text-center">
          <p className="text-sm text-destructive">{getErrorMessage(crawlMut.error)}</p>
          <div className="flex justify-center gap-2">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <Button type="button" onClick={() => crawlMut.mutate()}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  // No usable pages at all -- either the sitemap had zero URLs listed,
  // or it had URLs but every single one failed to crawl (added===0 &&
  // updated===0 with discovered>0). crawlSite (sites.functions.ts)
  // doesn't distinguish reasons beyond that -- a genuinely unreachable
  // sitemap already throws and lands in the isError branch above, not
  // here. Previously this state left "Generate first batch" (hidden
  // behind !styleLocked anyway) permanently disabled with no way
  // forward on this screen; now it offers a retry and an explicit way
  // to move on, per "don't trap them."
  const noPages = preview.length === 0;

  const generateDisabledReason = !styleLocked
    ? "Approve a pin style below before generating."
    : noPages
      ? "No pages were found to generate from."
      : selectedCount === 0
        ? "Select at least one page below to generate."
        : undefined;

  return (
    <div>
      <CrawlPhaseIndicator phase={phase} />
      <div className="space-y-5">
        {!noPages && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="mt-2 text-sm">
              Found {discovered || preview.length} page{(discovered || preview.length) === 1 ? "" : "s"} on {site ? hostFromUrl(site.url) : "your site"}
            </p>
          </div>
        )}
        {noPages && (
          <div className="space-y-3 rounded-md border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">
              {discovered === 0
                ? "We couldn't find any pages listed in the sitemap yet."
                : `We found ${discovered} page${discovered === 1 ? "" : "s"} listed, but couldn't crawl any of them successfully.`}
            </p>
            <p className="text-xs text-muted-foreground">Double-check the sitemap URL in Sites, then try again.</p>
            <div className="flex justify-center gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => crawlMut.mutate()}>Try again</Button>
              <Button type="button" variant="ghost" size="sm" onClick={onNext}>Skip for now →</Button>
            </div>
          </div>
        )}

        {!styleLocked && site && (
          <div className="border-t border-border pt-5">
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next: choose a pin style</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {!noPages
                  ? `We found ${discovered || preview.length} page${(discovered || preview.length) === 1 ? "" : "s"}. Approve a pin style below before generating your first batch -- this is what determines how every pin looks.`
                  : "Approve a pin style below -- it's still worth setting up now, even before any pages are ready to generate from."}
              </p>
            </div>
            <PinStyleSetupPanel
              site={{ id: site.id, brand_name: site.brand_name, url: site.url }}
              onDone={() => qc.invalidateQueries({ queryKey: ["sites-switcher"] })}
              onAdjust={onAdjustBrand}
            />
          </div>
        )}

        {!noPages && (
          <div className="border-t border-border pt-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose your first batch</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {`${selectedCount} of ${batchCandidates.length} page${batchCandidates.length === 1 ? "" : "s"} selected`}
                  {discovered > batchCandidates.length ? ` (out of ${discovered} found -- the rest can be generated later from Pages).` : "."}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPageIds(new Set(batchCandidates.map((p) => p.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setSelectedPageIds(new Set())}
                >
                  Select none
                </button>
              </div>
            </div>
            <ul className="space-y-1.5">
              {batchCandidates.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <Checkbox
                    checked={selectedPageIds?.has(p.id) ?? false}
                    onCheckedChange={() => toggleSelected(p.id)}
                    disabled={batchMut.isPending}
                  />
                  <span className="truncate" title={p.title ?? p.url}>{p.title || p.url}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!noPages && styleLocked && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {batchMut.isPending && batchProgress
              ? `Working on page ${Math.min(batchProgress.done + 1, batchProgress.total)} of ${batchProgress.total}${batchProgress.label ? ` -- ${batchProgress.label}` : ""}…`
              : `This analyzes ${selectedCount} page${selectedCount === 1 ? "" : "s"} and generates ${selectedCount} pin${selectedCount === 1 ? "" : "s"} (1 per page) using your own API keys. You can cancel partway through, and anything not generated here can always be generated later from Pages.`}
          </div>
        )}

        {batchMut.isPending && batchProgress && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-[#E60023] transition-all"
              style={{ width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%` }}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={batchMut.isPending}>Back</Button>
          <div className="flex items-center gap-2">
            {!noPages && (
              <Button
                type="button"
                variant="ghost"
                onClick={onNext}
                disabled={batchMut.isPending}
              >
                Skip -- generate pages individually later
              </Button>
            )}
            {batchMut.isPending ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => { cancelRef.current = true; setCancelRequested(true); }}
                disabled={cancelRequested}
              >
                {cancelRequested ? "Cancelling…" : "Cancel"}
              </Button>
            ) : (
              <Button
                type="button"
                className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
                onClick={() => batchMut.mutate(Array.from(selectedPageIds ?? []))}
                disabled={Boolean(generateDisabledReason)}
                title={generateDisabledReason}
              >
                {`Generate ${selectedCount} pin${selectedCount === 1 ? "" : "s"} →`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Step 5: Completion ----------

function StepComplete({
  siteId, onFinish,
}: {
  siteId: string | null;
  onFinish: () => void;
}) {
  const { data: sites } = useSitesList();
  const site = (sites ?? []).find((s) => (s as SiteRow).id === siteId) as SiteRow | undefined;
  const { data: status } = useSetupStatus();

  // Google Analytics is optional and never gates finishing the wizard --
  // it's a dismissible card here, not a step. Dismissal is this-session
  // only (component state, not persisted) per the "no progress
  // persistence across sessions" constraint -- a user who dismisses and
  // comes back later simply sees the card again, same as before they
  // dismissed it, unless they've since actually connected Google.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      window.history.replaceState({}, "", window.location.pathname + "?step=6");
    }
  }, []);
  const googleConnected = Boolean(status?.steps.google_connected);
  const showGoogleCard = !googleConnected && !dismissed;

  return (
    <div className="space-y-6 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
      <div>
        <h2 className="text-xl font-semibold">You're set up</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pinspider is generating pins for {site?.brand_name || (site ? hostFromUrl(site.url) : "your site")}. Here's where to go next.
        </p>
      </div>
      <div className="grid gap-3 text-left sm:grid-cols-2">
        <Link to="/pages" className="rounded-lg border border-border p-4 transition-colors hover:border-neutral-400">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <div className="mt-2 font-medium">View Pages</div>
          <div className="mt-1 text-xs text-muted-foreground">See what's been crawled and generated.</div>
        </Link>
        <Link to="/dashboard" className="rounded-lg border border-border p-4 transition-colors hover:border-neutral-400">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <div className="mt-2 font-medium">Go to Dashboard</div>
          <div className="mt-1 text-xs text-muted-foreground">Review and schedule your first pins.</div>
        </Link>
      </div>
      {showGoogleCard && (
        <div className="relative text-left">
          <button
            type="button"
            aria-label="Dismiss, I'll connect Google Analytics later"
            onClick={() => setDismissed(true)}
            className="absolute right-3 top-3 z-10 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Optional -- only needed to see which pins are driving traffic back to your site on the Insights page.
          </p>
          <GoogleConnectionsCard returnTo="onboarding" />
        </div>
      )}
      {googleConnected && (
        <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
          <Check className="h-4 w-4" />
          Google Analytics connected
        </div>
      )}
      <Button type="button" className="bg-[#E60023] text-white hover:bg-[#E60023]/90" onClick={onFinish}>
        Go to Dashboard →
      </Button>
    </div>
  );
}
