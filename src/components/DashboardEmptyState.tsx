// Replaces the normal masonry-feed Dashboard for an account with zero
// generated pins -- swapped in by DashboardContent (routes/dashboard.tsx)
// based on useSetupStatus().hasFirstBatch, the exact same live signal
// (pin_images count > 0) the onboarding wizard and the Finish-setup
// banner read, so this can never disagree with either about whether an
// account is "actually" past this stage. No manual toggle: once the
// first batch exists, hasFirstBatch flips true and DashboardContent
// renders the real feed on the very next query refresh instead.
//
// Internally this now covers two of the app's three setup states (see
// SetupSummaryBar's own comment below for the third):
//   State A -- !readyToGenerate: full checklist is the dominant element,
//     no Generate button anywhere (it would only fail).
//   State B -- readyToGenerate && !hasFirstBatch: checklist collapses to
//     a thin SetupSummaryBar, the Generate CTA becomes dominant. Because
//     the button only ever renders in this branch, it's structurally
//     impossible to render it against a missing prerequisite -- the old
//     "disable it after the fact" problem doesn't have a code path left
//     to occur on.
// hasFirstBatch (State C) never reaches this component at all --
// DashboardContent's own gate keeps rendering the real feed for that,
// unchanged from before this redesign.
import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { Sparkles, Globe, Wand2, Send, Loader2, Info, ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import { PinspiderMark } from "@/components/PinspiderMark";
import { useSetupStatus, useSetupGate, useGenerateFirstBatch } from "@/lib/onboarding-gate";
import { SETUP_STEPS, type SetupStatus, type SetupStepMeta } from "@/lib/onboarding.functions";
import { STEP_LABELS, getMissingRequiredSteps } from "@/lib/setup-checklist-copy";
import { getErrorMessage } from "@/lib/error-message";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

// Scopes the shadcn Progress/Badge/Button "primary" color to Pinterest
// red instead of the app-wide --accent (a slightly different rust/red
// used by the Tailwind/AppShell-driven pages) -- this whole dashboard is
// styled off the PIN token object, not that global variable, and these
// three are the first shadcn primitives borrowed into it, so this keeps
// them visually consistent with everything else here rather than
// introducing a second red.
const PIN_PRIMARY_VARS = { "--primary": PIN.accent, "--primary-foreground": "#FFFFFF" } as React.CSSProperties;

export function DashboardEmptyState({ userEmail }: { userEmail?: string | null }) {
  const navigate = useNavigate();
  const { data: status } = useSetupStatus();
  const { guard } = useSetupGate();
  const generateFirstBatch = useGenerateFirstBatch();

  const isStateB = Boolean(status?.readyToGenerate);

  function handleGenerateClick() {
    // Kept as a safety net, not the mechanism that prevents a broken
    // click anymore -- this button only ever renders in State B
    // (readyToGenerate already true), so guard() should never actually
    // redirect here. It stays in case that invariant is ever violated
    // by a future change elsewhere.
    if (!guard()) return;
    generateFirstBatch.mutate(undefined, {
      onSuccess: (r) => {
        toast.success(`Queued your first batch — analyzed ${r.pipeline.analyzed}, briefs for ${r.pipeline.briefsFor}, rendered ${r.worker.ok ?? 0} image${(r.worker.ok ?? 0) === 1 ? "" : "s"} so far.`);
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  }

  return (
    <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "24px 24px 40px", scrollbarWidth: "none" }}>
      {/* Personalized header -- search bar intentionally omitted, there's
          nothing to search yet. No per-user display name exists in the
          schema (only sites.brand_name, which is per-site, not
          per-user), so this deliberately doesn't try to derive one from
          the email address anymore -- "Welcome back" for everyone,
          rather than a raw email-local-part masquerading as a name. */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: PIN_FONT, fontSize: 24, fontWeight: 700, color: PIN.textPrimary, margin: 0 }}>
          Welcome back
        </h1>
        <p style={{ fontFamily: PIN_FONT, fontSize: 13.5, color: PIN.textSecondary, marginTop: 4 }}>
          Your Dashboard fills in with real pins as soon as your first batch is generated.
        </p>
      </div>

      {isStateB ? (
        <>
          <SetupSummaryBar status={status} />
          <EmptyFeedIllustration onGenerate={handleGenerateClick} pending={generateFirstBatch.isPending} />
        </>
      ) : (
        <>
          <SetupChecklistCard
            status={status}
            onStepClick={(wizardStep) => navigate({ to: "/onboarding", search: { step: wizardStep } })}
          />
          <HowItWorksRow userEmail={userEmail} />
        </>
      )}
    </div>
  );
}

// The State A checklist. Full width, single column -- no more sharing a
// 2-col grid with "How it works" (see HowItWorksRow below), since a
// half-viewport explainer panel next to the one card that actually
// matters was the whole problem being fixed here.
function SetupChecklistCard({
  status, onStepClick,
}: {
  status: SetupStatus | null | undefined;
  onStepClick: (wizardStep: SetupStepMeta["wizardStep"]) => void;
}) {
  const total = SETUP_STEPS.length;
  const done = status ? SETUP_STEPS.filter((s) => status.steps[s.id]).length : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  // Lowest wizardStep not yet done, optional or not -- if the only thing
  // left is the optional Google Analytics step, it's still correctly
  // "next" (there's nothing else to elevate instead), it just isn't
  // required to ever go away.
  const nextStep = status ? SETUP_STEPS.find((s) => !status.steps[s.id]) : undefined;

  return (
    <div style={{ borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 20, ...PIN_PRIMARY_VARS } as React.CSSProperties}>
      <div style={{ fontFamily: PIN_FONT, fontSize: 14, fontWeight: 700, color: PIN.textPrimary, marginBottom: 12 }}>Setup checklist</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Progress value={pct} className="h-2 flex-1" />
        <div style={{ fontFamily: PIN_FONT, fontSize: 12.5, color: PIN.textSecondary, whiteSpace: "nowrap", flexShrink: 0 }}>
          {status ? `${done} of ${total} done` : "Loading…"}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {SETUP_STEPS.map((s) => {
          const rowDone = status?.steps[s.id] ?? false;
          const isNext = !rowDone && nextStep?.id === s.id;
          return (
            <ChecklistRow
              key={s.id}
              step={s}
              done={rowDone}
              isNext={isNext}
              onAction={() => onStepClick(s.wizardStep)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChecklistRow({
  step, done, isNext, onAction,
}: {
  step: SetupStepMeta;
  done: boolean;
  isNext: boolean;
  onAction: () => void;
}) {
  const label = STEP_LABELS[step.id];
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px", borderRadius: 10,
        border: isNext ? `1.5px solid ${PIN.accent}` : "1.5px solid transparent",
        background: isNext ? PIN.roseTint : "transparent",
        opacity: done ? 0.55 : 1,
      }}
    >
      <span
        style={{
          flexShrink: 0, width: 16, height: 16, borderRadius: "50%",
          border: done ? "none" : `1.5px solid ${PIN.borderStrong}`,
          background: done ? "#10B981" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {done && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
      </span>
      <div style={{ flex: 1, minWidth: 0, fontFamily: PIN_FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: done ? PIN.textSecondary : PIN.textPrimary, textDecoration: done ? "line-through" : "none" }}>
            {label}
          </span>
          {step.optional && <span style={{ fontSize: 11, fontWeight: 400, color: PIN.textMuted }}>· optional</span>}
          {isNext && <Badge className="h-4 px-1.5 text-[10px] leading-none">Next</Badge>}
        </div>
        {!done && <div style={{ fontSize: 12, color: PIN.textMuted, marginTop: 1 }}>{step.description}</div>}
      </div>
      {!done && (
        <button
          type="button"
          onClick={onAction}
          style={{
            flexShrink: 0, fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600,
            borderRadius: 999, padding: "6px 12px", cursor: "pointer",
            border: isNext ? "none" : `1px solid ${PIN.borderStrong}`,
            background: isNext ? PIN.accent : "transparent",
            color: isNext ? "#FFFFFF" : PIN.textSecondary,
          }}
        >
          {label}
        </button>
      )}
    </div>
  );
}

// The State B / State C thin bar -- same "missing" list FinishSetupBanner
// uses (non-optional, not done), minus first_batch: in State B that's
// what the big Generate button right below already handles, so listing
// it here too would just repeat the primary CTA in miniature. In
// practice the only step that ever shows up here is Pinterest --
// readyToGenerate/hasFirstBatch don't require it, so an account can
// reach either state with it still unconnected, and this bar exists
// specifically so that case is shown honestly instead of the old
// "Setup complete" banner text that isFullyOnboarded's own definition
// (readyToGenerate && hasFirstBatch, no Pinterest requirement) would
// have made false. Returns null -- renders nothing -- once there's
// truly nothing left to say, which is what makes Dashboard.tsx's State C
// usage of this component correct without any extra condition around it.
export function SetupSummaryBar({
  status, style,
}: {
  status: SetupStatus | null | undefined;
  // Lets each of the two call sites (State B, inside DashboardEmptyState's
  // own padded scroll area, vs State C, sitting directly in dashboard.tsx
  // above TopBar in the spot FinishSetupBanner used to occupy) supply
  // whatever spacing fits its surroundings, instead of this component
  // guessing which context it's in.
  style?: React.CSSProperties;
}) {
  const missing = getMissingRequiredSteps(status).filter((s) => s.id !== "first_batch");
  if (!missing.length) return null;
  const next = missing[0]!;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        borderRadius: 12, border: `1px solid ${PIN.border}`, background: PIN.card,
        padding: "10px 14px", marginBottom: 16, fontFamily: PIN_FONT, ...PIN_PRIMARY_VARS, ...style,
      } as React.CSSProperties}
    >
      <div style={{ fontSize: 13, color: PIN.textSecondary, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: PIN.textPrimary }}>{STEP_LABELS[next.id]}</span>
        <span> — not finished yet{missing.length > 1 ? `, +${missing.length - 1} more` : ""}</span>
      </div>
      <Link
        to="/onboarding"
        search={{ step: next.wizardStep }}
        style={{
          flexShrink: 0, fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600, color: PIN.textPrimary,
          border: `1px solid ${PIN.borderStrong}`, borderRadius: 999, padding: "6px 12px", textDecoration: "none",
        }}
      >
        Continue →
      </Link>
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  { icon: Globe, label: "Crawl", blurb: "Pinspider reads your site's pages, listings, or products." },
  { icon: Wand2, label: "Generate", blurb: "AI writes on-brand pin copy and renders the image." },
  { icon: Send, label: "Publish", blurb: "Pins schedule and post straight to your Pinterest account." },
] as const;

const HOW_IT_WORKS_DISMISS_KEY_PREFIX = "pinspider:how-it-works-dismissed:";

// Collapsed to a single dismissible row -- was a full card sitting
// side-by-side with the checklist, restating in a diagram what the
// checklist's own row descriptions already say, while consuming half
// the viewport. Dismissal is persisted in localStorage per user
// (deliberately not the session-only useState pattern StepComplete's
// Google Analytics card uses in onboarding.tsx -- that one intentionally
// resurfaces every session since it's tied to a real, still-missing
// connection; this is just a first-time explainer someone can permanently
// clear once they've seen it).
function HowItWorksRow({ userEmail }: { userEmail?: string | null }) {
  const storageKey = HOW_IT_WORKS_DISMISS_KEY_PREFIX + (userEmail ?? "anon");
  const [dismissed, setDismissed] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" && window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  function dismiss(e: React.SyntheticEvent) {
    e.stopPropagation();
    window.localStorage.setItem(storageKey, "1");
    setDismissed(true);
  }

  return (
    <div style={{ marginTop: 16, borderRadius: 12, border: `1px solid ${PIN.border}`, background: PIN.card }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer", fontFamily: PIN_FONT,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: PIN.textPrimary }}>
          <Info size={14} style={{ color: PIN.textMuted }} />
          How it works
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <ChevronDown size={14} style={{ color: PIN.textMuted, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          <span
            role="button"
            tabIndex={0}
            aria-label="Dismiss How it works"
            onClick={dismiss}
            onKeyDown={(e) => { if (e.key === "Enter") dismiss(e); }}
            style={{ display: "flex", color: PIN.textMuted, cursor: "pointer" }}
          >
            <X size={14} />
          </span>
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px", display: "flex", gap: 24, flexWrap: "wrap" }}>
          {HOW_IT_WORKS_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: PIN_FONT, minWidth: 180 }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: PIN.roseTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={13} style={{ color: PIN.accent }} />
                </span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: PIN.textPrimary }}>{step.label}</div>
                  <div style={{ fontSize: 11, color: PIN.textMuted }}>{step.blurb}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Only ever mounted in State B now (see DashboardEmptyState above) --
// previously always rendered alongside the checklist regardless of
// readiness, which is what let the Generate button appear, enabled,
// in State A.
function EmptyFeedIllustration({ onGenerate, pending }: { onGenerate: () => void; pending: boolean }) {
  return (
    <div
      style={{
        marginTop: 8, borderRadius: 20, border: `1.5px dashed ${PIN.borderStrong}`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "56px 24px", gap: 14, textAlign: "center",
      }}
    >
      <div style={{ position: "relative", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <PinspiderMark size={56} className="opacity-90" />
        <Sparkles size={18} style={{ position: "absolute", top: -4, right: -6, color: PIN.accent }} />
      </div>
      <div>
        <div style={{ fontFamily: PIN_FONT, fontSize: 15, fontWeight: 700, color: PIN.textPrimary }}>Your pins will show up here</div>
        <div style={{ fontFamily: PIN_FONT, fontSize: 13, color: PIN.textSecondary, marginTop: 4, maxWidth: 360 }}>
          Generate your first batch and this feed fills in with real pin images, ready to review and schedule.
        </div>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={pending}
        style={{
          display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 18px", borderRadius: 999,
          border: "none", background: PIN.accent, color: "#FFFFFF", fontFamily: PIN_FONT, fontSize: 13.5, fontWeight: 600,
          cursor: pending ? "default" : "pointer", marginTop: 4,
        }}
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
        {pending ? "Generating…" : "Generate your first batch"}
      </button>
    </div>
  );
}
