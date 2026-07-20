// Shared, framework-agnostic design tokens + small utils for the
// Pinterest-native Dashboard/Schedule pair (see components/PinShell.tsx).
// Deliberately NOT wired into styles.css's --accent/--bg-card tokens —
// those drive Sites/Pages/Pins/Boards/Keywords/Logs/Settings via the
// shared AppShell, which this redesign explicitly doesn't touch. Kept as
// a plain object (not CSS custom properties) so it's usable from inline
// styles without a global stylesheet change.
export const PIN = {
  bg: "#FAFAF9",
  card: "#FFFFFF",
  border: "#EFEFEF",
  borderStrong: "#E2E2E2",
  textPrimary: "#111111",
  textSecondary: "#767676",
  textMuted: "#ACACAC",
  accent: "#E60023", // Pinterest red
  fieldBg: "#F5F5F5",
  roseTint: "#FCE4E8",
  roseIcon: "#D3244F",
  amberTint: "#FBECDA",
  amberIcon: "#C07A12",
} as const;

export const PIN_FONT = '"DM Sans", "Inter", ui-sans-serif, system-ui, sans-serif';

export function formatClock(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Deterministic board/category color -- boards have no stored color
// column, so this hashes the board id (or name, as a fallback) into a
// fixed palette instead of inventing a schema change or, worse, a
// random color that would flicker between renders.
const BOARD_PALETTE = [
  "#D97B3F", "#7B5EA7", "#2F6F6B", "#7A8B5C",
  "#C9970B", "#B0475E", "#3E6B8A", "#946B3E",
];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function boardColor(idOrName: string | null | undefined): string {
  if (!idOrName) return PIN.textMuted;
  return BOARD_PALETTE[hashStr(idOrName) % BOARD_PALETTE.length];
}

// "Today, 9:14 AM" / "Yesterday, 7:30 AM" / "Jul 17, 10:00 AM" -- the
// pin-card timestamp style used on the Dashboard masonry feed.
export function formatPinTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayMs = 86_400_000;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / dayMs);
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  if (diffDays === -1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
