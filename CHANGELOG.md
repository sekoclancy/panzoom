# Changelog

## Unreleased

### Added

- A `{{< panzoom-version >}}` shortcode, which prints the installed version.
- A swipe up or down closes the viewer: 65 px with a mouse, 30% of the screen
  height with a finger, as in lightbox.

### Changed

- Swipes on an image that fits the screen work as in lightbox. The image follows
  the swipe, and a swipe switches images from 40 px with a mouse (more than 30
  px with a finger), not 50 px. A mouse swipes from the image only, so a drag on
  the background no longer switches images. A swipe stops at the first and last
  image even with `loop`, and only the buttons and arrow keys wrap.

### Fixed

- Captions in the viewer use the slide font in revealjs, and a sans-serif font
  on pages without a theme, not the browser default serif.
- Dragging an image past its end no longer shakes it.
- Zooming out to the whole image no longer snaps on the last step, and the image
  stays inside the margins on the way.
- A held scroll or arrow key into the end of an image bounces once, then holds
  the image at the end. Before, the image hung past the end until the scroll
  stopped.

## 0.2.1

### Fixed

- The viewer files go to `panzoom-<version>/` under `site_libs/`, so browsers
  load the new files after an upgrade. 0.2.0 still used `panzoom-0.1.0/`.

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
