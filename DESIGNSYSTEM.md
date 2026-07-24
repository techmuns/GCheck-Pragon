# Design System & Ideology — Paragon Partners

A portable design reference distilled from a working, best-in-class investor
dashboard. Copy this file into any new project to inherit the **same look, feel,
and philosophy**. Everything here is real — every hex, font, and rule is lifted
from a shipped codebase, not invented.

> **The one-line north star:** *A compact, Bloomberg-style analytic surface —
> thin strokes, slim bars, tight cards — warmed by tinted, tone-coded colour.
> Calm, confident, decision-grade. Colour is always a signal, never decoration.*

---

## 0. The ideology (read this first)

Everything else in this file serves five ideas. If you only remember one section,
remember this one.

1. **Psychology-based design.** Every colour, number, and layout choice is made by
   asking *"where does the eye go, and what does this make the viewer feel or
   decide?"* Navy = intelligence / trust. Teal/green = growth / verified. Gold =
   premium / leadership. Rose/coral = risk. These meanings are consistent
   everywhere — a colour never means two things.

2. **Compact over chunky.** This is not a marketing infographic; it's a
   decision-grade analytic surface. Thin strokes, slim bars, thin donut rings,
   tight cards. Density with breathing room, never clutter.

3. **Storytelling, every section.** Every panel answers *"so what?"* — a clear
   takeaway, a "what changed", a next click. Plain-English labels on the surface;
   the precise technical term only as a quiet secondary.

4. **Radical honesty with data.** Show real, source-backed numbers only. Missing
   is never zero — it renders as an honest "n/a" marker. Period and basis labels
   are always truthful (FY25 ≠ Q3 FY25 ≠ TTM; premium ≠ profit). Never fabricate,
   never silently substitute.

5. **Premium finish, never flat.** No pure-white SaaS panels. Every surface carries
   a faint cool sheen, a tinted hairline, and a soft navy-tinted shadow. One calm
   easing curve across the whole app. Motion is a quiet state change, never a pop
   or a bounce.

---

## 1. Colour palette

### 1.1 Core brand + neutrals

| Token | Hex | Role |
|---|---|---|
| `navy.DEFAULT` | `#243F78` | Brand base |
| `navy.primary` | `#27457E` | **Dominant intelligence tone** — primary navy, the "selected" colour |
| `navy.deep` | `#172B4D` | Deepest navy — headings, shadow tint |
| `royal` | `#315AA9` | Bright navy accent |
| `muted.blue` | `#3D5F9F` | Secondary blue |
| `soft.blue` | `#EEF4FF` | Soft blue wash |
| `soft.border` | `#E1E6EF` | Hairline borders |
| `ice` | `#F4F7FC` | Pale surface |
| `ivory` | `#F6F4EF` | Warm surface |
| `surface.DEFAULT` | `#FCFCFB` | Layered base — **avoid pure white** |
| `surface.tint` | `#F6F9FD` | Cool surface tint |
| `surface.band` | `#F8F9FB` | Section band |
| `card` | `#FFFFFF` | Card base (always dressed with a sheen gradient, never bare) |
| `ink.primary` | `#26303F` | Body text |
| `ink.secondary` | `#6B7280` | Secondary / muted text |

### 1.2 Signal colours (the meaning layer)

The heart of the psychology system. These three carry *judgement*:

| Token | Hex | Meaning |
|---|---|---|
| `signal.positive` | `#2F855A` | Green — good / improving / verified |
| `signal.warning` | `#B7791F` | Amber-gold — caution / adjusted / pending |
| `signal.negative` | `#B94A48` | Muted red — risk / deterioration |

> **Soft red is reserved for risk / deterioration only.** Never use it for neutral
> "off" states, empty states, or decoration. That discipline is what makes it read
> as a genuine warning when it does appear.

### 1.3 Accent pops (each with a soft tint)

Institutional, signal-led accents. The `DEFAULT` is the ink/stroke; the `.soft` is
the fill/background wash.

| Accent | DEFAULT | soft |
|---|---|---|
| `teal` | `#168E8E` | `#E1F2F1` |
| `emerald` | `#2F855A` | `#E6F1EB` |
| `gold` | `#B7791F` | `#FBF3E2` |
| `coral` | `#C75D54` | `#F8ECEC` |
| `lavender` | `#6E7BD6` | `#ECEEFB` |
| `champagne` | `#B68B3A` (deep `#9C7430`) | `#F4ECDB` |

`champagne` is the **premium editorial accent** — gold hairlines, tooltip edge,
"spark" textures, nav-rail tint. Use it sparingly for the "advisor read" feel.

### 1.4 Tone-coded surface tints (card identity)

Cards get a colour identity by tone, applied as a diagonal gradient + tinted
hairline. Psychology is fixed:

| Tint | Gradient | Border | Meaning |
|---|---|---|---|
| `navy` | `#F4F7FC → #E0E9F6` | `rgba(39,69,126,0.24)` | Intelligence / analytical proof (dominant) |
| `slate` | `#FBFCFE → #E8EFFA` | `rgba(39,69,126,0.16)` | Supporting analysis |
| `teal` | `#FBFEFE → #E7F5F1` | `rgba(22,142,142,0.22)` | Verified / positive |
| `gold` | `#FFFDF7 → #F6EED9` | `rgba(182,139,58,0.26)` | Premium / advisor read |
| `rose` | `#FFFBFA → #FAE8E5` | `rgba(199,93,84,0.24)` | Risk / capital watch / exit overhang |

### 1.5 Canvas background (warm tonal wash)

The page is never flat grey. It's a warm mist with three faint tonal pools that
encode the brand psychology spatially:

```css
background-color: #F6F5F2;
background-image:
  radial-gradient(1100px 560px at 100% -10%, rgba(39, 69, 126, 0.045), transparent 60%),  /* navy · trust · top-right */
  radial-gradient(820px 460px at -8% 108%, rgba(22, 142, 142, 0.04), transparent 58%),     /* teal · growth · lower-left */
  radial-gradient(700px 420px at 52% 122%, rgba(182, 139, 58, 0.03), transparent 60%),     /* gold · leadership · foot */
  linear-gradient(180deg, #FAF9F6 0%, #F4F3EF 100%);
background-attachment: fixed;
```

### 1.6 Entity / series identity colours

When plotting multiple entities (companies, categories, series), give each a
**4-part identity** `{ key, tint, text, border }` and use it only on the *frame*
(strips, dots, bands, thin fills) — never as a heavy full-cell fill.

- **Focal entity** gets steady navy: key `#27457E`, tint `#EDF2FB`.
- Aggregates ("Total", "Others", "All") are deliberately **not** given a brand
  colour — they use a neutral grey (`#8C97A8` / tint `#F1F3F6` / text `#5A6677`)
  so real entities stand out and totals recede.
- A small muted rotation hashes any unpinned entity to a stable tone, e.g.
  `['#234A84', '#148A87', '#B68B3A', '#4D7EA8', '#6E7BD6']` cycled by index.

Reference series semantics (from the flagship chart): foundation metric = deep
navy `#234A84`, healthy/retained = teal `#148A87`, derived = steel blue `#4D7EA8`.

### 1.7 Status / QA colour coding

Solid, tone-coded status tints (opaque fills + a coloured dot):

| Status | Fill token | Dot |
|---|---|---|
| Fetched / available | `emerald.soft` | `#2F855A` |
| Calculated / info | `soft.blue` | `#3D7DD6` |
| Missing | `coral.soft` | `#C75D54` |
| Adjusted | `gold.soft` | `#B7791F` |
| Blocked / neutral | `slate-100` | `#94A3B8` |

Data-status pills follow the same psychology and **none uses red** except genuine
risk: available → emerald, pending → gold, not-disclosed → muted-blue,
source-missing → neutral ice.

---

## 2. Typography

| Stack | Family | Fallback | Use |
|---|---|---|---|
| `font-sans` | **Inter** | ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial | UI, labels, numbers, tables, charts |
| `font-display` | **Fraunces** | Georgia, ui-serif, serif | Headings, chart titles |
| `font-editorial` | **Cormorant Garamond** | Georgia, ui-serif, serif | Long-form written narrative only (theses, takeaways) |

- Body colour `#26303F`, antialiased.
- Inter uses character variants: `font-feature-settings: 'cv02','cv03','cv04','cv11'`.
- **Reset display/serif faces** to `font-feature-settings: normal; font-optical-sizing: auto` — the Inter `cvXX` tags map to wrong glyphs in Fraunces/Cormorant.
- **Numbers use `tabular-nums`** so figures align in columns.
- Labels run small and confident: `8px–11.5px`, `font-bold uppercase`,
  `tracking-[0.05em–0.08em]`. Chart titles ~`18px` on the display serif.

---

## 3. Surfaces, cards & shadows

**Rule: no card is ever flat white.** Every panel carries a faint cool sheen
gradient, a navy-tinted hairline, and a soft two-layer shadow.

```css
/* Standard card */
.card-surface {
  border-radius: 1.15rem;
  background-color: #ffffff;
  background-image: linear-gradient(159deg, #ffffff 0%, #fcfdfe 56%, #f6f9fd 100%);
  border: 1px solid rgba(23, 43, 77, 0.11);
  box-shadow:
    0 1px 2px rgba(23, 43, 77, 0.05),
    0 13px 30px rgba(23, 43, 77, 0.11);
}

/* Supporting tile */
.surface-soft {
  border-radius: 0.75rem;
  background-image: linear-gradient(180deg, rgba(255,255,255,0.7), rgba(244,247,252,0.6));
  border: 1px solid rgba(23, 43, 77, 0.06);
}

/* Premium hover — slight lift, deeper-but-soft shadow (opt-in) */
.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 6px rgba(23,43,77,0.05), 0 18px 40px rgba(23,43,77,0.1);
}

/* Selected / focal entity — findable without shouting */
.focal-mark {
  background-color: rgba(39, 69, 126, 0.06);
  box-shadow: inset 0 0 0 1.5px rgba(39,69,126,0.3), 0 4px 14px rgba(39,69,126,0.12);
}
```

**Named shadow scale** — all navy-tinted `rgba(23,43,77,…)`, never neutral grey:

| Token | Value |
|---|---|
| `soft` | `0 1px 2px /.05, 0 10px 24px /.08` |
| `card` | `0 1px 3px /.05, 0 16px 38px /.10` |
| `lift` | `0 18px 46px /.14` |
| `bar` | `0 3px 20px /.07` |

- Card padding convention: **`p-4 sm:p-5`** with tight label-to-value spacing.
- Extra radius token `xl2: 1.25rem`.
- The signature **navy control pill** (`.blob-btn`): navy gradient
  `linear-gradient(135deg, #1e4079, #14294c)` with an inset gold accent ring
  (`rgba(228,198,124,0.24)` resting → `~0.7` active). Navy fill + gold micro-accent
  is the app's button language.

---

## 4. Motion

**One calm easing curve, app-wide.** No bounce, no overshoot, no hard cuts.

```js
transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)', premium: 'cubic-bezier(0.22, 1, 0.36, 1)' }
transitionDuration:       { DEFAULT: '200ms', fast: '160ms', normal: '240ms', slow: '320ms' }
```

- Page/section changes: a quiet opacity fade + ~3–6px upward translate. The
  outgoing view fades out first, then the incoming fades in — never both loud.
- Reveals (accordions, drawers, cards) settle in with a fade + a few-px unfold.
- **Always honour `prefers-reduced-motion`**: collapse to a near-instant opacity
  fade, silence looping effects. Never a hard cut, never a slide/scale.
- Looping micro-motion (live pulses, glows, typing carets) stays *subtle* and is
  silenced under reduced motion.

---

## 5. Charts & data visualisation

Built on Recharts, but the rules are library-agnostic.

### 5.1 Geometry — "compact over chunky"

| Element | Rule |
|---|---|
| Line strokes | **≤1.8px** for data lines; `2–2.2px` only for emphasis |
| Bars (quarterly) | `maxBarSize ≤ 32` |
| Bars (annual) | `maxBarSize ≤ 42` |
| Bar corners | `radius={[3,3,0,0]}` |
| Bar gaps | `barCategoryGap="26%"`, `barGap={4}` |
| Donut ring | thin — `innerRadius ≥ 78%` of outer (e.g. inner 46 / outer 58) |
| Grid | horizontal only, `strokeDasharray="2 4"`, colour `#ECEFF5` |
| Axes | `tickLine={false}`, `axisLine={false}`, tick font `11px` fill `#6B7280` |

### 5.2 The honesty rules (non-negotiable)

- **Missing values are never zero.** If the source has `null`, omit the
  bar/line/segment (`value = null`) and render an honest marker — an italic `n/a`
  (font ~9, fill `#9AA6B6`) under the axis label, or a hatched sliver in the
  legend labelled "Missing = not disclosed". Never coerce `null → 0`.
- **Period labels are honest.** Tags and captions reflect the real underlying
  period (`FY25`, `Q4 FY25`, `TTM`). Never default a label to the current year
  just because it's convenient.
- **Premium ≠ profit.** Premium metrics (GWP/NWP/NEP) carry a basis tag so
  they're never mistaken for profit measures (PAT / underwriting result / combined
  ratio). Always label the basis.
- **Default states change with announcement only.** If the data underneath a
  default (active tab, default toggle, focal entity) changes, surface it — don't
  swap silently.

### 5.3 Tooltip polish

```css
.recharts-default-tooltip {
  border-radius: 12px;
  border: 1px solid rgba(229, 232, 239, 0.9);
  border-left: 2.5px solid rgba(182, 139, 58, 0.55);  /* champagne accent edge */
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  box-shadow: 0 10px 30px rgba(23, 43, 77, 0.12);
}
```

Delta values are coloured by sign: `+` green `#2F855A`, `−` coral `#C0584F`.
Null series are dropped from the tooltip entirely, not shown as 0.

---

## 6. Data-integrity ideology (the trust layer)

The visual polish is backed by honesty rules — the two are inseparable. Any
project adopting this system should also adopt these:

- **Real, source-backed data only.** Never silently fall back to mock or
  fabricated numbers.
- **No real data → ask, every time.** If source-backed data for a chart / metric /
  period isn't available, stop and ask how to proceed. Never fabricate, never
  substitute, never derive a misleading number from an incomplete basis.
- **Missing ≠ zero.** Render an honest "not available" marker, never a fake 0.
- **Honest basis labels.** A number on a different accounting basis is *not* a
  mismatch to be cross-filled — it's a distinct series.
- **Internal notes are not viewer content.** Data-lineage bookkeeping stays in the
  data files. The only note a viewer sees is one that explains why a value is
  *absent*.
- **A single authoritative source wins conflicts.** When sources disagree, define
  one canonical source (here: the investor presentation) as authoritative; keep
  the disagreeing source for the record without flagging the shown cell.

---

## 7. Quick-start: drop-in tokens

### Tailwind (`tailwind.config.js` → `theme.extend`)

```js
colors: {
  navy:    { DEFAULT: '#243F78', primary: '#27457E', deep: '#172B4D' },
  royal:   '#315AA9',
  muted:   { blue: '#3D5F9F' },
  soft:    { blue: '#EEF4FF', border: '#E1E6EF' },
  ice:     '#F4F7FC',
  ivory:   '#F6F4EF',
  surface: { DEFAULT: '#FCFCFB', tint: '#F6F9FD', band: '#F8F9FB' },
  card:    '#FFFFFF',
  ink:     { primary: '#26303F', secondary: '#6B7280' },
  signal:  { positive: '#2F855A', warning: '#B7791F', negative: '#B94A48' },
  teal:      { DEFAULT: '#168E8E', soft: '#E1F2F1' },
  emerald:   { DEFAULT: '#2F855A', soft: '#E6F1EB' },
  gold:      { DEFAULT: '#B7791F', soft: '#FBF3E2' },
  coral:     { DEFAULT: '#C75D54', soft: '#F8ECEC' },
  lavender:  { DEFAULT: '#6E7BD6', soft: '#ECEEFB' },
  champagne: { DEFAULT: '#B68B3A', deep: '#9C7430', soft: '#F4ECDB' },
},
fontFamily: {
  sans:      ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
  display:   ['Fraunces', 'Georgia', 'ui-serif', 'serif'],
  editorial: ['"Cormorant Garamond"', 'Georgia', 'ui-serif', 'serif'],
},
boxShadow: {
  soft: '0 1px 2px rgba(23,43,77,0.05), 0 10px 24px rgba(23,43,77,0.08)',
  card: '0 1px 3px rgba(23,43,77,0.05), 0 16px 38px rgba(23,43,77,0.10)',
  lift: '0 18px 46px rgba(23,43,77,0.14)',
  bar:  '0 3px 20px rgba(23,43,77,0.07)',
},
borderRadius: { xl2: '1.25rem' },
transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.22,1,0.36,1)', premium: 'cubic-bezier(0.22,1,0.36,1)' },
transitionDuration: { DEFAULT: '200ms', fast: '160ms', normal: '240ms', slow: '320ms' },
```

Load the fonts (Inter, Fraunces, Cormorant Garamond) via your font host of choice.

---

## 8. The checklist (paste into PRs)

- [ ] Colour used as a **signal**, meaning consistent (navy=intelligence,
      green=good, gold=premium, red=risk-only)?
- [ ] No pure-white flat cards — sheen gradient + tinted hairline + soft shadow?
- [ ] Strokes ≤1.8px, bars ≤32 (quarterly) / ≤42 (annual), donut ring ≥78% inner?
- [ ] `p-4` cards, tight label-to-value spacing, `tabular-nums` on figures?
- [ ] Missing data rendered as honest `n/a`, never `0`?
- [ ] Period + basis labels truthful (FY vs Q vs TTM; premium ≠ profit)?
- [ ] One calm easing, reduced-motion honoured, no bounce/pop?
- [ ] Every section answers "so what?" with a plain-English takeaway?
- [ ] Data is real and source-backed — or you stopped and asked?

---

*This document captures the design ideology of an investor-grade dashboard so a
new project can inherit the same feel from day one. Values are extracted verbatim
from the source implementation.*
