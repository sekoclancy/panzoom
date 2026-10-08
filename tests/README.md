# Tests

These tests check that the panzoom extension does the right thing in a real
web browser: that the right images open the pan/zoom viewer, that the rest
still open Quarto's own lightbox, and that the viewer zooms, pans and closes
the way it should.

## What is being tested

**The extension.** `panzoom` (in [../_extensions/sekoclancy/panzoom/](../_extensions/sekoclancy/panzoom/)) is a Quarto filter
that opens figures in a full-screen pan/zoom viewer, alongside Quarto's
built-in lightbox (GLightbox). The Lua filter decides which images get the
viewer; the JavaScript is the viewer itself. See [../README.md](../README.md) for how to use
it.

**The test cases.** The test pages contain 12 numbered cases (`## 1.` to
`## 12.`), one situation each: a gallery, subfigures, math in a caption, an
image inside a link, a margin image, and so on.

- Cases 1, 2 and 6–8 come from the example document of
  [quarto-ext/lightbox](https://github.com/quarto-ext/lightbox) (MIT,
  © Posit Software), the extension that became Quarto's built-in lightbox in
  Quarto 1.4, and from the
  [Quarto lightbox docs](https://quarto.org/docs/output-formats/html-lightbox-figures.html).
- The other cases were written for this project to cover what those examples
  don't.
- The photos in [../images/](../images/) are the ones quarto-ext/lightbox uses. They
  are from Unsplash, under the [Unsplash license](https://unsplash.com/license):
  [Chilmark Beach](https://unsplash.com/photos/VBDJGOMCwps),
  [Aquinnah](https://unsplash.com/photos/2iQnDPLIXwU),
  [Gingerbread House](https://unsplash.com/photos/HQEtvlNzUyA),
  [Edgartown Light](https://unsplash.com/photos/f59MyOfLpi8),
  [Edgartown Sailboat](https://unsplash.com/photos/IiLiz7XpQpI).

The same 12 cases are rendered four ways:

| Page | What it is | panzoom filter | Lightbox |
|---|---|---|---|
| [a-lightbox](pages/a-lightbox.qmd) | **Reference.** What Quarto's own lightbox does with each case. No panzoom markers at all. | off | `match: auto` |
| [b-panzoom-lightbox](pages/b-panzoom-lightbox.qmd) | **The usual setup.** Images marked with `.panzoom` or `#\| classes: panzoom`; Quarto's lightbox on for the rest. Same markup as D. | on | `true` |
| [c-panzoom-auto](pages/c-panzoom-auto.qmd) | **`panzoom: match: auto`.** Same markup as A; panzoom picks the images itself. | on, auto | `match: auto` |
| [d-panzoom-selective](pages/d-panzoom-selective.qmd) | **Explicit marking.** Images marked with `.panzoom` or `#\| classes: panzoom`. | on | none |

Four more pages have cases of their own:

| Page | What it is | panzoom filter | Lightbox |
|---|---|---|---|
| [e-formats](pages/e-formats.qmd) | **Image formats.** A wide collage and a standard plot as webp and svg; png + pdf, pdf only, png + cairo_pdf; and webp past its 16,383 px size limit. webp uses ragg's `agg_webp` (needs the ragg package). | on | none |
| [f-options](pages/f-options.qmd) | **Options.** `.nopanzoom`, `#\| panzoom: false`, and the per-cell `hint` and `max-zoom` options; a gallery with the page's `loop: true`. Each case states what to expect. | on | none |
| [g-captions](pages/g-captions.qmd) | **Captions and descriptions.** Citations and cross-references in captions and descriptions, including a work cited only in a description (quarto-cli#10709's case); the per-cell `caption` and `description` options. | on | none |
| [h-wide](pages/h-wide.qmd) | **Wide and tall figures.** Very wide collages (25 × 2 in), tall strips (4 × 15 in), a poster, a portrait photo and a small plot, alone, in galleries and in layouts; the `fit` option. | on | none |

Two more sets of pages are **not part of the website** (see
[Standalone pages](#standalone-pages)):

| Page | What it is |
|---|---|
| [standalone/self-contained](standalone/self-contained.qmd) | **A single HTML file**, `embed-resources: true`, opened from its `file://` address. `self-contained-math` also embeds MathJax (`self-contained-math: true`). |
| [standalone/self-contained-lightbox](standalone/self-contained-lightbox.qmd) | **The same page with Quarto's lightbox** instead of panzoom, for comparison (a copy: keep it in step with `_self-contained.qmd`). |
| [standalone/math-&lt;method&gt;](standalone/_math.qmd) | **Math in captions and descriptions** with each `html-math-method`: `mathjax`, `katex`, `mathml`, `webtex`, `plain`. |

Each website page starts with a note saying what it should show, has a **</> Code**
button that shows its full source, and shows each R chunk with its options.
They are published with the example at
<https://sekoclancy.github.io/panzoom/>.

## How browser testing works here

If you haven't used these tools before:

- **Headless Chrome** is the normal Chrome browser running without a window.
  It loads pages, runs their JavaScript and lays them out exactly as Chrome on
  your desktop would; it just doesn't draw them on a screen. That lets it run
  on a server with no display.
- **[Puppeteer](https://pptr.dev/)** is a Node.js library that remote-controls
  Chrome: open a page, move and click the mouse, scroll the wheel, press keys,
  read anything from the page, and take screenshots. We use `puppeteer-core`,
  the variant that doesn't download its own Chrome and instead uses the one
  Quarto installs.
- **[browser.mjs](browser.mjs)** is our script. It does what you would do by hand: open
  each page, click every image, see what opened, try zooming and dragging,
  press Esc. Instead of you watching, it reads the result from the page (for
  example "is the viewer's overlay showing?", "how far did the image move?")
  and writes it to a report. It also saves a screenshot of every click, so you
  can look at what it saw.

These are **behavior checks with screenshots for a human to look at**, not
pixel-by-pixel image comparisons. Nothing compares a screenshot to a saved
"correct" one.

## Folder layout

```
panzoom/                   the repo: a Quarto project (_quarto.yml)
├── _extensions/sekoclancy/panzoom/   the extension under test
├── index.qmd              the example (site front page)
├── images/                photos used by the test pages
├── docs/                  rendered site (git-ignored)
└── tests/
    ├── README.md          this file
    ├── package.json       Node project: dependency (puppeteer-core) and npm scripts
    ├── package-lock.json  exact dependency versions
    ├── browser.mjs        the browser checks
    ├── standalone.mjs     renders standalone/ (see Standalone pages)
    ├── nojs.mjs           the checks with JavaScript off (see Without JavaScript)
    ├── contrast.mjs       text contrast in light and dark mode (see Text contrast)
    ├── standalone/        pages outside the website: *.qmd, shared _*.qmd bodies,
    │                      _extensions -> ../../_extensions (symlink)
    ├── pages/             a-lightbox.qmd, b-panzoom-lightbox.qmd, c-panzoom-auto.qmd,
    │                      d-panzoom-selective.qmd, e-formats.qmd, f-options.qmd,
    │                      g-captions.qmd, h-wide.qmd
    ├── node_modules/      installed by npm (git-ignored)
    └── results/           test output (git-ignored)
```

Because the repo root is a Quarto project, the pages find the extension in
the root [_extensions/](../_extensions/) folder, and `quarto render` puts them in
`../docs/tests/pages/`.

## One-time setup

You need Quarto (1.9 or later), R with the ragg package (the pages have R
chunks; page E uses ragg for webp), and Node.js.

```bash
# 1. A Chrome for the tests to drive (about 115 MB, in ~/.local/share/quarto/)
quarto install chrome-headless-shell --no-prompt

# 2. The Node dependency (from tests/)
cd tests
npm install
```

To use a different Chrome or Chromium, set `CHROME=/path/to/chrome` when
running the tests.

## Running the tests

```bash
quarto render              # from the repo root: render the project into docs/
cd tests && npm test       # click through the test pages in headless Chrome
```

Render again whenever you change the extension or a page; `npm test` only
checks the HTML that is already there. To render or check a single page:

```bash
quarto render tests/pages/d-panzoom-selective.qmd                 # from the repo root
node browser.mjs ../docs/tests/pages/d-panzoom-selective.html     # from tests/
```

[browser.mjs](browser.mjs) starts a small web server for `docs/` and points Chrome at
it, the way GitHub Pages serves the site. Pages can't simply be opened as
files: Quarto's main script is a JavaScript module, and browsers refuse to
load modules from `file://` addresses.

### Standalone pages

The pages in [standalone/](standalone/) are plain documents with their options in their
own YAML header, as a self-contained document would have them. They aren't
in the project's `render:` list, so Quarto renders them without the
website layout, in place, finding the extension through the
[standalone/_extensions](standalone/_extensions) symlink. Each is just
`quarto render <page>.qmd --to html`; to render all and check them:

```bash
npm run standalone     # node standalone.mjs && node browser.mjs standalone/*.html
```

A self-contained page (no script or stylesheet files beside it) is opened
from its `file://` address, the way it would be from an email or a
download; the others are served like the website.

### Without JavaScript

```bash
npm run nojs           # node nojs.mjs: every test and standalone page, JavaScript off
```

With JavaScript off there is no viewer: each marked image is a link to its
own file (`a.panzoom-link`, written by panzoom.lua), as Quarto's lightbox
does with `a.lightbox`, so a click shows the full image in the same tab.
`nojs.mjs` opens every page with JavaScript disabled and checks that each
marked image is in such a link pointing at the image (or in an author's
own link, left alone), then clicks it and checks where the browser goes.
It prints one line per page, with the number of lightbox images for
comparison.

Self-contained pages are the exception. Their images are embedded, but the
link still points at the `*_files/` copy that Quarto deletes after
embedding, so with JavaScript off those links lead nowhere. Quarto's
lightbox links do the same (`self-contained-lightbox`). The line reports
them as `dead links (self-contained, as Quarto's lightbox)`, counted for
both, without failing the run. A link to a file that still exists (a
markdown image from the repo's `images/`) counts as fine.

### Text contrast

```bash
npm run contrast       # node contrast.mjs: index and every test page, light and dark
```

The site has Quarto's light/dark toggle (flatly and darkly). `contrast.mjs`
opens each page in both modes and measures the WCAG contrast ratio of every
visible piece of text in the page content and, with the first marked image
opened, in the viewer: the text color against the background behind it,
semi-transparent layers included. Text below 4.5:1 (3:1 for large text) is
reported, grouped by element and colors, and fails the run. Text over
images, typeset math and Quarto's navbar, sidebar and footer are not
measured.

### Without internet access

```bash
npm run offline        # render standalone/ offline, then check every page offline
```

This renders the standalone pages with no network at all
(`unshare -rn`: a new, empty network namespace; Linux only), then runs the
browser checks on all pages with every request that would leave the
machine blocked (`--offline`), as on a computer with no connection. The
report lists the blocked requests. Results go to `results/offline/`.

What to expect: panzoom itself needs nothing from the internet (Panzoom is
bundled), so every viewer check passes. Math is another matter: Quarto loads
MathJax and KaTeX from a CDN, so offline the page's math and the viewer's
stay raw TeX (`math ok (page: not typeset)`: the viewer is no worse than the
page), and a KaTeX page logs Quarto's own `katex is not defined`. Rendering
offline also can't embed MathJax for `self-contained-math`. To check that a
self-contained file *rendered online* works offline (it does, math
included; only MathJax's web fonts are missing, so math uses system fonts):

```bash
node standalone.mjs && node browser.mjs --offline standalone/self-contained*.html
```

### Output

`npm test` prints one line per page:

```
c-panzoom-auto: 18 images, {"panzoom":11,"glightbox":4,"nothing":3}, 0 console errors, isolation ok -> results/c-panzoom-auto/report.md
```

That is: how many images it clicked, what each click opened, how many
JavaScript errors the page logged, and whether the viewer isolation,
keyboard and gallery checks passed (below).

## Reading the results

Each page gets a folder in `results/`:

- **`report.md`**: one table row per image, then the isolation, keyboard
  and gallery checks.
- **`cNN-M.png`**: a screenshot taken right after clicking image M of case NN.
  Open a few to see what the viewer or lightbox looked like.
- **`results.json`**: the same data, for scripts.

Report columns:

| Column | Meaning |
|---|---|
| Classes | The image's CSS classes. `panzoom nolightbox` means the filter marked it. |
| Wrapper | `a.lightbox`: Quarto's lightbox link wraps it. `a[href]`: an ordinary link. `none`: no link. |
| Opened | What a click did: **panzoom** (our viewer), **glightbox** (Quarto's lightbox), **navigation** (followed a link; the test stops it before it leaves), or **nothing**. |
| Details | For GLightbox: the slide's title, description and how many slides its gallery has. For panzoom: the caption shown in the viewer and the gallery position (`2 / 3`). |
| Zoom× | Five wheel-scroll steps zoomed the image this many times its fitted size. |
| Anchor px | Those steps were taken, one at a time, with the mouse over a point 30% across and 60% down the image. Zooming toward the cursor keeps that point under it; this is how far it drifted in all. **NO**: a step moved it more than 3 px without the image being held at a screen edge (see Zoom anchor). |
| Drag px | A 170 px mouse drag moved the image this far. |
| Reset | Pressing `0` returned to the opening view at once (checked two animation frames later, so an animated reset fails). |
| Esc / Bg click | Esc, and a click on the dark background, closed the viewer. |

**Viewer isolation.** With the viewer open, the test adds key listeners to the
page (the way another extension would), presses the keys other extensions use
(arrows, `PageUp`/`PageDown`, `f`, `t`, `p`, `d`, `l`, `s`, `/`, Enter, Space),
and checks that none of them reached the page, that Ctrl+key and function
keys (F3, F9) still do, and
that a fixed button at z-index 10000 stays underneath the viewer. This guards
against keys acting on the page behind the viewer (for example focus-mode's
arrow keys switching pages).

**Keyboard access.** On the same image, the test opens the viewer with the
keyboard only: the image must be focusable and announced as a button (its
`a.panzoom-link` is, if it has one: one Tab stop per image), open
on Enter and on Space, move focus into the viewer, pan with the arrow keys,
keep Tab and Shift+Tab inside the viewer, close from the close button with
Enter and with Esc, and return focus to the image afterwards.

**Page behind the viewer.** Opening the viewer hides the page's scrollbar.
Where scrollbars take up room (Windows, most Linux desktops; not macOS's
default overlay scrollbars), the page would get wider and shift sideways
behind the viewer. Headless Chrome hides scrollbars, so the test reopens
each page in a Chrome that shows them, opens the first marked image, and
checks that the content and header keep their place and width, that the
viewer covers the whole window (scrollbar strip included), and that closing
brings the scrollbar back: `page still ok` in the summary line, and a
"Page behind the viewer" section in the report. Pages with no scrollbar or
no marked image skip it.

**Opening view.** Cases whose heading has an `expect-fit` attribute
(`contain`, `height` or `width`; pages E and H) are checked against how the viewer
actually opened them, in the normal 1280 px window and again in a 2560 px
wide one (the size rule depends on the screen): Details shows
`opens: ..., ... at 2560 px`, and the summary line says `fit ok` or
`FIT FAILED`. Cases with `expect-zoom-out` (page H) are also zoomed out as
far as possible from the opening view: `yes` means it must go below the
opening scale (the view was closer than the whole image), `no` that it
can't (the view already was the whole image); Details shows
`zooms out from ... to ...`. Without this, a `fit` override that changes
nothing visible would still pass.

**Focal point.** On the first single collage, a click at 50%
across the figure on the page must open the viewer with that point in the
middle of the screen, `0` must return there after panning, a click at 97%
must open flush with the right end, and opening with Enter must start at
the left end; on the first single tall strip, a click at 50% down must open
with that point in the middle (`focal point ok`).

**Options.** Cases with `expect-open` (`panzoom` or `nothing`),
`expect-caption="none"`, `expect-hint` (`shown` or `hidden`) or
`expect-max-zoom` (pages F and G) are checked: what opened, whether the caption
and hint show in the viewer, and where zooming in stops (`options ok`).
With the page's `loop: true`, the gallery check expects `←` on the first
image to wrap to the last.

**Descriptions.** Every image with a `description` must show it under the
caption in the viewer (`descriptions ok`; cases 1 and 3 on pages C and D).

**References.** Citations and cross-references in the viewer's caption and
description must be resolved (no `[@key]`, `@key` or Quarto's `?@key`
left), and each in-page link must lead to something on the page, such as
the References entry (`references ok`). Cases with `expect-references`
(page G) must show at least one.

**Math.** Math in the viewer's caption and description must show no worse
than the page's own math (`math ok (page: typeset)`): typeset if the
page's is, raw TeX only where the page has it too (the `plain` method, or a
math library that couldn't load). A page with no math of its own is
compared with the hidden math element panzoom adds for descriptions.

**Network.** The report lists requests to other machines (CDNs) and any
request that failed (`N FAILED REQUESTS`). On a gallery of images that open wider than
the screen, the test also checks that `→` pans along the image and
`PageDown` switches to the next one, and on a gallery of tall strips that
`→` neither switches nor moves the strip (`large galleries ok`).

**Zoom anchor.** In each of the five wheel steps (Anchor px), the image
point under the cursor must stay within 3 px of it, except along an axis
where the step left the image flush with the screen margin: there the
viewer may move it, to keep an image larger than the screen covering it
edge to edge, or a smaller one wholly on screen (`zoom anchor ok`).
Several steps within one animation frame are checked separately, once the
image is larger than the screen (`fast zoom ok`).

**Shift+scroll.** Cases with a `shift-scroll` attribute (`x`, `y`, `none`,
or `zoomed-x` for "after zooming in"; pages E and H) are checked for which way
Shift+scroll moved the image (`shift-scroll ok`).

**Containment.** On the first single collage, `→` must stop at its right
end, `←` at its left end, and `↑`/`↓` must not move it; one more `→` at the
end must bounce up to 40 px past it and back, and a 300 px drag past the
left end must stretch at most 80 px and spring back on release; on the first single
image shown whole, arrow keys and a drag must not move it
(`containment ok`). In galleries, `←` on the first image must do nothing.

**Gallery navigation.** On the first image that opens whole as `1 / N` in a
panzoom gallery, the test steps forward and back with `PageDown`/`PageUp`,
`→`/`←`, the next/previous buttons and a swipe, checks that `→` pans
instead when zoomed in, and that "previous" is disabled on the first image
(no `loop`).

**What to expect.** A on its own shows what Quarto does; compare each case in
B, C and D against it. B should match A except for the marked images,
which open panzoom. The notes at the top of each page list the intended
differences. A few cases do "nothing" on purpose: case 8 (`lightbox: false`),
case 9 in A and C (a Quarto bug drops the link around a captioned image), case
11 in A and C (inline images aren't automatic), and in D every image that
isn't marked, since D has no lightbox.

## Checking by hand

From the repo root, run

```bash
quarto preview
```

It renders the project, starts a local web server and opens the front page
in your browser; the test pages are linked at the bottom. It re-renders when
you save a file. (Opening the HTML files from `docs/` directly doesn't work,
for the module reason above.) The published copies at
<https://sekoclancy.github.io/panzoom/> work too, once published.

Things the automated checks can't judge:

- whether zooming feels smooth on a mouse wheel and on a trackpad pinch,
- touch devices (one-finger pan, two-finger pinch zoom),
- how sharp images look when zoomed in,
- anything about appearance: colors, the hint text, the close button.

## Adding a case

Add a `## N. Title {#cN}` section to all four pages (A without panzoom
markers, B and D with them, C with A's markup), then render and run the
tests.
The script finds cases by the `## N.` headings.

## Limitations

- Headless Chrome doesn't count as a device with a mouse and hover, so CSS
  that checks `(hover: hover)` or `(pointer: fine)` treats it as a touch
  device.
- No touch or pinch input is simulated.
- Tests only run Chrome, not Firefox or Safari.

## Troubleshooting

- **Console errors about CORS or `file://`**: the page was opened as a file.
  Use `quarto preview` or the test script, which serve it over HTTP.
- **`Failed to launch the browser process`**: Chrome isn't where the script
  looks. Run `quarto install chrome-headless-shell --no-prompt`, or set `CHROME=`.
- **`... is not a file inside ...`**: [browser.mjs](browser.mjs) only checks rendered
  pages in this repo. Render first (`quarto render`, `node standalone.mjs`),
  and pass paths like `../docs/tests/pages/d-panzoom-selective.html`.
