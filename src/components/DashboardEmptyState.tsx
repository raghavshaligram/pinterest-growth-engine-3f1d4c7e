// Replaces the normal masonry-feed Dashboard for an account with zero
// generated pins -- swapped in by DashboardContent (routes/dashboard.tsx)
// based on useSetupStatus().hasFirstBatch, the exact same live signal
// (pin_images count > 0) the onboarding wizard and the Finish-setup
// banner read, so this can never disagree with either about whether an
// account is "actually" past this stage. No manual toggle: once the
// first batch exists, hasFirstBatch flips true and DashboardContent
// renders the real feed on the very next query refresh instead.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, Globe, Wand2, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";
import { PinspiderMark } from "@/components/PinspiderMark";
import { useSetupStatus, useSetupGate, useGenerateFirstBatch } from "@/lib/onboarding-gate";
import { SETUP_STEPS } from "@/lib/onboarding.functions";
import { getErrorMessage } from "@/lib/error-message";

export function DashboardEmptyState({ userEmail }: { userEmail?: string | null }) {
  const navigate = useNavigate();
  const { data: status } = useSetupStatus();
  const { guard } = useSetupGate();
  const generateFirstBatch = useGenerateFirstBatch();

  const firstName = userEmail ? userEmail.split("@")[0] : "there";

  function handleGenerateClick() {
    if (!guard()) return; // guard already redirected into onboarding if prerequisites are missing
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
          nothing to search yet. */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: PIN_FONT, fontSize: 24, fontWeight: 700, color: PIN.textPrimary, margin: 0 }}>
          Welcome, {firstName}
        </h1>
        <p style={{ fontFamily: PIN_FONT, fontSize: 13.5, color: PIN.textSecondary, marginTop: 4 }}>
          Your Dashboard fills in with real pins as soon as your first batch is generated.
        </p>
      </div>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)" }} className="max-md:!grid-cols-1">
        <SetupChecklistCard status={status} onStepClick={(wizardStep) => navigate({ to: "/onboarding", search: { step: wizardStep } })} />
        <HowItWorksCard />
      </div>

      <EmptyFeedIllustration onGenerate={handleGenerateClick} pending={generateFirstBatch.isPending} />
    </div>
  );
}

function SetupChecklistCard({
  status, onStepClick,
}: {
  status: ReturnType<typeof useSetupStatus>["data"];
  onStepClick: (wizardStep: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 20 }}>
      <div style={{ fontFamily: PIN_FONT, fontSize: 14, fontWeight: 700, color: PIN.textPrimary, marginBottom: 4 }}>Setup checklist</div>
      <div style={{ fontFamily: PIN_FONT, fontSize: 12.5, color: PIN.textSecondary, marginBottom: 14 }}>
        {status ? `${SETUP_STEPS.filter((s) => status.steps[s.id]).length} of ${SETUP_STEPS.length} done` : "Loading…"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {SETUP_STEPS.map((s) => {
          const done = status?.steps[s.id] ?? false;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => !done && onStepClick(s.wizardStep)}
              disabled={done}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left",
                padding: "8px 6px", borderRadius: 10, border: "none", background: "transparent",
                cursor: done ? "default" : "pointer", fontFamily: PIN_FONT,
              }}
            >
              <span
                style={{
                  flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: "50%",
                  border: done ? "none" : `1.5px solid ${PIN.borderStrong}`,
                  background: done ? "#10B981" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {done && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
              </span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: done ? PIN.textSecondary : PIN.textPrimary, textDecoration: done ? "line-through" : "none" }}>
                  {s.title}{s.optional && <span style={{ fontWeight: 400, color: PIN.textMuted }}> · optional</span>}
                </div>
                <div style={{ fontSize: 12, color: PIN.textMuted, marginTop: 1 }}>{s.description}</div>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  { icon: Globe, label: "Crawl", blurb: "Pinspider reads your site's pages, listings, or products." },
  { icon: Wand2, label: "Generate", blurb: "AI writes on-brand pin copy and renders the image." },
  { icon: Send, label: "Publish", blurb: "Pins schedule and post straight to your Pinterest account." },
] as const;

// Uses the same node-and-thread visual language as the Pinspider logo
// mark (see components/PinspiderMark.tsx) -- three nodes on a line
// connected by threads, instead of a generic numbered-list explainer.
function HowItWorksCard() {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${PIN.border}`, background: PIN.card, padding: 20 }}>
      <div style={{ fontFamily: PIN_FONT, fontSize: 14, fontWeight: 700, color: PIN.textPrimary, marginBottom: 16 }}>How it works</div>
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ position: "absolute", top: 20, left: "16.5%", right: "16.5%", height: 2, background: PIN.border }} />
        {HOW_IT_WORKS_STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.label} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: 90, textAlign: "center" }}>
              <span
                style={{
                  width: 40, height: 40, borderRadius: "50%", background: PIN.roseTint,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >
                <Icon size={17} style={{ color: PIN.accent }} />
              </span>
              <div style={{ fontFamily: PIN_FONT, fontSize: 12.5, fontWeight: 600, color: PIN.textPrimary, marginTop: 8 }}>{step.label}</div>
              <div style={{ fontFamily: PIN_FONT, fontSize: 11, color: PIN.textMuted, marginTop: 2 }}>{step.blurb}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyFeedIllustration({ onGenerate, pending }: { onGenerate: () => void; pending: boolean }) {
  return (
    <div
      style={{
        marginTop: 24, borderRadius: 20, border: `1.5px dashed ${PIN.borderStrong}`,
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
