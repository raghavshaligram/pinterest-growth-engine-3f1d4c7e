import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Globe, Store, ShoppingBag, Trash2, RefreshCcw, ChevronDown, Plus, X, Check, BookOpen,
} from "lucide-react";
import {
  getSitesOverview, upsertSite, deleteSite, crawlSite, SITE_TYPES,
  type SiteOverviewRow, type SiteType,
} from "@/lib/sites.functions";

export const Route = createFileRoute("/sites")({
  head: () => ({ meta: [{ title: "Sites — Pinspider" }] }),
  component: SitesPage,
});

// ---------- Shared type/style config ----------
// Deliberately generic icons (not each platform's real logo) -- same
// trademark reasoning as the Pinterest mark elsewhere in this app: this
// is a third-party tool, not Etsy or the storefront platforms it
// connects to.
const SITE_TYPE_CONFIG: Record<SiteType, {
  wizardTitle: string;
  label: string;
  badgeClass: string;
  icon: typeof Globe;
  description: string;
  unitSingular: string;
  unitPlural: string;
  urlLabel: string;
  urlPlaceholder: string;
  tip?: string;
}> = {
  website: {
    wizardTitle: "Website / Blog",
    label: "Website",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Globe,
    description: "Any URL with a sitemap — great for blogs, portfolios, or brand sites",
    unitSingular: "post",
    unitPlural: "posts",
    urlLabel: "Website URL",
    urlPlaceholder: "https://yourwebsite.com",
  },
  etsy: {
    wizardTitle: "Etsy Store",
    label: "Etsy",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
    icon: Store,
    description: "Connect your Etsy shop and auto-pin your listings",
    unitSingular: "listing",
    unitPlural: "listings",
    urlLabel: "Etsy Shop URL",
    urlPlaceholder: "etsy.com/shop/YourShopName",
    tip: "We'll pull your active listings automatically. Make sure your shop is public.",
  },
  ecomm: {
    wizardTitle: "eComm Store",
    label: "eComm",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: ShoppingBag,
    description: "Shopify, WooCommerce, or any product catalogue",
    unitSingular: "product",
    unitPlural: "products",
    urlLabel: "Store URL",
    urlPlaceholder: "yourstore.myshopify.com",
    tip: "Works with Shopify, WooCommerce, Squarespace Commerce, and any store with a product feed.",
  },
};

const ACCENT_PRESETS = [
  "#E60023", "#F97316", "#EAB308", "#22C55E", "#3B82F6",
  "#8B5CF6", "#EC4899", "#14B8A6", "#111111", "#6B7280",
];

const TYPOGRAPHY_PRESETS = [
  { value: "Playfair Display + Inter", headingFont: "'Playfair Display', Georgia, serif", bodyFont: "'Inter', sans-serif" },
  { value: "DM Sans only", headingFont: "'DM Sans', sans-serif", bodyFont: "'DM Sans', sans-serif" },
  { value: "Poppins + IBM Plex Mono", headingFont: "'Poppins', sans-serif", bodyFont: "'IBM Plex Mono', monospace" },
  { value: "Serif Display + Clean Sans", headingFont: "Georgia, serif", bodyFont: "system-ui, sans-serif" },
] as const;

function hostFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------- Page ----------

function SitesPage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getSitesOverview);
  const delFn = useServerFn(deleteSite);
  const crawlFn = useServerFn(crawlSite);

  const { data: sites } = useQuery({ queryKey: ["sites-overview"], queryFn: () => overviewFn() });
  const [wizardOpen, setWizardOpen] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["sites-overview"] });
    // SiteSwitcher/SiteProvider (Dashboard/Schedule) read the lighter
    // listSites query -- keep both in sync on any change here.
    qc.invalidateQueries({ queryKey: ["sites-switcher"] });
  }

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Site removed"); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const crawlMut = useMutation({
    mutationFn: (id: string) => crawlFn({ data: { siteId: id } }),
    onSuccess: (r) => { toast.success(`Crawl: +${r.added} added, ${r.updated} updated, ${r.errors} errors`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rows = (sites ?? []) as SiteOverviewRow[];
  const totalPins = rows.reduce((sum, s) => sum + s.pinsCreated, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">My Sites</h1>
          <p className="text-sm text-muted-foreground">{rows.length} connected · {totalPins} total pins created</p>
        </div>
        {wizardOpen ? (
          <Button variant="outline" onClick={() => setWizardOpen(false)}>
            <X className="mr-1.5 h-4 w-4" />Cancel
          </Button>
        ) : (
          <Button className="bg-black text-white hover:bg-neutral-800" onClick={() => setWizardOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />Add a site
          </Button>
        )}
      </header>

      {wizardOpen && (
        <AddSiteWizard onCancel={() => setWizardOpen(false)} onCreated={() => { setWizardOpen(false); invalidate(); }} />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            onDelete={() => delMut.mutate(site.id)}
            onCrawl={() => crawlMut.mutate(site.id)}
            crawlPending={crawlMut.isPending}
            onSaved={invalidate}
          />
        ))}
      </div>
      {!rows.length && !wizardOpen && (
        <p className="text-sm text-muted-foreground">No sites yet — add one to get started.</p>
      )}
    </div>
  );
}

// ---------- Shared brand editor (used by both the wizard step 3 and each card's inline "Brand" panel) ----------

function BrandEditorFields({
  brandName, onBrandName,
  tagline, onTagline,
  accentColor, onAccentColor,
  brandColors, onToggleBrandColor, onRemoveLegacyColor,
  typography, onTypography,
  notes, onNotes,
  advancedOpen, onToggleAdvanced,
  previewLabel = "Your brand name",
}: {
  brandName: string; onBrandName: (v: string) => void;
  tagline: string; onTagline: (v: string) => void;
  accentColor: string; onAccentColor: (v: string) => void;
  brandColors: string[]; onToggleBrandColor: (hex: string) => void; onRemoveLegacyColor: (hex: string) => void;
  typography: string; onTypography: (v: string) => void;
  notes: string; onNotes: (v: string) => void;
  advancedOpen: boolean; onToggleAdvanced: () => void;
  previewLabel?: string;
}) {
  const legacyColors = brandColors.filter((c) => !ACCENT_PRESETS.includes(c));
  const typographyOptions = !typography || TYPOGRAPHY_PRESETS.some((p) => p.value === typography)
    ? TYPOGRAPHY_PRESETS
    : [{ value: typography, headingFont: undefined, bodyFont: undefined }, ...TYPOGRAPHY_PRESETS];
  const activeSample = TYPOGRAPHY_PRESETS.find((p) => p.value === typography);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Brand name</Label>
          <Input value={brandName} onChange={(e) => onBrandName(e.target.value)} placeholder="Clara Goods" />
        </div>
        <div>
          <Label>Tagline <span className="text-muted-foreground">(optional)</span></Label>
          <Input value={tagline} onChange={(e) => onTagline(e.target.value)} placeholder="Slow living, thoughtfully made." />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Brand accent color <span className="font-normal text-muted-foreground">used on pin thumbnails</span></Label>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((hex) => {
            const active = accentColor === hex;
            return (
              <button
                key={hex} type="button" onClick={() => onAccentColor(hex)}
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

      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background">
          <Globe className="h-4 w-4" style={{ color: accentColor }} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{brandName || previewLabel}</div>
          <div className="text-xs text-muted-foreground">www</div>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: accentColor }} />accent
        </span>
      </div>

      <button type="button" onClick={onToggleAdvanced} className="flex items-center gap-1.5 text-sm font-medium">
        <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />Advanced
      </button>

      {advancedOpen && (
        <div className="space-y-4 border-t border-border pt-4">
          <div>
            <Label className="mb-2 block">
              Brand palette <span className="font-normal text-muted-foreground">(optional, extra colors for image gen)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((hex) => {
                const active = brandColors.includes(hex);
                return (
                  <button
                    key={hex} type="button" onClick={() => onToggleBrandColor(hex)}
                    title={hex} aria-label={hex}
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ background: hex, boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #111111" : "0 0 0 1px rgba(0,0,0,0.08)" }}
                  >
                    {active && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                );
              })}
            </div>
            {legacyColors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {legacyColors.map((hex) => (
                  <span key={hex} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-1 pr-2 text-xs">
                    <span className="h-3 w-3 rounded-full border border-border" style={{ background: hex }} />
                    {hex}
                    <button type="button" onClick={() => onRemoveLegacyColor(hex)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="mb-2 block">Typography direction</Label>
            <Select value={typography || undefined} onValueChange={onTypography}>
              <SelectTrigger><SelectValue placeholder="Choose a pairing" /></SelectTrigger>
              <SelectContent>
                {typographyOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeSample && (
              <div className="mt-2 rounded-md border border-border p-3">
                <div className="text-lg" style={{ fontFamily: activeSample.headingFont }}>Heading sample</div>
                <div className="text-sm text-muted-foreground" style={{ fontFamily: activeSample.bodyFont }}>Body text sample for this pairing.</div>
              </div>
            )}
          </div>

          <div>
            <Label>Brand notes for image gen</Label>
            <Textarea rows={3} value={notes} onChange={(e) => onNotes(e.target.value)} placeholder="Warm editorial photography, minimal overlays, no stock illustrations." />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Add-site wizard ----------

type WizardStep = 1 | 2 | 3;

function AddSiteWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const upsert = useServerFn(upsertSite);
  const [step, setStep] = useState<WizardStep>(1);
  const [siteType, setSiteType] = useState<SiteType>("website");
  const [url, setUrl] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [accentColor, setAccentColor] = useState(ACCENT_PRESETS[0]);
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [typography, setTypography] = useState("");
  const [notes, setNotes] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const createMut = useMutation({
    mutationFn: () => upsert({
      data: {
        url: normalizeUrl(url),
        sitemap_url: siteType === "website" && sitemapUrl.trim() ? normalizeUrl(sitemapUrl) : undefined,
        site_type: siteType,
        brand_name: brandName,
        tagline: tagline || undefined,
        accent_color: accentColor,
        brand_colors: brandColors,
        brand_font: typography || undefined,
        brand_notes: notes || undefined,
      },
    }),
    onSuccess: () => { toast.success("Site added"); onCreated(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const cfg = SITE_TYPE_CONFIG[siteType];

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Add a site</h2>
          <p className="text-sm text-muted-foreground">
            {step === 1 && "Choose your site type"}
            {step === 2 && "Enter your site URL"}
            {step === 3 && "Set brand identity"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {([1, 2, 3] as const).map((n) => (
            <span key={n} className="h-1.5 w-6 rounded-full" style={{ background: n <= step ? "#111111" : "#E5E5E5" }} />
          ))}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {step === 1 && (
        <div className="grid gap-3 md:grid-cols-3">
          {SITE_TYPES.map((t) => {
            const c = SITE_TYPE_CONFIG[t];
            const Icon = c.icon;
            const active = siteType === t;
            return (
              <button
                key={t} type="button" onClick={() => setSiteType(t)}
                className="rounded-lg border p-4 text-left"
                style={{ borderColor: active ? "#111111" : "#E5E5E5", borderWidth: active ? 2 : 1 }}
              >
                <Icon className="mb-2 h-5 w-5" />
                <div className="font-medium">{c.wizardTitle}</div>
                <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="max-w-lg space-y-4">
          <div>
            <Label>{cfg.urlLabel}</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={cfg.urlPlaceholder} />
          </div>
          {siteType === "website" && (
            <div>
              <Label>Sitemap URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={sitemapUrl} onChange={(e) => setSitemapUrl(e.target.value)} placeholder="https://yoursite.com/sitemap.xml" />
            </div>
          )}
          {cfg.tip && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">💡 {cfg.tip}</p>}
        </div>
      )}

      {step === 3 && (
        <BrandEditorFields
          brandName={brandName} onBrandName={setBrandName}
          tagline={tagline} onTagline={setTagline}
          accentColor={accentColor} onAccentColor={setAccentColor}
          brandColors={brandColors}
          onToggleBrandColor={(hex) => setBrandColors((cur) => (cur.includes(hex) ? cur.filter((c) => c !== hex) : [...cur, hex]))}
          onRemoveLegacyColor={(hex) => setBrandColors((cur) => cur.filter((c) => c !== hex))}
          typography={typography} onTypography={setTypography}
          notes={notes} onNotes={setNotes}
          advancedOpen={advancedOpen} onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
        />
      )}

      <div className="mt-6 flex justify-end gap-2">
        {step > 1 && <Button variant="outline" onClick={() => setStep((s) => (s - 1) as WizardStep)}>Back</Button>}
        {step < 3 && (
          <Button onClick={() => setStep((s) => (s + 1) as WizardStep)} disabled={step === 2 && !url.trim()}>
            {step === 2 ? "Next: Brand info →" : "Next"}
          </Button>
        )}
        {step === 3 && (
          <Button onClick={() => createMut.mutate()} disabled={!brandName.trim() || createMut.isPending}>
            <Plus className="mr-1.5 h-4 w-4" />Add site
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------- Site card ----------

function SiteCard({
  site, onDelete, onCrawl, crawlPending, onSaved,
}: {
  site: SiteOverviewRow; onDelete: () => void; onCrawl: () => void; crawlPending: boolean; onSaved: () => void;
}) {
  const upsert = useServerFn(upsertSite);
  const [editing, setEditing] = useState(false);
  const [brandName, setBrandName] = useState(site.brand_name ?? "");
  const [tagline, setTagline] = useState(site.tagline ?? "");
  const [accentColor, setAccentColor] = useState(site.accent_color ?? ACCENT_PRESETS[0]);
  const [brandColors, setBrandColors] = useState<string[]>(Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : []);
  const [typography, setTypography] = useState(site.brand_font ?? "");
  const [notes, setNotes] = useState(site.brand_notes ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => upsert({
      data: {
        id: site.id, url: site.url, sitemap_url: site.sitemap_url ?? undefined,
        site_type: site.site_type,
        brand_name: brandName || undefined,
        tagline: tagline || undefined,
        accent_color: accentColor,
        brand_colors: brandColors,
        brand_font: typography || undefined,
        brand_notes: notes || undefined,
      },
    }),
    onSuccess: () => { toast.success("Brand saved"); setEditing(false); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const cfg = SITE_TYPE_CONFIG[site.site_type as SiteType] ?? SITE_TYPE_CONFIG.website;
  const Icon = cfg.icon;
  const host = hostFromUrl(site.url);
  const swatches = Array.isArray(site.brand_colors) ? (site.brand_colors as string[]) : [];
  const accent = site.accent_color ?? "#8A867C";

  return (
    <Card className="overflow-hidden p-0">
      <div className="h-1.5 w-full" style={{ background: accent }} />
      <div className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `${accent}1A` }}>
            <Icon className="h-4 w-4" style={{ color: accent }} />
          </span>
          <span className="min-w-0 truncate font-semibold">{site.brand_name || host}</span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.badgeClass}`}>{cfg.label}</span>
        </div>
        <div className="mb-2 truncate text-xs text-muted-foreground">{host}</div>
        {site.tagline && <p className="mb-3 text-sm italic text-muted-foreground">"{site.tagline}"</p>}

        {swatches.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5">
            {swatches.slice(0, 4).map((c) => (
              <span key={c} className="h-4 w-4 rounded-full border border-border" style={{ background: c }} />
            ))}
            <span className="text-[11px] text-muted-foreground">brand palette</span>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{site.pageCount}</strong> {site.pageCount === 1 ? cfg.unitSingular : cfg.unitPlural}</span>
          <span>·</span>
          <span><strong className="text-foreground">{site.pinsCreated}</strong> pins created</span>
          <span>·</span>
          {site.site_type === "website" ? (
            site.lastCrawledAt ? <span>Last crawled {formatShortDate(site.lastCrawledAt)}</span> : <span>Not crawled yet</span>
          ) : (
            site.lastCrawledAt
              ? <span className="font-medium text-emerald-600">✓ Indexed {formatRelative(site.lastCrawledAt)}</span>
              : <span>Not indexed yet</span>
          )}
        </div>

        {site.site_type === "website" && site.sitemap_url && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{site.sitemap_url.replace(/^https?:\/\//, "")}</span>
            </span>
            <span className="shrink-0 font-medium text-emerald-600">Sitemap linked</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            Brand<ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${editing ? "rotate-180" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" onClick={onCrawl} disabled={crawlPending}>
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />Crawl
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {site.brand_name || host}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the site and its crawled pages from Pinspider. Pins already scheduled or published aren't affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {editing && (
          <div className="mt-5 border-t border-border pt-5">
            <BrandEditorFields
              brandName={brandName} onBrandName={setBrandName}
              tagline={tagline} onTagline={setTagline}
              accentColor={accentColor} onAccentColor={setAccentColor}
              brandColors={brandColors}
              onToggleBrandColor={(hex) => setBrandColors((cur) => (cur.includes(hex) ? cur.filter((c) => c !== hex) : [...cur, hex]))}
              onRemoveLegacyColor={(hex) => setBrandColors((cur) => cur.filter((c) => c !== hex))}
              typography={typography} onTypography={setTypography}
              notes={notes} onNotes={setNotes}
              advancedOpen={advancedOpen} onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
              previewLabel={host}
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save brand</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
