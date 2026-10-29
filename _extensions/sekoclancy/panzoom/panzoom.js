/*
  panzoom: full-screen pan/zoom viewer for `.panzoom` images, built on
  Panzoom (https://github.com/timmywil/panzoom; panzoom.min.js, loaded first
  as the global `Panzoom`).

  Panzoom does the panning and zooming: drag (or one-finger drag) pans,
  two-finger pinch zooms. This file adds the viewer around it: click image ->
  overlay, wheel / trackpad pinch zooms toward the cursor, double-click or 0
  resets to fit, +/- zoom, arrow keys pan, Esc / x / background click closes,
  c hides or shows the caption and description, h the hint line. The
  document's `keys:` option changes these keys (see KEYS). The hint line
  names mouse and keyboard controls, so a viewer opened by a tap has none.

  Captions: the viewer shows the image's figure caption, taken from the
  rendered page (the nearest <figcaption>), so "Figure N:" prefixes and
  typeset math come through. Below it, the image's description: a copy
  of the hidden `.panzoom-desc` div its `data-panzoom-desc` names, which
  panzoom.lua made from the `description` attribute or cell option and
  Quarto rendered with the page (citations, cross-references, math).

  Caption position: `desc-position` (top, bottom, left or right; as for
  Quarto's lightbox) puts the caption band above or below the image, or
  beside it as a panel, and the image fits the rest of the screen. On a
  screen narrower than NARROW, left and right show below, as lightbox
  does.

  Galleries: images with the same group are stepped through with the
  prev/next buttons, Left/Right or a horizontal swipe (the last two only
  while the image fits the screen; when it is larger in either direction,
  they pan).

  Panning: drag, arrow keys, Shift+wheel or sideways trackpad scrolling
  (along the direction the image extends past the screen; sideways if
  both). The image is kept on screen: centered in a direction where it
  fits, and stopping at its ends where it doesn't. The group
  is `data-panzoom-group` (cell option), else `data-group` (`group="..."` on
  a markdown image, as for Quarto's lightbox), else `data-ref-parent`
  (subfigures of one figure, as Quarto's lightbox groups them).

  Keyboard: marked images are focusable buttons that open on Enter or Space.
  The open viewer takes focus, keeps Tab inside it, and gives focus back to
  what had it before when it closes. That image shows its focus ring only
  if the viewer was opened from the keyboard: opened with the mouse or a
  tap, the ring stays hidden until the next key press, even when Esc
  closed it. A caption or description too long for
  its panel is a Tab stop too, and the arrows, Page Up/Down, Home, End and
  Space scroll it while it has focus.

  Fit: by default (`fit: auto`) the viewer opens on the whole image, unless
  it is a strip (at least 3 times wider than tall, or 3 times taller than
  wide) that would show too thin to read (shorter than a quarter of the
  screen height, or narrower than a quarter of its width): then it fills
  the screen height from the left end (or the width from the top). The
  shape condition keeps ordinary portrait photos whole on wide screens.
  `fit: contain | height | width` forces one of these.
  Zooming out always goes down to the whole image. A strip clicked on the
  page opens with the clicked spot (its focal point) in the middle (as far as its ends
  allow); opened from the keyboard, at its left end (or top). Reset (0,
  double-click) returns to the opening view.

  Options come from `window.PANZOOM_OPTIONS` (written by panzoom.lua from
  the document's `panzoom:` metadata): { maxZoom: 4, hint: true,
  caption: true, loop: false, fit: "auto", descPosition (default: where
  the page puts the caption, see pagePosition()), cssClass: "", keys: {} };
  cssClass
  is added to the viewer's classes, for styling it, and keys rebinds the
  viewer's keys (see KEYS). A cell's `#| panzoom:` options
  override maxZoom, hint, caption, fit and descPosition per image, via
  `data-panzoom-max-zoom`, `data-panzoom-hint`, `data-panzoom-caption`,
  `data-panzoom-fit` and `data-panzoom-desc-position` on the <img> (the
  last also from `desc-position="..."` on a markdown image). The styling options of a cell or an
  image (`data-panzoom-css-class` and the colors, see STYLES) apply while
  that image is shown, on top of the document's.
*/
(function () {
  var SELECTOR = ".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)";
  var SWIPE = 50;  // px of horizontal drag that switches images
  var THIN = 0.25;  // fit: auto fills the screen below this fraction of it
  var STRIP = 3;    // ...but only for images at least this many times wider than tall (or vice versa)
  var BOUNCE = 40;  // px a key or scroll pan overshoots an image's end
  var STRETCH = 80; // px a drag can pull an image past its end, at most
  var OUT = 120, BACK = 200;  // ms out past the end, and back
  var FITS = ["auto", "contain", "height", "width"];
  var POSITIONS = ["bottom", "top", "left", "right"];
  var NARROW = 769; // px: below this width, left and right show below (as lightbox)
  // Per-image color options: data attribute (as in `dataset`) -> CSS variable.
  var STYLES = {
    panzoomBackdrop: "--panzoom-backdrop",
    panzoomPanelBackground: "--panzoom-panel-bg",
    panzoomPanelColor: "--panzoom-panel-fg",
    panzoomLinkColor: "--panzoom-link"
  };
  // The default keys of the actions `keys:` can rebind (KeyboardEvent.key
  // values; as in panzoom.lua). Tab, Enter, Space, the arrows, Page Up/Down,
  // Home and End stay fixed.
  var KEYS = {
    caption: ["c"], hint: ["h"], close: ["Escape"], reset: ["0"],
    "zoom-in": ["+", "="], "zoom-out": ["-"]
  };

  var overlay, img, closeBtn, prevBtn, nextBtn, counter, status, footer, caption, desc, hint;
  var loadId = 0, loadTimer = null;
  var pz = null, opts, press = null, returnFocus = null, margin = 0, marginX = 0;
  // Where the caption band is now (see place()): opts.descPosition, or
  // bottom instead of left or right on a narrow screen.
  var side = "bottom";
  // Whether the viewer was opened with the mouse or a tap (see close()),
  // and whether by a tap (no hint line; see showFooter()).
  var byPointer = false, byTouch = false;
  // The page's own inline overflow and scrollbar-gutter, put back on close.
  var pageStyle = null;
  // The kind of pointer last pressed: a click doesn't say whether it came
  // from a tap in every browser.
  var lastPointer = "";
  var bouncing = false, bounceTimer = null;
  // Where the image's center is held, on screen, along an axis where it is
  // smaller than the screen ({ x, y }; null: centered). Only zooming sets
  // it (see zoomAt()); opening, reset and zooming out to the whole image
  // clear it.
  var held = { x: null, y: null };
  // The focal point: where the image was clicked on the page, as fractions
  // of its width and height ({ el, fx, fy }), or null (opened from the
  // keyboard).
  var clicked = null;
  var gallery = [], index = 0;
  // Back closes the viewer: opening adds a history entry (same URL), which
  // Back leaves, and closing any other way steps back over it (see
  // close()). `leaving` is a link's address to follow once that step is
  // done.
  var inHistory = false, leaving = null;
  // The classes the shown image added to the viewer (see restyle()).
  var imageClasses = [];
  // The c and h keys hide the caption (with the description) and the hint,
  // for as long as the page is open, so a gallery stays that way. For the
  // hint, h flips each image's own start (shown, or hidden with `hint:
  // hide`); an image with no hint ignores it.
  var hideCaption = false, flipHint = false;
  // The document's keys (see keys()): action -> list of keys.
  var bindings = null;
  // The opening view fit() set ({ s, x, y }), to tell whether the reader
  // has zoomed or panned since.
  var opening = null;

  // Document-wide options, overridden by the image's data attributes.
  function options(el) {
    var o = window.PANZOOM_OPTIONS || {};
    var d = (el && el.dataset) || {};
    // `hint`: true or "show" (the default), "hide" (starts hidden), or
    // false (none: the hint key does nothing).
    var hintMode = function (v) {
      if (v === false || v === "false") return "none";
      return v === "hide" ? "hide" : "show";
    };
    var flag = function (v, dflt) {
      return v !== undefined ? v !== "false" && v !== false : dflt;
    };
    var maxZoom = d.panzoomMaxZoom !== undefined ? Number(d.panzoomMaxZoom) : o.maxZoom;
    var fit = d.panzoomFit !== undefined ? d.panzoomFit : o.fit;
    var pos = d.panzoomDescPosition !== undefined ? d.panzoomDescPosition :
      o.descPosition !== undefined ? o.descPosition : pagePosition(el);
    return {
      fit: FITS.indexOf(fit) >= 0 ? fit : "auto",
      descPosition: POSITIONS.indexOf(pos) >= 0 ? pos : "bottom",
      maxZoom: typeof maxZoom === "number" && maxZoom > 0 ? maxZoom : 4,
      hint: hintMode(d.panzoomHint !== undefined ? d.panzoomHint : o.hint),
      caption: flag(d.panzoomCaption, flag(o.caption, true)),
      loop: flag(o.loop, false)
    };
  }

  // Where the page puts the image's caption (`fig-cap-location`), as a
  // `desc-position`: the default when neither the image nor the document
  // sets one. A margin caption is beside the image on the margin side,
  // which a right-to-left page puts on the left. A subfigure looks at its
  // own caption, then its parent figure's.
  function pagePosition(el) {
    var fig = el && el.closest("figure");
    for (var i = 0; fig && i < 2; i++) {
      var cap = fig.querySelector(":scope > figcaption");
      if (cap && cap.classList.contains("quarto-float-caption-top")) return "top";
      if (cap && cap.classList.contains("margin-caption")) {
        return getComputedStyle(fig).direction === "rtl" ? "left" : "right";
      }
      fig = fig.parentElement && fig.parentElement.closest("figure");
    }
    return "bottom";
  }

  // Each action's keys: the document's `keys:` (a list, or false for
  // none; panzoom.lua has checked them), else the defaults.
  function keys() {
    if (bindings) return bindings;
    var o = (window.PANZOOM_OPTIONS || {}).keys || {};
    bindings = {};
    Object.keys(KEYS).forEach(function (a) {
      bindings[a] = o[a] === false ? [] : Array.isArray(o[a]) ? o[a] : KEYS[a];
    });
    return bindings;
  }

  // The action a key does, or null.
  function actionOf(key) {
    var k = keys();
    for (var a in k) if (k[a].indexOf(key) >= 0) return a;
    return null;
  }

  // The hint line's parts, naming the keys bound: the caption key only when
  // the image has a caption or description, to hide it or, once hidden, to
  // show it.
  function hintParts(captioned) {
    var named = function (a) {
      return keys()[a].map(function (k) { return k === "Escape" ? "Esc" : k; }).join(" or ");
    };
    var cap = captioned ? named("caption") : "", hin = named("hint"), shut = named("close");
    var parts = ["scroll to zoom", "drag to pan", "double-click to reset"];
    if (cap) parts.push(cap + (hideCaption ? " to show" : " to hide") + " the caption");
    if (hin) parts.push(hin + " to hide the hint");
    if (shut) parts.push(shut + " to close");
    return parts;
  }

  // Fills `el` with the parts, each kept whole on one line, between dots
  // that stay with the part before them (see panzoom.css: in a panel beside
  // the image, one part per line).
  function fillHint(el, parts) {
    el.textContent = "";
    parts.forEach(function (p, i) {
      if (i) {
        var sep = document.createElement("span");
        sep.className = "panzoom-hint-sep";
        sep.textContent = "\u00a0\u00b7 ";
        el.appendChild(sep);
      }
      var part = document.createElement("span");
      part.className = "panzoom-hint-part";
      part.textContent = p;
      el.appendChild(part);
    });
  }

  // The <figcaption> of `fig` itself (not of a nested subfigure), as HTML.
  function figcaption(fig) {
    var cap = fig && fig.querySelector(":scope > figcaption");
    return cap ? cap.innerHTML.trim() : "";
  }

  // The image's description, as rendered on the page (see the header).
  function descriptionOf(el) {
    var d = el.dataset.panzoomDesc && document.getElementById(el.dataset.panzoomDesc);
    return d ? d.innerHTML : "";
  }

  // The image's caption: its figure's caption and, for a subfigure, the
  // parent figure's caption as a second line ("(a) Sub A" over "Figure 1:
  // ..."), since the subfigure caption alone has no figure number.
  function captionOf(el) {
    var fig = el.closest("figure");
    var html = figcaption(fig);
    var parent = fig && fig.parentElement && fig.parentElement.closest("figure");
    var outer = figcaption(parent);
    if (outer) html += '<div class="panzoom-caption-parent">' + outer + "</div>";
    return html;
  }

  // The color behind `el` on the page: the first non-transparent background
  // among it and its ancestors (the page, a callout, a dark theme), else
  // white. The viewer shows the image on it, so a transparent plot (e.g.
  // knitr's `dev: [png, pdf]`) keeps its dark labels readable on the dark
  // overlay, and looks as it does on the page.
  function backdropOf(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      // Only an opaque color counts: a translucent tint shows what's behind.
      var bg = getComputedStyle(n).backgroundColor;
      var m = /^rgba\(.*,\s*([\d.]+)\)$/.exec(bg);
      if (/^rgb\(/.test(bg) || (m && +m[1] >= 1)) return bg;
    }
    return "#fff";
  }

  // A class list as written in an option: names separated by spaces.
  function classList(s) {
    return (s || "").split(/\s+/).filter(Boolean);
  }

  // Styles the viewer for `el` (or for no image): its `css-class` and
  // colors, replacing the previous image's. Inline variables beat the
  // document's, which are set on `.panzoom-overlay` and its classes.
  function restyle(el) {
    var d = (el && el.dataset) || {};
    imageClasses.forEach(function (c) { overlay.classList.remove(c); });
    // Classes the viewer already has from the document stay as they are.
    var page = classList((window.PANZOOM_OPTIONS || {}).cssClass).concat("panzoom-overlay");
    imageClasses = classList(d.panzoomCssClass).filter(function (c) {
      return page.indexOf(c) < 0;
    });
    imageClasses.forEach(function (c) { overlay.classList.add(c); });
    for (var key in STYLES) {
      if (d[key]) overlay.style.setProperty(STYLES[key], d[key]);
      else overlay.style.removeProperty(STYLES[key]);
    }
  }

  function groupOf(el) {
    var d = el.dataset;
    return d.panzoomGroup || d.group || d.refParent || null;
  }

  // Whether `el` is the rendering Quarto hides in the current color mode
  // (a cell with `renderings: [light, dark]` writes both).
  function otherRendering(el) {
    var body = document.body.classList;
    return (body.contains("quarto-light") && !!el.closest(".dark-content")) ||
      (body.contains("quarto-dark") && !!el.closest(".light-content"));
  }

  // The images the viewer can step through from `el`, in page order.
  function galleryOf(el) {
    var g = groupOf(el);
    if (!g) return [el];
    return Array.prototype.filter.call(document.querySelectorAll(SELECTOR), function (x) {
      return groupOf(x) === g && opens(x) && !otherRendering(x);
    });
  }

  // Which way to open the image (see the header): "contain", "height" or
  // "width". `s` is the whole-image scale, (vw, vh) the space for it.
  function fitMode(w, h, vw, vh, s) {
    if (opts.fit !== "auto") return opts.fit;
    if (w >= STRIP * h && h * s < THIN * vh) return "height";
    if (h >= STRIP * w && w * s < THIN * vw) return "width";
    return "contain";
  }

  // (Re)starts Panzoom at the opening view (see fitMode), with zoom-out
  // limited to the whole image. Scale = screen px per image px, so max-zoom
  // applies as is.
  //
  // The image box stays at the overlay's top-left corner and is placed by
  // Panzoom's own pan: zoomToPoint assumes that box position, and zooms away
  // from the cursor if the box is moved with left/top. Panzoom scales around
  // the image center and its translate is in unscaled px, so putting the
  // center at screen point (cx, cy) takes a pan of ((cx - w/2) / s,
  // (cy - h/2) / s).
  function fit() {
    stopBounce();
    held = { x: null, y: null };
    var a = area(), vw = a.w, vh = a.h;
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    // Screen points below are in the overlay; the space starts at (a.x, a.y).
    // No opening view enlarges an image past its real size (1 image px per
    // CSS px), as with Quarto's lightbox: a small image opens at its own size
    // and can still be zoomed in up to max-zoom.
    // In a gallery the sides leave room for the previous and next buttons,
    // so an image shown whole, or panned to an end, stays clear of them.
    margin = 0.025 * Math.min(vw, vh);
    marginX = gallery.length > 1 ? Math.max(margin, prevBtn.offsetWidth + 16) : margin;
    var whole = Math.min((vw - 2 * Math.max(marginX, 0.025 * vw)) / w, 0.95 * vh / h, 1);
    var mode = fitMode(w, h, vw, vh, whole);
    var s = whole, cx = a.x + vw / 2, cy = a.y + vh / 2;
    // A strip starts at its left end (or top), or, if it was clicked on the
    // page, with the clicked spot in the middle of the screen (as far as
    // its ends allow).
    var at = clicked && clicked.el === gallery[index] ? clicked : null;
    if (mode === "height") {
      s = Math.min((vh - 2 * margin) / h, 1);
      if (w * s > vw) cx = a.x + (at ? vw / 2 + (0.5 - at.fx) * w * s : marginX + w * s / 2);
    } else if (mode === "width") {
      s = Math.min((vw - 2 * marginX) / w, 1);
      if (h * s > vh) cy = a.y + (at ? vh / 2 + (0.5 - at.fy) * h * s : margin + h * s / 2);
    }
    img.dataset.fit = mode;
    // Clear `pz` first: Panzoom fires change events while it starts up, and
    // contain() must not act on the old, destroyed instance.
    if (pz) { pz.destroy(); pz = null; }
    pz = Panzoom(img, {
      canvas: true,             // drag anywhere on the overlay, not just the image
      cursor: "grab",
      startScale: s,
      // The opening view is also where reset (0, double-click) returns.
      startX: containAxis((cx - w / 2) / s, s, w, vw, null, a.x, marginX),
      startY: containAxis((cy - h / 2) / s, s, h, vh, null, a.y, margin),
      minScale: Math.min(whole, s),
      maxScale: Math.max(opts.maxZoom, s)
    });
    // Panzoom applies startX/startY on a timer after it starts; apply them
    // now, so the image doesn't show at (0, 0) for a frame and an
    // immediate zoom or pan starts from the opening view.
    pz.pan((cx - w / 2) / s, (cy - h / 2) / s, { animate: false, force: true });
    var p = pz.getPan();
    opening = { s: pz.getScale(), x: p.x, y: p.y };
  }

  // Whether the view is still the opening one: not zoomed or panned.
  function atOpening() {
    if (!pz || !opening) return false;
    var p = pz.getPan();
    return Math.abs(pz.getScale() - opening.s) < 1e-6 &&
      Math.abs(p.x - opening.x) < 0.5 && Math.abs(p.y - opening.y) < 0.5;
  }

  // Shows or hides the caption band's parts (see hideCaption), and the band
  // itself when all of them are hidden.
  function showFooter() {
    caption.hidden = hideCaption || !caption.innerHTML;
    desc.hidden = hideCaption || !desc.innerHTML.trim();
    hint.hidden = opts.hint === "none" || byTouch || (opts.hint === "hide") !== flipHint;
    fillHint(hint.querySelector(".panzoom-hint-keys"),
      hintParts(!!caption.innerHTML || !!desc.innerHTML.trim()));
    footer.hidden = caption.hidden && desc.hidden && hint.hidden;
    // The band's size, for the buttons it would cover (see panzoom.css).
    overlay.style.setProperty("--panzoom-band-height", footer.offsetHeight + "px");
    overlay.style.setProperty("--panzoom-band-width", footer.offsetWidth + "px");
    markScrollable();
  }

  // Puts the caption band where the image's desc-position says (a class on
  // the viewer: panzoom-desc-top and so on), below instead of beside the
  // image on a narrow screen.
  function place() {
    var p = opts.descPosition;
    if ((p === "left" || p === "right") && window.innerWidth < NARROW) p = "bottom";
    overlay.classList.remove("panzoom-desc-" + side);
    side = p;
    overlay.classList.add("panzoom-desc-" + side);
  }

  // c and h ("caption" and "hint"): hide or show the caption or the hint.
  // The image gets the room the band gave up (or gives it back): an
  // untouched view fits afresh, and a zoomed or panned one keeps its place,
  // held within the new space.
  function toggleFooter(which) {
    if (which === "caption") hideCaption = !hideCaption;
    else if (opts.hint === "none") return;
    else flipHint = !flipHint;
    var refit = atOpening();
    showFooter();
    if (refit) fit(); else contain();
  }

  // The space the image is shown in: the overlay less the caption band,
  // starting at (x, y) in the overlay.
  function area() {
    var w = overlay.clientWidth, h = overlay.clientHeight;
    if (side === "left" || side === "right") {
      var bw = footer.offsetWidth;
      return { x: side === "left" ? bw : 0, y: 0, w: w - bw, h: h };
    }
    var bh = footer.offsetHeight;
    return { x: 0, y: side === "top" ? bh : 0, w: w, h: h - bh };
  }

  // Which ways the image is larger than that space (zoomed in, or a wide or
  // tall figure opened at screen height or width). In either case Left/Right
  // and horizontal drags pan rather than switch gallery images.
  function overflow() {
    var a = area(), s = pz ? pz.getScale() : 0;
    var x = img.naturalWidth * s > a.w + 1, y = img.naturalHeight * s > a.h + 1;
    return { x: x, y: y, any: x || y };
  }

  // Keeps the image on screen, one axis at a time: where it is smaller than
  // the space it stays where zooming put it (`hold`, its center on screen),
  // or centered, and wholly on screen (within the opening margin where it
  // fits); drags and arrow keys don't move it. Where it is larger, its
  // edges stop at the screen edges (less the margin), so panning ends at
  // the image's ends. `t` is Panzoom's pan along the axis (unscaled px, see
  // fit()), `n` the image size and `avail` the space, both along the axis,
  // and `off` where the space starts on screen (the caption band above or
  // to the left); `mg` the margin along the axis (see fit()).
  function containAxis(t, s, n, avail, hold, off, mg) {
    var size = n * s;
    off = off || 0;
    if (size <= avail) {
      var m = Math.min(mg, (avail - size) / 2);
      var h = hold === null || hold === undefined ? avail / 2 : hold - off;
      h = Math.min(avail - m - size / 2, Math.max(m + size / 2, h));
      return (off + h - n / 2) / s;
    }
    var c = n / 2 + s * t - off;                       // image center in the space
    c = Math.min(mg + size / 2, Math.max(avail - mg - size / 2, c));
    return (off + c - n / 2) / s;
  }

  // The contained pan for (x, y) at scale s.
  function contained(x, y, s) {
    var a = area();
    return {
      x: containAxis(x, s, img.naturalWidth, a.w, held.x, a.x, marginX),
      y: containAxis(y, s, img.naturalHeight, a.h, held.y, a.y, margin)
    };
  }

  // How far a drag `over` px past an image's end shows: it follows with
  // growing resistance, never more than STRETCH px.
  function stretch(over) {
    return (over < 0 ? -1 : 1) * STRETCH * (1 - Math.exp(-Math.abs(over) / (2 * STRETCH)));
  }

  // Runs after every Panzoom change (drag, pinch, zoom, pan, reset), when
  // Panzoom draws it (in an animation frame), and moves the image back
  // inside if needed; that correction is drawn on the next frame. It works
  // from Panzoom's own pan and scale, which are always current. During a
  // drag the image may go past its ends with resistance (stretch()); it
  // springs back when released (settle()). Not during a bounce: that
  // animation goes past the end on purpose.
  function contain() {
    if (!pz || bouncing) return;
    var s = pz.getScale(), p = pz.getPan(), c = contained(p.x, p.y, s);
    var x = c.x, y = c.y;
    if (press) {
      x += stretch((p.x - c.x) * s) / s;
      y += stretch((p.y - c.y) * s) / s;
    }
    if (Math.abs(x - p.x) > 1e-6 || Math.abs(y - p.y) > 1e-6) {
      pz.pan(x, y, { animate: false, force: true, silent: true });
    }
  }

  // Whether a bounce or spring-back is running. The overlay carries the
  // `panzoom-moving` class meanwhile, for CSS or scripts (the browser tests
  // wait for it to go).
  function setBouncing(on) {
    bouncing = on;
    if (overlay) overlay.classList.toggle("panzoom-moving", on);
  }

  // Animated pan to (x, y), then `then`. Only a pan at a fixed scale is
  // animated, so the image slides straight (see resetView()).
  function slideTo(x, y, ms, easing, then) {
    setBouncing(true);
    pz.pan(x, y, { animate: true, duration: ms, easing: easing, force: true });
    bounceTimer = setTimeout(function () {
      bounceTimer = null;
      if (then) then(); else setBouncing(false);
    }, ms);
  }

  // Ends a bounce or spring-back early (a new pan, zoom, drag or image),
  // leaving the image where it belongs.
  function stopBounce() {
    if (bounceTimer) clearTimeout(bounceTimer);
    bounceTimer = null;
    if (!bouncing) return;
    setBouncing(false);
    contain();
  }

  // After a drag: slide back inside if it was pulled past an end.
  function settle() {
    if (!pz) return;
    var s = pz.getScale(), p = pz.getPan(), c = contained(p.x, p.y, s);
    if (Math.abs(c.x - p.x) * s < 0.5 && Math.abs(c.y - p.y) * s < 0.5) return;
    slideTo(c.x, c.y, BACK, "ease-out");
  }

  // Zoom by `factor`, keeping the image point under (px, py) fixed on screen.
  // Clamp to the zoom limits here: Panzoom computes the fixed point for the
  // scale it is asked for, so asking past a limit makes the image drift.
  //
  // The fixed point (Panzoom's `focal`: the point relative to the image's
  // unscaled center, times the new scale) is computed here rather than with
  // pz.zoomToPoint, which measures the image on the page. Panzoom only
  // draws a change on the next animation frame, so when several zoom steps
  // come within one frame (fast keys, a trackpad pinch, a fast wheel), the
  // page still shows the old size and zoomToPoint anchors to the wrong
  // point. The image's unscaled box sits at the overlay's top-left (see
  // fit()), so its center is at (w/2, h/2) in overlay coordinates.
  //
  // Along an axis where the image ends up smaller than the screen, its
  // center is held where this zoom puts it (see containAxis()), so the
  // point under the cursor stays there instead of the image re-centering
  // and drifting away from it. Zoomed out to the whole image, it centers.
  function zoomAt(factor, px, py) {
    if (!pz) return;
    stopBounce();
    var o = pz.getOptions();
    var s0 = pz.getScale(), p = pz.getPan(), a = area();
    var s = Math.min(o.maxScale, Math.max(o.minScale, s0 * factor));
    var box = overlay.getBoundingClientRect();
    var w = img.naturalWidth, h = img.naturalHeight;
    var fx = px - box.left, fy = py - box.top, f = s / s0;
    var whole = s <= o.minScale + 1e-9;
    held = {
      x: whole || w * s > a.w ? null : fx - (fx - (w / 2 + s0 * p.x)) * f,
      y: whole || h * s > a.h ? null : fy - (fy - (h / 2 + s0 * p.y)) * f
    };
    pz.zoom(s, { animate: false, focal: { x: (fx - w / 2) * s, y: (fy - h / 2) * s } });
  }

  // Back to the opening view, without Panzoom's default animation: it
  // transitions scale and (unscaled) translate separately, and when the
  // opening scale is tiny (a whole collage) the translate is huge, so the
  // image flies far off-screen mid-animation and snaps back.
  function resetView() {
    stopBounce();
    held = { x: null, y: null };
    if (pz) pz.reset({ animate: false });
  }

  // Pan the view by (dx, dy) screen px: the image moves the other way.
  // Panzoom's translate is in unscaled px, so divide by the scale. A pan
  // that runs into an end of the image (where it is larger than the
  // screen) goes up to BOUNCE px past it and slides back, to show the end.
  function panPx(dx, dy) {
    if (!pz) return;
    stopBounce();
    var s = pz.getScale(), p = pz.getPan(), o = overflow();
    var tx = p.x - dx / s, ty = p.y - dy / s, c = contained(tx, ty, s);
    var ex = o.x ? (tx - c.x) * s : 0, ey = o.y ? (ty - c.y) * s : 0;  // px past the end
    if (Math.abs(ex) < 0.5 && Math.abs(ey) < 0.5) {
      pz.pan(c.x, c.y, { animate: false, force: true });
      return;
    }
    var bx = (ex < 0 ? -1 : 1) * Math.min(BOUNCE, Math.abs(ex));
    var by = (ey < 0 ? -1 : 1) * Math.min(BOUNCE, Math.abs(ey));
    slideTo(c.x + bx / s, c.y + by / s, OUT, "ease-out", function () {
      slideTo(c.x, c.y, BACK, "ease-in-out");
    });
  }

  // Pan the view by a fraction of the screen.
  function panBy(fx, fy) {
    panPx(fx * overlay.clientWidth, fy * overlay.clientHeight);
  }

  // Whether the image, wider than the screen, rests at its end toward
  // `dir` (1: its right end, -1: its left end).
  function atEndX(dir) {
    if (!pz) return false;
    var a = area(), s = pz.getScale(), x = pz.getPan().x;
    var end = containAxis(dir > 0 ? -1e9 : 1e9, s, img.naturalWidth, a.w, null, a.x, marginX);
    return Math.abs(x - end) < 0.5;
  }

  // Left/Right (`dir` -1 or 1). While the image is larger than the screen
  // they pan, doing nothing sideways if it fits that way, and a press that
  // reaches an end bounces; one made while an image wider than the screen
  // already rests at that end switches gallery images, but a held key
  // (`repeat`) never does. An image that fits switches at once. Without
  // `loop`, nothing happens past either end of the gallery.
  function arrow(dir, repeat) {
    var o = overflow();
    if (!o.any) { step(dir); return; }
    if (o.x && !repeat && atEndX(dir) && step(dir)) return;
    panBy(0.1 * dir, 0);
  }

  // Shows gallery image `i`, fitted to the screen.
  function show(i) {
    stopBounce();
    var el = gallery[i];
    index = i;
    opts = options(el);
    restyle(el);
    var n = gallery.length, many = n > 1;
    prevBtn.hidden = nextBtn.hidden = counter.hidden = !many;
    prevBtn.disabled = !opts.loop && i === 0;
    nextBtn.disabled = !opts.loop && i === n - 1;
    // A disabled button loses focus to the page behind; keep it in the viewer.
    var focused = document.activeElement;
    if ((focused === prevBtn || focused === nextBtn) && focused.disabled) {
      var other = focused === nextBtn ? prevBtn : nextBtn;
      (other.disabled ? overlay : other).focus();
    }
    counter.textContent = (i + 1) + " / " + n;
    caption.innerHTML = opts.caption ? captionOf(el) : "";
    desc.innerHTML = opts.caption ? descriptionOf(el) : "";
    overlay.querySelector(".panzoom-hint-gallery").hidden = !many;
    caption.scrollTop = desc.scrollTop = 0;
    place();
    showFooter();
    overlay.setAttribute("aria-label", "Image viewer" + (many ? ", image " + (i + 1) + " of " + n : ""));
    if (pz) { pz.destroy(); pz = null; }
    img.style.transform = "";
    delete img.dataset.fit;
    img.alt = el.alt || "";
    img.style.backgroundColor = backdropOf(el);
    load(el.currentSrc || el.src);
    // Vector images stay sharp when zoomed only if the browser may redraw
    // them at the new scale (see panzoom.css).
    img.classList.toggle("panzoom-vector", /\.svg([?#]|$)/i.test(img.src) || /^data:image\/svg/i.test(img.src));
  }

  // Loads `src` into the viewer and fits it once it has loaded. Each load
  // gets a number, and only the latest one's events count: a slow image
  // that finishes after the viewer closed, or after another image was
  // shown, does nothing. While loading, the image is hidden, and after a
  // moment "Loading image" shows; if it fails, a message says so.
  function load(src) {
    var id = ++loadId;
    clearTimeout(loadTimer);
    overlay.classList.remove("panzoom-error");
    overlay.classList.add("panzoom-loading");
    status.textContent = "";
    loadTimer = setTimeout(function () {
      if (id === loadId) status.textContent = "Loading image\u2026";
    }, 300);
    img.onload = function () { if (id === loadId) loaded(); };
    img.onerror = function () { if (id === loadId) failed(); };
    img.src = src;
    if (img.complete && img.naturalWidth) loaded();
  }

  function loaded() {
    // Once per load (a cached image is complete at once, and fires load too).
    if (!overlay.classList.contains("panzoom-loading")) return;
    clearTimeout(loadTimer);
    overlay.classList.remove("panzoom-loading");
    status.textContent = "";
    fit();
  }

  function failed() {
    clearTimeout(loadTimer);
    overlay.classList.remove("panzoom-loading");
    overlay.classList.add("panzoom-error");
    status.textContent = "The image could not be loaded.";
  }

  // Steps through the gallery; returns false at either end without `loop`.
  function step(delta) {
    var n = gallery.length, i = index + delta;
    if (n < 2) return false;
    if (i < 0 || i >= n) {
      if (!opts.loop) return false;
      i = (i + n) % n;
    }
    show(i);
    return true;
  }

  function open(el, point, pointer) {
    if (!overlay) build();
    clicked = point ? { el: el, fx: point.fx, fy: point.fy } : null;
    returnFocus = document.activeElement;
    byPointer = !!pointer;
    byTouch = byPointer && lastPointer === "touch";
    gallery = galleryOf(el);
    var html = document.documentElement;
    if (!overlay.classList.contains("open")) {
      pageStyle = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    }
    if (!inHistory) {
      history.pushState({ panzoom: true }, "");
      inHistory = true;
    }
    overlay.classList.add("open");
    // Stop the page scrolling; keep the scrollbar's space, if it has one,
    // so the page behind doesn't shift sideways, and cover that space too.
    var bar = window.innerWidth - html.clientWidth;
    if (bar > 0) html.style.scrollbarGutter = "stable";
    overlay.style.right = -bar + "px";
    html.style.overflow = "hidden";
    show(Math.max(0, gallery.indexOf(el)));
    overlay.focus({ preventScroll: true });
  }

  // `fromHistory`: Back closed the viewer, so its history entry is gone.
  function close(fromHistory) {
    if (inHistory) {
      inHistory = false;
      if (fromHistory !== true) history.back();
    }
    stopBounce();
    if (pz) { pz.destroy(); pz = null; }
    // Forget the image being loaded (see load()), and stop downloading it.
    loadId++;
    clearTimeout(loadTimer);
    img.onload = img.onerror = null;
    img.removeAttribute("src");
    img.style.transform = "";
    delete img.dataset.fit;
    overlay.classList.remove("open", "panzoom-loading", "panzoom-error");
    restyle(null);
    status.textContent = "";
    if (pageStyle) {
      document.documentElement.style.overflow = pageStyle.overflow;
      document.documentElement.style.scrollbarGutter = pageStyle.gutter;
      pageStyle = null;
    }
    press = null;
    gallery = [];
    // Opened with the mouse or a tap: no focus ring on the image focus
    // returns to, though a key (Esc) may have closed the viewer, until the
    // next key press.
    if (byPointer) document.documentElement.classList.add("panzoom-no-ring");
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  // Capture phase, before the key moves focus (Tab).
  document.addEventListener("keydown", function () {
    document.documentElement.classList.remove("panzoom-no-ring");
  }, true);

  // The controls Tab moves between: visible, enabled buttons, caption links,
  // and a caption or description panel that scrolls (see markScrollable()).
  function focusables() {
    return Array.prototype.filter.call(
      overlay.querySelectorAll("button, a[href], .panzoom-scrollable"),
      function (x) { return !x.disabled && x.offsetParent !== null; });
  }

  // A caption or description longer than its panel scrolls; make it a Tab
  // stop, so it can be scrolled from the keyboard (see scrollPanel()).
  // Checked again on resize, which changes what fits.
  function markScrollable() {
    [caption, desc].forEach(function (p) {
      var on = !p.hidden && p.scrollHeight > p.clientHeight + 1;
      p.classList.toggle("panzoom-scrollable", on);
      if (on) {
        p.tabIndex = 0;
        p.setAttribute("role", "region");
        p.setAttribute("aria-label", p === caption ? "Caption" : "Description");
      } else {
        p.removeAttribute("tabindex");
        p.removeAttribute("role");
        p.removeAttribute("aria-label");
        if (document.activeElement === p) overlay.focus({ preventScroll: true });
      }
    });
  }

  // Scrolls a focused caption or description panel for a scrolling key, as
  // the browser would (its own scrolling is prevented, see onKey()).
  // Returns false for other keys.
  function scrollPanel(p, e) {
    var line = 40, page = Math.max(line, p.clientHeight - line);
    var by = { ArrowDown: line, ArrowUp: -line, PageDown: page, PageUp: -page,
      " ": e.shiftKey ? -page : page }[e.key];
    if (e.key === "Home") p.scrollTop = 0;
    else if (e.key === "End") p.scrollTop = p.scrollHeight;
    else if (by !== undefined) p.scrollTop += by;
    else return false;
    return true;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "panzoom-overlay";
    classList((window.PANZOOM_OPTIONS || {}).cssClass).forEach(function (c) {
      overlay.classList.add(c);
    });
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image viewer");
    overlay.tabIndex = -1;
    // `panzoom-exclude`: Panzoom ignores drags that start on these.
    overlay.innerHTML =
      '<img alt="" draggable="false">' +
      '<div class="panzoom-counter panzoom-exclude" aria-live="polite"></div>' +
      '<div class="panzoom-status panzoom-exclude" role="status"></div>' +
      '<button class="panzoom-close panzoom-exclude" aria-label="Close"><span aria-hidden="true">&times;</span></button>' +
      '<button class="panzoom-prev panzoom-exclude" aria-label="Previous image"><span aria-hidden="true">&lsaquo;</span></button>' +
      '<button class="panzoom-next panzoom-exclude" aria-label="Next image"><span aria-hidden="true">&rsaquo;</span></button>' +
      '<div class="panzoom-panel panzoom-exclude">' +
      '<div class="panzoom-caption"></div>' +
      '<div class="panzoom-description"></div>' +
      '<div class="panzoom-hint"><span class="panzoom-hint-keys"></span>' +
      '<span class="panzoom-hint-gallery"><span class="panzoom-hint-sep">&nbsp;&middot; </span>' +
      '<span class="panzoom-hint-part">previous/next buttons for other images</span></span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    img = overlay.querySelector("img");
    closeBtn = overlay.querySelector(".panzoom-close");
    prevBtn = overlay.querySelector(".panzoom-prev");
    nextBtn = overlay.querySelector(".panzoom-next");
    counter = overlay.querySelector(".panzoom-counter");
    status = overlay.querySelector(".panzoom-status");
    footer = overlay.querySelector(".panzoom-panel");
    caption = overlay.querySelector(".panzoom-caption");
    desc = overlay.querySelector(".panzoom-description");
    hint = overlay.querySelector(".panzoom-hint");
    closeBtn.addEventListener("click", function () { close(); });
    img.addEventListener("panzoomchange", contain);
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });
    // A link in the caption or description (e.g. a cross-reference) leaves
    // the viewer. A plain click follows it once the viewer's history entry
    // is gone, so Back from there returns to the page, not the viewer.
    footer.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a) return;
      var plain = e.button === 0 && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) &&
        (!a.target || a.target === "_self") && !a.hasAttribute("download");
      if (plain && inHistory) {
        e.preventDefault();
        leaving = a.href;
      }
      close();
    });

    // Panzoom's own zoomWithWheel takes a fixed step per event, which makes
    // trackpad pinch (many small events) far too fast; scale by the delta.
    // Over the caption, the wheel scrolls a long caption instead.
    // Shift+wheel, and sideways trackpad scrolling, pan instead: along the
    // one direction the image extends past the screen, or sideways when it
    // extends both ways (or neither, when containment keeps it still).
    overlay.addEventListener("wheel", function (e) {
      if (footer.contains(e.target)) return;
      e.preventDefault();
      if (e.ctrlKey && gesture) return;
      var unit = e.deltaMode === 1 ? 16 : 1;
      if (!e.ctrlKey && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        // Some browsers turn Shift+wheel into deltaX, others keep deltaY.
        var d = (e.deltaX || e.deltaY) * unit, o = overflow();
        if (o.y && !o.x) panPx(0, d); else panPx(d, 0);
        return;
      }
      var dy = e.deltaY * unit;
      // ctrlKey = trackpad pinch (small deltas), so it gets a higher gain
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });

    // Desktop Safari reports a trackpad pinch as gesture events (scale since
    // the pinch began), not as ctrlKey wheel events; while one runs, any
    // ctrlKey wheel events are skipped so the pinch never counts twice. A
    // touch pinch (iOS) also sends them, but Panzoom already follows the
    // pointers, so they are ignored while a finger is down.
    var gesture = null;
    overlay.addEventListener("gesturestart", function (e) {
      e.preventDefault();
      gesture = press ? null : { scale: 1 };
    });
    overlay.addEventListener("gesturechange", function (e) {
      e.preventDefault();
      if (!gesture || press || !e.scale) return;
      zoomAt(e.scale / gesture.scale, e.clientX, e.clientY);
      gesture.scale = e.scale;
    });
    overlay.addEventListener("gestureend", function (e) {
      e.preventDefault();
      gesture = null;
    });

    // Panzoom handles the drag itself. A press and release on the background
    // without moving closes the viewer; a horizontal swipe switches images
    // unless the image is larger than the screen (then the drag pans it).
    // Only a single finger (or the mouse) taps or swipes: once a second
    // finger is down (a pinch), lifting the fingers just ends the gesture,
    // whichever finger touched down last or rests on the background.
    overlay.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".panzoom-exclude")) return;
      stopBounce();
      if (press) {
        press.ids.push(e.pointerId);
        press.multi = true;
        return;
      }
      press = { id: e.pointerId, ids: [e.pointerId], multi: false, sx: e.clientX, sy: e.clientY,
        onImg: e.target === img, pans: overflow().any };
      overlay.classList.add("dragging");
    });
    function release(e) {
      var i = press ? press.ids.indexOf(e.pointerId) : -1;
      if (i < 0) return;
      press.ids.splice(i, 1);
      if (press.ids.length) return;
      var single = !press.multi && e.type === "pointerup";
      var dx = e.clientX - press.sx, dy = e.clientY - press.sy;
      var moved = Math.abs(dx) + Math.abs(dy) > 3;
      var clickedBackground = single && !moved && !press.onImg;
      var swipe = single && !press.pans && Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(dy);
      press = null;
      overlay.classList.remove("dragging");
      if (clickedBackground) close();
      else if (!(swipe && step(dx < 0 ? 1 : -1))) settle();
    }
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);

    overlay.addEventListener("dblclick", function (e) {
      if (!e.target.closest(".panzoom-exclude")) resetView();
    });
    // Resize events can fire many times a frame; lay out once per frame.
    var resizeFrame = 0;
    window.addEventListener("resize", function () {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(function () {
        resizeFrame = 0;
        if (!overlay.classList.contains("open")) return;
        place();
        showFooter();
        if (!overlay.classList.contains("panzoom-loading")) fit();
      });
    });
  }

  // The viewer is modal: while it is open, keys go to it and nowhere else.
  // Window capture phase is the earliest point an event can be caught, so
  // page shortcuts (e.g. focus-mode's arrows, Quarto search on keyup) never
  // see them. Only a window-capture listener registered before this one
  // can still run first, so register at script load, not on first open.
  // Browser shortcuts with Ctrl/Cmd/Alt, and function keys, pass through.
  function onKey(e) {
    if (!overlay || !overlay.classList.contains("open")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Function keys are browser features (F5 reload, F3 find, F7 caret
    // browsing), not page shortcuts, so they pass through too.
    if (/^F\d{1,2}$/.test(e.key)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type !== "keydown") return;
    var cx = overlay.clientWidth / 2, cy = overlay.clientHeight / 2;
    var active = document.activeElement;
    var onControl = active !== overlay && overlay.contains(active);
    var action = actionOf(e.key);
    if (e.key === "Tab") {
      // Focus trap: cycle through the viewer's own controls.
      var list = focusables(), i = list.indexOf(active), n = list.length;
      if (n) list[e.shiftKey ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n].focus();
    }
    else if (action === "close") close();
    // A focused caption or description panel takes the scrolling keys.
    else if (active.classList.contains("panzoom-scrollable") && scrollPanel(active, e)) return;
    else if ((e.key === "Enter" || e.key === " ") && onControl) active.click();
    // Left/Right pan while the image is larger than the screen (doing
    // nothing if it fits sideways); otherwise they switch gallery images
    // (doing nothing at either end without `loop`).
    else if (e.key === "ArrowLeft") arrow(-1, e.repeat);
    else if (e.key === "ArrowRight") arrow(1, e.repeat);
    else if (e.key === "ArrowUp") panBy(0, -0.1);
    else if (e.key === "ArrowDown") panBy(0, 0.1);
    else if (action === "reset") resetView();
    else if (action === "zoom-in") zoomAt(1.25, cx, cy);
    else if (action === "zoom-out") zoomAt(0.8, cx, cy);
    else if (action === "caption" || action === "hint") toggleFooter(action);
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  window.addEventListener("popstate", function (e) {
    var ours = e.state && e.state.panzoom;
    if (inHistory && !ours) close(true);
    else if (leaving && !ours) {
      var href = leaving;
      leaving = null;
      // After the browser puts back the scroll position for this entry,
      // which would undo a jump to an anchor on the page.
      setTimeout(function () { location.assign(href); }, 0);
    }
    // Forward into the entry of a viewer since closed: step back over it.
    else if (ours && !inHistory) history.back();
  });
  // Reloaded with the viewer open: its entry stays, but the viewer doesn't.
  if (history.state && history.state.panzoom) history.replaceState(null, "");

  // Whether a marked image opens the viewer: not one inside the viewer, and
  // not one inside an author's link, which keeps its link. panzoom.lua's
  // own `a.panzoom-link` (the no-JS fallback) doesn't count.
  function opens(t) {
    if (overlay && overlay.contains(t)) return false;
    var link = t.closest("a[href]");
    return !link || link.classList.contains("panzoom-link");
  }

  // The marked image an event targets, if it opens the viewer. Keys and
  // keyboard clicks on an `a.panzoom-link` target the link, not its image.
  function target(e) {
    var el = e.target;
    if (el.matches && el.matches("a.panzoom-link")) el = el.querySelector(SELECTOR) || el;
    var t = el.closest && el.closest(SELECTOR);
    return t && opens(t) ? t : null;
  }

  document.addEventListener("pointerdown", function (e) {
    lastPointer = e.pointerType;
  }, true);

  // Capture phase, so this runs before other click handlers on the page;
  // preventDefault stops the `a.panzoom-link` around the image.
  document.addEventListener("click", function (e) {
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    var r = t.getBoundingClientRect();
    var frac = function (v) { return Math.min(1, Math.max(0, v)); };
    // A click from the mouse or a tap counts one or more clicks in
    // `detail`; one made from the keyboard or a script, none, and has no
    // clicked spot: a strip opens at its start, as with Enter or Space.
    open(t, e.detail > 0 && r.width && r.height ? {
      fx: frac((e.clientX - r.left) / r.width),
      fy: frac((e.clientY - r.top) / r.height)
    } : null, e.detail > 0);
  }, true);

  // Enter or Space on a focused marked image opens it, like a button.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    open(t);
  });

  // Make marked images reachable with Tab and announced as buttons. An
  // image in an `a.panzoom-link` is reached through the link (one Tab stop).
  function makeFocusable() {
    document.querySelectorAll(SELECTOR).forEach(function (img) {
      if (!opens(img)) return;
      var el = img.closest("a.panzoom-link") || img;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-label", (img.alt ? img.alt + ": " : "") + "open in zoom viewer");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeFocusable);
  else makeFocusable();
})();
