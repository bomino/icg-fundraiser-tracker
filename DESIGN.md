---
version: "alpha"
name: ICG Heritage
description: A dignified, civic-institutional design system for the Islamic Center of Greensboro fundraising platform. Restrained ivory palette with deep forest accents and antique gold details. Designed to feel like a respected institution's annual report — not a SaaS dashboard.

colors:
  # --- Surfaces ---
  bg: "#fbf9f3"               # Page background — warm ivory, like aged paper
  surface: "#ffffff"          # Cards, modals — clean white for elevation
  surface-soft: "#f5f1e8"     # Hover fills (tabs, table rows, ghost buttons, Find-donor matches), hints, help notes, method badges without their own tint
  surface-sunken: "#efe9d9"   # Progress-bar track, loading skeleton

  # --- Ink (text) ---
  ink: "#1a2e1f"              # Primary text + headings — deep forest, almost black
  ink-soft: "#5a6b5f"         # Body copy, secondary labels
  ink-muted: "#65716a"        # Metadata, captions, field hints — 4.5:1 on bg, surface and surface-soft

  # --- Rules and dividers ---
  rule: "#e8e0cc"             # Hairline borders, table dividers — soft sand
  field-border: "#948a6e"     # Input borders only — a field's only visible edge, 3:1 on surface
  rule-strong: "#d4c79e"      # Table and help-table header rules, chip borders, secondary-button hover borders, modal scrollbar thumb

  # --- Brand accents ---
  gold: "#926c09"             # Antique gold — primary accent, stat values, hairline rules — 4.5:1 on bg and surface
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

  # --- Chart palette (the Summary's payment-method ring) ---
  chart-1: "#2d5e3e"          # emerald
  chart-2: "#a87c0a"          # gold — the original, brighter shade; a slice needs 3:1, not the 4.5:1 that darkened gold for text
  chart-3: "#3a5a8c"          # indigo
  chart-4: "#8b2e2e"          # claret
  chart-5: "#6b4d8c"          # aubergine
  chart-6: "#a8651f"          # burnt orange
  chart-7: "#8a9690"          # neutral grey — "No method recorded"; its own value, not ink-muted
  chart-8: "#4a4640"          # dark neutral — "Other / unlisted"; darker than chart-7 so the two neutrals differ by lightness

# Dark-mode token overrides. Same semantic names; different values.
# Every token in `colors` has its dark value below. The scrim and the two
# shadows are not in `colors` but change too; see Elevation & Depth.
colors-dark:
  # --- Surfaces ---
  bg: "#15110a"               # Warm near-black — slight gold cast keeps the "civic" register
  surface: "#1f1a10"           # Cards/modals — one step lighter than bg
  surface-soft: "#28221a"      # Hover fills (tabs, table rows, ghost buttons, Find-donor matches), hints, help notes, method badges without their own tint
  surface-sunken: "#1a160e"    # Progress-bar track, loading skeleton — just above bg (1.04:1)

  # --- Ink (text) ---
  ink: "#f1ebd8"              # Warm off-white. Never pure white.
  ink-soft: "#c5bda3"          # Body, secondary labels
  ink-muted: "#958c79"         # Metadata, captions, field hints

  # --- Rules and dividers ---
  rule: "#3a3320"             # Warm dim brown-gold, low contrast
  field-border: "#7a6d4b"      # Input borders only, 3:1 on surface
  rule-strong: "#5a4f30"       # Table and help-table header rules, chip borders, secondary-button hover borders, modal scrollbar thumb

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
  danger: "#d67070"            # Lifted so errors and the Delete label reach 4.5:1
  danger-tint: "#3a1818"

  # --- Payment method palette (lifted versions) ---
  payment-cash: "#5a9b6f"
  payment-bank: "#7591c4"
  payment-card: "#9b7ec4"
  payment-online: "#d4914a"

  # --- Chart palette (lifted for dark) ---
  chart-1: "#5a9b6f"
  chart-2: "#d4af37"
  chart-3: "#7591c4"
  chart-4: "#c65656"
  chart-5: "#9b7ec4"
  chart-6: "#d4914a"
  chart-7: "#8a8270"
  chart-8: "#c9c1ad"            # lighter than chart-7 here, again further from the page

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

rounded:
  none: "0"
  sm: "6px"      # buttons, inputs, toasts
  md: "12px"     # cards, modals, table containers
  lg: "20px"     # unused; kept on the scale for a future large display surface
  full: "9999px" # badges, chips, progress bars, swatches

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
    textColor: "{colors.ink}"
    borderColor: "{colors.emerald}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  badge-inactive:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.ink}"
    borderColor: "{colors.warning}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "2px 10px"

  badge-category:
    backgroundColor: "{colors.gold-tint}"
    textColor: "{colors.ink}"
    borderColor: "{colors.gold}"
    typography: "{typography.meta}"   # at eyebrow weight (600), tracking (0.12em) and in caps
    rounded: "{rounded.full}"
    padding: "2px 10px"

  payment-badge-cash:
    backgroundColor: "{colors.emerald-tint}"
    textColor: "{colors.ink}"
    borderColor: "{colors.payment-cash}"
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
- **`surface-soft` (#f5f1e8) and `surface-sunken` (#efe9d9) — recessed creams.** Hover fills, hints and help notes; the progress track and loading skeleton. Always darker than the page in light mode. In dark mode they sit slightly above `bg`, like the cards. Inputs stay on `surface`.
- **`ink` (#1a2e1f) — deep forest.** Primary text and headings. *Not pure black* — black on warm ivory is harsh. Forest pairs with the ICG dome and softens the contrast to something paper-like.
- **`ink-soft` (#5a6b5f) and `ink-muted` (#65716a) — body and metadata.** A two-step text hierarchy below ink. All three reach WCAG AA (4.5:1) on `bg`, `surface` and `surface-soft` in both themes; `test/styles/contrast.test.ts` checks the faintest of them, `ink-muted`, on each. `ink-muted` carries text volunteers need — field hints, the only column labels on phones, "Showing N of M" — so it is the lightest shade of its grey-green that still reaches 4.5:1 on `surface-soft` (the hover and focus fill behind a phone number in Find donor's matches). That keeps it a half-step lighter than `ink-soft` rather than merged into it, but the two are close: size (12px metadata against 15px body) now carries most of the hierarchy. The earlier `#8a9690` measured only 2.9:1.
- **`rule` (#e8e0cc) — soft sand.** Hairline dividers. The single most-used non-ink color in the system. Replaces the dark theme's rgba-white borders entirely.
- **`field-border` (#948a6e) — input edges.** A field's white fill matches the card or dialog it sits on, so its border is the only thing that shows where to type. `rule` there measured 1.3:1; this reaches the 3:1 WCAG asks of a control's edge. Used only by inputs; `rule` stays for hairlines.
- **`gold` (#926c09) — antique gold.** *Used sparingly.* Section underlines, KPI numbers, the brand wordmark gradient, focus rings. Never a button background. Antique (not bright) so it reads "civic emblem," not "Web3 token." It is also ordinary-sized text in two places, the Summary totals (22px on phones, below WCAG's 24px "large text") and the numbers in the Help guide's contents and steps, so it is the lightest shade of its gold that reaches 4.5:1 on `bg` (4.8:1 on `surface`); `test/styles/contrast.test.ts` checks both. The original `#a87c0a` measured 3.6:1 and survives only as the ring's gold slice (`chart-2`), which is not text and needs 3:1.
- **`emerald` (#2d5e3e) — forest green.** Primary CTA color, success states, progress fills. Echoes the ICG logo's dome. Calm and assertive.
- **`warning` (#9c6b1f) and `danger` (#8b2e2e) — burnt amber and subdued claret.** Functional colors held back from saturation so they don't dominate. A delete button should look serious, not panicked.

The **payment method palette** (emerald, indigo, aubergine, burnt orange) colours the Method badges wherever payments are listed (the Payments list and a donor's payment history in Find donor), by method name: Cash and Online as a border, Bank Transfer and Card as text. Other methods get a plain badge. The Summary's ring and its key use the `chart-*` palette instead.

The **chart palette** is reusable across visualizations. Drawn from the same six muted hues; no two adjacent slices clash. Each listed payment method takes the colour of its place in the Settings list (the first `chart-1`, the second `chart-2`, and so on, starting over after six), so a method keeps its colour while a method listed before it has no money yet. A seventh, neutral grey (`chart-7`) marks payments with no method recorded. It keeps its own value rather than borrowing `ink-muted`, which is now dark enough for text and would sit too close to the emerald Cash slice. An eighth, darker neutral (`chart-8`) marks "Other / unlisted" money, recorded under a method since removed from Settings; it never borrows a real method's colour, and it differs from `chart-7` by lightness because the two can sit side by side. The list badges keep their own `payment-*` colours by method name, so a badge and its ring slice need not match.

### Dark mode — the same logic, recalibrated

Dark mode isn't a 1:1 inversion. Every token was chosen for its specific semantic role on the new background.

- **`bg` (#15110a) — warm near-black.** Slight gold cast. Same reasoning as light's warm ivory: the page should feel like a material object (paper or vellum scroll), not a screen. Pure black would read "tech product."
- **`surface` (#1f1a10) — cards/modals.** One step lighter than `bg`. Cards lift via brightness, not heavy shadows — same approach as light, just inverted.
- **`ink` (#f1ebd8) — warm off-white.** *Never pure white.* Pure white on dark is harsh, overconfident, and reads "Twitter at 3am." A warm cream pairs with the `bg` and feels like ink on a dark page.
- **`gold` (#d4af37) — brighter antique gold.** The light-mode `#926c09` would read as a dim brown on dark. Lifted to retain readability while still antique-not-neon.
- **`emerald` (#5a9b6f) — lifted forest green.** A deep #2d5e3e on a dark surface reads as a hole. The dark-mode emerald is more saturated and lighter so it still says "go button" without screaming.
- **`rule` (#3a3320) — dim warm brown-gold.** Hairlines on dark are a balance: too bright reads "wireframe," too dim disappears. This walks that line. Inputs use `field-border` (#7a6d4b) instead, for the same 3:1 edge as in light.
- **`ink-muted` (#958c79) — metadata.** Lifted from the first dark value (#8a8270), which fell to 4.1:1 on `surface-soft`.
- **`danger` (#d67070) — lifted claret.** Field errors, error toasts, the Delete button's label and a not-counted donor's name all need 4.5:1 against the dark surface or the danger tint. The first dark claret (#c65656) reached only 4.0:1 and 3.7:1.

The brand wordmark gradient (`gold → emerald`) uses the dark-mode token values, so it stays readable on the dark background.

The **chart palette** is lifted across the board — the payment-method ring uses the dark `chart-*` values automatically, because its gradient names the CSS variables rather than their values, so a theme switch recolours it without a redraw.

**Print mode forces light theme.** A printed report on paper should always look like the light theme regardless of what the screen showed; the dark tokens are declared inside `@media screen` in `tokens.css`, so print always gets the light `:root` values. Keep any new dark token inside that block.

## Typography

**Two voices:**

1. **Display — Cormorant Garamond.** A refined serif used only for h1/h2. Carries the "annual report" gravitas. Used sparingly — typography is a spice, not a sauce.
2. **UI — Inter.** All body, labels, controls, KPI numbers. Proven workhorse, excellent tabular numerals.

**Arabic.** No Arabic face is loaded, because the app's own wording has no Arabic. Donor names and notes typed in Arabic script show in the device's own Arabic font. Free-text boxes (name, amounts, goal), the notes box and the search boxes carry `dir="auto"` so such text runs right-to-left; phone, date and choice fields are left alone.

**Hierarchy is shallow on purpose.** A civic site is read sequentially, not scanned for action. The KPI cards use `numeric-xl` for the value and `eyebrow` (uppercase, letter-spaced) for the label — that single contrast carries most of the page's information density.

**Tabular numerals everywhere.** Money columns must align. `font-feature-settings: 'tnum'` is on every `numeric-*` and `eyebrow` token.

**No all-caps display headings.** Eyebrow labels are caps; everything else is sentence case. All-caps display reads aggressive and dates the page.

## Layout

**Container:** 1080px (`--container`), widening to 1200px (`--container-wide`) on Pledges and Payments so their tables fit. A tighter content well reads as more dignified, easier to scan, more like a printed page.

**Page rhythm:** page padding is `xl` top, `md` sides and `2xl` bottom. Cards and sections in a view sit `lg` (24px) apart.

**Modals** are `min(560px, 100vw - 32px)` wide (sign-in 440px), with their height capped at `100dvh - 32px`.

**Spacing scale follows an 8pt grid** (xs=4, sm=8, md=16, lg=24, xl=40, 2xl=72, 3xl=120). Layout spacing (page padding, and the gaps between cards, sections and controls) uses these tokens. Component insets are fixed values, and not all of them sit on the scale: the button, input, badge, stat-card and modal padding given in the component specs above, table cells at `8px 12px` and chips at `4px 12px`.

**Stat grid:** the Summary stat cards use `repeat(auto-fit, minmax(200px, 1fr))` with a 24px gap, which puts all four in one row on desktop. Cards breathe.

**Breakpoints.** "On phones" means `max-width: 720px` (two-row nav, table rows as stacked cards with a Sort by list, stat cards two to a row, 24px modal padding). Between 721px and 900px the signed-in email is cut short with an ellipsis; at 720px and below it is hidden. The tightest layout is `max-width: 340px`, for WCAG's 320px reflow width.

**Targets.** `.btn` is at least 40px tall, and inputs 44px, at every width. At 720px and below, buttons, tabs, chips (filter and status) and Find donor's matches are at least 44px tall.

**Motion.** Transitions are short state changes only (150ms, or 200ms for the progress fill). Under `prefers-reduced-motion: reduce`, `base.css` cuts every transition and animation to 0.01ms and turns off smooth scrolling.

## Elevation & Depth

**No glass morphism, no `backdrop-filter: blur()`, and no translucent panels.** These are out — they read tech-product, and they print badly. The one semi-transparent layer is the modal scrim (see Modals), which dims the page without blurring it.

**Two-tier shadow system:**

- **Resting card:** `box-shadow: 0 1px 2px rgba(26, 46, 31, 0.04), 0 4px 16px rgba(26, 46, 31, 0.05);` Barely there. The card is grounded, not floating.
- **Modal / hovered card:** `box-shadow: 0 4px 8px rgba(26, 46, 31, 0.06), 0 16px 40px rgba(26, 46, 31, 0.10);` Lifts moderately, never dramatically.

In dark mode the tiers are `0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.25)` (rest) and `0 4px 8px rgba(0, 0, 0, 0.35), 0 16px 40px rgba(0, 0, 0, 0.45)` (lift), and the modal scrim is `rgba(10, 8, 4, 0.55)`, a warm near-black, not the forest tint.

**Hairline rules do most of the structural work.** A `1px solid rule` (#e8e0cc) above a section is more dignified than a shadow.

## Shapes

**Border radius is restrained.** `sm` (6px) for buttons, inputs and toasts; `md` (12px) for cards and modals; `full` (9999px) for badges, chips, the progress bar and the swatches. `lg` (20px) stays on the scale but is unused.

**No `2xl` or `3xl` rounding.** The previous design overused 16px+ rounded corners which reads "consumer mobile app." Smaller radii read more institutional.

**Buttons are slightly less rounded than cards** so they feel like distinct affordances inside a card, not echoes of it.

## Components

**Primary button** (`button-primary`): emerald background, white text, `sm` radius, label typography. The single most-used affordance — Save, Add pledge, Log a payment, and Sign in again on the signed-out screen. Hover lightens slightly to `emerald-soft`. No drop shadow on buttons. No gradients.

**Secondary button** (`button-secondary`): white surface, ink text, `1px solid rule` border. For Cancel, Download .xlsx, Call/Text.

**Ghost button** (`button-ghost`): transparent, ink-soft text, no border. For inline edit/delete affordances inside dense lists.

**Danger button** (`button-danger`): claret background, white text. Used for irreversible actions. Confirms through `confirmDialog` (`web/src/ui/dialog.ts`), a themed "Please confirm" modal with a secondary Cancel and a danger button. A pledge's Delete message says what happens to its payments: they stay matched to another pledge with the same phone, or there are none, or they will show "⚠ phone not in Pledges", and when they counted it adds how many and their total. The same danger button confirms Discard (a half-typed form, whose cancel reads "Keep editing") and Sign out anyway. Native `confirm()` is never used, because on mobile it opens as a full-screen prompt.

**Inputs** (`input`): white surface, `1px solid field-border` border, focused state replaces border with `1px solid emerald` and adds a 3px `emerald-tint` outline ring. No fake "filled" backgrounds — inputs read as paper fields.

**Cards** (`card`): white surface, `1px solid rule` border, two-tier resting shadow, `md` radius, 24px padding. The fundamental container.

**Stat cards** (`stat-card`): same as card but with `eyebrow`-styled label above and `numeric-xl` value below in `gold`. The Summary's KPI row uses this four times (Total pledged, Total received, Balance outstanding, Overpaid / credit), all in one row on desktop. On phones the cards pair up two to a row and the value drops to 22px so a five-figure total fits beside its neighbour; at 340px and below they stack in one column, because side by side at 320px a card has only about 100px for a total like $14,450.00 and it would spill over the card's edge.

**Progress bars** (`progress-track` + `progress-fill`): 6px tall, `full` radius, `surface-sunken` track inside a 1px inset `ink-muted` ring, `emerald` fill (the system `Highlight` in forced colours). The sunken track alone barely differs from the card (1.21:1 in light, 1.04:1 in dark), so without the ring the unfilled part vanishes and the bar has no visible end.

**Modals**: `surface`, `md` radius, second-tier shadow, scrim is `rgba(26, 46, 31, 0.20)` (deep forest at 20% opacity; warm near-black `rgba(10, 8, 4, 0.55)` in dark) — *not* black. The forest scrim keeps the warm ivory atmosphere even when a modal is open. A long form scrolls inside the modal under its pinned Save/Cancel row, so the modal carries a bottom `scroll-padding` a little taller than that row (104px; 152px on phones, where an open pledge's four buttons wrap to two rows): a field reached with Tab scrolls clear of the buttons instead of stopping underneath them (WCAG 2.4.11, focus not obscured). Its height is capped with `100dvh` as well as `100vh`, so it fits above a phone browser's toolbar.

**Nav bar**: sticky, filled with `bg` (opaque, so the list scrolls under it cleanly), with no separator or shadow, just padding (`md` `lg`; `sm` `md` 0 on phones). Because it is sticky, the page carries a top `scroll-padding` a little taller than it (88px; 136px on phones, where the tabs take a second row): a control reached with Tab or Shift+Tab, or a Help section jumped to from its contents, stops below the nav instead of underneath it. Nothing else adds its own offset, because a `scroll-margin` would stack on top of this one. The toasts, fixed to the bottom of the screen, get the same treatment from below: while one is showing (a failed save's stays until it is dealt with), the page's bottom `scroll-padding` follows the stack's height, and the page gains that much room at its end, so a row reached with Tab stops above the toasts, never under them. The desktop value assumes the nav keeps to one row, so between the phone layout and 900px, where the actions are tightest, the signed-in email is cut short with an ellipsis (8rem) rather than letting a long address push the actions onto a second row. On phones the five tabs share the second row, which scrolls sideways with its scrollbar hidden, so a tab that doesn't fit is cut off with no sign it is there. They fit a 360px phone as they are; at 340px and below (320px is WCAG's reflow width: a small phone, or a larger one with Display Zoom) they tighten to 12px text and 2px side padding, which still leaves every tab over 24px wide and 44px tall. The wordmark link is held to at least 24px tall for the same reason (WCAG 2.5.8): its line is only 21.6px, and below about 352px the action buttons wrap in so close under it that its spacing no longer makes up the difference.

**Tables**: rows are 48px tall minimum, separated by 1px `rule` dividers (no zebra striping — strips scream "tech app"), header row uses `eyebrow` typography with letter-spacing. The sorted column's heading turns `ink` and gains a ▲ or ▼ arrow, so the direction never rests on colour alone. On phones the header row is removed, since each card labels its own values, and a **Sort by** list above the table takes over sorting. A row tinted `danger-tint` (a duplicate pledge, a payment that isn't counted) switches its `ink-soft` and `ink-muted` text to `ink`, because in the light theme neither reaches 4.5:1 on the tint. A cell tinted `warning-tint` (a payment dated in the future) does the same for its column label on phones, which in `ink-muted` falls below 4.5:1 in both themes. Neither tint is ever the only sign, since both are too pale to see on a dim phone or by a colour-blind volunteer: a duplicate donor reads "· Listed more than once" after the phone number, a payment that is not counted has its `⚠` warning in Donor Name, and a future date reads "(future)".

**Charts** (no chart library): the Summary's one chart, money collected by payment method, is a ring drawn in CSS: a `conic-gradient` with a hard stop between slices, each slice sized by its method's share and coloured `var(--chart-N)`, and the hole cut out with a `mask` so the card shows through. It is an image to screen readers (`role="img"` with a label), and the table beside it carries every amount, so it has no hover tooltip. Very small slices can look slightly soft at their edges. It and its key print in colour (`print-color-adjust: exact`), since browsers otherwise leave backgrounds off paper. A future chart with axes drops its grid lines to `rule` at 50% opacity, uses `ink-muted` for tick labels, and takes its colours from the `chart-*` palette.

**Status chips** (`chip-toggle`): the Pledges status filter. A pill with a `surface` fill, an `ink-soft` label and a `rule-strong` border; pressed, it is an `emerald` fill with `surface` text, and `aria-pressed` carries the state.

**Filter chip** (`chip`): the "Showing: X ×" pill a Data-health **Show** puts on a list, on `gold-tint` with a `rule-strong` border and `ink` text.

**Toasts**: `surface`, `sm` radius, lift shadow, with an `emerald` (info) or `danger` (error) border and text. The stack is fixed bottom-centre, `min(480px, 100vw - 32px)` wide, and scrolls past 50vh.

**Banner** (offline and version strips under the nav): `warning-tint` with `ink` text and a `warning` border.

**Friday-prayer display mode** (`body[data-display="friday"]` + `.friday-*` classes): a full-screen presentation mode for projecting the drive during jumu'ah announcements. Opened from the Summary's **Friday display** link (`#display`); an old `?display=friday` link is rewritten to `#display`, and any other parameter (such as `campaign`) is ignored. It replaces the whole app shell (nav and tabs; toasts are hidden via `body[data-display] .toasts`) with a centred stack: eyebrow (Islamic Center of Greensboro) → title (the Settings tab's `campaignName`, or "Fundraiser" when blank) → progress bar → the amount raised in whole dollars, rounded down ("of $Y" added when a goal is set) → the floored percent (only when a goal is set) → the pledged-donor count. An Exit link sits top right, and a status row at the bottom shows the Updated time and, once the figures are over 15 minutes old, a warning-outlined "tap to reconnect" note. All type sizes use `clamp()` against existing palette tokens — no new design system primitives, just a layout repurposing of what's already there. Inherits the user's saved theme (no force-light) so a hall with controllable lighting can run dark mode if that suits the projector better. Its progress bar is taller, with a `rule` track inside a 2px inset `ink-soft` ring (5.4:1 on `bg` in light, 10:1 in dark): even `rule` is only 1.25:1 against the page (1.5:1 in dark), too faint for the bar's end to show through a projector in a lit hall.

## Do's and Don'ts

### Do

- **Lead with whitespace.** Every section should feel calm at first glance. If a screenshot looks crowded, remove something.
- **Use `gold` like a punctuation mark.** Never as decoration. A hairline gold rule under each page title (and the Friday display's title); the gold totals (Summary's stat cards and received figure, Friday's raised amount); the wordmark gradient. Beyond those, gold only marks things: focus rings, the current tab's underline, the Overpaid badge's border, and in Help the contents and step numbers, the +/− on each section and the note rule.
- **Use `emerald` as the action color.** Anything the user clicks to commit (save, sign in, contribute) is emerald. Consistency builds confidence.
- **Pair Cormorant with Inter.** Display headings serif, everything else sans. Never mix serifs into body text.
- **Right-align money.** Every numeric column. Tabular numerals. Bold only the most important number on each row.
- **Use sentence case in all body and headings.** Eyebrow-styled text (stat, section and page labels, the Summary's "Updated …" line, table headings, the column labels on phones, the Overpaid badge) is uppercase. That's the only place caps appears.
- **Print like a real document.** The print stylesheet is a first-class concern — the report should look like a board-meeting handout when it comes out of the printer. A handout says when its figures are from (the Summary's "Updated …" line prints) and never asks the reader to tap anything: an on-screen prompt goes in a `.screen-only` element, which print hides. A printed list says what it is: the filter the on-screen controls show, and how many rows a paged list left out, go in a `.print-only` element, which the screen hides. A donor's Find donor card prints as a statement for them: a `.print-only` heading (the masjid's name and the date printed) and a Total paid line are added, and what is written for volunteers (notes, warnings, the search) carries `.print-hidden`, which the print block hides in Find donor only. A figure never lives only inside a button, since print hides every `.btn` (and the toolbars and chip row): each Data-health check shows its count as its own number, with **Show** beside it. Colours that carry meaning (the goal bar, the payment-method ring and its swatches, a flagged check's warning rule) are marked `print-color-adjust: exact` in one place, `base.css`'s print block, so they still print when the browser's "Background graphics" option is off.
- **Trust hairline rules.** A single `1px solid rule` line does more work than a heavy divider, gradient, or shadow.

### Don't

- **Don't use glass morphism, `backdrop-filter: blur()`, or translucent panels.** They date the design and print poorly. The one semi-transparent layer is the modal scrim, which dims the page without blurring it.
- **Don't add gradients except on the wordmark.** The brand wordmark uses a `linear-gradient(to right, gold, emerald)` for the "ICG Fundraiser Tracker" wordmark only. Nothing else gets a gradient. (The payment-method ring is drawn with a `conic-gradient`, but its hard stops leave every slice one flat colour; nothing blends.)
- **Don't use neon or saturated brand colors.** All colors in this system are muted antique versions of their references. If a color looks bright, it's wrong.
- **Don't decorate.** No icon next to every label. No shimmer animations. No drop shadows on text. No emoji as section dividers.
- **Don't use bg-clip text** *except for the wordmark.* It's a brand signature, not a heading style.
- **Don't add geometric Islamic patterns.** We discussed this — we picked the restrained register, not the decorative one. A pattern background on the page would tip into "Islamic-themed template." The dignity comes from typography and whitespace.
- **Don't animate things that don't need to move.** The Summary redraws on every save, so its payment-method ring appears without a fade or sweep that would replay each time. Anything else (numbers counting up, cards floating in, parallax) breaks the institutional register.
- **Don't pure-black anywhere.** All black text and fills are `ink` (#1a2e1f). The one exception is dark mode's shadows, which use black at partial opacity. A subtle warmth keeps the page feeling printed.

## Implementation notes

- **CSS variables carry colour, spacing and shape.** Colours (both themes), the scrim, the two shadows, spacing, radii, the two container widths and the two font families are `:root` custom properties in `web/src/styles/tokens.css` (`--color-ink`, `--space-lg`, `--radius-md`, etc.). The type scale is not mirrored as variables. It lives as classes in `base.css` (`.display-lg`, `.display-md`, `.heading-md`, `.body-md`, `.label`, `.meta`, `.eyebrow`/`.stat-label`, `.numeric-xl`, `.numeric-lg`). Component-specific sizes (tabs, buttons, table headers, the modal title, Help, the Friday display's `clamp()` sizes) are literals in `components.css`. No hex or `rgba()` value appears outside `tokens.css`.
- **A few copies of the palette live outside the variables.** Browser chrome and install metadata cannot read CSS variables, so `bg` (light `#fbf9f3`, dark `#15110a`) is copied by hand into `web/index.html`'s two `theme-color` metas and `web/public/manifest.webmanifest`'s `background_color`/`theme_color`. The icons in `web/public/icons/` (the two SVGs, and the PNGs rasterised from them) use the light `bg`, `ink` and `chart-2` values. Change them together with the token, and re-export the PNGs when the icon colours change.
- **High-contrast themes are honoured, not fought.** Windows high-contrast themes (`forced-colors: active`) swap every colour for the viewer's own and drop backgrounds to the page colour, so anything shown only as a fill would vanish. One `@media (forced-colors: active)` block at the end of `components.css` paints the progress fill and the pressed status chip in the system `Highlight` colour (the chip filled, not outlined, so its focus ring still shows, and that ring set back to `Highlight`: opting the chip out of the theme would otherwise leave it brand gold), underlines only the current tab, and keeps the payment-method ring and its key's dots in the chart's own colours (the theme would drop the ring's gradient outright, and the key must still match it). System colour keywords (`Highlight`, `Canvas`) follow the viewer's theme, so they are the one colour value allowed outside the variables.
- **Accessibility claims are checked, not just written down.** `test/styles/contrast.test.ts` (inside `npm run check`) holds the token pairs above to their ratios in both themes. The e2e suite runs axe's WCAG 2.0–2.2 A and AA rules on every tab in both themes at 360px, and again at 320px in the light theme, where the tighter layout changes the spacing its target-size rule measures (`e2e/accessibility.spec.ts`), and checks reflow at 360px and 320px: no sideways page scroll, all five tabs inside their strip, and each Summary total inside its card (`e2e/no-overflow.spec.ts`).
- **Chart colours are CSS variables, not values read by script.** The payment-method ring's gradient names `var(--chart-N)`, so it follows the theme with no listener and no redraw.
- **Plain CSS, built by Vite.** There is no Tailwind. `web/src/styles/tokens.css` holds the tokens, and `base.css` and `components.css` take every colour from them (the forced-colors system keywords above are the one exception). The fonts are self-hosted npm packages, `@fontsource-variable/inter` and `@fontsource/cormorant-garamond` at weight 500. `web/src/main.ts` imports them and `vite build` bundles them.
