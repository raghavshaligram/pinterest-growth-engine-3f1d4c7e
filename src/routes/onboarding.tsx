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
  CheckCircle2, Loader2, FileText, KeyRound, LayoutDashboard, Check, ChevronDown, BarChart3, X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/Logo";
import { getErrorMessage } from "@/lib/error-message";
import { useSetupStatus, useGenerateFirstBatch, SETUP_STATUS_QUERY_KEY } from "@/lib/onboarding-gate";
import { dismissOnboardingPrompt, type SetupStatus } from "@/lib/onboarding.functions";
import {
  AddSiteWizard, ACCENT_PRESETS, TYPOGRAPHY_PRESETS, hostFromUrl,
} from "@/routes/sites";
import {
  listSites, upsertSite, type SiteType,
} from "@/lib/sites.functions";
import { crawlSite } from "@/lib/sites.functions";
import { getAccountProviderDefaults, setAccountProviderDefault } from "@/lib/account-provider-defaults.functions";
import { listPages } from "@/lib/pages.functions";
import { listIntegrations } from "@/lib/integrations.functions";
import { listApiKeyConnections } from "@/lib/api-key-connections.functions";
import { getPublishingProfile } from "@/lib/publishing-profile.functions";
import {
  PinterestConnectButton, PublishingAgePrompt, FirstApiKeySetup, IMAGE_GEN_PROVIDERS,
  GoogleConnectionsCard,
} from "@/routes/settings.integrations";
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

  const { data: sites } = useSitesList();
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
  // always "openai" -- an account that already has OpenAI connected
  // should open straight on the image-provider choice, not force a
  // replay of an already-done sub-step. Computed once at mount from
  // whatever's already cached (this component's parent already fetched
  // the same query, so it's normally available immediately, not a
  // loading flash).
  const [sub, setSub] = useState<"openai" | "imagegen">(() => {
    if (!setupStatus) return "openai";
    return setupStatus.steps.text_provider_connected ? "imagegen" : "openai";
  });
  const listConns = useServerFn(listApiKeyConnections);
  const { data: connections } = useQuery({ queryKey: ["api-key-connections"], queryFn: () => listConns() });
  const setAccountDefault = useServerFn(setAccountProviderDefault);

  const [imageProvider, setImageProvider] = useState<"openai" | "replicate">("openai");
  // Seeds from the account-level default CONNECTION's provider (not a
  // per-site value -- this step sets the account default now, see
  // saveProviderMut below) so revisiting this step shows whatever was
  // already chosen. Only openai/replicate are offered on this sub-tab
  // (see the fixed 2-item list below) -- a default connection for one
  // of the other 5 providers (set later via Settings) just leaves this
  // toggle on openai rather than forcing a mismatched selection here.
  const getDefaults = useServerFn(getAccountProviderDefaults);
  const { data: providerDefaults } = useQuery({ queryKey: ["account-provider-defaults"], queryFn: () => getDefaults() });
  useEffect(() => {
    const defaultConn = (connections ?? []).find((c) => c.id === providerDefaults?.default_image_connection_id);
    if (defaultConn?.provider === "openai" || defaultConn?.provider === "replicate") {
      setImageProvider(defaultConn.provider);
    }
  }, [providerDefaults?.default_image_connection_id, connections]);

  const openaiConnections = (connections ?? []).filter((c) => c.provider === "openai");
  const replicateConnections = (connections ?? []).filter((c) => c.provider === "replicate");

  const saveProviderMut = useMutation({
    // Sets the ACCOUNT-level default image CONNECTION (not this
    // specific site) -- image_provider is no longer a per-site column
    // at all, and the account default is now a specific connection id,
    // not a provider name. Onboarding always operates on this
    // account's first/only connection for whichever of the two
    // providers is selected here (a brand-new account can't have a
    // second key for the same provider yet).
    mutationFn: () => {
      const conns = imageProvider === "openai" ? openaiConnections : replicateConnections;
      const conn = conns[0];
      if (!conn) throw new Error(`Add ${imageProvider === "openai" ? "an OpenAI" : "a Replicate"} key above first.`);
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

  const openaiMeta = IMAGE_GEN_PROVIDERS.find((p) => p.provider === "openai")!;
  const replicateMeta = IMAGE_GEN_PROVIDERS.find((p) => p.provider === "replicate")!;

  return (
    <div className="space-y-6">
      <SubStepTabs
        sub={sub}
        onChange={setSub}
        items={[
          { key: "openai", label: "OpenAI", done: openaiConnections.length > 0 },
          { key: "imagegen", label: "Image generation", done: openaiConnections.length > 0 || replicateConnections.length > 0 },
        ]}
      />

      {sub === "openai" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Powers page analysis and pin copy by default. Prefer Claude? Connect Anthropic instead from Settings → Integrations and set it as your text provider default.
          </p>
          <FirstApiKeySetup meta={openaiMeta} connections={openaiConnections} onChanged={invalidateIntegrations} />
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => setSub("imagegen")}
              disabled={openaiConnections.length === 0}
              title={openaiConnections.length === 0 ? "Add and save an OpenAI key to continue, or connect Anthropic instead from Settings → Integrations first." : undefined}
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {sub === "imagegen" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose which model renders your pin images by default. Any site can be pinned to a specific key instead later, from that key's row in Settings → Integrations.
          </p>
          <div className="flex gap-2">
            {/* Deliberately its own fixed 2-item list, NOT a map over the
                full IMAGE_GEN_PROVIDERS array (which has 7 entries for
                the consolidated Image Generation card) -- this onboarding
                step's whole flow (the "openai" sub-tab above being a
                required first step, this sub-tab's two-way
                openai/replicate branching just below) is built
                specifically around those two providers. The other 5 are
                connectable in Settings -> Integrations immediately after
                onboarding, where each key's row offers a "Used by" site
                picker -- the real, un-truncated way to pin a specific
                site to a specific key (the Sites page's own Connections
                section is read-only and just links back there). */}
            {(["openai", "replicate"] as const).map((p) => (
              <button
                key={p} type="button" onClick={() => setImageProvider(p)}
                className="rounded-full border px-4 py-1.5 text-sm font-medium"
                style={{
                  borderColor: imageProvider === p ? "#E60023" : "#E5E5E5",
                  background: imageProvider === p ? "#FCE9EA" : "transparent",
                  color: imageProvider === p ? "#E60023" : undefined,
                }}
              >
                {p === "openai" ? "OpenAI" : "Replicate (Nano Banana)"}
              </button>
            ))}
          </div>
          {imageProvider === "openai" ? (
            openaiConnections.length > 0
              ? <p className="text-xs text-emerald-600">Using the OpenAI key you connected in the previous step.</p>
              : <p className="text-xs text-amber-700">Add your OpenAI key in the previous step first.</p>
          ) : (
            <FirstApiKeySetup meta={replicateMeta} connections={replicateConnections} onChanged={invalidateIntegrations} />
          )}
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setSub("openai")}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => saveProviderMut.mutate()}
              disabled={saveProviderMut.isPending || (imageProvider === "openai" ? openaiConnections.length === 0 : replicateConnections.length === 0)}
            >
              {saveProviderMut.isPending ? "Saving…" : "Next →"}
            </Button>
          </div>
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
  onChange: (v: "openai" | "imagegen") => void;
  items: { key: "openai" | "imagegen"; label: string; done: boolean }[];
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
  const generateFirstBatch = useGenerateFirstBatch();
  // "Generate first batch" calls generateBriefs under the hood, which is
  // gated on style_locked_at (see briefs.functions.ts) -- this is the
  // first point in onboarding where a real image provider is guaranteed
  // connected (step 3, just before this one), so it's the right place to
  // surface Pin Style Setup rather than forcing it back at step 1's site
  // creation, when no provider exists yet to render a real preview with.
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

  const { data: pages } = useQuery({
    queryKey: ["onboarding-pages-preview", siteId],
    queryFn: () => listPagesFn({ data: { siteId } }),
    enabled: crawlMut.isSuccess,
  });
  const preview = (pages ?? []).slice(0, 5);

  if (crawlMut.isPending || crawlMut.isIdle) {
    return (
      <div className="space-y-3 py-10 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Crawling {site ? hostFromUrl(site.url) : "your site"}…</p>
      </div>
    );
  }

  if (crawlMut.isError) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-sm text-destructive">{getErrorMessage(crawlMut.error)}</p>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" onClick={onBack}>Back</Button>
          <Button type="button" onClick={() => crawlMut.mutate()}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
        <p className="mt-2 text-sm">
          Found {crawlMut.data?.discovered ?? preview.length} page{(crawlMut.data?.discovered ?? preview.length) === 1 ? "" : "s"} on {site ? hostFromUrl(site.url) : "your site"}
        </p>
      </div>
      {preview.length > 0 ? (
        <ul className="space-y-2">
          {preview.map((p) => (
            <li key={p.id} className="truncate rounded-md border border-border px-3 py-2 text-sm" title={p.title ?? p.url}>
              {p.title || p.url}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          No pages found yet — double check the sitemap URL in Sites, or add pages there once your site's live.
        </p>
      )}
      {!styleLocked && site && (
        <div className="border-t border-border pt-5">
          <PinStyleSetupPanel
            site={{ id: site.id, brand_name: site.brand_name, url: site.url }}
            onDone={() => qc.invalidateQueries({ queryKey: ["sites-switcher"] })}
            onAdjust={onAdjustBrand}
          />
        </div>
      )}

      {styleLocked && (
        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>Back</Button>
          <Button
            type="button"
            className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
            onClick={() => generateFirstBatch.mutate(undefined, { onSuccess: onNext, onError: (e) => toast.error(getErrorMessage(e)) })}
            disabled={!preview.length || generateFirstBatch.isPending}
          >
            {generateFirstBatch.isPending ? "Generating…" : "Generate first batch →"}
          </Button>
        </div>
      )}
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
