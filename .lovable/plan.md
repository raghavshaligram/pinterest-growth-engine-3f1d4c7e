# Dashboard visual refresh (below "Pinned this week")

The current Activity / Integrations / Pins-by-board area reads like a plain three-column table stack — thin hairlines, tiny mono text, no color, no depth. It's information-dense but visually flat and doesn't match the warm coral/magenta identity of the rest of the app.

## Direction

Lean into the app's existing tokens (`--gradient-primary`, `--shadow-glow`, `card-glow`) so this block feels like part of Pinspider, not a dev console. Keep the same data — just present it with more hierarchy, color, and personality.

## Layout changes

- Keep the 1.3fr / 1fr split, but widen the gap and give each panel a real card treatment: `--bg-card` fill, soft border, 12px radius, subtle `card-glow` halo on the top-right of each panel.
- Panels get a proper header row (title + small count chip + action link) with a divider, instead of the current thin baseline.
- Remove the dashed/hairline `border-subtle` row separators inside each card — replace with generous vertical spacing and, where useful, alternating row hover states.

## Activity panel (left)

- Bigger, rounder thumbnails (40px), with a colored ring for errors (destructive) and a faint coral ring for publishes.
- Two-line row: primary line = pin title in `--text-primary`, secondary line = `→ Board · event` in `--text-secondary`.
- Event verbs get a tiny colored dot on the left (green = published, coral = manually posted, red = error) so the eye can scan the feed by outcome.
- Error rows keep the tinted destructive background but as a full-width pill inside the card, not a negative-margin hack.
- "N more manually posted" collapse row becomes a soft ghost button centered at the bottom.

## Integrations panel (top right)

- Turn the flat list into a 2×2 grid of provider tiles (OpenAI, Replicate, Apify, Pinterest).
- Each tile: provider name, a status dot (green ok / coral needs-attention / red error), and a small "Connected" or "Connect" link. Connected tiles get a very subtle gradient tint; disconnected tiles stay neutral so the eye is drawn to what needs action.

## Pins by board panel (bottom right)

- Replace the plain "name — count" rows with horizontal mini bar chart rows: board name on the left, a thin bar filled with `--gradient-primary` proportional to the max count that week, count number on the right in mono.
- Empty state: friendly one-liner + a subtle "Schedule pins" link to `/schedule`.

## New: subtle "This week" summary strip

Above these two columns, add a compact 4-tile strip (published, queued, drafts, errors) using the same gradient-tinted card treatment as the auth/dashboard hero cards elsewhere in the app. Purely visual reinforcement of the numbers already available in `pipeline` — no new server work.

## Files touched

- `src/routes/_authenticated/dashboard.tsx` — restructure the lower grid, ActivityRow, Integrations, Pins-by-board, add the summary strip.
- `src/styles.css` — only if a small helper utility is needed (e.g. `.ring-accent-soft`); reuse existing `card-glow`, gradient, and shadow tokens otherwise.

## Not doing

- No schema, server function, or data-shape changes.
- No changes to "Pinned this week", the pipeline stepper, or the sidebar.
- No new fonts or palette shifts — strictly reusing existing tokens.

Approve and I'll implement in one pass.
