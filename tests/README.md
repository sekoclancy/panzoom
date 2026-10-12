# Tests

These scripts open the rendered pages in a real browser (headless Chrome,
driven with [Puppeteer](https://pptr.dev/)) and check what each image does:
which viewer opens, and that panzoom's viewer zooms, pans and closes as it
should. They read the results from the page and save a screenshot of each
step for a person to look at; nothing is compared pixel by pixel.

## Quick start

From the repo root, once (see [Setup](#setup)):

```bash
quarto install chrome-headless-shell --no-prompt
(cd tests && npm install)
python3 -m venv .venv && .venv/bin/pip install -r tests/requirements.txt
```

Then render, and run the tests from `tests/`:

```bash
quarto render              # from the repo root; the tests check docs/ as rendered
cd tests && npm test
```

| Command | What it checks | Time |
|---|---|---|
| `npm test` | The site's test pages (A–L): what each image opens, zoom, pan, keys, galleries, captions | ~45 s |
| `npm run touch` | The viewer on an emulated phone: tap, pinch, drag, swipe | ~10 s |
| `npm run nojs` | Every page with JavaScript off: each marked image links to its file | ~10 s |
| `npm run contrast` | Text contrast in light and dark mode, and that the viewer follows the theme | ~7 s |
| `npm run standalone` | Renders and checks the pages outside the site (self-contained, math, `panzoom:` forms) | ~25 s |
| `npm run offline` | The standalone and site pages with no network | ~70 s |
| `npm run bench` | Weight and speed against a saved baseline (`bench:save` saves a new one) | ~1 min |

Each prints one line per page (or check) and exits with an error if
anything failed. Render again after changing the extension or a page: the
tests only check the HTML already in `docs/`. To check one page:

```bash
quarto render tests/pages/d-panzoom-selective.qmd                 # from the repo root
node browser.mjs ../docs/tests/pages/d-panzoom-selective.html     # from tests/
```

## Setup

You need [Quarto](https://quarto.org) 1.9 or later, R with the ragg package
(the pages have R chunks; ragg makes page E's webp figures), Python 3 for
pages J–L, and [Node.js](https://nodejs.org) 22.12 or later.

**Chrome Headless Shell**, the browser the tests drive, installed by Quarto
into `~/.local/share/quarto/chrome-headless-shell/` (about 115 MB).
`--no-prompt` skips the confirmation, so it also works in a script or CI:

```bash
quarto install chrome-headless-shell --no-prompt
```

To use another Chrome or Chromium, set `CHROME=/path/to/chrome` when running
the tests.

**Puppeteer**, the Node.js library that controls Chrome:
[package.json](package.json) lists `puppeteer-core` (which uses an existing
Chrome instead of downloading its own), and
[package-lock.json](package-lock.json) pins its version.

```bash
cd tests && npm install
```

**Python packages** for pages J–L, in a venv at the repo root
(git-ignored); the project's `_environment` file points Quarto at it:

```bash
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
# or, with uv:
uv venv .venv && uv pip install -r tests/requirements.txt
```

## Test pages

The site's test pages are in [pages/](pages/), rendered with the site and
published at <https://sekoclancy.github.io/panzoom/>. Each starts with a
note saying what it should show, and has a **</> Code** button with its full
source.

**R (knitr).** A–D render the same 12 cases (a gallery, subfigures, math in
a caption, an image inside a link, a margin image, ...) four ways:

| Page | What it is | panzoom | Lightbox |
|---|---|---|---|
| [a-lightbox](pages/a-lightbox.qmd) | **Reference:** what Quarto's lightbox does with each case | off | `match: auto` |
| [b-panzoom-lightbox](pages/b-panzoom-lightbox.qmd) | **The usual setup:** marked images; the lightbox for the rest | on | `true` |
| [c-panzoom-auto](pages/c-panzoom-auto.qmd) | **Every figure:** A's markup, panzoom with `match: auto` | auto | `match: auto` |
| [d-panzoom-selective](pages/d-panzoom-selective.qmd) | **Marked images only**, no lightbox | on | none |
| [e-formats](pages/e-formats.qmd) | webp, svg, png + pdf, and webp past its 16,383 px limit | on | none |
| [f-options](pages/f-options.qmd) | Opting out, the `hint`, `max-zoom` and `loop` options | on | none |
| [g-captions](pages/g-captions.qmd) | Citations and cross-references in captions and descriptions | on | none |
| [h-wide](pages/h-wide.qmd) | Wide collages, tall strips and other shapes, each on its own; `fit` | on | none |
| [i-wide-galleries](pages/i-wide-galleries.qmd) | The same shapes in galleries and layouts, of different lengths | on | none |

**Python (Jupyter).** J and K compare panzoom with the lightbox on the same
eight cases, as A and C do for knitr, but each case states what should open:

| Page | What it is | panzoom | Lightbox |
|---|---|---|---|
| [j-jupyter-lightbox](pages/j-jupyter-lightbox.qmd) | **Reference:** the lightbox alone (it ignores nested `#\| lightbox:` options with Jupyter) | off | `true` |
| [k-jupyter-auto](pages/k-jupyter-auto.qmd) | **`panzoom: true`:** J's cases; keep the two in step | `true` | `true` |
| [l-jupyter](pages/l-jupyter.qmd) | The R pages' cell options on matplotlib figures, and svg output | on | none |

**Outside the site** ([standalone/](standalone/), rendered by `npm run
standalone` as plain documents with their own YAML header):

| Page | What it is |
|---|---|
| [self-contained](standalone/self-contained.qmd) | A single HTML file (`embed-resources: true`) opened from disk; `self-contained-math` also embeds MathJax |
| [self-contained-lightbox](standalone/self-contained-lightbox.qmd) | The same page with Quarto's lightbox, for comparison (a copy of `_self-contained.qmd`: keep in step) |
| [math-&lt;method&gt;](standalone/_math.qmd) | Math in captions and descriptions with each `html-math-method` |
| [switch-&lt;value&gt;](standalone/switch-true.qmd) | `panzoom: true`, `auto` and `false` |

Cases 1, 2 and 6–8 on A–D come from the example document of
[quarto-ext/lightbox](https://github.com/quarto-ext/lightbox) (MIT, © Posit
Software) and Quarto's lightbox docs. The photos in [../images/](../images/)
are quarto-ext/lightbox's, from Unsplash under the
[Unsplash license](https://unsplash.com/license):
[Chilmark Beach](https://unsplash.com/photos/VBDJGOMCwps),
[Aquinnah](https://unsplash.com/photos/2iQnDPLIXwU),
[Gingerbread House](https://unsplash.com/photos/HQEtvlNzUyA),
[Edgartown Light](https://unsplash.com/photos/f59MyOfLpi8),
[Edgartown Sailboat](https://unsplash.com/photos/IiLiz7XpQpI).

## Checks

`npm test` ([browser.mjs](browser.mjs)) clicks every image on each page,
records what opened (**panzoom**, **glightbox**, **navigation** for a link,
or **nothing**), and runs these checks. Each appears in the page's summary
line as `... ok`, or in capitals when it fails. Attributes on a case's
heading (`## 3. Title {#c3 expect-fit="height"}`) say what that case should
do.

| Summary | What must hold |
|---|---|
| `options ok` | What opened matches `expect-open`; and `expect-caption="none"`, `expect-hint`, `expect-max-zoom`, `expect-format="svg"` where set |
| `fit ok` | The opening view matches `expect-fit` (`contain`, `height`, `width`), at 1280 px and 2560 px wide; `expect-zoom-out` says whether it can zoom out further |
| `real size ok` | `expect-scale="1"`: a small image opens at its own size |
| `zoom anchor ok`, `fast zoom ok` | Wheel zoom keeps the point under the cursor within 3 px, also with several steps in one frame |
| `containment ok` | Arrow keys and drags stop at a collage's ends (with a bounce or a stretch that springs back); an image shown whole doesn't move |
| `focal point ok` | A strip clicked on the page opens at that spot; `0` returns there; from the keyboard it starts at its end |
| `shift-scroll ok` | Shift+scroll pans the way `shift-scroll` says (`x`, `y`, `none`, `zoomed-x`) |
| `gallery ok` | ←/→, the buttons and a swipe step through a gallery; zoomed in, → pans instead; PageUp/PageDown don't change image; no wrap without `loop` |
| `large galleries ok` | In a gallery of wide or tall figures, → pans and the next button switches |
| `caption clear ok` | An image that fits the screen's height stays clear of the caption band |
| `descriptions ok`, `references ok`, `math ok` | Descriptions show; citations and cross-references are resolved and their links work; math is typeset wherever the page's is |
| `backdrop ok` | Every image is shown on an opaque backdrop |
| `isolation ok` | Keys pressed in the viewer don't reach the page behind it (Ctrl+key and function keys do), and a widget at z-index 10000 stays underneath |
| `keyboard ok` | Tab reaches the image, Enter or Space opens it, arrows pan, Tab stays in the viewer, Esc closes, focus returns |
| `page still ok` | Opening the viewer doesn't shift the page behind it where scrollbars take up room |

The line also counts console errors and requests to other machines
(`N FAILED REQUESTS` if any failed); these are reported but don't fail the
run, since offline runs and some math pages have them on purpose. Each page gets a folder in `results/`:
`report.md` (a row per image, then each check in detail), a screenshot per
click (`cNN-M.png`: image M of case NN) and `results.json`.

A–D aren't checked against each other automatically: A shows what Quarto
does, and the note at the top of B, C and D lists where they should differ.
A few cases open nothing on purpose: case 8 (`lightbox: false`), case 9 in
A and C (Quarto drops the link around a captioned image), case 11 in A and
C (inline images aren't automatic), and every unmarked image in D.

### Touch

`npm run touch` ([touch.mjs](touch.mjs)) opens page B on an emulated phone
(390 × 844, touch screen) and sends real multi-finger touch events, which
Chrome turns into pointer events as on a phone: tap to open, pinch to zoom
(staying on screen), one-finger pan, double-tap to reset, tap outside to
close, swipe to the next image, and a pinch with one finger resting on the
background, in both orders, which must not close the viewer. Emulation
can't show quirks of real devices, Safari on iOS especially: try a phone
too.

### Without JavaScript

`npm run nojs` ([nojs.mjs](nojs.mjs)) opens every page with JavaScript off.
Each marked image must be in a link to its own file (or an author's link),
and clicking it must go there. On self-contained pages those links lead
nowhere, as Quarto's lightbox links do (Quarto deletes the files after
embedding them); they are reported as `dead links (self-contained, as
Quarto's lightbox)` without failing. On a page with `panzoom: false`, no
image may be linked.

### Text contrast

`npm run contrast` ([contrast.mjs](contrast.mjs)) opens each page in light
and dark mode and measures the WCAG contrast of every piece of text on the
page and in the viewer: below 4.5:1 (3:1 for large text) fails. It also
checks that the viewer's caption band takes the page's background and text
colours (`theme ok`). Text over images, typeset math and Quarto's navbar
and footer aren't measured.

### Without internet access

`npm run offline` renders the standalone pages with no network (`unshare
-rn`, Linux only), then checks every page with all outside requests
blocked. The viewer needs nothing from the internet, so its checks pass;
math stays raw TeX, as on the page (`math ok (page: not typeset)`), since
Quarto loads MathJax and KaTeX from the web. To check that a self-contained
file rendered online works offline (math included, in system fonts):
`node standalone.mjs && node browser.mjs --offline standalone/self-contained*.html`.

### Benchmark

`npm run bench` ([bench.mjs](bench.mjs)) catches regressions by comparing
panzoom with a saved baseline ([bench/baseline.json](bench/baseline.json)),
not with Quarto's lightbox. It renders [bench/panzoom.qmd](bench/panzoom.qmd)
five times, weighs the viewer's files and the page, and times page load and
opening and closing the viewer (the first open as the median of five fresh
page loads), at full speed and with the CPU slowed 4x. A result more than
5% heavier, or 1.5 times as long and over 10 ms longer (30 ms for page load
and the slowed CPU), fails the run. Render time is shown but not checked.

Times depend on the machine: after a change meant to make the viewer
heavier or slower, or on another machine or Quarto version, check the
report and run `npm run bench:save`, then commit the baseline.
`--no-render` skips the renders; `--rounds N` changes their number.

## Adding a case

Add a `## N. Title {#cN}` section (the scripts find cases by these headings)
with any `expect-*` attributes, then render and run the tests. On A–D, add
it to all four pages: A without panzoom markers, B and D with them, C with
A's markup.

## Checking by hand

`quarto preview`, from the repo root, renders the site, serves it and
re-renders on save; the test pages are linked from the front page.
(Opening the HTML in `docs/` directly doesn't work: Quarto's script is a
JavaScript module, which browsers refuse to load from `file://`.)

What the scripts can't judge: whether zooming feels smooth on a wheel and a
trackpad, touch on real phones and tablets, how sharp zoomed images look,
and appearance in general.

## Limitations

- Only Chrome is tested, not Firefox or Safari.
- Touch is emulated, not tried on real devices.
- Headless Chrome counts as a device without a mouse or hover, so CSS that
  checks `(hover: hover)` or `(pointer: fine)` treats it as a touch device.

## Troubleshooting

- **Console errors about CORS or `file://`**: the page was opened as a
  file. Use `quarto preview` or the test scripts, which serve it over HTTP.
- **`Failed to launch the browser process`**: Chrome isn't where the
  scripts look. Run `quarto install chrome-headless-shell --no-prompt`, or
  set `CHROME=`.
- **`... is not a file inside ...`**: the scripts only check rendered pages
  in this repo. Render first, and pass paths like
  `../docs/tests/pages/d-panzoom-selective.html`.
