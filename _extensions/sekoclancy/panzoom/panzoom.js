/*
  panzoom: full-screen pan/zoom viewer for `.panzoom` images, built on
  Panzoom (https://github.com/timmywil/panzoom; panzoom.min.js, loaded first
  as the global `Panzoom`).

  Panzoom does the panning and zooming: drag (or one-finger drag) pans,
  two-finger pinch zooms. This file adds the viewer around it: click image ->
  overlay, wheel / trackpad pinch zooms toward the cursor, double-click or 0
  resets to fit, +/- zoom, arrow keys pan, Esc / x / background click closes.

  Captions: the viewer shows the image's figure caption, taken from the
  rendered page (the nearest <figcaption>), so "Figure N:" prefixes and
  typeset math come through. Below it, the image's description: a copy
  of the hidden `.panzoom-desc` div its `data-panzoom-desc` names, which
  panzoom.lua made from the `description` attribute or cell option and
  Quarto rendered with the page (citations, cross-references, math).

  Galleries: images with the same group are stepped through with the
  prev/next buttons, PageUp/PageDown, Left/Right or a horizontal swipe
  (the last two only while the image fits the screen; when it is larger in
  either direction, they pan).

  Panning: drag, arrow keys, Shift+wheel or sideways trackpad scrolling
  (along the direction the image extends past the screen; sideways if
  both). The image is kept on screen: centered in a direction where it
  fits, and stopping at its ends where it doesn't. The group
  is `data-panzoom-group` (cell option), else `data-group` (`group="..."` on
  a markdown image, as for Quarto's lightbox), else `data-ref-parent`
  (subfigures of one figure, as Quarto's lightbox groups them).

  Keyboard: marked images are focusable buttons that open on Enter or Space.
  The open viewer takes focus, keeps Tab inside it, and gives focus back to
  what had it before when it closes.

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
  caption: true, loop: false, fit: "auto" }. A cell's `#| panzoom:` options
  override maxZoom, hint, caption and fit per image, via
  `data-panzoom-max-zoom`, `data-panzoom-hint`, `data-panzoom-caption` and
  `data-panzoom-fit` on the <img>.
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

  var overlay, img, closeBtn, prevBtn, nextBtn, counter, footer, caption, desc;
  var pz = null, opts, press = null, returnFocus = null, margin = 0;
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

  // Document-wide options, overridden by the image's data attributes.
  function options(el) {
    var o = window.PANZOOM_OPTIONS || {};
    var d = (el && el.dataset) || {};
    var flag = function (v, dflt) {
      return v !== undefined ? v !== "false" && v !== false : dflt;
    };
    var maxZoom = d.panzoomMaxZoom !== undefined ? Number(d.panzoomMaxZoom) : o.maxZoom;
    var fit = d.panzoomFit !== undefined ? d.panzoomFit : o.fit;
    return {
      fit: FITS.indexOf(fit) >= 0 ? fit : "auto",
      maxZoom: typeof maxZoom === "number" && maxZoom > 0 ? maxZoom : 4,
      hint: flag(d.panzoomHint, flag(o.hint, true)),
      caption: flag(d.panzoomCaption, flag(o.caption, true)),
      loop: flag(o.loop, false)
    };
  }

  // The <figcaption> of `fig` itself (not of a nested subfigure), as HTML.
  function figcaption(fig) {
    var cap = fig && fig.querySelector(":scope > figcaption");
    return cap ? cap.innerHTML.trim() : "";
  }

  // The image's caption: its figure's caption and, for a subfigure, the
  // parent figure's caption as a second line ("(a) Sub A" over "Figure 1:
  // ..."), since the subfigure caption alone has no figure number.
  // The image's description, as rendered on the page (see the header).
  function descriptionOf(el) {
    var d = el.dataset.panzoomDesc && document.getElementById(el.dataset.panzoomDesc);
    return d ? d.innerHTML : "";
  }

  function captionOf(el) {
    var fig = el.closest("figure");
    var html = figcaption(fig);
    var parent = fig && fig.parentElement && fig.parentElement.closest("figure");
    var outer = figcaption(parent);
    if (outer) html += '<div class="panzoom-caption-parent">' + outer + "</div>";
    return html;
  }

  // The colour behind `el` on the page: the first non-transparent background
  // among it and its ancestors (the page, a callout, a dark theme), else
  // white. The viewer shows the image on it, so a transparent plot (e.g.
  // knitr's `dev: [png, pdf]`) keeps its dark labels readable on the dark
  // overlay, and looks as it does on the page.
  function backdropOf(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      // Only an opaque colour counts: a translucent tint shows what's behind.
      var bg = getComputedStyle(n).backgroundColor;
      var m = /^rgba\(.*,\s*([\d.]+)\)$/.exec(bg);
      if (/^rgb\(/.test(bg) || (m && +m[1] >= 1)) return bg;
    }
    return "#fff";
  }

  function groupOf(el) {
    var d = el.dataset;
    return d.panzoomGroup || d.group || d.refParent || null;
  }

  // The images the viewer can step through from `el`, in page order.
  function galleryOf(el) {
    var g = groupOf(el);
    if (!g) return [el];
    return Array.prototype.filter.call(document.querySelectorAll(SELECTOR), function (x) {
      return groupOf(x) === g && opens(x);
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
    // No opening view enlarges an image past its real size (1 image px per
    // CSS px), as with Quarto's lightbox: a small image opens at its own size
    // and can still be zoomed in up to max-zoom.
    var whole = Math.min(vw / w, vh / h, 1 / 0.95) * 0.95;
    var mode = fitMode(w, h, vw, vh, whole);
    margin = 0.025 * Math.min(vw, vh);
    var s = whole, cx = vw / 2, cy = vh / 2;
    // A strip starts at its left end (or top), or, if it was clicked on the
    // page, with the clicked spot in the middle of the screen (as far as
    // its ends allow).
    var at = clicked && clicked.el === gallery[index] ? clicked : null;
    if (mode === "height") {
      s = Math.min((vh - 2 * margin) / h, 1);
      if (w * s > vw) cx = at ? vw / 2 + (0.5 - at.fx) * w * s : margin + w * s / 2;
    } else if (mode === "width") {
      s = Math.min((vw - 2 * margin) / w, 1);
      if (h * s > vh) cy = at ? vh / 2 + (0.5 - at.fy) * h * s : margin + h * s / 2;
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
      startX: containAxis((cx - w / 2) / s, s, w, vw),
      startY: containAxis((cy - h / 2) / s, s, h, vh),
      minScale: Math.min(whole, s),
      maxScale: Math.max(opts.maxZoom, s)
    });
    // Panzoom applies startX/startY on a timer after it starts; apply them
    // now, so the image doesn't show at (0, 0) for a frame and an
    // immediate zoom or pan starts from the opening view.
    pz.pan((cx - w / 2) / s, (cy - h / 2) / s, { animate: false, force: true });
  }

  // The space the image is shown in: the overlay above the caption.
  function area() {
    return { w: overlay.clientWidth, h: overlay.clientHeight - footer.offsetHeight };
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
  // fit()), `n` the image size and `avail` the space, both along the axis.
  function containAxis(t, s, n, avail, hold) {
    var size = n * s;
    if (size <= avail) {
      var m = Math.min(margin, (avail - size) / 2);
      var h = hold === null || hold === undefined ? avail / 2 : hold;
      h = Math.min(avail - m - size / 2, Math.max(m + size / 2, h));
      return (h - n / 2) / s;
    }
    var c = n / 2 + s * t;                             // image center on screen
    c = Math.min(margin + size / 2, Math.max(avail - margin - size / 2, c));
    return (c - n / 2) / s;
  }

  // The contained pan for (x, y) at scale s.
  function contained(x, y, s) {
    var a = area();
    return {
      x: containAxis(x, s, img.naturalWidth, a.w, held.x),
      y: containAxis(y, s, img.naturalHeight, a.h, held.y)
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
    pz.zoom(s, {
      animate: false,
      focal: {
        x: (px - box.left - img.naturalWidth / 2) * s,
        y: (py - box.top - img.naturalHeight / 2) * s
      }
    });
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

  // Shows gallery image `i`, fitted to the screen.
  function show(i) {
    stopBounce();
    var el = gallery[i];
    index = i;
    opts = options(el);
    var n = gallery.length, many = n > 1;
    prevBtn.hidden = nextBtn.hidden = counter.hidden = !many;
    prevBtn.disabled = !opts.loop && i === 0;
    nextBtn.disabled = !opts.loop && i === n - 1;
    counter.textContent = (i + 1) + " / " + n;
    caption.innerHTML = opts.caption ? captionOf(el) : "";
    caption.hidden = !caption.innerHTML;
    desc.innerHTML = opts.caption ? descriptionOf(el) : "";
    desc.hidden = !desc.innerHTML.trim();
    overlay.querySelector(".panzoom-hint").hidden = !opts.hint;
    overlay.querySelector(".panzoom-hint-gallery").hidden = !many;
    overlay.setAttribute("aria-label", "Image viewer" + (many ? ", image " + (i + 1) + " of " + n : ""));
    if (pz) { pz.destroy(); pz = null; }
    img.style.transform = "";
    delete img.dataset.fit;
    img.alt = el.alt || "";
    img.style.backgroundColor = backdropOf(el);
    img.onload = fit;
    img.src = el.currentSrc || el.src;
    // Vector images stay sharp when zoomed only if the browser may redraw
    // them at the new scale (see panzoom.css).
    img.classList.toggle("panzoom-vector", /\.svg([?#]|$)/i.test(img.src) || /^data:image\/svg/i.test(img.src));
    if (img.complete && img.naturalWidth) fit();
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

  function open(el, point) {
    if (!overlay) build();
    clicked = point ? { el: el, fx: point.fx, fy: point.fy } : null;
    returnFocus = document.activeElement;
    gallery = galleryOf(el);
    overlay.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    show(Math.max(0, gallery.indexOf(el)));
    overlay.focus({ preventScroll: true });
  }

  function close() {
    stopBounce();
    overlay.classList.remove("open");
    document.documentElement.style.overflow = "";
    if (pz) { pz.destroy(); pz = null; }
    press = null;
    gallery = [];
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  // The controls Tab moves between: visible, enabled buttons and caption links.
  function focusables() {
    return Array.prototype.filter.call(
      overlay.querySelectorAll("button, a[href]"),
      function (x) { return !x.disabled && x.offsetParent !== null; });
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "panzoom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image viewer");
    overlay.tabIndex = -1;
    // `panzoom-exclude`: Panzoom ignores drags that start on these.
    overlay.innerHTML =
      '<img alt="" draggable="false">' +
      '<div class="panzoom-counter panzoom-exclude" aria-live="polite"></div>' +
      '<button class="panzoom-close panzoom-exclude" aria-label="Close">&times;</button>' +
      '<button class="panzoom-prev panzoom-exclude" aria-label="Previous image">&lsaquo;</button>' +
      '<button class="panzoom-next panzoom-exclude" aria-label="Next image">&rsaquo;</button>' +
      '<div class="panzoom-footer panzoom-exclude">' +
      '<div class="panzoom-caption"></div>' +
      '<div class="panzoom-description"></div>' +
      '<div class="panzoom-hint">scroll to zoom &middot; drag to pan &middot; ' +
      'double-click to reset &middot; Esc to close' +
      '<span class="panzoom-hint-gallery"> &middot; PageUp/PageDown for other images</span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    img = overlay.querySelector("img");
    closeBtn = overlay.querySelector(".panzoom-close");
    prevBtn = overlay.querySelector(".panzoom-prev");
    nextBtn = overlay.querySelector(".panzoom-next");
    counter = overlay.querySelector(".panzoom-counter");
    footer = overlay.querySelector(".panzoom-footer");
    caption = overlay.querySelector(".panzoom-caption");
    desc = overlay.querySelector(".panzoom-description");
    closeBtn.addEventListener("click", close);
    img.addEventListener("panzoomchange", contain);
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });
    // A link in the caption or description (e.g. a cross-reference) leaves
    // the viewer.
    footer.addEventListener("click", function (e) {
      if (e.target.closest("a[href]")) close();
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

    // Panzoom handles the drag itself. A press and release on the background
    // without moving closes the viewer; a horizontal swipe switches images
    // unless the image is larger than the screen (then the drag pans it).
    overlay.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".panzoom-exclude")) return;
      stopBounce();
      press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, onImg: e.target === img, pans: overflow().any };
      overlay.classList.add("dragging");
    });
    document.addEventListener("pointerup", function (e) {
      if (!press || e.pointerId !== press.id) return;
      var dx = e.clientX - press.sx, dy = e.clientY - press.sy;
      var moved = Math.abs(dx) + Math.abs(dy) > 3;
      var clickedBackground = !moved && !press.onImg;
      var swipe = !press.pans && Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(dy);
      press = null;
      overlay.classList.remove("dragging");
      if (clickedBackground) close();
      else if (!(swipe && step(dx < 0 ? 1 : -1))) settle();
    });

    overlay.addEventListener("dblclick", function (e) {
      if (!e.target.closest(".panzoom-exclude")) resetView();
    });
    window.addEventListener("resize", function () {
      if (overlay.classList.contains("open")) fit();
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
    if (e.key === "Tab") {
      // Focus trap: cycle through the viewer's own controls.
      var list = focusables(), i = list.indexOf(active), n = list.length;
      if (n) list[e.shiftKey ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n].focus();
    }
    else if (e.key === "Escape") close();
    else if ((e.key === "Enter" || e.key === " ") && onControl) active.click();
    else if (e.key === "PageUp") step(-1);
    else if (e.key === "PageDown") step(1);
    // Left/Right pan while the image is larger than the screen (doing
    // nothing if it fits sideways); otherwise they switch gallery images
    // (doing nothing at either end without `loop`).
    else if (e.key === "ArrowLeft") { if (overflow().any) panBy(-0.1, 0); else step(-1); }
    else if (e.key === "ArrowRight") { if (overflow().any) panBy(0.1, 0); else step(1); }
    else if (e.key === "ArrowUp") panBy(0, -0.1);
    else if (e.key === "ArrowDown") panBy(0, 0.1);
    else if (e.key === "0") resetView();
    else if (e.key === "+" || e.key === "=") zoomAt(1.25, cx, cy);
    else if (e.key === "-") zoomAt(0.8, cx, cy);
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

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

  // Capture phase, so this runs before other click handlers on the page;
  // preventDefault stops the `a.panzoom-link` around the image.
  document.addEventListener("click", function (e) {
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    var r = t.getBoundingClientRect();
    var frac = function (v) { return Math.min(1, Math.max(0, v)); };
    open(t, r.width && r.height ? {
      fx: frac((e.clientX - r.left) / r.width),
      fy: frac((e.clientY - r.top) / r.height)
    } : null);
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
