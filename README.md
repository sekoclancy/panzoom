# panzoom

**Live demo:** <https://sekoclancy.github.io/panzoom/>

A [Quarto](https://quarto.org) extension that opens figures in a full-screen
viewer, built on [Panzoom](https://github.com/timmywil/panzoom) and inspired by
the native Quarto
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html).

> [!WARNING]
> This extension is experimental and not guaranteed to work. Its behavior may
> change without notice.

## Installation

You can install this extension using the Quarto CLI (Quarto >=1.8.27):

```bash
quarto add sekoclancy/panzoom
```

This will install the extension under the `_extensions` subdirectory. If you're
using version control, you will want to check in this directory.

### From source

To build the demo site and examples from a clone, with
[uv](https://docs.astral.sh/uv/):

```bash
git clone https://github.com/sekoclancy/panzoom && cd panzoom
uv sync          # creates .venv with Python 3.14 and the locked packages
quarto render    # build into docs/
```

See [Development](#development) to preview and publish.

## Demo

![Opening a gallery image, zooming with the wheel, dragging, resetting with a
double-click, stepping to the next image, and panning a wide figure with the
arrow keys.](images/demo.gif)

## Viewer controls

  | Action                                   | Mouse or touch                          | Keyboard             |
  | ---------------------------------------- | --------------------------------------- | -------------------- |
  | Zoom                                     | scroll or pinch, toward the cursor      | + and -              |
  | Pan                                      | drag, or Shift+scroll                   | arrow keys           |
  | Go back to the opening view              | double-click                            | 0                    |
  | Change image in a gallery                | the previous and next buttons, or swipe | left and right arrow |
  | Hide or show the caption and description |                                         | c                    |
  | Hide or show the hint line               |                                         | h                    |
  | Close                                    | the × button, or click the background   | Esc                  |

The [`keys`](#keys) option changes the keys for zooming, resetting, hiding the
caption or the hint line, and closing. Zoom goes up to `max-zoom`. While an
image is larger than the screen (zoomed in, or a wide figure), the arrow keys
and swipes pan it, and only the buttons change image.

From the keyboard, selected images can be reached with Tab and opened with Enter
or Space; Tab moves between the viewer's buttons, links, and any caption or
description too long to fit, which the arrow keys then scroll. Closing returns
focus to the image.

## Features

- Zoom toward the cursor with scroll or pinch, in steps up to `max-zoom` (the
  lightbox only toggles between fit and real size, and not at all on screens 768
  px wide or less)
- Pan by dragging, using the arrow keys, or Shift+scroll
- [Captions](#captions) and [descriptions](#descriptions) with math, citations,
  and cross-references (the lightbox shows raw TeX and `[@key]`)
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

panzoom is a filter: turn it on for one document in its YAML header, or for
every page of a Quarto project (website, book) in `_quarto.yml`:

```yaml
filters:
  - panzoom
```

### Global Panzoom

With `panzoom: true`, every figure opens in the viewer, as does any image alone
in its own paragraph. Images inside a line of text are left out. These are the
same images Quarto's `lightbox: true` takes.

```yaml
filters:
  - panzoom
panzoom: true
```

`panzoom: auto` is the same as `true` (to match `lightbox:` options), and
`panzoom: false` turns panzoom off for the document, even for selected images.
Without the setting, only the images you select open in the viewer.

### Selecting images

**Code cells**: use the `panzoom` cell option.

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

This also works for an image inside a line of text, which `panzoom: true` skips:

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

To leave out a code cell's plots, use `#| panzoom: false`; to leave out a
markdown image, give it `.nopanzoom`. An image inside a link keeps its link.

### Options

Options go under `panzoom:` in the document's YAML header, in place of `true`:

```yaml
panzoom:
  match: auto     # every figure, same as panzoom: true; omit to apply only to selected images
  max-zoom: 4     # number: screen pixels per image pixel, at most (default 4)
  hint: true      # boolean: show the controls hint at the bottom, except when opened by a tap (default true)
  caption: true   # boolean: show the figure caption in the viewer (default true)
  loop: false     # boolean: in a gallery, wrap from the last image to the first (default false)
  fit: auto       # auto, contain, height, or width (default auto, see Wide and tall figures)
  desc-position: bottom  # bottom, top, left, or right: where the caption goes (default bottom, see Captions)
  css-class: my-viewer  # an extra class on the viewer, for styling it (default none; see Styling)
  keys:           # the viewer's keys (see Keys)
    caption: k
  backdrop: black             # colors (see Styling): the layer over the page,
  caption-background: black   # the caption band,
  caption-color: white        # caption, description, and hint text,
  link-color: lightblue       # and links in captions (defaults follow the theme)
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

`keys` sets the document's viewer keys. Actions left out keep their defaults:

```yaml
panzoom:
  keys:
    caption: k          # one key
    hint: false         # no key
    close: [Escape, q]  # several keys
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

The viewer shows the figure's caption, with its number, math, citations, and
cross-references, under the image. Turn it off with `caption: false`.

`desc-position` puts the caption and description above the image (`top`), or
beside it (`left`, `right`), for a document, a code cell, or one image. On a
screen narrower than 769 px, `left` and `right` show below, as in lightbox:

```markdown
![Beach](beach.jpg){.panzoom desc-position="left"}
```

### Descriptions

A Markdown description is shown under the caption:

```markdown
![Beach](beach.jpg){.panzoom description="The best beaches. **Credit:** [Unsplash](https://unsplash.com)"}
```

or for a code cell's plots:

````markdown
```{r}
#| panzoom:
#|   description: "Pressure rises with temperature, $p \propto e^{-1/T}$."

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

### Layouts

Figures in layouts (`layout-ncol`, `layout-nrow`, layout divs) work too. Each
image in a layout opens on its own, and subfigures form a gallery.

### Wide and tall figures

Heuristic:

  | Figure                                | Opens                                     | Same as        |
  | ------------------------------------- | ----------------------------------------- | -------------- |
  | Most images                           | whole, never larger than real size        | `fit: contain` |
  | Very wide (e.g. a row of many panels) | at screen height, at the spot you clicked | `fit: height`  |
  | Very tall                             | at screen width, from the top             | `fit: width`   |

The [wide and tall figures
example](https://sekoclancy.github.io/panzoom/tests/pages/h-wide.html) has the
exact rules and an example of each shape. Set `fit:` to choose for one figure:

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

or for a whole document:

```yaml
panzoom:
  match: auto
  fit: contain    # every figure opens whole
```

### Math

Math in captions and descriptions is displayed in the viewer.

MathJax and KaTeX are loaded from the web, so math needs a connection. To make
math work offline, render with MathJax (Quarto's default) and:

```yaml
embed-resources: true
self-contained-math: true
```

### Self-contained documents

panzoom works in a self-contained document, with no internet access:

```yaml
filters:
  - panzoom
embed-resources: true
```

For math, use `html-math-method: mathml`, or `katex` with
`self-contained-math: true`. MathJax loads its fonts from the internet even with
`self-contained-math: true`.

### Styling

Set the viewer's colors with the options, or with the CSS variables they stand
for in your own CSS (a `css:` file, or the theme's `.scss`):

  | Option               | CSS variable         | Element                        | Default               |
  | -------------------- | -------------------- | ------------------------------ | --------------------- |
  | `backdrop`           | `--panzoom-backdrop` | The layer over the page        | `rgba(0, 0, 0, 0.7)`  |
  | `caption-background` | `--panzoom-bg`       | The caption band               | The page's background |
  | `caption-color`      | `--panzoom-fg`       | Caption, description, and hint | The page's text color |
  | `link-color`         | `--panzoom-link`     | Links in captions              | The page's link color |

```yaml
panzoom:
  backdrop: rgba(0, 0, 0, 0.9)   # any CSS color: rgba(),
  caption-background: "#222"     # hex (quoted, for YAML),
  caption-color: white           # or a name
```

In CSS, for every viewer on the site:

```css
.panzoom-overlay {
  --panzoom-backdrop: black;
  --panzoom-bg: black;
  --panzoom-fg: white;
}
```

For some documents only, set `css-class: dark-viewer` and write the same rule
for `.dark-viewer`.

For one image, give its code cell the same options under `#| panzoom:`, or write
them as attributes on a markdown image. They apply while that image is open, on
top of the document's:

````markdown
```{r}
#| panzoom:
#|   backdrop: darkred
#|   css-class: poster-viewer

plot(pressure)
```

![A photo.](photo.jpg){.panzoom caption-background="#222" caption-color="white"}
````

The [color
options](https://sekoclancy.github.io/panzoom/tests/pages/m-styling-options.html)
and [styling with
CSS](https://sekoclancy.github.io/panzoom/tests/pages/n-css-class.html) examples
have each way, and the classes of the viewer's parts.

## Development

Set up a clone as in [From source](#from-source). The venv is only for the
Python (Jupyter) examples, with its packages listed in
[pyproject.toml](pyproject.toml) and pinned in [uv.lock](uv.lock). The rest need
R, with the `ragg` package. Then:

```bash
quarto render              # build the site into docs/
caddy run                  # serve docs/ on port 4242 (or $CADDYPORT)
quarto publish gh-pages --no-prompt --no-browser   # build and publish to GitHub Pages
uv lock --upgrade && uv sync   # update the Python packages, then commit uv.lock
```

Before the first publish, create an empty `gh-pages` branch once (`--no-prompt`
can't create it):

```bash
git branch gh-pages $(git commit-tree $(git hash-object -t tree /dev/null) -m "Initializing gh-pages branch")
git push origin gh-pages
```

See [tests/README.md](tests/README.md) for the tests and their setup.
