# LucidHire design system: "Highlighter"

**Status: LOCKED (owner, 2026-10-21).** The landing page prototype is the
final design. Every surface of the app follows this system: the landing
page, sign-in and onboarding, the dashboard, jobs, candidates, the public
apply portal, billing, empty states, errors and emails.

- **Source of truth:** `docs/design/landing-prototype.html` (open it in a
  browser). Published copy: https://claude.ai/artifact/2Ud5GXJALFR9VapxQqsPaA
  (version 14).
- **Build the landing page as it is.** Don't restyle, reorder or "improve"
  it. Changing a token, a motif or the landing layout needs the owner's
  explicit approval.
- **No one-off values.** Every colour, font, radius, shadow and easing in
  the app comes from the tokens below. If a screen needs something that
  isn't here, add it to this file in the same PR and say why in the PR
  description.
- Values marked **(derived)** don't appear on the landing page. They were
  worked out from it for app screens. Treat them as part of the system, and
  check them in the browser the first time they ship.

---

## 1. The idea

The product reads CVs and marks them up, so the interface looks like
marked-up paper on a desk.

- **Paper and ink.** Warm off-white paper, near-black ink, white sheets
  for documents, a grey desk with a dot grid behind them.
- **Yellow marker means "this matches" or "look here".** Matched skills,
  the top candidate, the current step, one phrase in each heading.
- **Pink marker means "this is missing".** Missing requirements and gaps.
  It is never used for decoration.
- **An ink ring goes around the score.** It marks the one number that
  matters on the screen.
- **Marks are earned.** If everything is highlighted, nothing is. Use at
  most one marked phrase per heading and one ring per screen.

---

## 2. Tokens

### 2.1 Colour

The light theme is canonical. The landing page is light only
(`color-scheme: light`), and its features section uses the night colours
as a dark band. The app supports light and dark.

| Token (app name) | Prototype name | Light | Dark (derived) | Use |
|---|---|---|---|---|
| `paper` | `--paper` | `#F5F5F1` | `#141414` | Page background |
| `paper-2` | `--paper-2` | `#ECECE5` | `#1E1E1C` | Hover fills, quiet panels |
| `desk` | `--desk` | `#E4E4DC` | `#1A1A18` | Stage behind documents (with the dot grid) |
| `sheet` | `--sheet` | `#FFFFFF` | `#222220` | Cards, CV sheets, popovers, inputs |
| `ink` | `--ink` | `#141414` | `#F5F5F1` | Headings, body text, primary buttons, borders that matter |
| `ink-2` | `--ink-2` | `#34342F` | `#D6D6CC` | Secondary text, ledes, nav links |
| `ink-muted` | `--muted` | `#5C5C55` | `#BEBEB4` | Metadata, labels, helper text |
| `ink-faint` | `--faint` | `#8C8C84` | `#8C8C84` | Rank numbers, disabled text, placeholders (see §7) |
| `line` | `--line` | `#D9D9D1` | `#373732` | Borders, dividers, slider tracks |
| `line-2` | `--line-2` | `#E8E8E1` | `#2A2A27` | Row dividers inside cards |
| `marker` | `--yellow` | `#FFE84A` | `#FFE84A` | Yellow highlight, selected chip, CTA band |
| `marker-soft` | `--yellow-2` | `#FFF4A8` | `#484320` | Large pale highlight areas |
| `gap` | `--pink` | `#FF9BC8` | `#FF9BC8` | Pink highlight for missing items |
| `gap-soft` | `--pink-2` | `#FFD6E8` | `#432F38` | Pale pink areas |
| `gap-ink` | `--pink-ink` | `#A3134F` | `#FF9BC8` | Text for gaps and errors |
| `on-marker` | (none) | `#141414` | `#141414` | Text on `marker` and `gap`. **Never flips in dark mode.** |

The night band on the landing page uses `--night #141414`,
`--night-2 #1E1E1C`, `--night-line #373732`, `--on-night #F5F5F1` and
`--on-night-2 #BEBEB4`. These are the same values as the dark theme above.

The app tokens are renamed from the prototype for two reasons. First,
shadcn/ui already uses `--muted` for a background colour. Second, `yellow`
and `pink` would sit beside Tailwind's palette of the same names. The
semantic names (`marker`, `gap`) also say what the colours mean.

### 2.2 Type

Two families, both variable:
- **Archivo** (`wdth` 62–125, `wght` 100–900) for display, headings, body
  and UI.
- **Fragment Mono** (400) for labels, metadata, file names and statuses.

The prototype loads both from Google Fonts. **The app self-hosts the woff2
files** and preloads the two used above the fold, so there's no
third-party request and no layout shift. Check that the Archivo build you
ship includes the width axis, because the condensed score numerals and the
wide headings depend on it.

| Role | Family and weight | Size / line height | `font-stretch` | Tracking | Where |
|---|---|---|---|---|---|
| Display XL | Archivo 830 | `clamp(40px,5vw,78px)` / .95 | 112% | -.04em | Hero h1 only |
| CTA display | Archivo 850 | `clamp(38px,6vw,86px)` / .95 | 116% | -.045em | Final CTA band |
| Section heading | Archivo 820 | `clamp(32px,4vw,58px)` / .98 | 112% | -.038em | Page and section h2, `text-wrap: balance` |
| Story heading | Archivo 780 | `clamp(27px,2.7vw,42px)` / 1.03 | 108% | -.028em | Large h3 |
| Card heading | Archivo 800 | 22–26px / 1.1 | 108–112% | -.02em | Card and plan titles |
| Panel heading | Archivo 800 | 17–19px / 1.2 | 108% | -.01em | Panels, list headers, dialog titles |
| Lede | Archivo 400 | `clamp(17px,1.45vw,20px)` / 1.55 | 100% | 0 | Intro paragraph, colour `ink-2` |
| Body | Archivo 400 | 17px / 1.55 | 100% | 0 | Paragraphs. App tables and forms may use 15px. Never below 13px. |
| UI | Archivo 500–650 | 15–16px / 1 | 100–104% | 0 | Nav (500, 15px), buttons (650, 16px) |
| Label | Fragment Mono 400 | 12px / 1.4 | n/a | .08em, uppercase | Eyebrows, column headers, kickers. Colour `ink-muted`. |
| Meta | Fragment Mono 400 | 11–13.5px / 1.3 | n/a | 0 | Role · city, file names, statuses, timestamps |
| Score numerals | Archivo 800 | 30px in rows, 64–116px hero | **62%** (condensed) | -.02em | Match scores and big counts |

Rules:
- Mono is for data and system voice. Never set a paragraph in mono.
- Headings use sentence case and end with a full stop on marketing pages
  ("We read every CV."). App headings are plain labels without the full
  stop ("Candidates").
- Use `·` (a middle dot with spaces) to separate metadata:
  `iOS Developer · Tokyo`.

### 2.3 Layout and spacing

- **Container:** `max-width: 1280px`, centred. Side gutters are
  `max(clamp(16px,4vw,56px), env(safe-area-inset-*))`.
- **Header:** 64px tall (58px at 900px and below). It's sticky, with
  paper at 90% opacity, `backdrop-filter: saturate(1.5) blur(12px)`, and a
  1px `line` shadow once the page scrolls.
- **Sections:** `padding-block: clamp(56px,7vw,104px)`. A section head is
  a 7fr / 5fr grid: the heading on the left, the intro paragraph on the
  right, aligned to the bottom.
- **Spacing:** use Tailwind's 4px scale. The common steps are 8, 12, 16,
  20, 24, 32, 48 and 64.
- **Breakpoints:**
  - **900px:** the hero and section heads stack, and the story stage pins
    on top.
  - **760px:** nav links collapse and only the CTA stays.
  - **560px:** single column.

  Everything works at 360px with no sideways scroll.
- **Touch targets:** at least 44 × 44px.

### 2.4 Radius

| Radius | Use |
|---|---|
| 3–4px | Paper sheets: CVs and documents |
| 6px | Chips, toggles, nav hover |
| 8px | Buttons, inputs, status pills (shadcn `--radius: 8px`) |
| 10px | Panels, lists inside sections |
| 12px | Cards, plan cards |
| 14px | Large stage surfaces |
| `.16em .34em .2em .3em` | Marker highlights (irregular on purpose) |

No pill-shaped (`rounded-full`) buttons. Round shapes are only for status
dots, avatars and slider thumbs.

### 2.5 Shadow

```css
--shadow-sheet: 0 1px 0 rgba(20,20,20,.05), 0 2px 4px -2px rgba(20,20,20,.12), 0 18px 32px -18px rgba(20,20,20,.32);
--shadow-card:  0 1px 0 rgba(20,20,20,.06), 0 18px 40px -28px rgba(20,20,20,.35);
--shadow-lift:  0 22px 44px -30px rgba(20,20,20,.55);   /* selected plan, dragged row */
--shadow-float: 0 34px 64px -30px rgba(20,20,20,.55), var(--shadow-sheet); /* popovers, dialogs */
```

In dark mode, shadows switch to `rgba(0,0,0,.5)` at the same offsets
**(derived)**. Separation comes mostly from the `sheet` colour and the
1px `line` border.

### 2.6 Motion

- `--ease-out: cubic-bezier(.2,.7,.1,1)` for entrances, hovers and
  highlights.
- `--ease-in-out: cubic-bezier(.65,0,.25,1)` for things that move from one
  place to another, such as re-ranking rows and cards sliding.
- **Durations:**
  - hover and colour changes: .2–.4s
  - marker sweeps: .5–.85s
  - ink ring and line drawing: 1s
  - reordering: about .6s
- **No animation library.** Use CSS transitions and keyframes, plus small
  `requestAnimationFrame` loops where scrolling drives the effect.
- **Nothing loops** except the live status dot, which blinks with
  `steps(2)`.
- **Reduced motion:** every animated element is complete at rest. Under
  `prefers-reduced-motion: reduce`, marks, rings and swipes render
  finished, and no information exists only in an animation.

**Keep text sharp.** These rules come from bugs fixed in the prototype:
- Never scale a container with text in it using `transform: scale()`. Use
  real sizes or CSS `zoom`, as the hero artboard does.
- Don't rotate cards that hold text people need to read. The tilted sheets
  in the hero are decoration.
- Entrance animations use `animation-fill-mode: backwards`, not `both`, so
  the element isn't kept on its own layer after the animation ends.
- Pointer parallax moves decorative layers only.

---

## 3. Signature motifs

These are what make the product recognisable. Reuse them exactly.

**Marker highlight** (`.mk`): a slightly slanted band behind the text,
covering 68% of its height and sitting low.

```css
.mk{--mkc:var(--marker);background-image:linear-gradient(101deg,transparent .06em,var(--mkc) .15em,var(--mkc) calc(100% - .16em),transparent calc(100% - .05em));background-repeat:no-repeat;background-position:0 64%;background-size:100% 68%;padding-inline:.1em;margin-inline:-.1em;-webkit-box-decoration-break:clone;box-decoration-break:clone;border-radius:.16em .34em .2em .3em}
.mk.mk-gap{--mkc:var(--gap)}       /* prototype: .mk.pk */
```

- Sweep it in by animating `background-size` from `0% 68%` to
  `100% 68%`.
- Text on a mark is always `on-marker`.
- In app UI, use it for matched requirements, the selected filter or step,
  and the top result. Use it for one phrase per marketing heading.

**Ink ring:** a hand-drawn loop around the main score. It's an SVG path
with `pathLength="1"`, `stroke: ink`, `stroke-width: 3.2` and round caps,
drawn in by animating `stroke-dashoffset` from 1 to 0. **One per screen.**

**Evidence chips:** Fragment Mono at 12px. A found item gets a yellow
mark. A missing item gets a pink mark and a `✕` (`✕ Kotlin MP`). They
always show the text, so colour is never the only signal.

**Marker band on the top row:** the first-ranked row in a list gets the
wobbly yellow marker stroke behind it, with its score in a ring. Lower
rows are plain, and rows out of contention fade to 50% opacity.

**Highlighter swipe:** a broad, pale yellow stroke with chisel-cut ends,
pooled ink at both ends and faint streaks. It sits behind the hero
illustration. In the app, use it behind empty-state and onboarding
illustrations only. At most one per screen. Its source is the `.swipe`
SVG in the prototype.

**Desk and sheets:** documents (a CV preview, the parsed CV view) are
white sheets with a 3px radius and `--shadow-sheet`, on the `desk` colour
with a 22px dot grid:
`radial-gradient(rgba(20,20,20,.12) 1px, transparent 1.3px) 0 0/22px 22px`.

**Marker CTA band:** a full-width `marker` band with gently torn top and
bottom edges (the `clip-path` polygon on `.cta-band`). It's for the final
call to action on marketing pages. In the app, use it only for the
upgrade prompt.

**Live dot:** an 7–8px `ink` dot blinking with `steps(2)`. It means live
or processing, as in `● Reading cv_grace_turner.pdf · 2 pages`.

**Marker pen:** the logo mark and the pen on the hero headline. Don't use
it as a general icon.

---

## 4. Components

The web Worker uses shadcn/ui. Restyle its components to these specs; don't
use its defaults. The prototype class is the visual reference.

| Component | Spec | Reference |
|---|---|---|
| **Button, primary** | `ink` background, `paper` text, 2px `ink` border, 8px radius, 650 16px. Height 50px on marketing pages, 42px in the app (`.btn.sm`), 36px for compact buttons in tables. **Hover:** yellow fills in from the left (`background-size` 0 → 100%, .4s `--ease-out`), the text turns `ink`, and a trailing arrow moves 4px. | `.btn` |
| **Button, secondary** | Transparent background, `ink` text, same border and hover. | `.btn.ghost` |
| **Button, marker** | `marker` background, `ink` text. **Hover:** ink fills in and the text turns yellow. Use it only on the CTA band and the upgrade prompt. | `.btn.yl` |
| **Button, destructive** **(derived)** | Secondary button with `gap-ink` text and border. Hover fills with `gap-soft`. Always confirm in a dialog. | n/a |
| **Text link** | Inherits the text colour. Underline offset .18em, 1px thick. | `a` |
| **Nav link** | 500 15px `ink-2`, 12px padding, 6px radius. Hover: `paper-2` fill and `ink` text. | `.nav a` |
| **Card** | `sheet` background, 12px radius, `--shadow-card`, 24px padding. | `.how-card` |
| **Panel** | `paper` background, 10px radius, a 1px bottom shadow. Use it for grouped controls inside a card. | `.panel` |
| **Ranked list or table** | Rows divided by 1px `line-2` and 12px vertical padding. Rank in mono `ink-faint`. Name in Archivo 800, meta in mono 11–12px `ink-muted`. Score right-aligned in condensed numerals. The top row gets the marker band. | `.slist`, `.sl-row` |
| **Chip or toggle** | 34px tall, 1.5px `ink` border, 6px radius, 600 13px, `sheet` background. Selected: `marker` background with a drawn check. | `.chip`, `.chip.yes` |
| **Slider** | 8px track filled `ink` up to the value, `line` after it. Thumb is 28px, `marker` with a 3px `ink` border. | `.range` |
| **Plan card** | 1.5px `line` border, 12px radius. Selected: `ink` border, `--shadow-lift`, lifted 4px, and the plan name marked. | `.plan`, `.plan.is-fit` |
| **Status pill** | A `sheet` pill, 8px radius, mono 13.5px `ink` text, with the live dot. | `.hud .status` |
| **Step rail** | Segments with a 4px top border: `line` for upcoming steps, `ink-2` for done, `ink` for current. The current label is marked yellow. | `.rail` |
| **Dark band** | `paper` and `ink` swap within the section. Marks stay yellow with `on-marker` text. | `.sec.inv` |
| **Input** **(derived)** | 44px min height, `sheet` background, 1.5px `line` border, 8px radius, 16px text (so iOS doesn't zoom). Label 600 14px `ink`, help text 13px `ink-muted`. Error: `gap-ink` border and text, plus a `✕` before the message. | n/a |
| **Dialog, popover, menu** **(derived)** | `sheet`, 12px radius (8px for menus), `--shadow-float`. Overlay `rgba(20,20,20,.5)`. | `.ask` |
| **Toast** **(derived)** | The status pill on `ink` with `paper` text. Error toasts add a `gap` mark on the key word. | n/a |
| **Skeleton** **(derived)** | `line-2` bars with a 4px radius, like the grey lines on the sheets in the hero. No shimmer under reduced motion. | `.heap .bars` |
| **Focus** | `outline: 3px solid ink; outline-offset: 3px; border-radius: 3px` on `:focus-visible`, everywhere. | global |
| **Selection** | `marker` background, `ink` text. | global |

**Icons (derived):** `lucide-react` at stroke width 2, 16px inline and
20px in buttons and nav, coloured `currentColor`. Draw the check and arrow
glyphs the way the prototype does. Don't use emoji as icons.

**Charts (derived):**
- Series use `ink` and `ink-muted`.
- The one value to notice gets `marker` fill **with a 1.5px `ink`
  outline**, because yellow alone is about 1.1:1 against paper.
- Gaps use `gap-ink`.
- Axis labels are mono 11px `ink-muted`, gridlines are `line-2`.
- No legends where a direct label fits.

---

## 5. Tailwind 4 and shadcn/ui setup

Put this in the web Worker's global CSS in the first app-shell PR. It
removes Tailwind's default palette so one-off colours can't creep in.

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --paper:#F5F5F1; --paper-2:#ECECE5; --desk:#E4E4DC; --sheet:#FFFFFF;
  --ink:#141414; --ink-2:#34342F; --ink-muted:#5C5C55; --ink-faint:#8C8C84;
  --line:#D9D9D1; --line-2:#E8E8E1;
  --marker:#FFE84A; --marker-soft:#FFF4A8; --gap:#FF9BC8; --gap-soft:#FFD6E8; --gap-ink:#A3134F;
  --on-marker:#141414;

  /* shadcn/ui */
  --background:var(--paper); --foreground:var(--ink);
  --card:var(--sheet); --card-foreground:var(--ink);
  --popover:var(--sheet); --popover-foreground:var(--ink);
  --primary:var(--ink); --primary-foreground:var(--paper);
  --secondary:var(--paper-2); --secondary-foreground:var(--ink);
  --muted:var(--paper-2); --muted-foreground:var(--ink-muted);
  --accent:var(--marker); --accent-foreground:var(--on-marker);
  --destructive:var(--gap-ink);
  --border:var(--line); --input:var(--line); --ring:var(--ink);
  --chart-1:var(--ink); --chart-2:var(--ink-muted); --chart-3:var(--marker); --chart-4:var(--gap-ink); --chart-5:var(--line);
  --radius:8px;
  color-scheme:light;
}

.dark {
  --paper:#141414; --paper-2:#1E1E1C; --desk:#1A1A18; --sheet:#222220;
  --ink:#F5F5F1; --ink-2:#D6D6CC; --ink-muted:#BEBEB4; --ink-faint:#8C8C84;
  --line:#373732; --line-2:#2A2A27;
  --marker-soft:#484320; --gap-soft:#432F38; --gap-ink:#FF9BC8;
  color-scheme:dark;
}

@theme inline {
  --color-*: initial;
  --color-white:#FFFFFF; --color-black:#000000; --color-transparent:transparent; --color-current:currentColor;
  --color-paper:var(--paper); --color-paper-2:var(--paper-2); --color-desk:var(--desk); --color-sheet:var(--sheet);
  --color-ink:var(--ink); --color-ink-2:var(--ink-2); --color-ink-muted:var(--ink-muted); --color-ink-faint:var(--ink-faint);
  --color-line:var(--line); --color-line-2:var(--line-2);
  --color-marker:var(--marker); --color-marker-soft:var(--marker-soft);
  --color-gap:var(--gap); --color-gap-soft:var(--gap-soft); --color-gap-ink:var(--gap-ink);
  --color-on-marker:var(--on-marker);
  --color-background:var(--background); --color-foreground:var(--foreground);
  --color-card:var(--card); --color-card-foreground:var(--card-foreground);
  --color-popover:var(--popover); --color-popover-foreground:var(--popover-foreground);
  --color-primary:var(--primary); --color-primary-foreground:var(--primary-foreground);
  --color-secondary:var(--secondary); --color-secondary-foreground:var(--secondary-foreground);
  --color-muted:var(--muted); --color-muted-foreground:var(--muted-foreground);
  --color-accent:var(--accent); --color-accent-foreground:var(--accent-foreground);
  --color-destructive:var(--destructive);
  --color-border:var(--border); --color-input:var(--input); --color-ring:var(--ring);
  --color-chart-1:var(--chart-1); --color-chart-2:var(--chart-2); --color-chart-3:var(--chart-3); --color-chart-4:var(--chart-4); --color-chart-5:var(--chart-5);

  --font-sans:"Archivo", ui-sans-serif, system-ui, sans-serif;
  --font-display:"Archivo", ui-sans-serif, system-ui, sans-serif;
  --font-mono:"Fragment Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;

  --radius-sheet:3px; --radius-chip:6px; --radius-sm:6px; --radius-md:8px; --radius-lg:10px; --radius-xl:12px; --radius-2xl:14px;

  --shadow-sheet:0 1px 0 rgba(20,20,20,.05), 0 2px 4px -2px rgba(20,20,20,.12), 0 18px 32px -18px rgba(20,20,20,.32);
  --shadow-card:0 1px 0 rgba(20,20,20,.06), 0 18px 40px -28px rgba(20,20,20,.35);
  --shadow-lift:0 22px 44px -30px rgba(20,20,20,.55);
  --shadow-float:0 34px 64px -30px rgba(20,20,20,.55), 0 1px 0 rgba(20,20,20,.05), 0 18px 32px -18px rgba(20,20,20,.32);

  --ease-out:cubic-bezier(.2,.7,.1,1);
  --ease-in-out:cubic-bezier(.65,0,.25,1);
}
```

Put the `.mk` rule from §3 in the same file, along with the
reduced-motion block and the focus and selection rules from the
prototype.

---

## 6. Voice

These rules come from the landing copy.

- Short, plain sentences in the second person. Concrete numbers ("7 of 7
  read", "Free for 10 CVs a job"), not adjectives.
- Every claim has evidence near it. That is the product's whole pitch.
- Buttons start with a verb and say what happens: "Post a job free",
  "Watch it read a CV", "Shortlist", "Not a fit".
- System statuses are in mono and in the present tense:
  "Reading cv_grace_turner.pdf · 2 pages", "Scored 93 · 5 of 6
  requirements".
- No hype words (revolutionary, seamless, supercharge, AI-powered magic),
  no exclamation marks.
- Sample data uses the prototype's cast: Grace Turner, Kenji Tanaka,
  Lucas Becker, Amelia Nguyen, Rayan Al-Farsi, Sophia Carter and Oliver
  Hayes. Mark it clearly as sample data wherever it appears.

---

## 7. Accessibility

Contrast was measured against WCAG 2.1 AA.

| Pair | Ratio | Allowed for |
|---|---|---|
| `ink` on `paper` | 16.9 | Everything |
| `ink-2` on `paper` | 11.5 | Everything |
| `ink-muted` on `paper` / `desk` | 6.2 / 5.3 | Everything, including small text |
| `ink-faint` on `paper` / `sheet` | 3.1 / 3.4 | **Only** text 18px and up, disabled text, placeholders next to a visible label, and decorative numbers. Never body text. |
| `on-marker` on `marker` / `gap` | 14.8 / 9.5 | Everything |
| `gap-ink` on `sheet` | 7.6 | Everything |
| Dark: `ink` on `sheet` | 14.6 | Everything |
| Dark: `ink-muted` on `sheet` | 8.5 | Everything |
| Dark: `ink-faint` on `paper` / `sheet` | 5.4 / 4.7 | Everything |
| Dark: `ink` on `marker-soft` / `gap-soft` | 9.2 / 11.3 | Everything |

- Match and gap are never shown by colour alone. Pair them with a check
  or `✕` and with words.
- Every interactive element has the focus ring and is at least 44px.
- Pinned and scroll-driven sections have a "Skip the story" link and work
  with the keyboard.
- Charts and illustrations get a text alternative that states the
  result, as the hero artboard's `aria-label` does.

---

## 8. Don't

- New colours, fonts, radii or shadows outside this file.
- Gradients, except the marker strokes and their pooled ink. No glass
  effects, except the header blur.
- Purple, blue or any other brand accent. The palette is paper, ink,
  yellow and pink.
- Yellow as a large background, except on the CTA band, the upgrade
  prompt and the pale swipe.
- More than one ink ring or one swipe per screen, or more than one marked
  phrase per heading.
- Rotated or transform-scaled containers holding text people need to
  read.
- Pill-shaped buttons, emoji icons, text shadows, auto-playing loops.

---

## 9. App shell and components (derived, 2026-10-23)

Values derived for the signed-in dashboard's shell (`apps/web/src/dashboard/`)
and its shared components (`apps/web/src/ui/`). They're built from the
tokens above; nothing here adds a colour, font, radius or easing. The
classes live in `apps/web/src/index.css`.

### 9.1 Theme

- The app follows the person's choice: System, Light or Dark, saved in
  `localStorage` under `lh-theme` (System by default). The `dark` class
  goes on `<html>` only while the dashboard is mounted, so the landing
  page, sign-in, legal and public job pages stay light. An inline script
  in `index.html` applies the saved choice on `/dashboard` addresses
  before the first paint, so there's no flash. `<meta name="theme-color">`
  follows `paper`: `#F5F5F1` / `#141414`.
- Shadows live in `--elev-sheet/card/lift/float` on `:root` and `.dark`, and
  `--shadow-*` point at them. Dark shadows are `rgba(0,0,0,.5)` at the same
  offsets (§2.5).
- Overlay behind dialogs and drawers: `--overlay`, `rgba(20,20,20,.5)`
  light and `rgba(0,0,0,.6)` dark (dark needs more to separate the sheet).
  Clerk's modal backdrop uses it too.
- Sticky header and mobile top bar: `--hdr-bg`, `paper` at 90% in both
  themes (`rgba(245,245,241,.9)` / `rgba(20,20,20,.9)`), with the header
  blur.
- Desk dot grid: `--desk-dot`, `rgba(20,20,20,.12)` light and
  `rgba(245,245,241,.10)` dark.
- Marker surfaces keep the light inks in dark mode. `.rank-band` and
  `.on-marker-area` (the current nav item, the top ranked row) re-declare
  `ink`, `ink-2`, `ink-muted`, `ink-faint`, `line`, `line-2`, `paper`,
  `paper-2`, `sheet` and `gap-ink` with their light values, so text, borders
  and focus rings on yellow stay dark (`on-marker` never flips).
- `.btn:hover` text is `on-marker` (the fill is yellow in both themes).
- The logo mark swaps its ink square for the light ink with dark strokes in
  dark mode; the marker band stays yellow.
- The pale swipe (`.swipe-art`) drops to 30% opacity in dark mode so it
  stays a background.

### 9.2 Shell

| Part | Spec |
|---|---|
| **Sidebar** (768px and up) | 256px, `paper-2`, 1px `line` right border, full height, sticky. Collapses to a **64px rail** (Ctrl/⌘+B), saved in `lucidhire.sidebar`; width transition .2s `--ease-out`. In the rail every item is a 44px icon button with a tooltip on the right, and a to-review count becomes an 8px `ink` dot. |
| **Nav row** (`.nav-item`) | 40px tall on a mouse, 44px on touch, 10px side padding, 6px radius, 500 15px `ink-2`, 20px icon, 12px gap. Hover `line-2` fill. Current: `marker` fill, `on-marker` text, 650, `aria-current`. Open-jobs rows are denser: 36px (44px on touch), 14.5px, 8px gap. |
| **Search field** | Looks like an input: 40px (44px on touch), `sheet`, 1.5px `line` border, 8px radius, 14px `ink-muted`, a 16px search icon and a keycap on the right. Hover border `ink-faint`. |
| **Mobile top bar** | 56px, sticky, `--hdr-bg` with the header blur, 1px `line` bottom shadow. Back button or logo mark, page title 650 16px, avatar button 44px. |
| **Tab bar** | Fixed, 64px plus `env(safe-area-inset-bottom)`, `sheet`, 1px `line` top border, five equal columns. 20px icons over mono 11px labels in `ink-muted`. Current: `ink`, 650, and a 3px `marker` bar along the top edge (inset 22% each side), so colour is never the only signal. `main` gets 64px bottom padding to clear it. |
| **Bottom sheet** (More, Account) | A drawer from the bottom: `max-height: 88dvh`, 14px top radius, a 36 × 4px `line` grip, safe-area bottom padding. |
| **Page frame** (`.page`) | `padding-top: clamp(24px,3vw,40px)`, `padding-bottom: clamp(48px,6vw,80px)`, inside the 1280px container. |
| **Page title** (`.page-title`) | Archivo 820, `clamp(28px,3.2vw,40px)` / 1.02, 112% stretch, -.035em, balanced. Between the section heading and the card heading: app pages are denser than marketing sections. Focused on arrival (tabindex -1, no ring). |
| **Layers** | Sticky bars 60, dialogs and drawers 80 (`.layer-modal`), menus and popovers 82 (`.layer-popover`, they open from dialogs too), toasts 85 (`.layer-toast`), skip link 90, tooltips 95. |

### 9.3 Components

| Component | Spec |
|---|---|
| **Keycap** (`.kbd`) | Mono 11.5px `ink-2`, 22px tall, min 22px wide, 6px side padding, 1px `line` border with an `ink-faint` bottom edge, 4px radius, `sheet`. Sequences read "G then O"; ⌘ on a Mac, Ctrl elsewhere. |
| **Tooltip** | Mono 12.5px / 1.35 `paper` on `ink`, 6 × 9px padding, 6px radius, max 280px, the float shadow. Appears after 400ms on hover or keyboard focus, hides on Escape, scroll or pointer down. Never holds anything people must act on. |
| **Icon button** | 44 × 44px, 8px radius, `ink-muted`; hover and open: `line-2` fill and `ink`. Outline variant: 1.5px `line` border on `sheet`, `ink` border on hover. Always has a name and a tooltip. |
| **Count badge** | Mono 11.5px tabular, 20px tall, min 22px wide, 6px radius, 1px `line` border on `paper`, `ink-2`. Marker variant (things waiting on you): `marker` with an `on-marker` border, because yellow alone barely shows on paper. 999+ caps it. |
| **Checkbox** | An 18px box, 1.5px `ink` border, 4px radius, `sheet`; checked or mixed: `marker` with an `on-marker` border and the drawn check or dash. 44px hit area. |
| **Meter** | An 8px `line` track with a 4px radius, filled in `ink`; from 90% the fill turns `gap-ink` and the words say "Almost at the limit" (or "✕ Limit reached"), never colour alone. |
| **Skeleton** | `line-2` bars, 4px radius, min 12px tall. Static: nothing loops but the live dot (§2.6). |
| **Tabs** | A 1px `line` under the row. Tab 44px tall, 12px padding, 600 15px `ink-muted`, 6px top radius; hover `paper-2`. Chosen: `ink`, 650, and a 3px `ink` bar inset 8px. Focus ring inset 3px so the row's overflow doesn't clip it. |
| **Menu** | `sheet`, 1px `line` border, 8px radius, 6px padding, min 220px, max 340px, the float shadow. Items 40px (44px on touch), 6px radius, 500 15px; focus and hover `paper-2`, keyboard focus also a 2px `ink` outline inset 2px. Destructive items `gap-ink`. Group labels mono 11.5px uppercase `ink-muted`; separators 1px `line-2`. |
| **Popover** | As the menu, with a 12px radius, 16px padding and max 400px. |
| **Dialog** | `sheet`, 12px radius, the float shadow, on `--overlay`. Widths `min(N, 100vw - 32px)` for N = 440 (confirm), 560 (default), 640 (palette), 800. Padding 24px, 32px from 561px. Title is the panel heading (Archivo 800, 19px). Footer buttons right-aligned, 12px apart. The palette sits 12vh from the top. |
| **Drawer** | 480px from the right by default (`--drawer-w`), full height, 1px `line` edge, the float shadow. Below 768px every drawer becomes a bottom sheet (§9.2). |
| **Toast** | The status pill on `ink`: mono 13.5px / 1.35 `paper`, min 48px tall, 8px radius, the float shadow, max 560px, bottom-centre 24px up (above the tab bar on phones). Action button 650 14px underlined in `paper`; Dismiss 44px. Hover fill `paper` at 14% (`color-mix`). Errors start with ✕. |
| **Command palette** | A top-placed 640px dialog, max `min(640px, 80dvh)` tall. A 56px field row with a 20px icon and 17px text, groups under mono 11.5px labels, 44px rows, the active row `paper-2`. Matches are marked with `.mk` (no negative margin, so spaces stay). |

### 9.4 Motion

- Entrances use `--ease-out`: tooltip fade .15s, menu and popover pop-in
  .16s (4px rise), dialog pop-in .2s, toast rise .25s (8px), drawers and
  sheets slide .28s. All use `animation-fill-mode: backwards` and are
  complete at rest under reduced motion (the global rule cuts them).

### 9.5 Requirements and live ranking (derived, 2026-10-24)

The job page's Requirements tab (`apps/web/src/jobs/workspace/`) and the
evidence on candidate rows and the candidate page. Built from the tokens
above and the landing page's demo; nothing here adds a colour, font, radius
or easing.

| Part | Spec |
|---|---|
| **Evidence square** | 12px (14px `md`), 3px radius, 1.5px border, 3px apart, one per requirement in the job's order. Clear: `ink` fill. Partial: `sheet` with the left half `ink`. None: `sheet`, `ink` border. Not checked: a dotted `ink-muted` border. An Off requirement's square drops to 30% opacity. Each square is named for screen readers ("SwiftUI: partial", "GraphQL: clear, off"); the key under the ranking and on the candidate page's Evidence tab explains them, "Partial: the CV shows part of it" included. |
| **Must / Nice / Off** | The compact segmented control (§4), one per requirement, as a radio group named by its label. Chosen Must: `ink` fill, `paper` text. Chosen Nice: `marker` fill, `on-marker` text, `ink` border. Chosen Off: the plain chosen segment. An Off requirement's label goes `ink-muted`. |
| **Requirement row** | Number (mono 12px `ink-faint`), label 750 16px with a Rename icon button, detail 14px `ink-muted`, then the weight control and a Remove icon button; from 700px they sit on one line. Rename turns the label into a field with Save and Cancel (Enter and Escape) and a "n / 40 characters" count. |
| **Live ranking** | A `sheet` card beside the requirements from 1100px (sticky, 340–420px wide), under them below. The top 10 scored CVs: rank, name, squares, score in Archivo 800 26px at 62% stretch; the leader on the `.rank-band`. Above them one polite live line: "Grace Turner leads with 86." |
| **Move mark** | "↑2" mono 11px on `marker` with `on-marker` text, or "↓1" in `gap-ink`, beside the name of each CV that moved in the last re-rank, on the Requirements tab and the Candidates tab. Shown for 2.4s, then fades over .3s. Hidden from screen readers: the rank says it. |
| **Re-rank motion** | Rows slide to their new places (FLIP, `.flip-move`: `transform` .6s `--ease-in-out`). Scores count to their new value over 450ms, easing out (cubic). Under reduced motion both rest finished. |
| **Check all prompt** | A `sheet` strip with a 1.5px `line` border and 8px radius above the list: "3 CVs not checked against all requirements." and a small Check all button. While a run is going: the live dot and "Checking 3 CVs against every requirement…", and the button is disabled. Rows being checked say "Checking…" with the live dot. |
| **Scored before requirements** | On a row: a tag in mono 11.5px `ink-2` on `paper-2` with a 1px `line` border and 6px radius, "Scored before requirements were set", and Re-read where Retry would be. On the candidate page: a bordered note with the old requirements under it. |
| **Candidate page evidence** | Grouped as Must-haves, Nice to have, then "Off, not counted". Each requirement: its label (clear on `.mk`, none on `.mk-gap` with ✕, partial and not checked plain), a square and its level in words (Clear, Partial, None, Not checked), the detail, and the quote with a 3px `ink` rule. Off requirements lose their marks and go `ink-muted`, rather than fading, so the text keeps its contrast. |
