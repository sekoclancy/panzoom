# Panzoom

**Live demo:** <https://sekoclancy.github.io/panzoom/> (the example, plus
test pages comparing panzoom with Quarto's lightbox).

A [Quarto](https://quarto.org) filter extension for HTML formats that opens
figures in a full-screen pan/zoom viewer: scroll (or trackpad pinch) to zoom
toward the cursor, drag to pan, double-click or `0` to reset, `+`/`-` to zoom,
`Esc` or a background click to close.

It works from the keyboard too: marked images can be reached with `Tab` and
opened with `Enter` or `Space`, the arrow keys pan, and closing returns focus
to the image.

It works alongside Quarto's built-in
[lightbox](https://quarto.org/docs/output-formats/html-lightbox-figures.html)
and attempts to mimic its functionality.

The viewer is built on [Panzoom](https://github.com/timmywil/panzoom).

## Installation

You can install this extension using the Quarto CLI:

```bash
quarto add sekoclancy/panzoom
```

This will install the extension under the `_extensions` subdirectory.
If you're using version control, you will want to check in this directory.

### Development Tools

Only needed to run the browser tests (see [Testing](#testing)), not to use
the extension. They also need [Node.js](https://nodejs.org) 22.12 or later.

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

## Usage

Turn the filter on:

```yaml
filters:
  - panzoom
```

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

## Options

```yaml
panzoom:
  match: auto     # give block images the viewer (default: only marked images)
  max-zoom: 4     # maximum zoom, in screen px per image px (default 4)
  hint: true      # show the controls hint at the bottom (default true)
```

## Notes

See `index.qmd` for example uses.

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

## Testing

**Tools:**

- [Quarto](https://quarto.org) 1.9+ and R, to render the test pages (they
  have R chunks, some taken from the quarto-ext/lightbox examples).
- [Node.js](https://nodejs.org) with
  [puppeteer-core](https://pptr.dev/), to drive the browser.
- Headless Chrome, installed with
  `quarto install chrome-headless-shell --no-prompt` (or any Chrome/Chromium
  via `CHROME=`).

**How we test:** the same 12 figure cases (galleries, subfigures, math in
captions, linked, margin and inline images, R chunks with cell options) are
rendered three ways: with Quarto's lightbox alone as the reference, with
`match: auto`, and with explicitly marked images. A script serves the
rendered site locally, clicks every image on each page and records which
viewer opened (panzoom, Quarto's lightbox, or nothing). For the panzoom
viewer, it then checks zoom, pan, reset and closing, that key presses
don't reach the page behind it, and that it works from the keyboard alone.
It writes a report per page and a screenshot of each step for a person to
review; nothing is compared pixel by pixel.

See `tests/README.md` for setup and running the tests.

## License

[MIT](LICENSE).
