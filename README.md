# panzoom

**Live demo:** <https://sekoclancy.github.io/panzoom/>

A [Quarto](https://quarto.org) filter extension for HTML formats that opens
figures in a full-screen pan/zoom viewer, built on
[Panzoom](https://github.com/timmywil/panzoom): scroll (or trackpad pinch) to zoom
toward the cursor, drag or Shift+scroll to pan, double-click or `0` to reset,
`+`/`-` to zoom, `Esc` or a background click to close. The image stays on
screen: panning stops at its edges, with a small bounce (or, when dragging,
a stretch that springs back) to show you've reached one.

It works from the keyboard too: marked images can be reached with `Tab` and
opened with `Enter` or `Space`, the arrow keys pan, and closing returns focus
to the image.

It attempts to match, and extend, the feature set of Quarto's built-in
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html).

## Features

- **Zoom:** scroll or pinch toward the cursor, in steps up to `max-zoom`,
  instead of one click between fit and real size (which the lightbox turns
  off on screens 768 px wide or less).
- **Pan:** drag, arrow keys or Shift+scroll at any zoom; the image stops at
  its edges with a bounce.
- **Captions:** math is typeset (the lightbox shows raw TeX); a subfigure
  shows its own caption with the parent figure's caption below.
- **Very wide or tall figures:** open at screen height (or width), at the
  spot you clicked.
- **Galleries:** `←`/`→` pan an image larger than the screen;
  `PageUp`/`PageDown` change image.
- **Layouts:** figures in Quarto layouts (`layout-ncol`, `layout-nrow`,
  layout divs) open one at a time; subfigures form a gallery.
- **Linked images:** an image inside a link keeps its link.

## Installation

You can install this extension using the Quarto CLI:

```bash
quarto add sekoclancy/panzoom
```

This will install the extension under the `_extensions` subdirectory.
If you're using version control, you will want to check in this directory.

## Usage

Turn the filter on for one document in its YAML header, or for every page
of a Quarto project (website, book) in `_quarto.yml`:

```yaml
filters:
  - panzoom
```

Options, all optional, go under `panzoom:` in the same place:

```yaml
panzoom:
  match: auto     # auto: all block images; omit this parameter for only marked images (default)
  max-zoom: 4     # number: screen px per image px (default 4)
  hint: true      # boolean: show the controls hint at the bottom (default true)
  caption: true   # boolean: show the figure caption in the viewer (default true)
  loop: false     # boolean: in a gallery, wrap from the last image to the first (default false)
  fit: auto       # auto, contain, height or width (default auto, see below)
```

`max-zoom`, `hint`, `caption` and `fit` can also be set per cell under
`#| panzoom:`, along with `group` and `description`.

Then mark images in any of these ways.

**Code cells:** use the `panzoom` cell option.

````markdown
```{r}
#| panzoom: true
plot(pressure)
```
````

Give it options instead of `true` to override the document settings for that
cell:

````markdown
```{r}
#| panzoom:
#|   max-zoom: 8
#|   hint: false
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

To exclude one image (inside a `.panzoom` div, or with `match: auto`), give
it `.nopanzoom`. To exclude a whole cell, use `#| panzoom: false`.

Labeled figures and subfigure layouts (`fig-subcap`, `layout-ncol`) work as
well.

`#| panzoom:` overrides `#| lightbox:` options.

### Captions and galleries

The viewer shows the figure's caption under the image, including its
"Figure N:" prefix and any math. A subfigure shows its own caption with
the parent figure's caption below it. Turn captions off with
`caption: false` (for the document or one cell).

A description, written in Markdown (with math, links, emphasis), is shown
under the caption, as for Quarto's lightbox:

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

Images in the same group form a gallery: step through them with the
‹ › buttons, `PageUp`/`PageDown`, `←`/`→` or a horizontal swipe (the last
two pan instead while the image is wider than the screen). Groups work
like Quarto's
lightbox:

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

### Very wide or tall figures

With `fit: auto`, the viewer opens most images whole. A strip, at least 3
times wider than tall, that would show less than a quarter of the screen
tall, such as a collage of many panels (`fig-width: 100`, `fig-height: 5`),
opens filling the screen height instead; drag or use `←`/`→` to move
along it. A strip at least 3 times taller than wide opens
filling the screen width, at its top. Ordinary photos and plots, portrait
or landscape, always open whole. No image is enlarged past its real size
when it opens (as with Quarto's lightbox): a small image opens at its own
size, and scrolling still zooms it in, up to `max-zoom`.

**Focal point.** Where you click a strip on the page is its focal point:
click panel 12 of a 20-panel collage and the viewer opens with panel 12 in
the middle of the screen (or flush with the end, near either end). `0` and
double-click return to it. Opened from the keyboard, a strip
starts at its left end (or top). Ordinary images open whole wherever you
click.
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

In a gallery, `←`/`→` and swipes pan an image that is larger than the
screen (or do nothing, if it fits sideways); use `PageUp`/`PageDown` or the
‹ › buttons to change images.

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
quarto-ext/lightbox examples; ragg makes the webp figures).

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

The Node.js library that controls Chrome. `tests/package.json` lists
`puppeteer-core` (the variant that uses an existing Chrome instead of
downloading its own), and `tests/package-lock.json` pins its version. From
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

See `tests/README.md` for setup and running the tests.
