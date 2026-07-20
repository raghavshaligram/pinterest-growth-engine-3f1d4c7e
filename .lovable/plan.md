# Blotato-inspired design refresh (full app, loose interpretation)

Keep Pinspider's warm Pinterest-red identity, but borrow Blotato's energy: deeper near-black background, a **coral→magenta gradient** as the signature accent, glowing gradient CTAs, bold sans-serif display type, and subtle radial halos. Not a copy — no yellow announcement bar, no hot-pink neon, no mockup pane.

## Design tokens (src/styles.css)

- **Background**: darker, cooler near-black. `--background: oklch(0.12 0.015 15)`; `--card: oklch(0.16 0.017 15)`; `--sidebar: oklch(0.10 0.012 15)`.
- **Primary**: keep warm coral-red `oklch(0.66 0.20 25)` as solid token, but introduce a gradient pair:
  - `--primary-glow: oklch(0.66 0.24 355)` (magenta)
  - `--gradient-primary: linear-gradient(135deg, var(--primary) 0%, var(--primary-glow) 100%)`
  - `--gradient-primary-soft: linear-gradient(135deg, oklch(0.66 0.20 25 / 0.15), oklch(0.66 0.24 355 / 0.15))`
  - `--shadow-glow: 0 0 40px -8px oklch(0.66 0.22 355 / 0.45), 0 0 80px -20px oklch(0.66 0.20 25 / 0.35)`
- **Border**: tighter, cooler `oklch(0.22 0.012 15)`.
- **Radius**: bump to `1rem` for a softer, more modern feel.

## Typography

- Swap display font from *Instrument Serif* to **Space Grotesk** (bold, geometric, matches Blotato energy without cloning Inter). Body stays Inter.
- Load via `<link>` in `src/routes/__root.tsx` (never `@import` in CSS per Tailwind v4 rules).
- Update `--font-display` in `@theme` and `.font-display` weight to 600.
- Tighter tracking on headings (`-0.03em`) for the bold display look.

## Component-level changes

- **Button (`primary` variant)**: gradient background + subtle glow shadow on hover. Add a new `variant="gradient"` in `src/components/ui/button.tsx` using `--gradient-primary` and `--shadow-glow`.
- **AppShell sidebar**:
  - Logo icon gets a small gradient chip behind the Sparkles.
  - Active nav item uses a left gradient bar + soft gradient tint background instead of flat `bg-sidebar-accent`.
  - Sidebar keeps solid dark, but border becomes a hairline gradient on the right edge.
- **Cards**: add a `.card-glow` utility (`@utility`) for hero/dashboard summary cards — subtle radial magenta halo top-right, thin border.
- **Auth page (`/auth`)**: full-bleed background with two large soft radial halos (coral top-left, magenta bottom-right), centered card floats on top with backdrop blur, gradient submit button. Small "TRUSTED BY" style eyebrow chip above the heading.
- **Dashboard**: promote the top stat row to gradient-tinted cards; primary CTA (e.g. "Generate pins") becomes the gradient button.

## Utilities added to styles.css

```css
@utility bg-gradient-primary { background-image: var(--gradient-primary); }
@utility text-gradient-primary {
  background-image: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
@utility shadow-glow { box-shadow: var(--shadow-glow); }
@utility card-glow {
  position: relative;
  &::before {
    content: "";
    position: absolute; inset: 0;
    background: radial-gradient(600px circle at 100% 0%, oklch(0.66 0.22 355 / 0.12), transparent 40%);
    pointer-events: none; border-radius: inherit;
  }
}
```

## Files touched

- `src/styles.css` — tokens, gradient vars, glow shadow, utilities, heading tracking, radius bump.
- `src/routes/__root.tsx` — add Space Grotesk `<link>` in head.
- `src/components/ui/button.tsx` — add `gradient` variant.
- `src/components/AppShell.tsx` — logo chip, gradient active state, hairline right edge.
- `src/routes/auth.tsx` — halo background, blurred card, gradient CTA, eyebrow chip.
- `src/routes/_authenticated/dashboard.tsx` — apply `card-glow` + gradient CTA on primary actions.

## What I'm intentionally NOT doing

- No yellow announcement bar.
- No hot-pink neon — the accent stays coral-leaning to preserve Pinterest brand link.
- No app-preview mockup pane on the auth page.
- No changes to business logic, server functions, or DB.

Approve and I'll implement in one pass.