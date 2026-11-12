# Tests

Scripts that open the rendered pages in headless Chrome, click each image, and
check the viewer. They save a screenshot of each step for a person to look at;
nothing is compared pixel by pixel.

## Quick start

Set up a clone as in [Setup](../README.md#setup) in the main README, then, from
the repo root, once:

```bash
quarto install chrome-headless-shell --no-prompt
(cd tests && npm install)
```

Render, then run the tests from `tests/`:

```bash
quarto render
cd tests && npm run all
```

  | Command              | Checks                                                                                                                                                                                                                         | Time   |
  | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
  | `npm test`           | The front page and the example pages (A–T): the viewer per image, zoom, pan, keys, galleries, captions                                                                                                                         | ~2 min |
  | `npm run touch`      | The viewer on an emulated phone: tap, pinch, drag, swipe                                                                                                                                                                       | ~10 s  |
  | `npm run loading`    | Slow and failed images: loading message, late arrivals, error message                                                                                                                                                          | ~5 s   |
  | `npm run nojs`       | Every page with JavaScript off: each marked image links to its file                                                                                                                                                            | ~10 s  |
  | `npm run contrast`   | Text contrast in light and dark mode, and that the viewer follows the theme                                                                                                                                                    | ~7 s   |
  | `npm run lightbox`   | Caption text, band colors, and backdrop the same as lightbox, light and dark                                                                                                                                                   | ~5 s   |
  | `npm run a11y`       | axe-core at WCAG 2.2 AAA plus best practices, on each page and with the viewer open, light and dark. Only panzoom's own markup fails it; theme and content findings, and results axe can't decide ("needs review"), are listed | ~80 s  |
  | `npm run standalone` | Renders and checks the pages outside the site (self-contained, math, `panzoom:` forms)                                                                                                                                         | ~25 s  |
  | `npm run offline`    | The standalone and site pages with no network                                                                                                                                                                                  | ~70 s  |
  | `npm run bench`      | Weight and speed against a saved baseline (`bench:save` saves a new one)                                                                                                                                                       | ~1 min |
  | `npm run options`    | Misspelled and wrong options: each mistake reported, as Quarto words it, and the render stopped; descriptions that look like options come through whole                                                                        | ~15 s  |
  | `npm run api`        | `window.QuartoPanzoom`: `open`, `onClose` on each way of closing, `observe`; printing with the viewer open                                                                                                                     | ~3 s   |
  | `npm run order`      | The order of `#\|` options in every `.qmd`: `panzoom` first, the alt text and captions last                                                                                                                                    | ~1 s   |
  | `npm run all`        | Every suite above, in `package.json` order, except `offline` and `bench`; stops at the first that fails                                                                                                                        | ~7 min |

Each prints one line per page and exits with an error if a check fails. The
tests read `docs/`, so render again after changing the extension or a page. To
check one page:

```bash
quarto render examples/d-selecting-r.qmd                 # from the repo root
node browser.mjs ../docs/examples/d-selecting-r.html     # from tests/
```

Quarto's own axe check (Quarto 1.10 or later) shows each page's violations at
WCAG 2.2 AAA plus best practices on the page itself. It renders into
`_site-axe/`, not `docs/`, and never sees the open viewer:

```bash
quarto render --profile axe    # then, with caddy run, open /axe/
```

## Setup

  | Need                                                                           | For                         | Install                                            |
  | ------------------------------------------------------------------------------ | --------------------------- | -------------------------------------------------- |
  | [Quarto](https://quarto.org) 1.8.27 or later                                   | Rendering                   |                                                    |
  | R 4.6 and [rv](https://github.com/A2-ai/rv)                                    | The R pages                 | `rv sync` ([Setup](../README.md#setup))            |
  | Python 3.14 venv                                                               | Pages J–M, Q, and T         | `uv sync` ([Setup](../README.md#setup))            |
  | [Node.js](https://nodejs.org) 22.12 or later                                   | The scripts                 |                                                    |
  | Chrome Headless Shell (about 115 MB)                                           | The browser the tests drive | `quarto install chrome-headless-shell --no-prompt` |
  | Puppeteer (`puppeteer-core`, pinned in [package-lock.json](package-lock.json)) | Controlling Chrome          | `cd tests && npm install`                          |

Set `CHROME=/path/to/chrome` to use another Chrome or Chromium.

## Example pages

The example pages are in [examples/](../examples/), rendered with the site and
published at <https://sekoclancy.github.io/panzoom/>. Each starts with a note
describing the expected result.

**R (knitr).** A–D render the same 12 cases four ways (B adds a 13th, a cell with both
options):

  | Page                                                     | Description                                                               | panzoom | Lightbox      |
  | -------------------------------------------------------- | ------------------------------------------------------------------------- | ------- | ------------- |
  | [a-lightbox-r](../examples/a-lightbox-r.qmd)             | **Reference:** Quarto's lightbox on each case                             | off     | `match: auto` |
  | [b-mixed-r](../examples/b-mixed-r.qmd)                   | **The usual setup:** marked images; the lightbox for the rest             | on      | `true`        |
  | [c-global-r](../examples/c-global-r.qmd)                 | **Every figure:** A's markup, panzoom with `match: auto`                  | auto    | `match: auto` |
  | [d-selecting-r](../examples/d-selecting-r.qmd)           | **Marked images only**, no lightbox                                       | on      | none          |
  | [e-image-formats-r](../examples/e-image-formats-r.qmd)   | webp, svg, png + pdf, and webp past its 16,383 px limit                   | on      | none          |
  | [f-cell-options-r](../examples/f-cell-options-r.qmd)     | Opting out, the `hint`, `max-zoom`, `loop`, and `desc-position` options   | on      | none          |
  | [g-captions-r](../examples/g-captions-r.qmd)             | Citations, cross-references, and inline code in captions and descriptions | on      | none          |
  | [h-wide-and-tall-r](../examples/h-wide-and-tall-r.qmd)   | Wide collages, tall strips, and other shapes, each on its own; `fit`      | on      | none          |
  | [i-wide-galleries-r](../examples/i-wide-galleries-r.qmd) | The same shapes in galleries and layouts, of different lengths            | on      | none          |

**Python (Jupyter).** J and K are the Jupyter counterparts of A and C, on eight
cases. L and M carry the R pages' cell cases:

  | Page                                                           | Description                                                                                                                           | panzoom | Lightbox |
  | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- |
  | [j-lightbox-python](../examples/j-lightbox-python.qmd)         | **Reference:** the lightbox alone (it ignores nested `#\| lightbox:` options with Jupyter)                                            | off     | `true`   |
  | [k-global-python](../examples/k-global-python.qmd)             | **`panzoom: true`:** J's cases; keep the two in step                                                                                  | `true`  | `true`   |
  | [l-cell-options-python](../examples/l-cell-options-python.qmd) | The R pages' cell options on matplotlib figures, and svg output                                                                       | on      | none     |
  | [m-figures-python](../examples/m-figures-python.qmd)           | The cell cases from E to I: `loop`, captions, citations, and inline code, png + pdf and jpeg, `fit`, strips and collages in galleries | on      | none     |

**Styling**, checked with `expect-overlay` and `expect-band`:

  | Page                                                   | Description                                                                              |
  | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
  | [n-color-options-r](../examples/n-color-options-r.qmd) | The color options, no CSS                                                                |
  | [o-css-r](../examples/o-css-r.qmd)                     | `css-class` with CSS rules in a raw HTML block: the CSS variables and the viewer's parts |

**Divs.** Quarto's own divs around figures, with images on tabs and in collapsed
callouts uncovered first:

  | Page                                           | Description                                                                                                                                                       |
  | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | [p-divs-r](../examples/p-divs-r.qmd)           | Callouts (collapsed too), tabsets (a gallery across tabs), `column-screen`, `column: page`, `column-margin`, and `content-visible`, alone and in a `.panzoom` div |
  | [q-divs-python](../examples/q-divs-python.qmd) | The cell cases from P, in Python: callouts, tabsets, `column-screen`, `column: page`, `column-margin`, and a gallery from a div                                   |

**Theme.** Plots in light and dark mode:

  | Page                                                       | Description                                                                                    |
  | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | [r-dark-plots-r](../examples/r-dark-plots-r.qmd)           | Dark and transparent plots on the default backdrop and a light backdrop, and a gallery of both |
  | [s-renderings-r](../examples/s-renderings-r.qmd)           | `renderings: [light, dark]`: opaque and transparent plots, and a gallery                       |
  | [t-renderings-python](../examples/t-renderings-python.qmd) | The cases from S, in Python                                                                    |

**Outside the site** ([standalone/](standalone/)), rendered by
`npm run standalone` as plain documents:

  | Page                                                              | Description                                                                                              |
  | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | [self-contained](standalone/self-contained.qmd)                   | A single HTML file (`embed-resources: true`) opened from disk; `self-contained-math` also embeds MathJax |
  | [self-contained-lightbox](standalone/self-contained-lightbox.qmd) | The same page with Quarto's lightbox (a copy of `_self-contained.qmd`: keep in step)                     |
  | [math-&lt;method&gt;](standalone/_math.qmd)                       | Math in captions and descriptions with each `html-math-method`                                           |
  | [switch-&lt;value&gt;](standalone/switch-true.qmd)                | `panzoom: true`, `auto`, and `false`                                                                     |
  | [css-class](standalone/css-class.qmd)                             | `css-class` and the CSS variables, set by a rule loaded before panzoom's stylesheet                      |
  | [desc-position](standalone/desc-position.qmd)                     | `desc-position` for the document, and on images in a gallery                                             |

## Checks

`npm test` ([browser.mjs](browser.mjs)) clicks every image, records the result
(**panzoom**, **glightbox**, **navigation** for a link, or **nothing**), and
runs the checks below. Each shows in the page's summary line as `... ok`, or in
capitals when it fails. Attributes on a case's heading set its expected results,
as in `## Title {expect-fit="height"}`.

  | Summary                                       | Assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `options ok`                                  | The viewer opened matches `expect-open` (one value, or one per image); and `expect-caption="none"`, `expect-hint`, `expect-hint-key` (what h does), `expect-max-zoom`, `expect-format="svg"`, `expect-class` (on the viewer), `expect-overlay` and `expect-band` (backdrop and caption band colors), and `expect-desc-position` (where the caption shows, in panzoom or lightbox) where set; on a case, a `;` list gives these one value per image |
  | `fit ok`                                      | The opening view matches `expect-fit` (`contain`, `height`, `width`), in a 1280 × 900 window and four others (1440 × 780, 1920 × 950, 1920 × 1080, 2560 × 1300); `expect-zoom-out` says whether it can zoom out further                                                                                                                                                                                                                            |
  | `real size ok`                                | `expect-scale="1"`: a small image opens at its own size                                                                                                                                                                                                                                                                                                                                                                                            |
  | `zoom anchor ok`, `fast zoom ok`              | Wheel zoom keeps the point under the cursor within 3 px, also with several steps in one frame                                                                                                                                                                                                                                                                                                                                                      |
  | `containment ok`                              | Arrow keys and drags stop at a collage's ends; an image shown whole doesn't move                                                                                                                                                                                                                                                                                                                                                                   |
  | `focal point ok`                              | A strip clicked on the page opens at that spot; `0` returns there; from the keyboard it starts at its end                                                                                                                                                                                                                                                                                                                                          |
  | `shift-scroll ok`                             | Shift+scroll pans the way `shift-scroll` says (`x`, `none`, `zoomed-x`)                                                                                                                                                                                                                                                                                                                                                                            |
  | `alt-scroll ok`                               | Alt+scroll pans the way `alt-scroll` says (`y`, `none`, `zoomed-y`)                                                                                                                                                                                                                                                                                                                                                                                |
  | `gallery ok`                                  | ←/→, the buttons, and a swipe step through a gallery; zoomed in, → pans instead; PageUp/PageDown don't change image; no wrap without `loop`; focus stays in the viewer at the last image                                                                                                                                                                                                                                                           |
  | `back ok`                                     | Back closes the viewer and stays on the page; Esc leaves no history entry; Forward doesn't reopen; Back closes a gallery; a caption link is followed, and Back returns                                                                                                                                                                                                                                                                             |
  | `large galleries ok`                          | In a gallery of wide or tall figures, → pans and the next button switches; a wide figure stops clear of the buttons, a held → stops at its end, and → at the end switches                                                                                                                                                                                                                                                                          |
  | `caption clear ok`                            | An image that fits the screen stays clear of the caption band, on whichever side it is                                                                                                                                                                                                                                                                                                                                                             |
  | `anchors ok`                                  | `expect-anchors`: each labeled figure keeps its id and its number ("Figure N"), holds an image panzoom marked, and a cross-reference on the page links to it                                                                                                                                                                                                                                                                                       |
  | `descriptions ok`, `references ok`, `math ok` | Descriptions show; citations and cross-references are resolved and their links work; math is typeset wherever the page's is                                                                                                                                                                                                                                                                                                                        |
  | `links ok`                                    | Every link to a spot on the site (`#id`, on the page or another) has an element with that id: section references and links to cases                                                                                                                                                                                                                                                                                                                |
  | `panel scroll ok`                             | A caption or description marked `expect-scroll` (page G) is reached with Tab and scrolled by the arrows, Page Up/Down, Home, End, and Space, without moving the image or the page                                                                                                                                                                                                                                                                  |
  | `backdrop ok`                                 | Every image is shown on an opaque backdrop                                                                                                                                                                                                                                                                                                                                                                                                         |
  | `isolation ok`                                | Keys pressed in the viewer don't reach the page behind it (Ctrl+key and function keys do), and a widget at z-index 10000 stays underneath                                                                                                                                                                                                                                                                                                          |
  | `keyboard ok`                                 | Tab reaches the image, Enter or Space opens it, zoomed in the arrows pan both ways, Tab stays in the viewer, Esc closes, focus returns                                                                                                                                                                                                                                                                                                             |
  | `page still ok`                               | Opening the viewer doesn't shift the page behind it where scrollbars take up room                                                                                                                                                                                                                                                                                                                                                                  |

A console error, a page error, or a failed request for one of the page's own
files fails the page, unless `KNOWN_ERRORS` or `KNOWN_FAILED_REQUESTS` in
browser.mjs lists it as expected (from Quarto or a math library, with the
reason). Requests to other sites are counted, and their failures reported, but
don't fail the run. Each page gets a folder in `results/` with `report.md`, a
screenshot per click (`cNN-M.png`: image M of case NN), and `results.json`.

For example, the summary line for page B:

```
b-mixed-r: 18 images, {"panzoom":12,"glightbox":4,"navigation":1,"nothing":1}, 0 console errors, isolation ok, keyboard ok, gallery ok, back ok, fit n/a, links ok, backdrop ok, caption clear ok, hint keys ok, fast zoom ok, zoom anchor ok, options ok, descriptions ok, references ok, math ok (page: typeset), 13 external requests, containment ok, short panels ok, page still ok -> results/b-mixed-r/report.md
```

the first row of its `report.md` (the Classes and Wrapper columns left out):

  | Case            | Img | Opened      | Details                                                                                                                                                                                                                   | Zoom× | Anchor px | Drag px | Reset | Esc | Bg click |
  | --------------- | --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- | ------- | ----- | --- | -------- |
  | 1. Single image | 1   | **panzoom** | caption: Sunset at Chilmark Beach, Martha’s Vineyard.; 1 / 1; 2400×1364 px, shown 861×489, on rgb(255, 255, 255); opens: contain; description: Chilmark has some of the best beaches. credit: Chilmark Beach; hint hidden | 4.48  | 100       | 170     | yes   | yes | yes      |

and its screenshot, `c01-1.png`:

![The viewer open on case 1 of page B: the beach photo over the dimmed page,
with its caption and description below.](images/example-screenshot.jpg)

A few cases open nothing on purpose: Opt out a cell on A–D (`lightbox: false`),
Image in a link on A (Quarto drops the link around a captioned image), Inline
image on A and C (inline images aren't automatic), and every unmarked image on D.

## Other suites

**Touch.** `npm run touch` ([touch.mjs](touch.mjs)) opens page B on an emulated
phone (390 × 844) and sends real multi-finger touch events: tap, pinch,
one-finger pan, double-tap, swipe, tap outside, and a pinch with one finger on
the background, which must not close the viewer. A caption set beside the image
must show below it.

**Loading.** `npm run loading` ([loading.mjs](loading.mjs)) opens page B with a
server that holds back or refuses chosen images. A slow image shows "Loading
image" and then fits; one that arrives after the viewer closed, or after the
gallery moved on, changes nothing; a failed one shows an error, and Esc still
closes and gives focus back.

**Without JavaScript.** `npm run nojs` ([nojs.mjs](nojs.mjs)) opens every page
with JavaScript off. Each marked image must link to its own file (or an author's
link), and the link must work. On self-contained pages the links lead nowhere,
as with Quarto's lightbox; these are reported, not failed. With
`panzoom: false`, no image may be linked.

**Text contrast.** `npm run contrast` ([contrast.mjs](contrast.mjs)) measures
the WCAG contrast of the text on the page and in the viewer, in light and dark
mode; below 4.5:1 (3:1 for large text) fails. It also checks that the caption
band takes the page's colors (`theme ok`), except on M and N, which restyle it.
Text over images, typeset math, and Quarto's navbar and footer aren't measured.

**Lightbox match.** `npm run lightbox`
([lightbox-match.mjs](lightbox-match.mjs)) opens case 3 on the lightbox page (A)
and on page D, in light and dark mode, and compares the backdrop, the band
colors, and the caption and description text (font, size, weight, line height,
color). Layout isn't compared: panzoom pins the band to the screen edge on
purpose.

**Without internet access.** `npm run offline` (Linux only) renders the
standalone pages with no network, then checks every page with outside requests
blocked. Math stays raw TeX, as on the page. For a self-contained file rendered
online:
`node standalone.mjs && node browser.mjs --offline standalone/self-contained*.html`.

**Benchmark.** `npm run bench` ([bench.mjs](bench.mjs)) compares the viewer's
weight and speed with a saved baseline,
[bench/baseline.json](bench/baseline.json). A result over 5% heavier, or 1.5
times as long and over 10 ms longer (30 ms for page load and a 4× slowed CPU),
fails the run. After an intended change, or on another machine or Quarto
version, run `npm run bench:save` and commit the baseline. `--no-render` skips
the renders; `--rounds N` changes their number.

## Other Quarto versions

Every Quarto release since 1.4 is on PyPI as `quarto-cli`. The scripts call
`quarto` from `PATH`; install it into a copy and render and test there, so
`docs/` and `_freeze/` keep the usual build:

```bash
v=1.8.27; w=/tmp/panzoom-$v
rsync -rlpt --exclude=.git --exclude=/docs --exclude=/_freeze --exclude=/.quarto ./ $w/
uv venv -q $w/.quarto-cli
uv pip install -q --python $w/.quarto-cli --no-deps quarto-cli==$v
mkdir -p $w/.bin && ln -s $w/.quarto-cli/bin/quarto $w/.bin/quarto
export PATH=$w/.bin:$PATH
cd $w && quarto render && cd tests
npm test; npm run options; npm run standalone; npm run nojs
```

Afterward: `rm -rf $w` and `uv cache clean quarto-cli` (about 1.3 GB per
version). Not `uvx --from quarto-cli==$v`: its environments stay in uv's cache
(about 600 MB each), which `uv cache clean quarto-cli` leaves.

Below `quarto-required`, lower it in the copy's
`_extensions/sekoclancy/panzoom/_extension.yml`. Quarto 1.7 and earlier print
the refusal but exit 0, so check that `docs/examples/` has pages.

  | Quarto                  | Result (2026-10-20)                                                                                                                                                                                                                                                                                                               |
  | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1.11.9                  | All pass (2026-11-06)                                                                                                                                                                                                                                                                                                             |
  | 1.8.27, 1.9.38, 1.10.19 | All pass                                                                                                                                                                                                                                                                                                                          |
  | 1.7.34                  | All pass except `options`: the errors are reported and the render stops, but Quarto exits 0                                                                                                                                                                                                                                       |
  | 1.4.556 to 1.6.42       | `options` as for 1.7; standalone `switch-*` pages log a `SyntaxError` from Quarto's own `quarto.js`; on 1.4, page G case 10's caption stays short (no `lipsum` shortcode before 1.5), so its panel scroll check fails. Jupyter plots come out at half the pixels (588 × 411), which the keyboard and gallery checks now zoom past |

## Demo

`npm run demo` ([demo.mjs](demo.mjs)) records
[images/demo.gif](../images/demo.gif) for the README, and demo.mp4 with its
poster for the front page, from the rendered front page. Run it again after
changing `index.qmd` or the viewer, then commit the three files. It needs
ffmpeg, from `uv sync --group demo` or `FFMPEG=/path/to/ffmpeg`. A later plain
`uv sync` removes it again.

## Adding a case

Add a `## Title` section with any `expect-*` attributes, and an id (`{#sec-…}`)
if another page links to it, then render and run the tests. On A–D, add it to
all four pages: A without panzoom markers, B and D with them, C with A's markup.
Keep the title short, since the code shown below it carries the details.

### Markdown cases

Code cells show their own code, but Quarto has no way to show markdown source.
Write a markdown case once, as a `show-source` code block:

````markdown
```show-source
![Aquinnah](../../images/mv-1.jpg){#fig-md-a .panzoom}
```
````

[_filters/show-source.lua](../_filters/show-source.lua) keeps the block on the
page and renders its markdown right below it. Readers see the exact source of
the image they click, and that source can't drift from the case the tests check,
as a hand-made copy could. The filter belongs to the example site, not to the
panzoom extension.

List it first under `filters:` in the YAML header, at `pre-ast`:

```yaml
---
filters:
  - path: ../../_filters/show-source.lua
    at: pre-ast
  - panzoom
---
```

`pre-ast` runs it before Quarto builds figures and cross-references, so the
rendered markdown behaves as if it were written on the page. As an ordinary
filter it runs too late, so subfigure cross-references don't resolve and a
linked image keeps a link Quarto would otherwise drop.

Markdown around a code cell, such as a `.panzoom` div holding an R cell, can't
use it, because the cell runs before the filter does. Those examples show their
source in a `source` block next to a copy.

## Checking by hand

Run `quarto render`, then `caddy run` from the repo root, which serves `docs/`
on port 4242 (or `$CADDYPORT`); the front page links to the example pages.
Opening the files in `docs/` directly doesn't work, since browsers block
Quarto's module script on `file://`.

The scripts can't judge zoom smoothness on a wheel or a trackpad, touch on real
phones and tablets (iOS Safari especially), the sharpness of zoomed images, or
appearance in general. Only Chrome is tested, but desktop Firefox has been
checked by hand. Headless Chrome counts as a device without hover, so CSS that
checks `(hover: hover)` or `(pointer: fine)` treats it as a touch device.

On a phone (iOS Safari first) and in desktop Safari, open the live demo and
pages B, G, and I:

  | Check                                                                            | Where                               | Expected                                                    |
  | -------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
  | Tap                                                                              | any marked image                    | the viewer opens                                            |
  | Pinch and drag                                                                   | page B, Grouped cells               | zooms toward the fingers, pans, stays on screen             |
  | Pinch with a finger on the background                                            | page B, Grouped cells               | the viewer stays open                                       |
  | Double-tap                                                                       | a zoomed image                      | back to the opening view                                    |
  | Swipe                                                                            | page B, Markdown subfigures         | the next image                                              |
  | Scroll a long description                                                        | page G, Long description            | it scrolls; the image and page don't move                   |
  | Rotate the phone, or resize the window                                           | any open image                      | refits; a long caption still scrolls                        |
  | Close                                                                            | the × button, or tap the background | closes; the page is where it was                            |
  | Tab, Enter, and Esc (desktop Safari, with "Press Tab to highlight each item" on) | page G, Long description            | Tab reaches the description; Esc returns focus to the image |
  | Wide figure                                                                      | page H                              | opens at screen height and pans sideways                    |

## Troubleshooting

- **Console errors about CORS or `file://`**: the page was opened as a file. Use
  `caddy run` or the test scripts, which serve it over HTTP.
- **`Failed to launch the browser process`**: the scripts can't find Chrome. Run
  `quarto install chrome-headless-shell --no-prompt`, or set `CHROME=`.
- **`... is not a file inside ...`**: the scripts only check rendered pages in
  this repo. Render first, and pass paths like
  `../docs/examples/d-selecting-r.html`.

## Credits

Cases 1, 2, and 9–11 on A–D come from the example document of
[quarto-ext/lightbox](https://github.com/quarto-ext/lightbox) (MIT, © Posit
Software) and Quarto's lightbox docs. The photos in [../images/](../images/) are
quarto-ext/lightbox's, from Unsplash under the [Unsplash
license](https://unsplash.com/license): [Chilmark
Beach](https://unsplash.com/photos/VBDJGOMCwps),
[Aquinnah](https://unsplash.com/photos/2iQnDPLIXwU), [Gingerbread
House](https://unsplash.com/photos/HQEtvlNzUyA), [Edgartown
Light](https://unsplash.com/photos/f59MyOfLpi8), [Edgartown
Sailboat](https://unsplash.com/photos/IiLiz7XpQpI).
