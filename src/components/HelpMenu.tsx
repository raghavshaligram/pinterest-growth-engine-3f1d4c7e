// Global "?" help affordance -- mounted once, inside PinShell, so it's
// present on every screen (PinShell is the one truly shared wrapper;
// see its own file comment) rather than needing to be added to each
// page's own TopBar (PinTopBar.tsx), which several pages (Sites,
// Insights, Logs, Settings) don't even use.
//
// Plain-language, no-marketing-tone explanations of the handful of
// concepts genuinely likely to confuse a new user: BYOK, Content
// Vertical, API vs. Webhook publish mode, UTM tagging, and what each
// connected provider is actually used for. Kept short and factual --
// this mirrors real behavior (see utm.ts, pinterest.server.ts's
// publish_mode branch, crypto.server.ts's BYOK comment) rather than
// aspirational copy.
import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { PIN, PIN_FONT } from "@/lib/pin-shell-tokens";

const HELP_SECTIONS: { title: string; body: string }[] = [
  {
    title: "BYOK (Bring Your Own Key)",
    body: "You connect your own API keys for Pinterest and for image/copy generation providers in Settings > Integrations. Pinspider never generates content on a shared account -- each provider bills your own account directly for what you use, and your keys are encrypted at rest.",
  },
  {
    title: "Content Vertical",
    body: "A per-site setting that shapes the palette, tone, and template flavor used when generating pins for that site (e.g. Food, Travel, Lifestyle). It only affects visual style -- it doesn't restrict or unlock which pin templates are available.",
  },
  {
    title: "API vs. Webhook publish mode",
    body: "API mode publishes pins directly to your connected Pinterest account through Pinterest's own API. Webhook mode instead sends each pin's data as a POST request to a URL you provide, so you can route publishing through your own automation (Make.com, Zapier, etc.) instead.",
  },
  {
    title: "UTM tagging",
    body: "Every pin's destination link is automatically tagged with UTM parameters (source=pinterest, medium=social, campaign=pinspider, and a content value unique to that pin). This is what lets the Insights page trace Google Analytics traffic back to the specific pin that drove it.",
  },
  {
    title: "Connected providers",
    body: "Image Generation providers render the actual pin artwork; Copy Generation providers write titles, taglines, and calls-to-action. Each site picks which connected provider to use for each independently in its Brand settings.",
  },
];

export function HelpMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        title="Help"
        aria-label="Help"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", top: 16, right: 20, zIndex: 40,
          width: 32, height: 32, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: PIN.card, border: `1px solid ${PIN.border}`, cursor: "pointer",
          color: PIN.textSecondary,
        }}
      >
        <HelpCircle size={17} />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 49 }}
          />
          <div
            role="dialog"
            aria-label="Help"
            style={{
              position: "fixed", top: 0, right: 0, height: "100vh", width: 360, maxWidth: "90vw",
              background: PIN.card, borderLeft: `1px solid ${PIN.border}`, zIndex: 50,
              display: "flex", flexDirection: "column", fontFamily: PIN_FONT, color: PIN.textPrimary,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${PIN.border}` }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>Help</span>
              <button
                type="button" title="Close" aria-label="Close" onClick={() => setOpen(false)}
                style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", cursor: "pointer", color: PIN.textSecondary }}
              >
                <X size={17} />
              </button>
            </div>
            <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {HELP_SECTIONS.map((s) => (
                <div key={s.title} style={{ borderRadius: 16, border: `1px solid ${PIN.border}`, padding: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: PIN.textSecondary }}>{s.body}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
