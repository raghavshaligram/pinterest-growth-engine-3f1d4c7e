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
  quick_answer: {
    id: "quick_answer", label: "Quick answer", style: "quick-tip",
    angle: "One direct question people search for, answered in a single memorable line. The pin states the question as the headline and promises the answer on the page. Specific beats vague.",
    templates: { blog: ["definition_card", "quote_stat_card"], calculator: ["tool_result_preview", "definition_card"] },
  },
  how_to_steps: {
    id: "how_to_steps", label: "Step by step", style: "how-to",
    angle: "A short numbered how-to (3 to 5 steps) for the task this page helps with. The headline names the task and the number of steps. Save-worthy: someone should want to keep it for later.",
    templates: { blog: ["step_by_step", "problem_solution_headline"], calculator: ["step_by_step", "tool_result_preview"] },
  },
  mistakes_myths: {
    id: "mistakes_myths", label: "Mistakes and myths", style: "mistakes-to-avoid",
    angle: "A common mistake or myth gardeners believe about this topic, set against what is actually true. Curiosity headline, no clickbait.",
    templates: { blog: ["myth_vs_fact", "problem_solution_headline"], calculator: ["myth_vs_fact", "scale_comparison"] },
  },
  tips_grid: {
    id: "tips_grid", label: "Tips at a glance", style: "listicle",
    angle: "A scannable list of 4 to 6 short tips or facts from the page. Headline carries the number and the keyword.",
    templates: { blog: ["quick_tip_grid"], calculator: ["quick_tip_grid", "scale_comparison"] },
  },
  compare_before_after: {
    id: "compare_before_after", label: "Compare or before and after", style: "comparison",
    angle: "A visual comparison: before and after, right and wrong, or two options side by side, taken from the page's own content.",
    templates: { blog: ["editorial_before_after", "scale_comparison"], calculator: ["scale_comparison", "tool_result_preview"] },
  },
  seasonal_now: {
    id: "seasonal_now", label: "Do this now (seasonal)", style: "seasonal",
    angle: "What to do at this time of year for this topic, framed as a timeline or checklist. Mention the season in the headline so it ranks for seasonal searches.",
    templates: { blog: ["seasonal_timeline", "quick_tip_grid"], calculator: ["seasonal_timeline", "tool_result_preview"] },
  },
  save_for_later: {
    id: "save_for_later", label: "Save for later reference", style: "infographic",
    angle: "A compact reference card (a chart, a formula or a cheat sheet) people will save and come back to. The headline says what it is.",
    templates: { blog: ["definition_card", "quote_stat_card"], calculator: ["tool_result_preview", "quote_stat_card"] },
  },
};

// Sunday = 0 ... Saturday = 6 (UTC).
export const WEEKDAY_THEMES: string[] = [
  "save_for_later",       // Sun
  "quick_answer",         // Mon
  "how_to_steps",         // Tue
  "mistakes_myths",       // Wed
  "tips_grid",            // Thu
  "compare_before_after", // Fri
  "seasonal_now",         // Sat
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
