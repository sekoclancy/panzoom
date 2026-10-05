/*
  panzoom: full-screen pan/zoom viewer for `.panzoom` images, built on
  Panzoom (https://github.com/timmywil/panzoom; panzoom.min.js, loaded first
  as the global `Panzoom`).

  Panzoom does the panning and zooming: drag (or one-finger drag) pans,
  two-finger pinch zooms. This file adds the viewer around it: click image ->
  overlay, wheel / trackpad pinch zooms toward the cursor, double-click or 0
  resets to fit, +/- zoom, arrow keys pan, Esc / x / background click closes.

  Keyboard: marked images are focusable buttons that open on Enter or Space.
  The open viewer takes focus, keeps Tab inside it, and gives focus back to
  what had it before when it closes.

  Options come from `window.PANZOOM_OPTIONS` (written by panzoom.lua from
  the document's `panzoom:` metadata): { maxZoom: 4, hint: true }. A cell's
  `#| panzoom:` options override them per image, via `data-panzoom-max-zoom`
  and `data-panzoom-hint` on the <img>.
*/
(function () {
  var SELECTOR = ".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)";

  var overlay, img, closeBtn, pz = null, opts, press = null, returnFocus = null;

  // Document-wide options, overridden by the clicked image's data attributes.
  function options(el) {
    var o = window.PANZOOM_OPTIONS || {};
    var d = (el && el.dataset) || {};
    var maxZoom = d.panzoomMaxZoom !== undefined ? Number(d.panzoomMaxZoom) : o.maxZoom;
    var hint = d.panzoomHint !== undefined ? d.panzoomHint !== "false" : o.hint;
    return {
      maxZoom: typeof maxZoom === "number" && maxZoom > 0 ? maxZoom : 4,
      hint: hint !== false
    };
  }

  // Centers the image at its natural size and (re)starts Panzoom scaled to
  // fit the screen. Scale = screen px per image px, so max-zoom applies as is.
  function fit() {
    var vw = overlay.clientWidth, vh = overlay.clientHeight;
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;
    var s = Math.min(vw / w, vh / h) * 0.95;
    img.style.left = (vw - w) / 2 + "px";
    img.style.top = (vh - h) / 2 + "px";
    if (pz) pz.destroy();
    pz = Panzoom(img, {
      canvas: true,             // drag anywhere on the overlay, not just the image
      cursor: "grab",
      startScale: s,
      minScale: s,
      maxScale: Math.max(opts.maxZoom, s)
    });
  }

  // Zoom by `factor`, keeping the image point under (px, py) fixed on screen.
  function zoomAt(factor, px, py) {
    if (pz) pz.zoomToPoint(pz.getScale() * factor, { clientX: px, clientY: py });
  }

  // Pan the view by a fraction of the screen: the image moves the other way.
  // Panzoom's translate is in unscaled px, so divide by the scale.
  function panBy(fx, fy) {
    if (!pz) return;
    var s = pz.getScale();
    pz.pan(-fx * overlay.clientWidth / s, -fy * overlay.clientHeight / s, { relative: true });
  }

  function open(src, alt, o) {
    if (!overlay) build();
    returnFocus = document.activeElement;
    opts = o;
    overlay.querySelector(".panzoom-hint").hidden = !opts.hint;
    overlay.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    img.alt = alt || "";
    img.onload = fit;
    img.src = src;
    if (img.complete && img.naturalWidth) fit();
    overlay.focus({ preventScroll: true });
  }

  function close() {
    overlay.classList.remove("open");
    document.documentElement.style.overflow = "";
    if (pz) { pz.destroy(); pz = null; }
    press = null;
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "panzoom-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image viewer");
    overlay.tabIndex = -1;
    overlay.innerHTML =
      '<img alt="" draggable="false">' +
      '<button class="panzoom-close panzoom-exclude" aria-label="Close">&times;</button>' +
      '<div class="panzoom-hint">scroll to zoom &middot; drag to pan &middot; ' +
      'double-click to reset &middot; Esc to close</div>';
    document.body.appendChild(overlay);
    img = overlay.querySelector("img");
    closeBtn = overlay.querySelector(".panzoom-close");
    closeBtn.addEventListener("click", close);

    // Panzoom's own zoomWithWheel takes a fixed step per event, which makes
    // trackpad pinch (many small events) far too fast; scale by the delta.
    overlay.addEventListener("wheel", function (e) {
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      // ctrlKey = trackpad pinch (small deltas), so it gets a higher gain
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    }, { passive: false });

    // A press and release on the background without moving closes the
    // viewer; Panzoom handles the drag itself.
    overlay.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest(".panzoom-close")) return;
      press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, onImg: e.target === img };
      overlay.classList.add("dragging");
    });
    document.addEventListener("pointerup", function (e) {
      if (!press || e.pointerId !== press.id) return;
      var moved = Math.abs(e.clientX - press.sx) + Math.abs(e.clientY - press.sy) > 3;
      var clickedBackground = !moved && !press.onImg;
      press = null;
      overlay.classList.remove("dragging");
      if (clickedBackground) close();
    });

    overlay.addEventListener("dblclick", function () { if (pz) pz.reset(); });
    window.addEventListener("resize", function () {
      if (overlay.classList.contains("open")) fit();
    });
  }

  // The viewer is modal: while it is open, keys go to it and nowhere else.
  // Window capture phase is the earliest point an event can be caught, so
  // page shortcuts (e.g. focus-mode's arrows, Quarto search on keyup) never
  // see them. Only a window-capture listener registered before this one
  // can still run first, so register at script load, not on first open.
  // Browser shortcuts with Ctrl/Cmd/Alt pass through.
  function onKey(e) {
    if (!overlay || !overlay.classList.contains("open")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type !== "keydown") return;
    var cx = overlay.clientWidth / 2, cy = overlay.clientHeight / 2;
    // Focus trap: the close button is the only control, so Tab lands on it.
    if (e.key === "Tab") closeBtn.focus();
    else if (e.key === "Escape") close();
    else if ((e.key === "Enter" || e.key === " ") && document.activeElement === closeBtn) close();
    else if (e.key === "ArrowLeft") panBy(-0.1, 0);
    else if (e.key === "ArrowRight") panBy(0.1, 0);
    else if (e.key === "ArrowUp") panBy(0, -0.1);
    else if (e.key === "ArrowDown") panBy(0, 0.1);
    else if (e.key === "0") { if (pz) pz.reset(); }
    else if (e.key === "+" || e.key === "=") zoomAt(1.25, cx, cy);
    else if (e.key === "-") zoomAt(0.8, cx, cy);
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  // The marked image `e` targets, unless it is in the viewer or is a real
  // link (other than a lightbox wrapper), which keeps its link.
  function target(e) {
    var t = e.target.closest && e.target.closest(SELECTOR);
    if (!t || (overlay && overlay.contains(t))) return null;
    var link = t.closest("a[href]");
    return link && !link.classList.contains("lightbox") ? null : t;
  }

  function openFrom(t) {
    open(t.currentSrc || t.src, t.alt, options(t));
  }

  // Capture phase, so this runs before any lightbox handler on a wrapping <a>.
  document.addEventListener("click", function (e) {
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    openFrom(t);
  }, true);

  // Enter or Space on a focused marked image opens it, like a button.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = target(e);
    if (!t) return;
    e.preventDefault();
    openFrom(t);
  });

  // Make marked images reachable with Tab and announced as buttons.
  function makeFocusable() {
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (!target({ target: el })) return;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-haspopup", "dialog");
      el.setAttribute("aria-label", (el.alt ? el.alt + ": " : "") + "open in zoom viewer");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeFocusable);
  else makeFocusable();
})();
