# panzoom

> [!WARNING]
> This extension is experimental and not guaranteed to work. Its behavior may
> change without notice.

**Live demo:** <https://sekoclancy.github.io/panzoom/>

A [Quarto](https://quarto.org) extension that opens figures in a full-screen
viewer, built on [Panzoom](https://github.com/timmywil/panzoom) and inspired by
the built-in Quarto
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html).

## Installation

You can install this extension using the Quarto CLI (Quarto >=1.8.27):

```bash
quarto add sekoclancy/panzoom
```

This will install the extension under the `_extensions` subdirectory. If you're
using version control, you will want to check in this directory.

## Demo

![Opening a gallery image, zooming with the wheel, dragging, resetting with a
double-click, stepping to the next image, and panning a wide figure with
Ctrl/Cmd+arrow keys.](images/demo.gif)

## Viewer controls

  | Action                                 | Mouse or touch                                                              | Keyboard             |
  | -------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
  | Zoom                                   | scroll or pinch, toward the cursor                                          | + and -              |
  | Pan                                    | drag, Shift+scroll (sideways), or Alt+scroll (up and down; Option on a Mac) | Ctrl/Cmd+arrow keys  |
  | Go back to the opening view            | double-click or double-tap                                                  | 0                    |
  | Change image in a gallery              | the previous and next buttons, or swipe                                     | left and right arrow |
  | Hide or show captions and descriptions |                                                                             | c                    |
  | Hide or show hints                     |                                                                             | h                    |
  | Close                                  | the × button, a click on the background, or the browser Back button         | Esc                  |

The [`keys`](#keys) option changes the keys for zooming, resetting, hiding
captions or hints, and closing. Zoom goes up to `max-zoom`. Left and Right
always change the gallery image; Ctrl/Cmd+arrow pans instead, in any direction,
while the image is larger than the screen (zoomed in, or a wide figure).

From the keyboard, selected images can be reached with Tab and opened with Enter
or Space; Tab moves between the viewer's buttons, links, and any caption or
description too long to fit, which the arrow keys then scroll. Closing returns
focus to the image.

## Features

- Zoom toward the cursor with scroll or pinch, in steps up to `max-zoom`
  (lightbox only toggles between fit and real size, and not at all on screens
  768 px wide or less)
- Pan by dragging, using the arrow keys, Shift+scroll, or Alt+scroll
- [Captions](#captions) and [descriptions](#descriptions) with math, citations,
  and cross-references (lightbox shows raw TeX and `[@key]` in the viewer)
- [Galleries](#galleries) from groups and subfigures, and figure
  [layouts](#layouts)
- [Wide and tall figures](#wide-and-tall-figures) open readable, at the spot you
  clicked
- Applies to every figure (`panzoom: true`) or only the images you select, in
  code cells or markdown
- Keyboard access; [restyle it](#styling) with options or CSS, for a page or a
  single image
- [Math](#math) in any `html-math-method`, offline too; works in [self-contained
  documents](#self-contained-documents)

Not offered (lightbox has this):

- Opening effects: the viewer opens and closes at once (no `effect`)

## Usage

panzoom is a filter: turn it on for one document in the YAML header at the top
of its `.qmd` file, or for every page of a Quarto project (website, book) in
`_quarto.yml`:

```yaml
---
filters:
  - panzoom
---
```

The other YAML examples below work in either place.

### Global Panzoom

Add `panzoom: true` to the same header to open every figure in the viewer, and
any image alone in its own paragraph, except images given the `.nopanzoom`
class. These are the same images `lightbox: true` takes.

```yaml
---
filters:
  - panzoom
panzoom: true
---
```

`panzoom: auto` is the same as `true` (to match `lightbox:` options), and
`panzoom: false` turns panzoom off for the document, even for selected images.
Without the setting, only the images you select open in the viewer.

### Selecting images

To open specific images without `panzoom: true`, select them directly.

In a code cell, use the `panzoom` cell option:

````markdown
```{r}
#| panzoom: true

plot(pressure)
```
````

On a markdown image, use the `.panzoom` class:

```markdown
![Caption](figure.png){.panzoom}
```

The `.panzoom` class also opens an image inside a line of text, which
`panzoom: true` does not match:

```markdown
Some text with an inline image ![](image.jpg){.panzoom width=60px} in the middle.
```

To select every image in a block, wrap it in a `.panzoom` div:

```markdown
::: {.panzoom}
![](a.png)
![](b.png)
:::
```

To leave out a code cell's plots, use `#| panzoom: false`; to leave out a
markdown image, give it `.nopanzoom`. An image inside a link keeps its link.

### Options

Options go under `panzoom:` in the document's YAML header, in place of `true`:

```yaml
---
panzoom:
  match: auto     # every figure, same as panzoom: true; omit to apply only to selected images
  max-zoom: 4     # number: screen pixels per image pixel, at most (default 4)
  hint: true      # true or show, hide (starts hidden; h shows it), or false (none): the controls hint, except when opened by a tap (default true)
  caption: true   # boolean: show the figure caption in the viewer (default true)
  loop: false     # boolean: in a gallery, wrap from the last image to the first (default false)
  fit: auto       # auto, contain, height, or width (default auto, see Wide and tall figures)
  desc-position: bottom  # bottom, top, left, or right: where the caption goes (default: where the page has it, see Captions)
  css-class: my-viewer  # an extra class on the viewer, for styling it (default none; see Styling)
  keys:           # the viewer's keys (see Keys)
    caption: k
  backdrop: black             # colors (see Styling): the layer over the page,
  panel-background: black     # the band or side panel with the caption,
  panel-color: white          # caption, description, and hint text,
  link-color: lightblue       # and links in captions (defaults follow the theme)
---
```

A code cell can set `max-zoom`, `hint`, `caption`, `fit`, `desc-position`,
`css-class`, and the colors for its own plots, as well as `group` and
`description`, by giving `#| panzoom:` options instead of `true`. A cell's
options win over the document's:

````markdown
```{r}
#| panzoom:
#|   max-zoom: 8
#|   hint: false

plot(pressure)
```
````

A misspelled option or a wrong value stops the render (matching Quarto
`lightbox` behavior).

```
ERROR: Validation of panzoom options failed.
ERROR: In file index.qmd
property name max-zom is invalid
ℹ The error happened in location panzoom:max-zom.
ℹ Did you mean max-zoom?
```

### Keys

`keys` in the YAML header sets the viewer keys. Actions left out keep their
defaults:

```yaml
---
panzoom:
  keys:
    caption: k          # one key
    hint: false         # no key
    close: [Escape, q]  # several keys
---
```

  | Action                                               | Default      |
  | ---------------------------------------------------- | ------------ |
  | `caption` (hide or show the caption and description) | `c`          |
  | `hint` (hide or show the hint line)                  | `h`          |
  | `close`                                              | `Escape`     |
  | `reset` (go back to the opening view)                | `"0"`        |
  | `zoom-in`                                            | `["+", "="]` |
  | `zoom-out`                                           | `"-"`        |

A key is one character, or `Escape`, `Backspace`, `Delete`, or `Insert`. Tab,
Enter, Space, the arrows, Page Up, Page Down, Home, and End are fixed. A key can
only do one action. The hint line names the keys in use.

### Captions

The viewer shows the figure's caption, with its number, math, inline code,
citations, and cross-references, where the page has it: under the image, above
it with `fig-cap-location: top`, or beside it on the margin side with
`fig-cap-location: margin`. Turn it off with `caption: false`.

`desc-position` puts the caption and description under the image (`bottom`),
above it (`top`), or beside it (`left`, `right`) instead, for a document, a code
cell, or one image. On a screen narrower than 769 px, `left` and `right` show
below, as in lightbox:

```markdown
![Beach](beach.jpg){.panzoom desc-position="left"}
```

The caption text and colors match lightbox. The layout differs: the band spans
the screen width, and a side panel sits at the screen edge, so the image keeps
the rest of the screen to zoom and pan in.

### Descriptions

A markdown description is shown under the caption:

```markdown
![Beach](beach.jpg){.panzoom description="The best beaches. **Credit:** [Unsplash](https://unsplash.com)"}
```

or for a code cell's plots:

````markdown
```{r}
#| panzoom:
#|   description: "Pressure rises with temperature, $p \\propto e^{-1/T}$."

plot(pressure)
```
````

### Galleries

Subfigures of one figure form a gallery on their own. Other images join one with
a group name, on markdown images:

```markdown
![](a.png){.panzoom group="beach"}
![](b.png){.panzoom group="beach"}
```

or for all of a cell's plots:

````markdown
```{r}
#| panzoom:
#|   group: pressure

plot(pressure)
plot(pressure, log = "y")
```
````

or for every image in a `.panzoom` div:

```markdown
::: {.panzoom group="beach" layout-ncol="2"}
![](a.png)

![](b.png)
:::
```

### Layouts

Figures in layouts (`layout-ncol`, `layout-nrow`, layout divs) work too. Each
image in a layout opens on its own, and subfigures form a gallery.

### Wide and tall figures

panzoom opens each figure according to its shape:

  | Figure                                | Opens                                     | Same as        |
  | ------------------------------------- | ----------------------------------------- | -------------- |
  | Most images                           | whole, never larger than real size        | `fit: contain` |
  | Very wide (e.g. a row of many panels) | at screen height, at the spot you clicked | `fit: height`  |
  | Very tall                             | at screen width, from the top             | `fit: width`   |

The [wide and tall figures
example](https://sekoclancy.github.io/panzoom/examples/h-wide-and-tall-r.html)
has the exact rules and an example of each shape. To choose the behavior
explicitly for one figure, set `fit` in its code cell:

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

or for a whole document, in its YAML header:

```yaml
---
panzoom:
  match: auto
  fit: contain    # every figure opens whole
---
```

### Self-contained documents

panzoom works in a self-contained document with no internet access. In the YAML
header:

```yaml
---
filters:
  - panzoom
embed-resources: true
---
```

MathJax, the Quarto default, loads its fonts from the internet even with
`self-contained-math: true` set. For math that works fully offline, use
`html-math-method: mathml`, or `katex` with:

```yaml
---
embed-resources: true
self-contained-math: true
---
```

### Math

Math in captions and descriptions is displayed in the viewer. MathJax and KaTeX
need an internet connection by default; see Self-contained documents above for
offline setup.

### Styling

Set the viewer's colors with the `panzoom` options, or with the CSS variables
they stand for:

  | Option             | CSS variable         | Element                                 | Default              |
  | ------------------ | -------------------- | --------------------------------------- | -------------------- |
  | `backdrop`         | `--panzoom-backdrop` | The layer over the page                 | `rgba(0, 0, 0, 0.7)` |
  | `panel-background` | `--panzoom-panel-bg` | The band or side panel with the caption | Page background      |
  | `panel-color`      | `--panzoom-panel-fg` | Caption, description, and hint          | Page text color      |
  | `link-color`       | `--panzoom-link`     | Links in captions                       | Page link color      |

Set the options in the YAML header to style every viewer in the document:

```yaml
---
panzoom:
  backdrop: rgba(0, 0, 0, 0.9)   # any CSS color: rgba(),
  panel-background: "#222"       # hex (quoted, for YAML),
  panel-color: white             # or a name
---
```

A color can also be a
[`_brand.yml`](https://quarto.org/docs/authoring/brand.html) color: a `palette`
name, or a role such as `primary` or `background`. With a light and a dark
brand, it follows the theme. `panel-colour` and `link-colour` work too.

Set the CSS variables in a stylesheet (a `css:` file, or the theme's `.scss`) to
style every viewer on the site:

```css
.panzoom-overlay {
  --panzoom-backdrop: black;
  --panzoom-panel-bg: black;
  --panzoom-panel-fg: white;
}
```

Or set them inline, in the document's `include-in-header`:

```yaml
---
include-in-header:
  text: |
    <style>
    .panzoom-overlay {
      --panzoom-backdrop: black;
    }
    </style>
---
```

For some documents only, set `css-class: dark-viewer` and write the same rule
for `.dark-viewer`.

These variables have no option, only CSS:

  | CSS variable                | Element                                        | Default              |
  | --------------------------- | ---------------------------------------------- | -------------------- |
  | `--panzoom-button-bg`       | Close, previous, and next buttons, and counter | `rgba(0, 0, 0, 0.6)` |
  | `--panzoom-button-fg`       | Their text and focus ring                      | `#eee`               |
  | `--panzoom-panel-min-width` | Side panel (`desc-position` `left` or `right`) | `min(12rem, 32vw)`   |
  | `--panzoom-panel-max-width` | Side panel, which is as wide as its text needs | `min(22rem, 32vw)`   |

To style one image differently, give its code cell the same options under
`#| panzoom:`, or write them as attributes on a markdown image; they override
the document's options while that image is open:

````markdown
```{r}
#| panzoom:
#|   backdrop: darkred
#|   css-class: poster-viewer

plot(pressure)
```

![A photo.](photo.jpg){.panzoom panel-background="#222" panel-color="white"}
````

The [color
options](https://sekoclancy.github.io/panzoom/examples/n-color-options-r.html)
and [styling with
CSS](https://sekoclancy.github.io/panzoom/examples/o-css-r.html) examples
demonstrate setting colors through options and through CSS, and list the classes
of the viewer's parts.

## Development

### Setup

Building the site needs [uv](https://docs.astral.sh/uv/) for the Python examples
and [rv](https://github.com/A2-ai/rv) for the R examples:

```bash
git clone https://github.com/sekoclancy/panzoom && cd panzoom
uv sync          # Python packages, from uv.lock
rv sync          # R packages, from rv.lock
```

### Build and preview

```bash
quarto render    # build the site into docs/
caddy run        # serve docs/ on port 4242 (or $CADDYPORT)
```

### Tests

See [tests/README.md](tests/README.md) for the suites and their setup.

### Publish

```bash
quarto publish gh-pages --no-prompt --no-browser
```

The first publish needs a `gh-pages` branch. Create it once, without touching
the working tree:

```bash
git branch gh-pages $(git commit-tree $(git hash-object -t tree /dev/null) -m "Initializing gh-pages branch")
git push origin gh-pages
```

### Update packages

```bash
uv lock --upgrade && uv sync    # Python, then commit uv.lock
rv upgrade                      # R, then commit rv.lock
```

R packages come from a dated snapshot, the `p3m.dev/cran/<date>` URL in
`rproject.toml`. Move its date forward first to get newer versions.
