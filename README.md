# panzoom

**Live demo:** <https://sekoclancy.github.io/panzoom/>

A [Quarto](https://quarto.org) extension that opens figures in HTML
documents in a full-screen viewer where you can zoom and pan, built on
[Panzoom](https://github.com/timmywil/panzoom). Use it for every figure, or
for the ones that need a closer look alongside Quarto's built-in
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html)
for the rest. See [Compared with Quarto's lightbox](#compared-with-quartos-lightbox)
for how the two differ.

## Installation

You can install this extension using the Quarto CLI:

```bash
quarto add sekoclancy/panzoom
```

This will install the extension under the `_extensions` subdirectory.
If you're using version control, you will want to check in this directory.

## Usage

panzoom is a filter: turn it on for one document in its YAML header, or
for every page of a Quarto project (website, book) in `_quarto.yml`:

```yaml
filters:
  - panzoom
```

Then mark images in any of these ways.

**Code cells** (R with knitr, or Python and others with Jupyter): use the
`panzoom` cell option.

````markdown
```{r}
#| panzoom: true

plot(pressure)
```
````

**Markdown images:** use the class directly.

```markdown
![Caption](figure.png){.panzoom}
```

This also works for an image inside a line of text, which `match: auto`
skips:

```markdown
Some text with an inline image ![](image.jpg){.panzoom width=60px} in the middle.
```

**Any block:** wrap it in a div.

```markdown
::: {.panzoom}
![](a.png)
![](b.png)
:::
```

**Every figure:** set `match: auto` (see [Options](#options)) to mark all
block images, the same ones Quarto's `lightbox: auto` takes.

To exclude one image (inside a `.panzoom` div, or with `match: auto`), give
it `.nopanzoom`. To exclude a whole cell, use `#| panzoom: false`.

Labeled figures and figures in layouts (`layout-ncol`, `layout-nrow`,
layout divs) work as well: each image opens on its own, and subfigures form
a [gallery](#galleries). An image inside a link is left alone, so it keeps
its link.

Marked images are left out of Quarto's lightbox, and `#| panzoom:`
overrides `#| lightbox:` options, so the two can be used in one document.

### Options

Options, all optional, go under `panzoom:` next to `filters:`:

```yaml
panzoom:
  match: auto     # auto: all block images; omit this parameter for only marked images (default)
  max-zoom: 4     # number: screen px per image px (default 4)
  hint: true      # boolean: show the controls hint at the bottom (default true)
  caption: true   # boolean: show the figure caption in the viewer (default true)
  loop: false     # boolean: in a gallery, wrap from the last image to the first (default false)
  fit: auto       # auto, contain, height or width (default auto, see Very wide or tall figures)
```

`max-zoom`, `hint`, `caption` and `fit` can also be set per cell, along
with `group` and `description`, by giving `#| panzoom:` options instead of
`true`:

````markdown
```{r}
#| panzoom:
#|   max-zoom: 8
#|   hint: false

plot(pressure)
```
````

## Using the viewer

| To | Mouse or trackpad | Keyboard |
|---|---|---|
| Zoom | scroll, or pinch, toward the cursor | + and - |
| Pan | drag, or Shift+scroll | arrow keys |
| Go back to the opening view | double-click | 0 |
| Change image in a gallery | the ‹ › buttons, or swipe sideways | ← and → |
| Close | the × button, or click the background | Esc |

Zoom goes in small steps, up to `max-zoom`. Panning stops at the image's
edges, with a small bounce (or, when dragging, a stretch that springs back)
to show you've reached one.

From the keyboard, marked images can be reached with Tab and opened with
Enter or Space; Tab moves between the viewer's buttons, and closing returns
focus to the image.

The viewer is a dark overlay with light text, so it looks the same under
Quarto's light and dark themes.

## Captions and descriptions

The viewer shows the figure's caption under the image, including its
"Figure N:" prefix, math, citations and cross-references. A subfigure shows
its own caption with the parent figure's caption below it. Turn captions
off with `caption: false` (for the document or one cell).

A description, written in Markdown (with math, links, emphasis,
citations and cross-references), is shown under the caption, as for
Quarto's lightbox. It is rendered with the page, so a work cited only in a
description is still listed under References:

```markdown
![Beach](beach.jpg){.panzoom description="The best beaches. **Credit:** [Unsplash](https://unsplash.com)"}
```

or for all of a cell's plots:

````markdown
```{r}
#| panzoom:
#|   description: "Pressure rises with temperature, $p \propto e^{-1/T}$."

plot(pressure)
```
````

Math in captions and descriptions shows as it does on the page, with any
`html-math-method` (MathJax, KaTeX, MathML, WebTeX, plain).

## Galleries

Images in the same group form a gallery, stepped through with the ‹ ›
buttons, ←/→ or a sideways swipe. While an image is larger than the screen
(zoomed in, or a wide figure), ←/→ and swipes pan it instead, and the
buttons change image. Groups work like Quarto's lightbox:

- subfigures of one figure are a gallery automatically,
- `group="name"` on markdown images,
- `group: name` in a cell's `#| panzoom:` options (all of the cell's plots).

````markdown
```{r}
#| panzoom:
#|   group: pressure

plot(pressure)
plot(pressure, log = "y")
```
````

## Very wide or tall figures

With `fit: auto`, the viewer opens most images whole. A strip, at least 3
times wider than tall, that would show less than a quarter of the screen
tall, such as a collage of many panels (`fig-width: 100`, `fig-height: 5`),
opens filling the screen height instead; drag or use ←/→ to move along it.
A strip at least 3 times taller than wide, that would show less than a
quarter of the screen wide, opens filling the screen width, at its top.
Ordinary photos and plots, portrait or landscape, always open whole, even
on a very wide screen where a portrait photo is narrower than a quarter of
it. No image is enlarged past its real size when it opens (as with
Quarto's lightbox): a small image opens at its own size, and scrolling
still zooms it in, up to `max-zoom`.

**Focal point.** Where you click a strip on the page is its focal point:
click panel 12 of a 20-panel collage and the viewer opens with panel 12 in
the middle of the screen (or flush with the end, near either end). The 0
key and double-click return to it. Opened from the keyboard, a strip starts
at its left end (or top). Ordinary images open whole wherever you click.
Zooming out still shows the whole figure.

Override it per figure with `fit: contain` (always open whole), `fit:
height` or `fit: width`:

````markdown
```{r}
#| panzoom:
#|   fit: contain
#| fig-width: 25
#| fig-height: 2

par(mfrow = c(1, 12), mar = c(3, 3, 2, 1))
for (i in 1:12) plot(cumsum(rnorm(200)), type = "l", main = paste("Panel", i))
```
````

Shift+scroll (or a sideways trackpad swipe) pans along the direction the
figure extends past the screen: sideways for a collage, up and down for a
tall figure, sideways when zoomed in both ways.

## Without JavaScript

Each marked image is wrapped in a link to its own file, as Quarto's
lightbox does. With JavaScript running, panzoom stops the link and opens
the viewer instead. Without it (blocked, failed to load, or not loaded
yet), a click opens the full image in the same tab, where the browser's
own image view fits it to the window and shows it at real size on a
click; Back returns to the page. An image already inside a link keeps that
link.

## Self-contained and offline documents

panzoom works in a self-contained document, a single HTML file you can
email or open from disk:

```yaml
filters:
  - panzoom
embed-resources: true
```

The viewer needs no internet access: it and the Panzoom library are
bundled with the extension. Quarto loads MathJax and KaTeX from the web,
though, so without a connection math in the page, and in the viewer's
captions and descriptions, shows as raw TeX. To make a file whose math
works offline too, render it (with a connection) using MathJax and
`self-contained-math`:

```yaml
embed-resources: true
self-contained-math: true
```

Math is then typeset offline, in system fonts rather than MathJax's own
(Quarto doesn't embed those). MathML (`html-math-method: mathml`) needs no
library at all, so it works offline without embedding anything.

With JavaScript off, the links around images in a self-contained file lead
nowhere: Quarto embeds the images but not the files the links point to,
and deletes those. Quarto's lightbox links have the same problem. With
JavaScript on, the viewer shows the embedded image as usual.

## Compared with Quarto's lightbox

panzoom aims to match the lightbox's features and go further. It adds:

- **Zoom** toward the cursor in steps up to `max-zoom`, instead of one
  click between fit and real size (which the lightbox turns off on screens
  768 px wide or less), and panning at any zoom.
- **Captions** with math, citations and cross-references rendered; the
  lightbox shows raw TeX and `[@key]`.
- **Very wide or tall figures** that open readable, at the spot you
  clicked.
- **Linked images** that keep their link.

It doesn't offer:

- **Caption position:** the caption and description are always below the
  image; there is no `desc-position` (top, left, right).
- **Opening effects:** the viewer opens and closes at once, with no fade
  or zoom animation; there is no `effect`.

## Development

```bash
quarto render              # build into docs/
quarto preview             # build and open in a browser, re-rendering on save
quarto publish gh-pages --no-prompt --no-browser   # build and publish to GitHub Pages
```

`quarto publish gh-pages` pushes the rendered site to the `gh-pages` branch,
which GitHub Pages serves; `main` only holds source. `--no-prompt` skips the
confirmation, and `--no-browser` skips waiting for the site to go live, which
never happens until Pages is enabled for the repo.

One-time setup: `--no-prompt` can't create the `gh-pages` branch, so create
the empty branch once before the first publish:

```bash
git branch gh-pages $(git commit-tree $(git hash-object -t tree /dev/null) -m "Initializing gh-pages branch")
git push origin gh-pages
```

### Tools

Only needed to run the browser tests (see [Testing](#testing)), not to use
the extension. They also need [Node.js](https://nodejs.org) 22.12 or later.
Rendering the test pages needs [Quarto](https://quarto.org) 1.9+ and R
with the ragg package (they have R chunks, some taken from the
quarto-ext/lightbox examples; ragg makes the webp figures), and Python
with matplotlib for the Jupyter page (see [tests/README.md](tests/README.md)).

#### Chrome Headless Shell

The browser the tests drive, installed with the Quarto CLI into
`~/.local/share/quarto/chrome-headless-shell/` (about 115 MB):

```bash
quarto install chrome-headless-shell --no-prompt
```

`--no-prompt` skips the confirmation, so the command also works in a
non-interactive shell (a script, CI, or an agent).

To use a different Chrome or Chromium instead, set `CHROME=/path/to/chrome`
when running the tests.

#### Puppeteer

The Node.js library that controls Chrome. [tests/package.json](tests/package.json) lists
`puppeteer-core` (the variant that uses an existing Chrome instead of
downloading its own), and [tests/package-lock.json](tests/package-lock.json) pins its version. From
the repo root:

```bash
cd tests
npm install
```

### Testing

**How we test:** the same 12 figure cases (galleries, subfigures, math in
captions, linked, margin and inline images, R chunks with cell options) are
rendered four ways: with Quarto's lightbox alone as the reference,
explicitly marked images with the lightbox on for the rest, `match: auto`,
and explicitly marked images with no lightbox. A script serves the
rendered site locally, clicks every image on each page and records which
viewer opened (panzoom, Quarto's lightbox, or nothing). For the panzoom
viewer, it then checks zoom, pan, reset and closing, that key presses
don't reach the page behind it, and that it works from the keyboard alone.
It writes a report per page and a screenshot of each step for a person to
review; nothing is compared pixel by pixel.

A few more pages, outside the website, check a single self-contained HTML
file opened from disk and math with each of Quarto's math methods, and the
whole set can be run with no internet access. A separate script opens every
page with JavaScript off and checks each image's link to its file.
A benchmark weighs the viewer's files and times loading the page and
opening and closing the viewer, and fails if any of it got heavier or
slower than a saved baseline.

See [tests/README.md](tests/README.md) for setup and running the tests.
