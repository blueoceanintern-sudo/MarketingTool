# DESIGN.md — BlueOcean Automated Marketing Tool

> Extracted from Google Stitch output. Use alongside CLAUDE.md.
> Visual reference: Linear + Retool — clean, data-forward internal tooling.
> Viewport: 1280px minimum width. Desktop only. Light mode only (no dark mode in v1).

---

## 1. Colors

```css
/* Brand */
--primary:                #021745;   /* nav text, headings, CTA buttons, wordmark */
--ocean-light:            #4B6BB5;   /* secondary actions, links */
--secondary:              #405ba1;   /* secondary buttons, text links */
--ocean-wash:             #EDF1FA;   /* active nav bg, row hover, light fills */

/* Backgrounds */
--background:             #fbf8fd;   /* page background */
--surface:                #fbf8fd;   /* top bar */
--surface-container-lowest: #ffffff; /* cards, panels, table surfaces */
--surface-container-low:  #f5f3f7;
--surface-container:      #efedf2;
--grey-50:                #F7F8FA;   /* page bg, table header bg */
--grey-100:               #ECEEF2;   /* borders, dividers, badge bg */

/* Text */
--on-background:          #1b1b1f;   /* default body text */
--grey-700:               #3D4557;   /* table body text */
--grey-500:               #7D8799;   /* secondary labels, nav inactive, timestamps */
--grey-300:               #C2C8D4;   /* icon decorations, muted borders */

/* Borders */
--outline-variant:        #c5c6d0;   /* input borders */

/* Semantic */
--success:                #1A9E6B;   /* verified, positive, active badge text */
--success-bg:             #E8F7F2;   /* active/success badge background */
--warning:                #D4860A;   /* paused, follow-up badge text */
--warning-bg:             #FEF4E0;   /* warning badge background */
--danger:                 #C7322A;   /* spam alert, rejected, suppressed badge text */
--danger-bg:              #FDECEA;   /* danger badge background */
--neutral:                #5A6478;   /* draft badge text */
--neutral-bg:             #ECEEF2;   /* draft badge background */

/* Charts */
--secondary-container:    #97b1fd;   /* bar chart fill — inactive bars */
/* active bar uses --primary #021745 */
```

---

## 2. Typography

```css
/* Families */
--font-sans:  'DM Sans', sans-serif;         /* all UI text */
--font-mono:  'JetBrains Mono', monospace;   /* numeric data in tables only */

/* Icons: Material Symbols Outlined (Google Fonts) — no other icon set */
```

**Scale & role mapping:**

| Token | Size | Weight | Use |
|---|---|---|---|
| `text-xs` | 11–12px | 400 | Timestamps, metadata, badge text, chart axis labels |
| `text-sm` | 13px | 400 | Table body, secondary labels, nav items |
| `text-sm-medium` | 13px | 500 | Badge labels, table name cells |
| `text-base` | 14px | 400 | Body copy, descriptions |
| `text-base-semibold` | 14px | 600 | Button labels, table column headers |
| `text-lg` | 16–18px | 600 | Card/section titles |
| `text-xl` | 20px | 700 | Page titles |
| `text-2xl` | 28–32px | 700 | KPI stat numbers |
| `text-mono` | 13px | 400–500 | Numeric values in tables (JetBrains Mono) |

**Rules:**
- `DM Sans` for all UI text — never substitute Inter or system fonts
- `JetBrains Mono` for all numeric table data (sent counts, open rates, scores, CAC)
- Never use more than 2 typefaces
- Page titles: `text-xl`, bold, `--primary`
- KPI stat numbers: `text-2xl`, bold — `--primary` default, `--danger` for alert metrics
- Nav active item: `text-sm`, bold, `--primary`

---

## 3. Spacing & Layout

```css
/* Base unit: 4px */
--space-1:   4px
--space-2:   8px
--space-3:   12px
--space-4:   16px
--space-5:   20px
--space-6:   24px
--space-8:   32px
--space-10:  40px

/* Layout */
--sidebar-width:   220px
--topbar-height:   64px
--min-viewport:    1280px
--max-content:     1600px
```

**Grid rules:**
- KPI tiles: `grid-cols-5`, gap `space-4`
- Charts row: `grid-cols-12`, gap `space-8` — bar chart `col-span-8`, donut `col-span-4`
- Page padding: `p-space-10` (40px) on main canvas
- Section spacing: `mb-space-8` between major page sections
- Card internal padding: `p-space-5` (KPI tiles), `p-space-6` (charts, tables)

---

## 4. Component Patterns

### Layout Shell
- **Sidebar:** fixed, `220px`, white bg (`#ffffff`), right border `grey-100`, shadow `1px 0 3px rgba(27,45,91,0.08)`
- **Top bar:** fixed, `64px`, white bg, bottom border `grey-100`, left offset `220px`, z-index above content
- **Main canvas:** `ml-[220px]`, `pt-16`, `max-w-[1600px] mx-auto`, `p-space-10`

### Sidebar Nav
- Inactive: `text-grey-500`, hover `bg-ocean-wash`, `transition-colors 150ms`
- Active: `text-primary font-bold bg-ocean-wash` — full-width row highlight, no pill/indicator
- Every nav item requires a Material Symbol icon, `mr-3` gap
- Active press: `active:scale-[0.98]`
- Bottom user profile: separated by `border-t border-grey-100`, avatar `w-8 h-8 rounded-full`

### Buttons

```
Primary:    bg-primary (#021745), text-white, rounded-lg, px-space-4 py-space-2
            hover: opacity-90 | press: scale-[0.98] | leading icon optional

Outline:    border-primary, text-primary, rounded-lg, px-space-4 py-space-2
            hover: bg-ocean-wash | press: opacity-80

Icon-only:  p-1, text-grey-500
            hover: text-primary | no border
```

### Cards / Panels
- `bg-surface-container-lowest` (`#ffffff`)
- `rounded-lg` (4px)
- `shadow-[0_1px_3px_rgba(27,45,91,0.08)]` — this exact shadow only, never heavier
- Never nest cards inside cards

### KPI Stat Tiles
- 5 equal columns, white card, `p-space-5`
- Layout: label + icon row → large number → trend line
- Normal: number in `--primary`
- Alert/danger: add `border-l-4 border-danger`, number and trend in `--danger`
- Trend icons: `trending_up` (success green), `trending_flat` (warning amber), `trending_up` in danger context for negative movement

### Status Badges

```
Active:      bg-success-bg (#E8F7F2),  text-success (#1A9E6B)
Paused:      bg-warning-bg (#FEF4E0),  text-warning (#D4860A)
Draft:       bg-neutral-bg (#ECEEF2),  text-neutral (#5A6478)
Suppressed:  bg-danger-bg  (#FDECEA),  text-danger  (#C7322A)
Sent:        bg-neutral-bg,            text-neutral
```
- Shape: `rounded-full`, `px-2 py-0.5`, `text-sm-medium`
- Inline only — never use full-row color for status

### Confidence Score Badge (draft queue)
```
High  (score ≥ 70):  bg-success-bg, text-success  — "High"
Med   (score 40–69): bg-warning-bg, text-warning  — "Medium"
Low   (score < 40):  bg-danger-bg,  text-danger   — "Low"
```
Same shape as status badges.

### Tables
- Container: white card, `rounded-lg`, card shadow, `overflow-hidden`
- Header row: `bg-grey-50`, `text-grey-700 text-base-semibold`, `px-space-6 py-4`
- Body rows: `text-sm text-grey-700`, `divide-y divide-grey-100`
- Row hover: `hover:bg-ocean-wash transition-colors`
- Numeric cells: `font-mono` (JetBrains Mono), right-aligned
- Name cells: two-line stack — `text-sm-medium text-primary` + `text-xs text-grey-500`
- Action cells: icon-only buttons, centered, `text-grey-500 hover:text-primary`
- Pagination footer: `bg-grey-50 border-t border-grey-100 px-space-6 py-4`, left count + right chevrons

### Search Bar
- `bg-grey-50 border border-grey-100 rounded-lg px-3 py-1.5 w-96`
- Leading `search` Material Symbol in `text-grey-500`
- `focus:ring-0` — no focus ring

### Time Range Toggle (charts)
- Inactive: `bg-grey-50 border border-grey-100 text-grey-700 rounded px-2 py-1 text-xs`
- Active: `bg-primary text-white rounded px-2 py-1 text-xs`

### Charts
- Bar chart: inactive bars `secondary-container (#97b1fd)`, active/selected bar `primary (#021745)`
- Tooltip: dark bg, white text, tight padding, positioned above bar
- Donut: segment colors — success (positive), warning (follow-up), danger (negative), grey-100 (empty)
- Legend: dot + label + right-aligned percentage, `text-sm text-grey-700`
- Axis labels: `text-xs text-grey-500`

---

## 5. Brand Voice / Visual Tone

- **Clean and data-forward** — every element earns its place; no decorative elements
- **Navy + white** — authoritative, not aggressive; internal ops tool, not consumer-facing
- **Dense over airy** — reps scan tables all day; optimize for information density, not breathing room
- Closest references: **Linear** (sidebar polish, interaction feel) + **Retool** (table density, data layout)
- No illustrations, no empty state artwork, no gradients, no glassmorphism

---

## 6. Motion & Interaction

- All transitions: `duration-150 ease-in-out` — snappy, never bouncy
- Button press: `active:scale-[0.98]` — subtle tactile response
- Row hover: color transition only — no slide, lift, or shadow change
- No skeleton loaders in v1 — spinner or disabled state only
- No animated charts in v1 — static render only

---

## 7. Do's and Don'ts

**Do:**
- Use `rounded-lg` on all cards and buttons
- Use `shadow-[0_1px_3px_rgba(27,45,91,0.08)]` as the only card shadow
- Use `ocean-wash` for all row and nav hover states
- Use `JetBrains Mono` for every number displayed in a table
- Use Material Symbols Outlined for every icon — no Heroicons, no Lucide, no SVGs

**Don't:**
- Never use more than 2 typefaces (DM Sans + JetBrains Mono)
- Never use a shadow heavier than the defined card shadow
- Never color full table rows by status — badges only
- Never use `rounded-full` on buttons — only on badges and avatars
- Never add a sidebar nav item without a Material Symbol icon
- Never use gradients or glassmorphism anywhere
- Never build dark mode — light only for v1
