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
  CheckCircle2, Loader2, FileText, KeyRound, LayoutDashboard, Check, ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PinspiderMark } from "@/components/PinspiderMark";
import { getErrorMessage } from "@/lib/error-message";
import { useSetupStatus, useGenerateFirstBatch, SETUP_STATUS_QUERY_KEY } from "@/lib/onboarding-gate";
import { dismissOnboardingPrompt, type SetupStatus } from "@/lib/onboarding.functions";
import {
  AddSiteWizard, ACCENT_PRESETS, TYPOGRAPHY_PRESETS, hostFromUrl,
} from "@/routes/sites";
import {
  listSites, upsertSite, IMAGE_PROVIDERS, type SiteType, type ImageProvider,
} from "@/lib/sites.functions";
import { crawlSite } from "@/lib/sites.functions";
import { listPages } from "@/lib/pages.functions";
import { listIntegrations } from "@/lib/integrations.functions";
import { getPublishingProfile } from "@/lib/publishing-profile.functions";
import {
  IntegrationCard, PinterestConnectButton, PublishingAgePrompt,
} from "@/routes/settings.integrations";
import { PinStyleSetupPanel } from "@/components/PinStyleSetupPanel";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) =>
    z.object({ step: z.coerce.number().int().min(1).max(5).optional() }).parse(search),
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
  image_provider: ImageProvider;
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

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>((search.step as 1 | 2 | 3 | 4) ?? 1);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [pinterestConnected, setPinterestConnected] = useState(false);
  const autoResumedRef = useRef(false);

  // A gated action (see onboarding-gate.tsx:useSetupGate) can navigate
  // here with a new ?step= while this route is already mounted -- sync
  // local state to that instead of only reading it once at mount.
  useEffect(() => {
    if (search.step && search.step !== step) { setStep(search.step as 1 | 2 | 3 | 4); autoResumedRef.current = true; }
  }, [search.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume at the first genuinely-incomplete step, not always step 1 --
  // e.g. an account that already has a site/brand/integrations set up
  // (HarvestMath) should land straight on whatever's actually still
  // missing (could be just the Pinterest age-bucket question). Only
  // does this once per mount, and only when the URL didn't already say
  // where to go (an explicit ?step= -- from the gate hook, the Settings
  // "Setup guide" link, or the step-dots below -- always wins).
  useEffect(() => {
    if (autoResumedRef.current || search.step || !status) return;
    autoResumedRef.current = true;
    if (status.isFullyOnboarded) { setStep(5); return; }
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
  // etc.) genuinely isn't ready yet.
  function isStepReachable(n: 1 | 2 | 3 | 4 | 5): boolean {
    if (n <= step) return true;
    if (!status) return false;
    if (n === 2) return status.steps.site_connected;
    if (n === 3) return status.steps.site_connected && status.steps.brand_identity;
    if (n === 4) return status.readyToGenerate;
    if (n === 5) return status.isFullyOnboarded;
    return true;
  }
  // A dot shows as done/checked based on the SAME per-step real-data
  // signal the checklist card and banner use, not just "is it behind
  // the current step" -- landing straight on step 4 should still show
  // 1-3 checked, not merely filled-in because they're numerically lower.
  function isStepDone(n: 1 | 2 | 3 | 4 | 5): boolean {
    if (!status) return n < step;
    if (n === 1) return status.steps.site_connected;
    if (n === 2) return status.steps.brand_identity;
    if (n === 3) return status.readyToGenerate; // openai connected (pinterest is optional, not required for the dot)
    if (n === 4) return status.hasFirstBatch;
    return status.isFullyOnboarded;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF9" }} className="flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PinspiderMark size={28} />
            <span className="font-semibold">Pinspider setup</span>
          </div>
          {step < 5 && (
            <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
              Skip setup
            </Button>
          )}
        </div>

        <div className="mb-8 flex items-center justify-center gap-2">
          {([1, 2, 3, 4, 5] as const).map((n) => {
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
            ? (
              <StepIntegrations
                siteId={siteId}
                onNext={(connected) => { setPinterestConnected(connected); setStep(4); }}
                onBack={() => setStep(2)}
              />
            )
            : <CenteredSpinner />)}
          {step === 4 && (siteId
            ? <StepCrawlPreview siteId={siteId} onNext={() => setStep(5)} onBack={() => setStep(3)} onAdjustBrand={() => setStep(2)} />
            : <CenteredSpinner />)}
          {step === 5 && (
            <StepComplete
              siteId={siteId}
              pinterestConnected={pinterestConnected || Boolean(status?.steps.pinterest_connected)}
              onFinish={handleFinish}
            />
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

// ---------- Step 3: Integrations (OpenAI -> image provider -> Pinterest) ----------

function StepIntegrations({
  siteId, onNext, onBack,
}: {
  siteId: string;
  onNext: (pinterestConnected: boolean) => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: setupStatus } = useSetupStatus();
  // Land on whichever sub-tab is actually still relevant instead of
  // always "openai" -- an account that already has OpenAI + an image
  // provider connected (HarvestMath) and only needs the Pinterest
  // age-bucket question should open straight there, not force a replay
  // of two already-done sub-steps first. Computed once at mount from
  // whatever's already cached (this component's parent already fetched
  // the same query, so it's normally available immediately, not a
  // loading flash).
  const [sub, setSub] = useState<"openai" | "imagegen" | "pinterest">(() => {
    if (!setupStatus) return "openai";
    if (!setupStatus.steps.image_generation) return "openai";
    if (!setupStatus.readyToGenerate) return "imagegen";
    return "pinterest";
  });
  const listIntFn = useServerFn(listIntegrations);
  const { data: integrations } = useQuery({ queryKey: ["integrations"], queryFn: () => listIntFn() });
  const { data: sites } = useSitesList();
  const site = (sites ?? []).find((s) => (s as SiteRow).id === siteId) as SiteRow | undefined;
  const upsert = useServerFn(upsertSite);
  const getProfile = useServerFn(getPublishingProfile);

  const [imageProvider, setImageProvider] = useState<ImageProvider>("openai");
  const [showAgePrompt, setShowAgePrompt] = useState(false);
  useEffect(() => { if (site?.image_provider) setImageProvider(site.image_provider); }, [site?.image_provider]);

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
      window.history.replaceState({}, "", window.location.pathname + "?step=3");
      setSub("pinterest");
    } else if (st === "error") {
      toast.error(`Pinterest connect failed: ${p.get("reason") ?? "unknown"}`);
      window.history.replaceState({}, "", window.location.pathname + "?step=3");
      setSub("pinterest");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openaiStatus = (integrations ?? []).find((i) => i.provider === "openai");
  const replicateStatus = (integrations ?? []).find((i) => i.provider === "replicate");
  const pinterestStatus = (integrations ?? []).find((i) => i.provider === "pinterest");
  const pinterestOk = pinterestStatus?.status === "ok";

  // Proactively surfaces the age-bucket question whenever Pinterest's
  // OAuth token exists but the profile doesn't -- not just in the
  // moment right after a fresh OAuth redirect above. An account can
  // have connected Pinterest long before this prompt existed (or before
  // this wizard existed at all) and never been asked -- landing on this
  // sub-tab, by any route, should always check for that gap rather than
  // only checking it on the one narrow path of a same-second OAuth
  // return.
  useEffect(() => {
    if (!pinterestOk) return;
    let cancelled = false;
    getProfile().then((profile) => { if (!cancelled && !profile) setShowAgePrompt(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pinterestOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProviderMut = useMutation({
    mutationFn: () => upsert({
      data: { id: siteId, url: site!.url, site_type: site!.site_type, image_provider: imageProvider },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
      qc.invalidateQueries({ queryKey: ["setup-status"] });
      setSub("pinterest");
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const invalidateIntegrations = () => { qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["setup-status"] }); };

  return (
    <div className="space-y-6">
      <SubStepTabs
        sub={sub}
        onChange={setSub}
        items={[
          { key: "openai", label: "OpenAI", done: Boolean(openaiStatus?.has_value) },
          { key: "imagegen", label: "Image generation", done: Boolean(openaiStatus?.has_value || replicateStatus?.has_value) },
          { key: "pinterest", label: "Pinterest", done: pinterestOk, optional: true },
        ]}
      />

      {sub === "openai" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Powers page analysis and pin copy — every brief starts here, regardless of which image generator you pick next.
          </p>
          <IntegrationCard
            provider="openai"
            title="OpenAI"
            description="Powers page analysis, pin copy, and competitive pattern summaries."
            fields={[{ name: "api_key", label: "API key", placeholder: "sk-…", type: "password" }]}
            status={openaiStatus}
            onChanged={invalidateIntegrations}
          />
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => setSub("imagegen")}
              disabled={!openaiStatus?.has_value}
              title={!openaiStatus?.has_value ? "Add and save an OpenAI key to continue -- it's required for page analysis and pin copy regardless of which image provider you pick next." : undefined}
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {sub === "imagegen" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose which model renders your pin images. You can switch this later per-site in Sites → brand settings.
          </p>
          <div className="flex gap-2">
            {IMAGE_PROVIDERS.map((p) => (
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
            openaiStatus?.has_value
              ? <p className="text-xs text-emerald-600">Using the OpenAI key you connected in the previous step.</p>
              : <p className="text-xs text-amber-700">Add your OpenAI key in the previous step first.</p>
          ) : (
            <IntegrationCard
              provider="replicate"
              title="Replicate"
              description="Runs Nano Banana 2 (google/nano-banana-2) to render every pin image."
              fields={[{ name: "api_token", label: "API token", placeholder: "r8_…", type: "password" }]}
              status={replicateStatus}
              onChanged={invalidateIntegrations}
            />
          )}
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setSub("openai")}>Back</Button>
            <Button
              type="button"
              className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
              onClick={() => saveProviderMut.mutate()}
              disabled={saveProviderMut.isPending || (imageProvider === "openai" ? !openaiStatus?.has_value : !replicateStatus?.has_value)}
            >
              {saveProviderMut.isPending ? "Saving…" : "Next →"}
            </Button>
          </div>
        </div>
      )}

      {sub === "pinterest" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Publish straight to your Pinterest account — optional, you can skip this and connect it later from Settings.
          </p>
          <Card className="p-6">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="text-lg font-semibold">Pinterest</h3></div>
              {pinterestOk && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>}
            </div>
            {!pinterestOk && <PinterestConnectButton returnTo="onboarding" />}
          </Card>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={() => setSub("imagegen")}>Back</Button>
            <div className="flex gap-2">
              {!pinterestOk && (
                <Button type="button" variant="ghost" onClick={() => onNext(false)}>Connect later →</Button>
              )}
              <Button
                type="button"
                className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
                onClick={() => onNext(pinterestOk)}
                disabled={!pinterestOk}
              >
                Continue →
              </Button>
            </div>
          </div>
          <PublishingAgePrompt open={showAgePrompt} onOpenChange={setShowAgePrompt} />
        </div>
      )}
    </div>
  );
}

function SubStepTabs({
  sub, onChange, items,
}: {
  sub: string;
  onChange: (v: "openai" | "imagegen" | "pinterest") => void;
  items: { key: "openai" | "imagegen" | "pinterest"; label: string; done: boolean; optional?: boolean }[];
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
            {it.label}{it.optional && <span className="text-muted-foreground">(optional)</span>}
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
  siteId, pinterestConnected, onFinish,
}: {
  siteId: string | null;
  pinterestConnected: boolean;
  onFinish: () => void;
}) {
  const { data: sites } = useSitesList();
  const site = (sites ?? []).find((s) => (s as SiteRow).id === siteId) as SiteRow | undefined;

  return (
    <div className="space-y-6 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
      <div>
        <h2 className="text-xl font-semibold">You're set up</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pinspider is generating pins for {site?.brand_name || (site ? hostFromUrl(site.url) : "your site")}. Here's where to go next.
        </p>
      </div>
      <div className="grid gap-3 text-left sm:grid-cols-3">
        <Link to="/pages" className="rounded-lg border border-border p-4 transition-colors hover:border-neutral-400">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <div className="mt-2 font-medium">View Pages</div>
          <div className="mt-1 text-xs text-muted-foreground">See what's been crawled and generated.</div>
        </Link>
        {!pinterestConnected && (
          <Link to="/settings/integrations" className="rounded-lg border border-border p-4 transition-colors hover:border-neutral-400">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <div className="mt-2 font-medium">Connect Pinterest</div>
            <div className="mt-1 text-xs text-muted-foreground">Publish pins automatically once you're ready.</div>
          </Link>
        )}
        <Link to="/dashboard" className="rounded-lg border border-border p-4 transition-colors hover:border-neutral-400">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <div className="mt-2 font-medium">Go to Dashboard</div>
          <div className="mt-1 text-xs text-muted-foreground">Review and schedule your first pins.</div>
        </Link>
      </div>
      <Button type="button" className="bg-[#E60023] text-white hover:bg-[#E60023]/90" onClick={onFinish}>
        Go to Dashboard →
      </Button>
    </div>
  );
}
