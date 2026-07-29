// Shared "Pin Style Setup" panel -- used both as step 4 of the Sites
// page's AddSiteWizard (routes/sites.tsx) and as the standalone
// /sites/style-setup route (the redirect target for useSiteStyleGate,
// site-style-gate.ts, when a site tries to batch-generate before this
// has ever been completed). Kept in its own file rather than inlined in
// either caller so both stay in sync automatically.
//
// Generates 2 REAL sample pins through the actual generation pipeline
// (see pin-style-setup.functions.ts) and renders them using the same
// pin-tile visual pattern as the Pin Assets grid (routes/pages.$id.tsx
// BriefCard: rounded-16px card, #E4E1D9 border, tinted template tag
// pill) rather than a generic form-then-preview layout.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { generateStyleSamples, lockPinStyle, type StyleSample } from "@/lib/pin-style-setup.functions";
import { getErrorMessage } from "@/lib/error-message";

export function PinStyleSetupPanel({
  site, onDone, onAdjust,
}: {
  site: { id: string; brand_name: string | null; url: string };
  onDone: () => void;
  onAdjust: () => void;
}) {
  const genFn = useServerFn(generateStyleSamples);
  const lockFn = useServerFn(lockPinStyle);
  const qc = useQueryClient();
  const [samples, setSamples] = useState<StyleSample[] | null>(null);

  const genMut = useMutation({
    mutationFn: () => genFn({ data: { siteId: site.id } }),
    onSuccess: (r) => setSamples(r.samples),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  // Kick off generation as soon as this site's panel mounts -- there's
  // no form to fill in first, the whole point is a real preview of the
  // brand settings already saved.
  useEffect(() => {
    setSamples(null);
    genMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const lockMut = useMutation({
    mutationFn: () => lockFn({ data: { siteId: site.id } }),
    onSuccess: () => {
      toast.success("Pin style locked in");
      qc.invalidateQueries({ queryKey: ["sites-overview"] });
      qc.invalidateQueries({ queryKey: ["sites-switcher"] });
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Preview your pin style</h3>
        <p className="text-sm text-muted-foreground">
          Real sample pins generated from {site.brand_name || "this site"}&rsquo;s brand settings, across two templates.
        </p>
      </div>

      {genMut.isPending && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating sample pins&hellip; this can take up to a minute.
        </div>
      )}

      {genMut.isError && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{getErrorMessage(genMut.error)}</p>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => genMut.mutate()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Try again
            </Button>
            <Link to="/settings/integrations" className="text-xs font-medium text-primary hover:underline">
              Settings &rarr; Integrations
            </Link>
          </div>
        </div>
      )}

      {samples && !genMut.isPending && (
        <div className="grid gap-4 sm:grid-cols-2">
          {samples.map((s) => (
            <div key={s.templateId} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #E4E1D9", background: "#fff" }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "2 / 3", background: "#F4F2ED" }}>
                {s.signedUrl ? (
                  <img src={s.signedUrl} alt="" className="h-full w-full object-cover" style={{ display: "block" }} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No preview</div>
                )}
              </div>
              <div style={{ padding: "14px 14px 16px" }}>
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                    background: s.color, color: "#fff",
                  }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onAdjust}>Adjust brand settings</Button>
        <Button
          className="bg-[#E60023] text-white hover:bg-[#E60023]/90"
          onClick={() => lockMut.mutate()}
          disabled={!samples || genMut.isPending || lockMut.isPending}
        >
          {lockMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Looks good, continue
        </Button>
      </div>
    </div>
  );
}
