---
version: "alpha"
name: ICG Heritage
description: A dignified, civic-institutional design system for the Islamic Center of Greensboro fundraising platform. Restrained ivory palette with deep forest accents and antique gold details. Designed to feel like a respected institution's annual report — not a SaaS dashboard.

colors:
  # --- Surfaces ---
  bg: "#fbf9f3"               # Page background — warm ivory, like aged paper
  surface: "#ffffff"          # Cards, modals — clean white for elevation
  surface-soft: "#f5f1e8"     # Inputs, secondary fills, table row hover — slight cream
  surface-sunken: "#efe9d9"   # Toolbar/footer/recessed wells — deeper cream

  # --- Ink (text) ---
  ink: "#1a2e1f"              # Primary text + headings — deep forest, almost black
  ink-soft: "#5a6b5f"         # Body copy, secondary labels
  ink-muted: "#8a9690"        # Metadata, captions, disabled

  # --- Rules and dividers ---
  rule: "#e8e0cc"             # Hairline borders, table dividers — soft sand
  rule-strong: "#d4c79e"      # Emphasized borders, focused inputs

  # --- Brand accents ---
  gold: "#a87c0a"             # Antique gold — primary accent, stat values, hairline rules
  gold-soft: "#c69b2a"        # Hover state for gold elements
  gold-tint: "#f7eecf"        # Backgrounds for gold-themed badges (high contrast text)

  emerald: "#2d5e3e"          # Forest green — secondary brand, ICG dome echo, success
  emerald-soft: "#3f7551"     # Hover state for emerald
  emerald-tint: "#dde9df"     # Backgrounds for active/success badges

  # --- Functional ---
  warning: "#9c6b1f"          # Burnt amber — inactive badges, edit affordances
  warning-tint: "#f4e4c2"
  danger: "#8b2e2e"           # Subdued claret — delete, destructive
  danger-tint: "#f0d8d8"

  # --- Payment method palette ---
  payment-cash: "#2d5e3e"     # Reuses emerald
  payment-bank: "#3a5a8c"     # Muted indigo — feels institutional, not bright blue
  payment-card: "#6b4d8c"     # Muted aubergine — replaces neon purple
  payment-online: "#a8651f"   # Burnt orange — replaces neon orange

  # --- Chart palette (used by Chart.js) ---
  chart-1: "#2d5e3e"          # emerald
  chart-2: "#a87c0a"          # gold
  chart-3: "#3a5a8c"          # indigo
  chart-4: "#8b2e2e"          # claret
  chart-5: "#6b4d8c"          # aubergine
  chart-6: "#a8651f"          # burnt orange

# Dark-mode token overrides. Same semantic names; different values.
# Each entry below is the dark-mode value of the matching token in `colors`
# above. Tokens not listed here keep their light-mode value in dark mode
# (e.g. payment-* tints we re-derive from token math).
colors-dark:
  # --- Surfaces ---
  bg: "#15110a"               # Warm near-black — slight gold cast keeps the "civic" register
  surface: "#1f1a10"           # Cards/modals — one step lighter than bg
  surface-soft: "#28221a"      # Inputs, secondary fills, table hover
  surface-sunken: "#1a160e"    # Toolbars, recessed wells — darker than bg

  # --- Ink (text) ---
  ink: "#f1ebd8"              # Warm off-white. Never pure white.
  ink-soft: "#c5bda3"          # Body, secondary labels
  ink-muted: "#8a8270"         # Metadata, captions, disabled

  # --- Rules and dividers ---
  rule: "#3a3320"             # Warm dim brown-gold, low contrast
  rule-strong: "#5a4f30"       # Emphasized borders, focused state outlines

  # --- Brand accents (lifted slightly for dark backgrounds) ---
  gold: "#d4af37"              # Brighter antique gold — readable on dark
  gold-soft: "#e6c463"          # Hover state
  gold-tint: "#3d3415"          # Dark-themed gold-tinted background for badges

  emerald: "#5a9b6f"            # Lifted forest green — saturated enough to read on dark
  emerald-soft: "#73b187"       # Hover state
  emerald-tint: "#1f3a26"       # Dark-themed emerald-tinted background

  # --- Functional ---
  warning: "#d4a04a"
  warning-tint: "#3d2e12"
  danger: "#c65656"
  danger-tint: "#3a1818"

  # --- Payment method palette (lifted versions) ---
  payment-cash: "#5a9b6f"
  payment-bank: "#7591c4"
  payment-card: "#9b7ec4"
  payment-online: "#d4914a"

  # --- Chart palette (used by Chart.js — lifted for dark) ---
  chart-1: "#5a9b6f"
  chart-2: "#d4af37"
  chart-3: "#7591c4"
  chart-4: "#c65656"
  chart-5: "#9b7ec4"
  chart-6: "#d4914a"

typography:
  display-xl:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "3.75rem"        # 60px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.01em"

  display-lg:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "2.75rem"        # 44px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.005em"

  display-md:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "2rem"           # 32px
    fontWeight: 500
    lineHeight: 1.2

  heading-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"         # 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"

  heading-md:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"       # 18px
    fontWeight: 600
    lineHeight: 1.4

  body-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.0625rem"      # 17px
    fontWeight: 400
    lineHeight: 1.65

  body-md:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"      # 15px
    fontWeight: 400
    lineHeight: 1.6

  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"       # 14px
    fontWeight: 400
    lineHeight: 1.55

  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.8125rem"      # 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"

  meta:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"        # 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.02em"

  eyebrow:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"      # 11px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.12em"
    fontFeature: "'tnum'"

  numeric-xl:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "2.25rem"        # 36px — KPI values
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "'tnum'"
    letterSpacing: "-0.01em"

  numeric-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"         # 24px — secondary stats, money in tables
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "'tnum'"

  arabic:
    fontFamily: "Amiri, 'Times New Roman', serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.6

rounded:
  none: "0"
  sm: "6px"      # buttons, inputs, badges
  md: "12px"     # cards, modals, table containers
  lg: "20px"     # hero panel, large display surfaces only
  full: "9999px" # pills, avatars, progress bars

spacing:
  "0": 0
  xs: 4
  sm: 8
  md: 16
  lg: 24
  xl: 40
  "2xl": 72
  "3xl": 120

components:
  # --- Buttons ---
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"

  button-primary-hover:
    backgroundColor: "{colors.emerald-soft}"

  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"

  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"

  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"

  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "8px"

  # --- Inputs ---
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"

  input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"

  # --- Surfaces ---
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"

  card-elevated:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "32px"

  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "32px"

  # --- Badges ---
  badge-active:
    backgroundColor: "{colors.emerald-tint}"
    textColor: "{colors.emerald}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  badge-inactive:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.warning}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  badge-category:
    backgroundColor: "{colors.gold-tint}"
    textColor: "{colors.gold}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  payment-badge-cash:
    backgroundColor: "{colors.emerald-tint}"
    textColor: "{colors.payment-cash}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  # --- Stat / KPI ---
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px 24px"

  # --- Progress ---
  progress-track:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.full}"
    height: "6px"

  progress-fill:
    backgroundColor: "{colors.emerald}"
    rounded: "{rounded.full}"

  # --- Nav ---
  nav-bar:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    padding: "16px 24px"

  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"

---

# ICG Heritage — Design System

A design system for the Islamic Center of Greensboro fundraising platform. The brief: *make a public-facing fundraiser feel like a respected civic institution, not a tech product.*

## Overview

**Register:** restrained, dignified, civic. Closer to a printed annual report than a SaaS dashboard. The site represents a real community institution; visual quality must signal trust before it tries to delight.

**Reference points:** Charity:Water's annual reports, the New York Times' opinion section, classical Islamic civic typography (Amiri, Naskh traditions), Edward Tufte's information design.

**Anti-references:** Linear, Vercel, Web3 dashboards, glass-morphism heavy UIs. These read "I am a tech product." We are not.

**Mode:** light + dark, equal polish. The default is light (the institutional register). Dark mode is a first-class citizen: same restrained logic, same dignity, calibrated specifically rather than mechanically inverted. The toggle in the nav respects `prefers-color-scheme` on first visit and persists the user's choice.

## Colors

The palette is rooted in three pillars: **ivory** (the institutional surface), **deep forest** (gravity, ink, a quiet echo of the green ICG dome), and **antique gold** (sparingly used for emphasis, never decoration).

- **`bg` (#fbf9f3) — warm ivory.** The page background. Slightly warmer than pure white; reads as paper, not screen. Source of the "calm" in the design.
- **`surface` (#ffffff) — clean white.** Cards and modals. Lifts content off the ivory background through brightness, not heavy shadows.
- **`surface-soft` (#f5f1e8) and `surface-sunken` (#efe9d9) — recessed creams.** Inputs and recessed wells (toolbars, table-row hovers). Always darker than the page, never lighter.
- **`ink` (#1a2e1f) — deep forest.** Primary text and headings. *Not pure black* — black on warm ivory is harsh. Forest pairs with the ICG dome and softens the contrast to something paper-like.
- **`ink-soft` (#5a6b5f) and `ink-muted` (#8a9690) — body and metadata.** A two-step text hierarchy below ink. All three pass WCAG AA on the ivory background.
- **`rule` (#e8e0cc) — soft sand.** Hairline dividers. The single most-used non-ink color in the system. Replaces the dark theme's rgba-white borders entirely.
- **`gold` (#a87c0a) — antique gold.** *Used sparingly.* Section underlines, KPI numbers, the brand wordmark gradient, focus rings. Never a button background. Antique (not bright) so it reads "civic emblem," not "Web3 token."
- **`emerald` (#2d5e3e) — forest green.** Primary CTA color, success states, progress fills. Echoes the ICG logo's dome. Calm and assertive.
- **`warning` (#9c6b1f) and `danger` (#8b2e2e) — burnt amber and subdued claret.** Functional colors held back from saturation so they don't dominate. A delete button should look serious, not panicked.

The **payment method palette** replaces the previous neon set with institutional muted tones: emerald, indigo, aubergine, burnt orange. They harmonize with each other and with the brand greens/golds, so the donut chart in the report doesn't look like a clown.

The **chart palette** is reusable across visualizations. Drawn from the same six muted hues; no two adjacent slices clash.

### Dark mode — the same logic, recalibrated

Dark mode isn't a 1:1 inversion. Every token was chosen for its specific semantic role on the new background.

- **`bg` (#15110a) — warm near-black.** Slight gold cast. Same reasoning as light's warm ivory: the page should feel like a material object (paper or vellum scroll), not a screen. Pure black would read "tech product."
- **`surface` (#1f1a10) — cards/modals.** One step lighter than `bg`. Cards lift via brightness, not heavy shadows — same approach as light, just inverted.
- **`ink` (#f1ebd8) — warm off-white.** *Never pure white.* Pure white on dark is harsh, overconfident, and reads "Twitter at 3am." A warm cream pairs with the `bg` and feels like ink on a dark page.
- **`gold` (#d4af37) — brighter antique gold.** The light-mode `#a87c0a` would read as a dim brown on dark. Lifted to retain readability while still antique-not-neon.
- **`emerald` (#5a9b6f) — lifted forest green.** A deep #2d5e3e on a dark surface reads as a hole. The dark-mode emerald is more saturated and lighter so it still says "go button" without screaming.
- **`rule` (#3a3320) — dim warm brown-gold.** Hairlines on dark are a balance: too bright reads "wireframe," too dim disappears. This walks that line.

The brand wordmark gradient (`gold → emerald`) uses the dark-mode token values, so it stays readable on the dark background.

The **chart palette** is lifted across the board — Chart.js charts running on dark mode use the dark `chart-*` values automatically (the JS reads CSS variables on render).

**Print mode forces light theme.** A printed report on paper should always look like the light theme regardless of what the screen showed; the print stylesheet overrides `--bg`, `--surface`, `--ink`, etc., to their light values.

## Typography

**Three voices:**

1. **Display — Cormorant Garamond.** A refined serif used only for h1/h2 and the hero. Carries the "annual report" gravitas. Used sparingly — typography is a spice, not a sauce.
2. **UI — Inter.** All body, labels, controls, KPI numbers. Proven workhorse, excellent tabular numerals.
3. **Arabic — Amiri.** Replaces Cairo. Amiri is a classical Naskh designed for Quranic typesetting; pairs naturally with serif Latin display in a way that Cairo (a modern sans) can't.

**Hierarchy is shallow on purpose.** A civic site is read sequentially, not scanned for action. The KPI cards use `numeric-xl` for the value and `eyebrow` (uppercase, letter-spaced) for the label — that single contrast carries most of the page's information density.

**Tabular numerals everywhere.** Money columns must align. `font-feature-settings: 'tnum'` is on every `numeric-*` and `eyebrow` token.

**No all-caps display headings.** Eyebrow labels are caps; everything else is sentence case. All-caps display reads aggressive and dates the page.

## Layout

**Public pages (homepage, report):**
- Container max-width: **1080px** — narrower than current 1280px. A tighter content well reads as more dignified, easier to scan, more like a printed page.
- Generous vertical rhythm using `xl` (40px) between cards and `2xl` (72px) between major sections. The hero uses `3xl` (120px) of breathing room above and below.

**Admin modals:** stay current width (~1200px max), high information density. Functionality wins over breath here — admins are working, not browsing.

**Spacing scale follows an 8pt grid** (xs=4, sm=8, md=16, lg=24, xl=40, 2xl=72, 3xl=120). Everything in the codebase uses these tokens — no arbitrary `padding: 13px` anywhere.

**Card grid:** 3 columns on desktop with **24px gap** (lg). Cards breathe.

**Hero block (homepage):** title in Cormorant Garamond display-xl, hairline gold rule beneath (1px solid `gold`, 80px wide), then `xl` whitespace, then a single intent line in `body-lg ink-soft`, then `xl` whitespace, then the filter chips. The hero is mostly air.

## Elevation & Depth

**No glass morphism. No `backdrop-filter: blur()`. No semi-transparent overlays.** These are out — they read tech-product, and they print badly.

**Two-tier shadow system:**

- **Resting card:** `box-shadow: 0 1px 2px rgba(26, 46, 31, 0.04), 0 4px 16px rgba(26, 46, 31, 0.05);` Barely there. The card is grounded, not floating.
- **Modal / hovered card:** `box-shadow: 0 4px 8px rgba(26, 46, 31, 0.06), 0 16px 40px rgba(26, 46, 31, 0.10);` Lifts moderately, never dramatically.

**Hairline rules do most of the structural work.** A `1px solid rule` (#e8e0cc) above a section is more dignified than a shadow.

## Shapes

**Border radius is restrained.** `sm` (6px) for buttons/inputs/badges; `md` (12px) for cards and modals; `lg` (20px) reserved for the hero panel only; `full` (9999px) for pills, avatars, progress bars.

**No `2xl` or `3xl` rounding.** The previous design overused 16px+ rounded corners which reads "consumer mobile app." Smaller radii read more institutional.

**Buttons are slightly less rounded than cards** so they feel like distinct affordances inside a card, not echoes of it.

## Components

**Primary button** (`button-primary`): emerald background, white text, `sm` radius, label typography. The single most-used affordance — Sign In, Save, Donate. Hover lightens slightly to `emerald-soft`. No drop shadow on buttons. No gradients.

**Secondary button** (`button-secondary`): white surface, ink text, `1px solid rule` border. For Cancel, Reset, Back to Dashboard.

**Ghost button** (`button-ghost`): transparent, ink-soft text, no border. For inline edit/delete affordances inside dense lists.

**Danger button** (`button-danger`): claret background, white text. Used for irreversible actions. Confirms via the themed `ICGUtil.confirmDialog` modal before firing — for the most destructive actions (project delete) the dialog requires the operator to type the project's ID before the Delete button is enabled. Native browser `confirm()` is never used; it renders as a full-screen prompt on mobile.

**Inputs** (`input`): white surface, `1px solid rule` border, focused state replaces border with `1px solid emerald` and adds a 3px `emerald-tint` outline ring. No fake "filled" backgrounds — inputs read as paper fields.

**Cards** (`card`): white surface, `1px solid rule` border, two-tier resting shadow, `md` radius, 24px padding. The fundamental container.

**Stat cards** (`stat-card`): same as card but with `eyebrow`-styled label above and `numeric-xl` value below in `gold`. The KPI row on the report page uses this five times across.

**Progress bars** (`progress-track` + `progress-fill`): 6px tall, `full` radius, `surface-sunken` track, fill colored per-project. The current 2px hair-thin bar is too timid; 6px reads as confident.

**Modals**: `surface`, `md` radius, second-tier shadow, scrim is `rgba(26, 46, 31, 0.20)` (deep forest at 20% opacity) — *not* black. The forest scrim keeps the warm ivory atmosphere even when a modal is open.

**Nav bar**: `bg` (transparent over the page), no separator below — just generous padding. The nav lifts off the page only when scrolled (a `1px solid rule` appears via JS once `scrollY > 4`).

**Project cards** (homepage grid): `surface`, `md` radius, hairline `rule` border, hovers lift to second-tier shadow + a `1px solid rule-strong` border. Project color is shown as a 4px tall bar across the top (not a dot anywhere on the card) — this is a major visual signature for the redesign.

**Tables**: rows are 48px tall minimum, separated by 1px `rule` dividers (no zebra striping — strips scream "tech app"), header row uses `eyebrow` typography with letter-spacing.

**Charts** (Chart.js): grid lines drop to `rule` color at 50% opacity; tick labels use `ink-muted`; bars/lines use the `chart-1`..`chart-6` palette. The dark-theme cyan bars are gone.

**Dashboard tiles** (`dash-tile`): the four large clickable cards on the admin dashboard (Add or edit donations, Bulk upload donations, Manage projects, Manage categories). Same `card` foundation, but tap-target sized for stubby fingers and arranged on a `md:grid-cols-2 lg:grid-cols-4` grid so they reflow gracefully across phone, tablet, and desktop.

**Friday-prayer display mode** (`body[data-display="friday"]` + `.friday-*` classes): a full-screen presentation mode for projecting one campaign during jumu'ah announcements. Activated via `?display=friday&campaign=<slug>`. Hides nav, project grid, footer, and live-status; renders a centered stack of eyebrow → display title → optional Arabic name → progress bar → raised vs goal → percent. All type sizes use `clamp()` against existing palette tokens — no new design system primitives, just a layout repurposing of what's already there. Inherits the user's saved theme (no force-light) so a hall with controllable lighting can run dark mode if that suits the projector better.

## Do's and Don'ts

### Do

- **Lead with whitespace.** Every section should feel calm at first glance. If a screenshot looks crowded, remove something.
- **Use `gold` like a punctuation mark.** Once or twice per screen, never as decoration. A hairline gold rule under the hero title; a gold KPI number on a stat card; the wordmark gradient. That's it.
- **Use `emerald` as the action color.** Anything the user clicks to commit (save, sign in, contribute) is emerald. Consistency builds confidence.
- **Pair Cormorant with Inter.** Display headings serif, everything else sans. Never mix serifs into body text.
- **Right-align money.** Every numeric column. Tabular numerals. Bold only the most important number on each row.
- **Use sentence case in all body and headings.** Eyebrow labels (kpi titles, meta) are uppercase. That's the only place caps appears.
- **Print like a real document.** The print stylesheet is a first-class concern — the report should look like a board-meeting handout when it comes out of the printer. A handout says when its figures are from (the Summary's "Updated …" line prints) and never asks the reader to tap anything: an on-screen prompt goes in a `.screen-only` element, which print hides.
- **Trust hairline rules.** A single `1px solid rule` line does more work than a heavy divider, gradient, or shadow.

### Don't

- **Don't use glass morphism, blur backgrounds, or semi-transparent overlays.** They date the design and print poorly.
- **Don't add gradients except on the wordmark.** The brand wordmark uses a `linear-gradient(to right, gold, emerald)` for the "ICG Fundraising" text only. Nothing else gets a gradient.
- **Don't use neon or saturated brand colors.** All colors in this system are muted antique versions of their references. If a color looks bright, it's wrong.
- **Don't decorate.** No icon next to every label. No shimmer animations. No drop shadows on text. No emoji as section dividers (the `🔒` admin banner stays — it carries meaning. Sectional emoji do not.)
- **Don't use bg-clip text** *except for the wordmark.* It's a brand signature, not a heading style.
- **Don't add geometric Islamic patterns.** We discussed this — we picked the restrained register, not the decorative one. A pattern background on the hero would tip into "Islamic-themed template." The dignity comes from typography and whitespace.
- **Don't animate things that don't need to move.** A subtle `fade-in 200ms` on chart load is fine. Anything else (numbers counting up, cards floating in, parallax) breaks the institutional register.
- **Don't pure-black anywhere.** All "black" is `ink` (#1a2e1f). A subtle warmth keeps the page feeling printed.

## Implementation notes

- **CSS variables drive everything.** The full token set is mirrored as `:root` custom properties (`--color-ink`, `--space-lg`, `--radius-md`, etc.). All component CSS references variables; no hex codes outside the variable definitions.
- **Tailwind CDN stays** for utility classes, but a `tailwind.config` block in each HTML extends the theme to map our tokens to Tailwind names (`text-ink`, `bg-surface`, `rounded-md` already aligned to our scale).
- **Chart.js theme** is configured once in a shared init function that reads the CSS variables, so charts pick up the palette automatically.
- **No build step, no NPM dependencies.** Same constraint as the rest of the project — the design system is just a CSS variables block and a Tailwind config.
