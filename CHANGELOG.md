# Changelog

## 0.2.0

### Changed

- Left and Right always change the gallery image. Ctrl/Cmd+arrow pans, in any
  direction, while the image is larger than the screen. In 0.1.0 the bare arrow
  keys panned an image larger than the screen.

### Added

- `window.QuartoPanzoom`, a JavaScript API: `open()` and `close()` for the
  viewer, and `observe()` for images added after the page loads.
- `description` under `#| panzoom:` takes a list, one description per plot of
  the cell.
- CSS variables for each control: `--panzoom-close-*`, `--panzoom-nav-*`,
  `--panzoom-counter-*`, `--panzoom-status-*`, and `--panzoom-hint-fg`.
  `--panzoom-button-bg` and `--panzoom-button-fg` stay as the shared default.
- System colors (`Canvas`, `CanvasText`, `LinkText`, `Highlight`) as the last
  fallback, for pages without the Quarto or Bootstrap variables and for forced
  colors.

### Fixed

- A double-tap on a touch screen goes back to the opening view.
- On touch screens, a tap near the top-right corner of a labeled figure opens
  the image, not the figure anchor link.
- Closing the viewer on a page reached through a `#anchor` link keeps the scroll
  position.
- Stepping to another gallery image no longer keeps the clicked spot of the
  first one.
- Printing with the viewer open prints the page.
- Hint text can be selected and copied.
