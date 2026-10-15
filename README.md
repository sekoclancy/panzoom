# panzoom

**Live demo:** <https://sekoclancy.github.io/panzoom/>

**Reference:** <https://sekoclancy.github.io/panzoom/reference.html>

A [Quarto](https://quarto.org) extension that opens figures in a
full-screen viewer to zoom and pan, built on
[Panzoom](https://github.com/timmywil/panzoom).

## Features

panzoom covers what Quarto's
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html)
does and adds to it. The two work in one document: images panzoom marks
are left out of the lightbox, and `#| panzoom:` overrides `#| lightbox:`.

- Zoom toward the cursor with scroll or pinch, in steps up to `max-zoom`
  (the lightbox only toggles between fit and real size, and not at all on
  screens 768 px wide or less)
- Pan at any zoom, by dragging, with the arrow keys or Shift+scroll
- [Captions and descriptions](#captions-and-descriptions) with math,
  citations and cross-references (the lightbox shows raw TeX and `[@key]`)
- [Galleries and layouts](#galleries-and-layouts) from groups, subfigures
  and figure layouts
- [Wide and tall figures](#wide-and-tall-figures) open readable, at the
  spot you clicked
- Applies to every figure (`panzoom: true`) or only the images you mark,
  in code cells or markdown
- Keyboard access, and Quarto's light and dark themes; [restyle it](#styling)
  with CSS
- [Math](#math) in any `html-math-method`, offline too; works in
  [self-contained documents](#self-contained-documents) and
  [without JavaScript](#without-javascript)

Not offered (the lightbox has these):

- Caption position: the caption is always below the image (no
  `desc-position`)
- Opening effects: the viewer opens and closes at once (no `effect`)

## Installation

You can install this extension using the Quarto CLI (it needs Quarto 1.9
or later):

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

### Every figure, or only marked ones

With `panzoom: true`, every figure opens in the viewer, as does any image
alone in its own paragraph. Images inside a line of text are left out.
These are the same images Quarto's `lightbox: true` takes.

```yaml
filters:
  - panzoom
panzoom: true
```

As with `lightbox:`, `panzoom: auto` is the same as `true`, and
`panzoom: false` turns panzoom off for the document, even for marked
images. Without the setting, only the images you mark open in the viewer
(see [Marking images](#marking-images)).

### Options

Options go under `panzoom:` in place of `true`:

```yaml
panzoom:
  match: auto     # every figure, as panzoom: true; leave out for only marked images
  max-zoom: 4     # number: screen px per image px (default 4)
  hint: true      # boolean: show the controls hint at the bottom (default true)
  caption: true   # boolean: show the figure caption in the viewer (default true)
  loop: false     # boolean: in a gallery, wrap from the last image to the first (default false)
  fit: auto       # auto, contain, height or width (default auto, see Wide and tall figures)
  css-class: my-viewer  # a class added to the viewer, for styling it (see Styling)
  backdrop: "#000"            # colours (see Styling): the layer over the page,
  caption-background: "#000"  # the caption band,
  caption-color: "#eee"       # caption, description and hint text,
  link-color: "#9cf"          # and links in captions (defaults follow the theme)
```

A code cell can set `max-zoom`, `hint`, `caption` and `fit` for its own
plots, as well as `group` and `description`, by giving `#| panzoom:`
options instead of `true`:

````markdown
```{r}
#| panzoom:
#|   max-zoom: 8
#|   hint: false

plot(pressure)
```
````

A misspelled option or a wrong value stops the render, with the same kind
of message Quarto gives for a bad `lightbox:` option, all mistakes at once:

```
ERROR: Validation of panzoom options failed.
ERROR: In file index.qmd
property name max-zom is invalid
ℹ The error happened in location panzoom:max-zom.
ℹ Did you mean max-zoom?
```

Cell options are checked too, which Quarto doesn't do for `#| lightbox:`.
Unlike Quarto, which checks its options before running any code, panzoom
can only check them once the page's code has run, and the message gives
no line number.

### Marking images

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

This also works for an image inside a line of text, which `panzoom: true`
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

To exclude one image (inside a `.panzoom` div, or with `panzoom: true`),
give it `.nopanzoom`. To exclude a whole cell, use `#| panzoom: false`. An
image inside a link is left alone, so it keeps its link.

### Viewer controls

| Action | Mouse | Keyboard |
|---|---|---|
| Zoom | scroll, toward the cursor | + and - |
| Pan | drag, or Shift+scroll | arrow keys |
| Go back to the opening view | double-click | 0 |
| Change image in a gallery | the previous and next buttons | left and right arrow |
| Close | the × button, or click the background | Esc |

Zoom goes in small steps, up to `max-zoom`. Panning stops at the image's
edges, with a small bounce (or, when dragging, a stretch that springs back)
to show you've reached one.

From the keyboard, marked images can be reached with Tab and opened with
Enter or Space; Tab moves between the viewer's buttons, and closing returns
focus to the image.

As with Quarto's lightbox, the page shows through a dark overlay, and the
caption takes the page's own colours, so the viewer follows Quarto's light
and dark themes.

### Captions and descriptions

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

### Galleries and layouts

Images in the same group form a gallery, stepped through with the
previous and next buttons, the left and right arrow keys or a sideways
swipe. While an image is larger than the screen (zoomed in, or a wide
figure), the arrow keys and swipes pan it instead, and the buttons change
image. Groups work like Quarto's lightbox:

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

Labeled figures and figures in layouts (`layout-ncol`, `layout-nrow`,
layout divs) work too: each image in a layout opens on its own, and
subfigures form a gallery.

### Wide and tall figures

Most images open whole. A very wide figure, such as a collage of many
panels, would be too thin to read that way, so it opens at screen height,
at the spot you clicked; drag or use the left and right arrow keys to move
along it. A very tall figure opens at screen width, from its top. No image
opens larger than its real size. The [live demo's page H](https://sekoclancy.github.io/panzoom/tests/pages/h-wide.html)
has the exact rules, with examples of each shape.

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

### Math

Math in captions and descriptions shows as it does on the page, with any
`html-math-method` (MathJax, KaTeX, MathML, WebTeX, plain).

Quarto loads MathJax and KaTeX from the web, so without a connection math
shows as raw TeX, on the page and in the viewer. To make a file whose math
works offline, render it (with a connection) using MathJax and
`self-contained-math`:

```yaml
embed-resources: true
self-contained-math: true
```

Math is then typeset offline, in system fonts rather than MathJax's own
(Quarto doesn't embed those). MathML (`html-math-method: mathml`) needs no
library at all, so it works offline without embedding anything.

### Self-contained documents

panzoom works in a self-contained document, a single HTML file you can
email or open from disk. The viewer needs no internet access: it and the
Panzoom library are bundled with the extension.

```yaml
filters:
  - panzoom
embed-resources: true
```

### Without JavaScript

A click on a marked image opens the image file itself, as with Quarto's
lightbox. (In a self-contained file that link leads nowhere, for both.)

### Styling

The viewer takes the page's light or dark theme. To change its colours,
use the options, or set the CSS variables they stand for in your own CSS
(a `css:` file, or the theme's `.scss`):

| Option | CSS variable | Element | Default |
|---|---|---|---|
| `backdrop` | `--panzoom-backdrop` | The layer over the page | `rgba(0, 0, 0, 0.7)` |
| `caption-background` | `--panzoom-bg` | The caption band | The page's background |
| `caption-color` | `--panzoom-fg` | Caption, description and hint | The page's text colour |
| `link-color` | `--panzoom-link` | Links in captions | The page's link colour |

```yaml
panzoom:
  backdrop: "#000"
  caption-background: "#000"
  caption-color: "#eee"
```

The live demo's [Styling pages](https://sekoclancy.github.io/panzoom/reference.html#styling)
show both ways. In CSS, for every viewer on the site:

```css
.panzoom-overlay { --panzoom-backdrop: #000; }
```

For some documents only, give the viewer a class with `css-class`, as with
Quarto's lightbox, and write the rule for that class:

```yaml
panzoom:
  css-class: dark-viewer
```

```css
.dark-viewer { --panzoom-backdrop: #000; --panzoom-bg: #000; --panzoom-fg: #eee; }
```

Unlike Quarto's lightbox, which turns `css-class: foo` into the class
`glightbox-foo` and drops its default style, panzoom adds the class as
written, next to its own.

To set `css-class` (or any option) for a whole site, put it under
`format: html:` in `_quarto.yml`. A top-level `panzoom:` there is replaced,
not merged, by a page's own `panzoom:` options, as Quarto's `lightbox:` is.

The viewer's parts have their own classes, for anything the variables
don't cover: `.panzoom-footer` (the caption band), `.panzoom-caption`,
`.panzoom-description`, `.panzoom-hint`, `.panzoom-close`, `.panzoom-prev`,
`.panzoom-next` and `.panzoom-counter`. Start the selector with the
viewer's class, as in `.dark-viewer .panzoom-caption`, so it wins over
panzoom's own rules.

## Development

Setup, with [uv](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/sekoclancy/panzoom && cd panzoom
uv venv .venv                               # creates the venv with Python 3.14
uv pip install -r tests/requirements.txt    # matplotlib, ipykernel, etc.
```

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

The tests, their setup and what each one checks are in
[tests/README.md](tests/README.md).
