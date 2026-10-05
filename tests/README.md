# Tests

These tests check that the panzoom extension does the right thing in a real
web browser: that the right images open the pan/zoom viewer, that the rest
still open Quarto's own lightbox, and that the viewer zooms, pans and closes
the way it should.

## What is being tested

**The extension.** `panzoom` (in `../_extensions/sekoclancy/panzoom/`) is a Quarto filter
that opens figures in a full-screen pan/zoom viewer, alongside Quarto's
built-in lightbox (GLightbox). The Lua filter decides which images get the
viewer; the JavaScript is the viewer itself. See `../README.md` for how to use
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
- The photos in `../images/` are the ones quarto-ext/lightbox uses. They
  are from Unsplash, under the [Unsplash license](https://unsplash.com/license):
  [Chilmark Beach](https://unsplash.com/photos/VBDJGOMCwps),
  [Aquinnah](https://unsplash.com/photos/2iQnDPLIXwU),
  [Gingerbread House](https://unsplash.com/photos/HQEtvlNzUyA),
  [Edgartown Light](https://unsplash.com/photos/f59MyOfLpi8),
  [Edgartown Sailboat](https://unsplash.com/photos/IiLiz7XpQpI).

The same 12 cases are rendered three ways:

| Page | What it is | Panzoom filter | Lightbox |
|---|---|---|---|
| `a-lightbox` | **Reference.** What Quarto's own lightbox does with each case. No panzoom markers at all. | off | `match: auto` |
| `c-panzoom-auto` | **`panzoom: match: auto`.** Same markup as A; panzoom picks the images itself. | on, auto | `match: auto` |
| `d-panzoom-selective` | **Explicit marking.** Images marked with `.panzoom` or `#\| classes: panzoom`. | on | none |

A fourth page has its own 8 cases:

| Page | What it is | Panzoom filter | Lightbox |
|---|---|---|---|
| `e-formats` | **Formats and shapes.** Very wide collages (100 × 5 in) as png, webp and svg; standard plots as webp, svg, png + pdf and pdf only; and webp past its 16,383 px size limit. webp uses ragg's `agg_webp` (needs the ragg package). | on | none |

Each page starts with a note saying what it should show, has a **</> Code**
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
- **`browser.mjs`** is our script. It does what you would do by hand: open
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
    ├── render.sh          renders the project into ../docs/
    ├── browser.mjs        the browser checks
    ├── pages/             a-lightbox.qmd, c-panzoom-auto.qmd, d-panzoom-selective.qmd, e-formats.qmd
    ├── node_modules/      installed by npm (git-ignored)
    └── results/           test output (git-ignored)
```

Because the repo root is a Quarto project, the pages find the extension in
the root `_extensions/` folder, and `quarto render` puts them in
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

From `tests/`:

```bash
npm run render   # render the project into ../docs/
npm test         # click through the test pages in headless Chrome
```

Render again whenever you change the extension or a page; `npm test` only
checks the HTML that is already there. To render or check a single page
(render paths are relative to the repo root):

```bash
./render.sh tests/pages/d-panzoom-selective.qmd
node browser.mjs ../docs/tests/pages/d-panzoom-selective.html
```

`browser.mjs` starts a small web server for `docs/` and points Chrome at
it, the way GitHub Pages serves the site. Pages can't simply be opened as
files: Quarto's main script is a JavaScript module, and browsers refuse to
load modules from `file://` addresses.

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
| Anchor px | Those steps were taken with the mouse over a point 30% across and 60% down the image. Zooming toward the cursor keeps that point under it; this is how far it drifted (a few px of rounding is normal). |
| Drag px | A 170 px mouse drag moved the image this far. |
| Reset | Pressing `0` returned to the opening view at once (checked 20 ms later, so an animated reset fails). |
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
keyboard only: the image must be focusable and announced as a button, open
on Enter and on Space, move focus into the viewer, pan with the arrow keys,
keep Tab and Shift+Tab inside the viewer, close from the close button with
Enter and with Esc, and return focus to the image afterwards.

**Opening view.** Cases whose heading has an `expect-fit` attribute
(`contain`, `height` or `width`; page E) are checked against how the viewer
actually opened them: Details shows `opens: ...`, and the summary line
says `fit ok` or `FIT FAILED`. On a gallery of images that open wider than
the screen, the test also checks that `→` pans along the image and
`PageDown` switches to the next one, and on a gallery of tall strips that
`→` neither switches nor moves the strip (`large galleries ok`).

**Shift+scroll.** Cases with a `shift-scroll` attribute (`x`, `y`, `none`,
or `zoomed-x` for "after zooming in"; page E) are checked for which way
Shift+scroll moved the image (`shift-scroll ok`).

**Containment.** On the first single collage, `→` must stop at its right
end, `←` at its left end, and `↑`/`↓` must not move it; on the first single
image shown whole, arrow keys and a drag must not move it
(`containment ok`). In galleries, `←` on the first image must do nothing.

**Gallery navigation.** On the first image that opens whole as `1 / N` in a
panzoom gallery, the test steps forward and back with `PageDown`/`PageUp`,
`→`/`←`, the next/previous buttons and a swipe, checks that `→` pans
instead when zoomed in, and that "previous" is disabled on the first image
(no `loop`).

**What to expect.** A on its own shows what Quarto does; compare each case in
C and D against it. The notes at the top of each page list the intended
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

Add a `## N. Title {#cN}` section to all three pages (A without panzoom
markers, D with them, C with A's markup), then `npm run render && npm test`.
The script finds cases by the `## N.` headings.

## Limitations

- Headless Chrome doesn't count as a device with a mouse and hover, so CSS
  that checks `(hover: hover)` or `(pointer: fine)` treats it as a touch
  device.
- No touch or pinch input is simulated.
- Tests only run Chrome, not Firefox or Safari.

## Troubleshooting

- **R errors when rendering** (for example about `renv`): `render.sh` sets
  `R_PROFILE_USER=/dev/null` so a personal `~/.Rprofile` doesn't run. If you
  render or preview by hand, do the same.
- **Console errors about CORS or `file://`**: the page was opened as a file.
  Use `quarto preview` or the test script, which serve it over HTTP.
- **`Failed to launch the browser process`**: Chrome isn't where the script
  looks. Run `quarto install chrome-headless-shell --no-prompt`, or set `CHROME=`.
- **`... is not inside .../docs`**: `browser.mjs` only checks pages from
  `docs/`. Render first, and pass paths like
  `../docs/tests/pages/d-panzoom-selective.html`.
