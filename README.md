# Panzoom

A [Quarto](https://quarto.org) filter extension for HTML formats that opens
figures in a full-screen pan/zoom viewer: scroll (or trackpad pinch) to zoom
toward the cursor, drag to pan, double-click or `0` to reset, `+`/`-` to zoom,
`Esc` or a background click to close.

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

**Live demo:** <https://sekoclancy.github.io/panzoom/> (the example, plus
test pages comparing panzoom with Quarto's lightbox).

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

`tests/` renders the same 12 figure cases three ways: with Quarto's lightbox
alone (the reference), with `match: auto`, and with explicitly marked images.
A headless Chrome script clicks every image on each page and reports which
viewer opened, then checks that the viewer zooms, pans and closes, saving a
screenshot of each step for review. See `tests/README.md` to set it up and
run it.

## License

[MIT](LICENSE).
