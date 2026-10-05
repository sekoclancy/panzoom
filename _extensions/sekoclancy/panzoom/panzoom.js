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
  typeset math come through.

  Galleries: images with the same group are stepped through with the
  prev/next buttons, PageUp/PageDown, Left/Right or a horizontal swipe
  (the last two only while the image fits the screen width; when it is
  wider, they pan). The group
  is `data-panzoom-group` (cell option), else `data-group` (`group="..."` on
  a markdown image, as for Quarto's lightbox), else `data-ref-parent`
  (subfigures of one figure, as Quarto's lightbox groups them).

  Keyboard: marked images are focusable buttons that open on Enter or Space.
  The open viewer takes focus, keeps Tab inside it, and gives focus back to
  what had it before when it closes.

  Fit: by default (`fit: auto`) the viewer opens on the whole image, unless
  that would show it too thin to read (a wide collage shorter than a quarter
  of the screen height, or a tall strip narrower than a quarter of its
  width): then it fills the screen height from the left end (or the width
  from the top). `fit: contain | height | width` forces one of these.
  Zooming out always goes down to the whole image.

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
  var FITS = ["auto", "contain", "height", "width"];

  var overlay, img, closeBtn, prevBtn, nextBtn, counter, footer, caption;
  var pz = null, opts, press = null, returnFocus = null;
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
  function captionOf(el) {
    var fig = el.closest("figure");
    var html = figcaption(fig);
    var parent = fig && fig.parentElement && fig.parentElement.closest("figure");
    var outer = figcaption(parent);
    if (outer) html += '<div class="panzoom-caption-parent">' + outer + "</div>";
    return html;
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
    if (h * s < THIN * vh) return "height";
    if (w * s < THIN * vw) return "width";
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
    var vw = overlay.clientWidth, vh = overlay.clientHeight - footer.offsetHeight;
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    var whole = Math.min(vw / w, vh / h) * 0.95;
    var mode = fitMode(w, h, vw, vh, whole);
    var margin = 0.025 * Math.min(vw, vh);
    var s = whole, cx = vw / 2, cy = vh / 2;
    if (mode === "height") {
      s = (vh - 2 * margin) / h;
      if (w * s > vw) cx = margin + w * s / 2;      // start at the left end
    } else if (mode === "width") {
      s = (vw - 2 * margin) / w;
      if (h * s > vh) cy = margin + h * s / 2;      // start at the top
    }
    img.dataset.fit = mode;
    if (pz) pz.destroy();
    pz = Panzoom(img, {
      canvas: true,             // drag anywhere on the overlay, not just the image
      cursor: "grab",
      startScale: s,
      startX: (cx - w / 2) / s,
      startY: (cy - h / 2) / s,
      minScale: Math.min(whole, s),
      maxScale: Math.max(opts.maxZoom, s)
    });
  }

  // Whether the image is wider than the screen, so that Left/Right and
  // horizontal drags pan it rather than switch gallery images.
  function overflowsX() {
    return !!pz && img.naturalWidth * pz.getScale() > overlay.clientWidth + 1;
  }

  // Zoom by `factor`, keeping the image point under (px, py) fixed on screen.
  // Clamp to the zoom limits here: Panzoom computes the fixed point for the
  // scale it is asked for, so asking past a limit makes the image drift.
  function zoomAt(factor, px, py) {
    if (!pz) return;
    var o = pz.getOptions();
    var s = Math.min(o.maxScale, Math.max(o.minScale, pz.getScale() * factor));
    pz.zoomToPoint(s, { clientX: px, clientY: py });
  }

  // Back to the opening view, without Panzoom's default animation: it
  // transitions scale and (unscaled) translate separately, and when the
  // opening scale is tiny (a whole collage) the translate is huge, so the
  // image flies far off-screen mid-animation and snaps back.
  function resetView() {
    if (pz) pz.reset({ animate: false });
  }

  // Pan the view by a fraction of the screen: the image moves the other way.
  // Panzoom's translate is in unscaled px, so divide by the scale.
  function panBy(fx, fy) {
    if (!pz) return;
    var s = pz.getScale();
    pz.pan(-fx * overlay.clientWidth / s, -fy * overlay.clientHeight / s, { relative: true });
  }

  // Shows gallery image `i`, fitted to the screen.
  function show(i) {
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
    overlay.querySelector(".panzoom-hint").hidden = !opts.hint;
    overlay.querySelector(".panzoom-hint-gallery").hidden = !many;
    overlay.setAttribute("aria-label", "Image viewer" + (many ? ", image " + (i + 1) + " of " + n : ""));
    if (pz) { pz.destroy(); pz = null; }
    img.style.transform = "";
    delete img.dataset.fit;
    img.alt = el.alt || "";
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

  function open(el) {
    if (!overlay) build();
    returnFocus = document.activeElement;
    gallery = galleryOf(el);
    overlay.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    show(Math.max(0, gallery.indexOf(el)));
    overlay.focus({ preventScroll: true });
  }

  function close() {
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
    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });
    // A link in the caption (e.g. a cross-reference) leaves the viewer.
    caption.addEventListener("click", function (e) {
      if (e.target.closest("a[href]")) close();
    });

    // Panzoom's own zoomWithWheel takes a fixed step per event, which makes
    // trackpad pinch (many small events) far too fast; scale by the delta.
    // Over the caption, the wheel scrolls a long caption instead.
    overlay.addEventListener("wheel", function (e) {
      if (footer.contains(e.target)) return;
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      // ctrlKey = trackpad pinch (small deltas), so it gets a higher gain
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });

    // Panzoom handles the drag itself. A press and release on the background
    // without moving closes the viewer; a horizontal swipe switches images
    // unless the image is wider than the screen (then the drag pans it).
    overlay.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".panzoom-exclude")) return;
      press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, onImg: e.target === img, pans: overflowsX() };
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
      else if (swipe && !step(dx < 0 ? 1 : -1)) resetView();
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
    else if (e.key === "ArrowLeft") { if (overflowsX() || !step(-1)) panBy(-0.1, 0); }
    else if (e.key === "ArrowRight") { if (overflowsX() || !step(1)) panBy(0.1, 0); }
    else if (e.key === "ArrowUp") panBy(0, -0.1);
    else if (e.key === "ArrowDown") panBy(0, 0.1);
    else if (e.key === "0") resetView();
    else if (e.key === "+" || e.key === "=") zoomAt(1.25, cx, cy);
    else if (e.key === "-") zoomAt(0.8, cx, cy);
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  // Whether a marked image opens the viewer: not one inside the viewer, and
  // not a real link (other than a lightbox wrapper), which keeps its link.
  function opens(t) {
    if (overlay && overlay.contains(t)) return false;
    var link = t.closest("a[href]");
    return !(link && !link.classList.contains("lightbox"));
  }

  // The marked image an event targets, if it opens the viewer.
  function target(e) {
    var t = e.target.closest && e.target.closest(SELECTOR);
    return t && opens(t) ? t : null;
  }

  // Capture phase, so this runs before any lightbox handler on a wrapping <a>.
  document.addEventListener("click", function (e) {
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    open(t);
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

  // Make marked images reachable with Tab and announced as buttons.
  function makeFocusable() {
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (!opens(el)) return;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-label", (el.alt ? el.alt + ": " : "") + "open in zoom viewer");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeFocusable);
  else makeFocusable();
})();
