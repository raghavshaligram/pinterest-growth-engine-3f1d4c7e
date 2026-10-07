// Pin themes for the autopilot content calendar: one pin a day, each day a different, deliberately chosen format.
//
// Why these formats (Pinterest's own creative guidance and current SEO guides):
//   - vertical 2:3 (1000x1500), one idea per pin, bold high-contrast text, headline at the top, visual in the
//     middle, call to action and brand at the bottom;
//   - keyword first in the title (the first ~40 characters are what people see) and at the start of the description;
//   - fresh pins: a new design for the same URL is a new pin, so each page is re-pinned with a DIFFERENT format and
//     never the same image twice, spaced weeks apart;
//   - save-worthy formats (checklists, step-by-step, myth vs fact, seasonal "do this now") over decorative photos.
//
// The weekday rotation keeps the feed varied; the page type decides which templates make sense, because a calculator
// page (a tool) and a blog post (an article) are pinned differently.
import type { TemplateId } from "@/lib/briefs.functions";

export type PageKind = "blog" | "calculator";

export type PinTheme = {
  id: string;
  label: string;
  style: string; // one of PIN_STYLES, stored on the brief
  angle: string; // told to the copywriting model
  templates: Record<PageKind, TemplateId[]>; // preferred templates, best first
};

export const PIN_THEMES: Record<string, PinTheme> = {
  how_to: {
    id: "how_to", label: "How-to", style: "how-to",
    angle: "A how-to pin for the task this page teaches. Real photos, one big hook headline naming the plant or task and the benefit (e.g. 'Grow Kale Like a Pro'). Labels are the page's real steps or stages.",
    templates: { blog: ["hero_hook_strip", "photo_sandwich", "step_photo_infographic"], calculator: ["step_photo_infographic", "hero_hook_strip"] },
  },
  how_to_steps: {
    id: "how_to_steps", label: "Step by step", style: "how-to",
    angle: "A numbered step guide (3 or 4 steps) with a real photo per step, using the page's own steps (for a calculator: measure, enter, read the result, then plant). Headline names the task and the payoff.",
    templates: { blog: ["step_photo_infographic", "photo_sandwich"], calculator: ["step_photo_infographic"] },
  },
  when_to: {
    id: "when_to", label: "When-to", style: "seasonal",
    angle: "A when-to pin: when to plant, sow, harvest, prune or feed for this topic, with 3 or 4 real months or seasons from the page. Headline starts with 'When to' or states the best time.",
    templates: { blog: ["when_to_timeline_photo", "hero_hook_strip"], calculator: ["when_to_timeline_photo", "step_photo_infographic"] },
  },
  listicle: {
    id: "listicle", label: "Listicle", style: "listicle",
    angle: "A numbered listicle: the headline carries a number (5, 7, 9) and the topic, the labels are real list entries from the page (varieties, mistakes, tips, plants).",
    templates: { blog: ["photo_list_grid", "hero_hook_strip"], calculator: ["photo_list_grid", "step_photo_infographic"] },
  },
  mistakes: {
    id: "mistakes", label: "Mistakes to avoid", style: "mistakes-to-avoid",
    angle: "A numbered 'mistakes' listicle or wrong-versus-right guide drawn from the page. Headline like '7 Mistakes Killing Your Tomatoes'. Honest, specific, no clickbait lies.",
    templates: { blog: ["photo_list_grid", "step_photo_infographic"], calculator: ["step_photo_infographic", "photo_list_grid"] },
  },
};

// Sunday = 0 ... Saturday = 6 (UTC). How-to, When-to and Listicle lead because they are Pinterest's top formats.
export const WEEKDAY_THEMES: string[] = [
  "listicle",      // Sun
  "how_to",        // Mon
  "when_to",       // Tue
  "listicle",      // Wed
  "how_to_steps",  // Thu
  "when_to",       // Fri
  "mistakes",      // Sat
];

export function pageKindFor(url: string): PageKind | null {
  if (/\/calculators\/[^/?#]+\/?$/.test(url)) return "calculator";
  if (/\/blog\/[^/?#]+\/?$/.test(url)) return "blog";
  return null;
}

// Pick the theme for a date and the template for a page: the weekday's theme, using the first of its preferred
// templates that this page has not already used; if all are used, fall back to the first (a new image on the same
// layout is still a fresh pin) so the calendar never stalls.
export function chooseTheme(date: Date, kind: PageKind, usedTemplates: Set<string>): { theme: PinTheme; template: TemplateId } {
  const theme = PIN_THEMES[WEEKDAY_THEMES[date.getUTCDay()]!]!;
  const prefs = theme.templates[kind];
  const template = prefs.find((t) => !usedTemplates.has(t)) ?? prefs[0]!;
  return { theme, template };
}

export const SEASON_WORDS: Record<string, string[]> = {
  winter: ["winter", "december", "january", "february"],
  spring: ["spring", "march", "april", "may"],
  summer: ["summer", "june", "july", "august"],
  fall: ["fall", "autumn", "september", "october", "november"],
};

export function seasonalBoost(seasonality: string | undefined, date: Date): number {
  if (!seasonality) return 0;
  const s = seasonality.toLowerCase();
  if (/year[- ]round|evergreen|all year/.test(s)) return 0;
  const m = date.getUTCMonth(); // 0-11
  const season = m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "fall";
  return SEASON_WORDS[season]!.some((w) => s.includes(w)) ? 25 : 0;
}
