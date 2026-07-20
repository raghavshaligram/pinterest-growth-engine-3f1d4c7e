import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSites } from "@/lib/sites.functions";

// Sticky per-browser site selection. Not synced across devices -- if that
// turns out to matter, this is a small swap to a user-preference row
// instead of localStorage, without changing the consuming components.
const STORAGE_KEY = "pinspider:selected-site";

export type SiteOption = {
  id: string;
  url: string;
  brand_name: string | null;
  accent_color: string | null;
};

type SiteContextValue = {
  sites: SiteOption[];
  isLoading: boolean;
  selectedSiteId: string | null; // null = "All sites"
  selectedSite: SiteOption | null;
  setSelectedSiteId: (id: string | null) => void;
};

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const listSitesFn = useServerFn(listSites);
  const { data, isLoading } = useQuery({ queryKey: ["sites-switcher"], queryFn: () => listSitesFn() });
  const sites = (data ?? []) as SiteOption[];

  const [selectedSiteId, setSelectedSiteIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored !== "all" ? stored : null;
  });

  // If the previously-selected site was deleted (or belongs to a
  // different account entirely), fall back to "All sites" once we know
  // the real list rather than silently querying a dead id forever.
  useEffect(() => {
    if (!isLoading && selectedSiteId && sites.length > 0 && !sites.some((s) => s.id === selectedSiteId)) {
      setSelectedSiteIdState(null);
      window.localStorage.setItem(STORAGE_KEY, "all");
    }
  }, [isLoading, sites, selectedSiteId]);

  function setSelectedSiteId(id: string | null) {
    setSelectedSiteIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id ?? "all");
  }

  const selectedSite = useMemo(() => sites.find((s) => s.id === selectedSiteId) ?? null, [sites, selectedSiteId]);

  return (
    <SiteContext.Provider value={{ sites, isLoading, selectedSiteId, selectedSite, setSelectedSiteId }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSiteContext() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSiteContext must be used within a SiteProvider");
  return ctx;
}
