/*
  Browser checks for the panzoom extension.

  Opens each rendered test page in headless Chrome, clicks every image in every
  `## N. ...` section, and records what opened: the panzoom viewer, GLightbox,
  a link navigation, or nothing. For the panzoom viewer it also tries wheel
  zoom, drag, Esc and a background click; for GLightbox it records the slide
  title, description and gallery size. Console errors, page errors and
  failed requests are collected per page; any of them fails the page,
  except the known ones from Quarto or a math library (KNOWN_ERRORS,
  KNOWN_FAILED_REQUESTS) and failed requests to other sites.
  Then, with the viewer open, checks that keys don't reach the page (as
  focus-mode's and Quarto search's shortcuts would), that Ctrl+key still
  does, and that a fixed widget at z-index 10000 stays below the viewer.
  Last, in a separate Chrome that shows scrollbars (the others hide them),
  checks that the page behind the viewer doesn't shift sideways when the
  viewer hides the page's scrollbar, and that the viewer covers the window.

  Usage: render first (`quarto render` from the repo root, into ../docs/),
  then from tests/:
    npm test                                                          # checks the demo and the test pages
    node browser.mjs ../docs/tests/pages/d-panzoom-selective.html ...   # checks the given pages
    node browser.mjs standalone/_output/*.html                        # pages from standalone.mjs
    node browser.mjs --offline [pages]                                # with no internet access

  Pages are served from the repo by a small built-in web server, as GitHub
  Pages would serve them: Quarto's scripts are JavaScript modules, which
  browsers refuse to load from file:// URLs. A self-contained page (no
  script or stylesheet files of its own) is opened from its file:// address
  instead, as it would be from an email or a download.

  External requests (to CDNs, say) are listed in the report. With
  --offline, they are blocked, as with no internet access.

  Output: results/<page>/report.md, results/<page>/results.json and one
  screenshot per image (results/<page>/<case>-<n>.png); with --offline,
  in results/offline/<page>/.

  Chrome: Quarto's `chrome-headless-shell`
  (`quarto install chrome-headless-shell --no-prompt`), or set
  CHROME=/path/to/chrome.
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const OFFLINE = process.argv.includes("--offline");
const ARGS = process.argv.slice(2).filter((a) => a !== "--offline");
const PAGES = ARGS.length
  ? ARGS.map((p) => path.resolve(p))
  : [path.join(ROOT, "docs", "index.html"),
    ...fs.readdirSync(path.join(ROOT, "docs", "tests", "pages")).filter((f) => f.endsWith(".html")).sort()
      .map((p) => path.join(ROOT, "docs", "tests", "pages", p))];
const VIEWPORT = { width: 1280, height: 900 };

// Errors expected on some pages, from Quarto or a math library rather than
// the viewer: reported with their reason, not failed. `page` matches the
// page's name; `offline` limits one to --offline runs.
const KNOWN_ERRORS = [
  { text: /katex is not defined/, offline: true,
    why: "Quarto's KaTeX setup, with KaTeX's CDN blocked" },
  { text: /sre\/speech-worker\.js/, page: /^self-contained-math$/,
    why: "MathJax 4's speech worker, which self-contained-math (Quarto 1.10) doesn't embed" },
];
const KNOWN_FAILED_REQUESTS = [
  { url: /^file:\/\/\/output\/chtml\/fonts\/woff-v2\//, page: /^self-contained-math$/,
    why: "MathJax's web fonts, which self-contained-math doesn't embed" },
  { url: /^file:\/\/\/sre\/speech-worker\.js/, page: /^self-contained-math$/,
    why: "MathJax 4's speech worker, which self-contained-math (Quarto 1.10) doesn't embed" },
];

// Splits a page's errors or failed requests into the expected ones (with
// their reason) and the rest.
function sortOut(list, known, field, name) {
  const expected = [], unexpected = [];
  for (const item of list) {
    const k = known.find((k) => k[field].test(item) && (!k.page || k.page.test(name)) && (!k.offline || OFFLINE));
    if (k) expected.push({ item, why: k.why }); else unexpected.push(item);
  }
  return { expected, unexpected };
}
// Windows the opening view (`expect-fit`) is also checked in.
const FIT_SIZES = [[1440, 780], [1920, 950], [1920, 1080], [2560, 1300]];
const RESULTS = path.join(HERE, "results", ...(OFFLINE ? ["offline"] : []));

// A self-contained page has no script or stylesheet files of its own
// (embed-resources: true), so it works from a file:// address.
function selfContained(file) {
  return !/<(script|link)\b[^>]*\s(src|href)="(?!data:|https?:|\/\/|#)/i.test(fs.readFileSync(file, "utf8"));
}

// How math shows in an element, defined in each page: "delimited" (TeX
// with its \( \) or \[ \] delimiters: not typeset at all), "raw" (TeX
// commands left as text) or "clean". KaTeX's and MathJax's hidden copies
// for screen readers don't count. Ordered from best to worst.
const TEX_RANK = { clean: 0, raw: 1, delimited: 2 };
function defineTexClass() {
  // The viewer's image space, as panzoom.js's area(): the overlay less the
  // caption band, which desc-position puts below (default), above, or
  // beside the image; { x, y } is where the space starts in the overlay.
  window.__area = (o) => {
    const f = o.querySelector(".panzoom-footer");
    const side = (/\bpanzoom-desc-(top|bottom|left|right)\b/.exec(o.className) || [])[1] || "bottom";
    const w = o.clientWidth, h = o.clientHeight;
    if (side === "left" || side === "right") {
      return { x: side === "left" ? f.offsetWidth : 0, y: 0, w: w - f.offsetWidth, h, side };
    }
    return { x: 0, y: side === "top" ? f.offsetHeight : 0, w, h: h - f.offsetHeight, side };
  };
  window.__texClass = (el) => {
    if (!el) return "clean";
    const c = el.cloneNode(true);
    c.querySelectorAll("annotation, mjx-assistive-mml, script, style").forEach((n) => n.remove());
    const t = c.textContent;
    return /\\[(\[]/.test(t) ? "delimited" : /\\[a-zA-Z]/.test(t) ? "raw" : "clean";
  };
}

// Minimal static file server for docs/.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the page is still: which viewer is open, the viewer image's
// position, size and transform, the gallery counter, GLightbox's slide and
// the focused element haven't changed for `quiet` ms. Also waits for the
// viewer's image to load and Panzoom to start on it (keys pressed before
// that are lost), and for GLightbox's slide to finish loading. Replaces
// fixed sleeps after an action: returns as soon as the action has played
// out (a gallery switch, an open or close). The viewer marks a running
// bounce or spring-back with `panzoom-moving`, so a short `quiet` can't
// return at a bounce's turning point.
// After wheel input: Chrome may handle a wheel event after mouse.wheel()
// returns, so first wait (briefly) for the viewer image's transform to
// change from `before`, then settle. If it never changes (the wheel was
// meant to do nothing), this costs `wait` ms.
async function afterWheel(page, before, wait = 400) {
  await page.waitForFunction((before) => {
    const img = document.querySelector(".panzoom-overlay img");
    return !!img && img.style.transform !== before;
  }, { polling: 16, timeout: wait }, before).catch(() => {});
  await settle(page);
}

const transformOf = (page) =>
  page.evaluate(() => document.querySelector(".panzoom-overlay img")?.style.transform ?? "");

async function settle(page, quiet = 60, timeout = 5000) {
  await page.evaluate(() => { window.__settle = null; });
  await page.waitForFunction((quiet) => {
    const o = document.querySelector(".panzoom-overlay");
    const open = !!(o && o.classList.contains("open"));
    const img = o && o.querySelector("img");
    if (open && img && !img.complete) return false;           // still loading
    if (open && img && img.naturalWidth && !img.style.transform) return false;  // Panzoom not started
    if (o && o.classList.contains("panzoom-moving")) return false;   // bounce running
    const g = document.querySelector(".glightbox-container");
    const slide = g && g.querySelector(".gslide.current");
    if (g && slide && !slide.classList.contains("loaded")) return false;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    };
    const snap = JSON.stringify([
      open, box(open && img), img && img.style.transform,
      o && o.querySelector(".panzoom-counter")?.textContent,
      !!g, g && g.className, box(slide), slide && getComputedStyle(slide).opacity,
      document.activeElement && document.activeElement.className,
    ]);
    const now = performance.now();
    if (!window.__settle || window.__settle.snap !== snap) window.__settle = { snap, since: now };
    return now - window.__settle.since >= quiet;
  }, { polling: 16, timeout }, quiet).catch(() => {});
}

// Parse Panzoom's `scale(s) translate(x px, y px)` on the viewer image. The
// translate is in unscaled px, so x and y are multiplied by s to give the
// on-screen offset.
async function viewerTransform(page) {
  return page.evaluate(() => {
    const img = document.querySelector(".panzoom-overlay img");
    const m = img && /scale\(([-\d.e]+)\)\s*translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(img.style.transform);
    return m ? { x: +m[1] * +m[2], y: +m[1] * +m[3], s: +m[1] } : null;
  });
}

// Zooms in (+) until the viewer's image is larger than the screen, wider
// if `wide`, and returns which ways it is ({ x, y }). Two steps are enough
// for most images, but not for small ones (Quarto before 1.7 renders
// Jupyter plots at half the pixels), which would otherwise still fit, so
// the arrows would switch images instead of panning.
async function zoomPastScreen(page, wide = false) {
  const overflow = () => page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay");
    const r = o.querySelector("img").getBoundingClientRect(), a = window.__area(o);
    return { x: r.width > a.w + 1, y: r.height > a.h + 1 };
  });
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await settle(page);
  let over = await overflow();
  for (let i = 0; i < 8 && !(wide ? over.x : over.x || over.y); i++) {
    await page.keyboard.press("+");
    await settle(page);
    over = await overflow();
  }
  return over;
}

async function state(page) {
  return page.evaluate(() => {
    const pz = document.querySelector(".panzoom-overlay.open");
    const glb = document.querySelector(".glightbox-container");
    if (pz) {
      const counter = pz.querySelector(".panzoom-counter");
      const caption = pz.querySelector(".panzoom-caption");
      const img = pz.querySelector("img");
      const r = img.getBoundingClientRect(), a = window.__area(pz);
      return {
        size: `${img.naturalWidth}×${img.naturalHeight} px, shown ${Math.round(r.width)}×${Math.round(r.height)}` +
          (img.classList.contains("panzoom-vector") ? `, vector (will-change: ${getComputedStyle(img).willChange})` : "") +
          `, on ${getComputedStyle(img).backgroundColor}`,
        opened: "panzoom",
        caption: caption.hidden ? "" : caption.textContent.trim().replace(/\s+/g, " "),
        fit: img.dataset.fit || "",
        format: img.classList.contains("panzoom-vector") ? "svg" : "bitmap",
        hintShown: !pz.querySelector(".panzoom-hint").hidden,
        // The hint names the caption key only when there is a caption or
        // description to hide or show (and a key bound to it).
        hintCaptionOk: /to (hide|show) the caption/.test(pz.querySelector(".panzoom-hint-keys").textContent) ===
          ((window.PANZOOM_OPTIONS?.keys || {}).caption !== false &&
            (!!caption.innerHTML || !!pz.querySelector(".panzoom-description").innerHTML.trim())),
        overlayClass: pz.className,
        overlayBg: getComputedStyle(pz).backgroundColor,
        bandBg: getComputedStyle(pz.querySelector(".panzoom-footer")).backgroundColor,
        // Where the caption band is: below, above, or beside the image.
        descPosition: a.side,
        // Whether the image opened larger than the screen, sideways (overX)
        // or up and down (overY): a strip to scroll along.
        overX: r.width > a.w + 1,
        overY: r.height > a.h + 1,
        // An image that fits the space stays clear of the caption band, on
        // whichever side it is (its size follows its text).
        captionClear: (r.height > a.h + 1 || (r.top >= a.y - 1 && r.bottom <= a.y + a.h + 1)) &&
          (r.width > a.w + 1 || (r.left >= a.x - 1 && r.right <= a.x + a.w + 1)),
        backdrop: getComputedStyle(img).backgroundColor,
        description: (() => {
          const d = pz.querySelector(".panzoom-description");
          return !d || d.hidden ? "" : d.textContent.trim().replace(/\s+/g, " ");
        })(),
        // Shown at all: a description of only webtex math has no text.
        descriptionShown: (() => {
          const d = pz.querySelector(".panzoom-description");
          return !!d && !d.hidden && !!d.innerHTML.trim();
        })(),
        // The panels whose text is longer than they are (they scroll).
        overflowing: [".panzoom-caption", ".panzoom-description"].filter((s) => {
          const p = pz.querySelector(s);
          return !p.hidden && p.scrollHeight > p.clientHeight + 1;
        }).map((s) => s.slice(9)),
        captionHasMath: !caption.hidden && !!caption.querySelector(".math, math"),
        // Citations and cross-references left unresolved: Quarto shows an
        // unknown one as `?@key`, an unprocessed one stays `[@key]` or
        // `@key` (not an email address).
        unresolved: (pz.querySelector(".panzoom-caption:not([hidden])")?.textContent || "").concat(" ",
          pz.querySelector(".panzoom-description:not([hidden])")?.textContent || "").match(/(?<![\w.])[[?]?@[A-Za-z][\w:-]*/g) || [],
        // In-page links (citations, cross-references) whose target is missing.
        brokenLinks: [...pz.querySelectorAll(".panzoom-caption a[href^='#'], .panzoom-description a[href^='#']")]
          .map((a) => a.getAttribute("href")).filter((h) => h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))),
        citations: pz.querySelectorAll(".panzoom-caption .citation, .panzoom-description .citation").length,
        crossrefs: pz.querySelectorAll(".panzoom-caption a.quarto-xref, .panzoom-description a.quarto-xref").length,
        captionTeX: caption.hidden ? "clean" : window.__texClass(caption),
        descriptionTeX: window.__texClass(pz.querySelector(".panzoom-description:not([hidden])")),
        counter: counter.hidden ? "" : counter.textContent,
      };
    }
    if (glb) {
      const slide = glb.querySelector(".gslide.current");
      const text = (sel) => slide?.querySelector(sel)?.textContent.trim() || "";
      return {
        opened: "glightbox",
        title: text(".gslide-title"),
        description: text(".gslide-desc"),
        slides: glb.querySelectorAll(".gslide").length,
        skin: [...glb.classList].filter((c) => c !== "glightbox-container").join(" "),
        descPosition: (/\bdesc-(top|bottom|left|right)\b/.exec(slide?.querySelector(".ginner-container")?.className || "") || [])[1] || "",
      };
    }
    return { opened: "nothing" };
  });
}

// Close whatever is open and wait for it to go away.
async function closeAll(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector(".panzoom-overlay.open") && !document.querySelector(".glightbox-container"),
    { timeout: 3000 }).catch(() => {});
  await settle(page);
}

// Open the viewer on a result's image, from a closed viewer.
// Shows an image a reader has to uncover first: one on a tab not selected,
// or in a collapsed callout. Clicks the tab or the callout's header, as a
// reader would, and says whether it did.
async function reveal(page, handle) {
  const clicked = await handle.evaluate((el) => {
    let n = 0;
    const pane = el.closest(".tab-pane");
    if (pane && !pane.classList.contains("active")) {
      const tab = document.querySelector(`[data-bs-target="#${pane.id}"]`);
      if (tab) tab.click(), n++;
    }
    const body = el.closest(".callout-collapse");
    if (body && !body.classList.contains("show")) {
      const header = body.closest(".callout")?.querySelector('[data-bs-toggle="collapse"]');
      if (header) header.click(), n++;
    }
    return n > 0;
  });
  // Bootstrap's collapse animates for 0.35 s.
  if (clicked) await settle(page, 400);
  return clicked;
}

async function openImage(page, r) {
  const handle = await page.$(`img[data-test-idx="${r.idx}"]`);
  await reveal(page, handle);
  await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await settle(page);
  await handle.click();
  await settle(page);
}

async function exercisePanzoom(page) {
  const out = {};
  const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
  const fit = await viewerTransform(page);
  out.fitScale = fit?.s ?? null;

  // Wheel-zoom at an off-center point of the image (30% across, 60% down,
  // kept on screen). Zooming toward the cursor means that image point stays
  // under the cursor; Anchor px is how far it drifted.
  const imageRect = () => page.evaluate(() => {
    const r = document.querySelector(".panzoom-overlay img").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const r0 = await imageRect();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const px = clamp(r0.left + 0.3 * r0.width, 20, VIEWPORT.width - 20);
  const py = clamp(r0.top + 0.6 * r0.height, 20, VIEWPORT.height - 120);
  const frac = (r) => [(px - r.left) / r.width, (py - r.top) / r.height];
  const f0 = frac(r0);
  await page.mouse.move(px, py);
  // One wheel step at a time (several in one frame are the fast zoom check,
  // below). In each step the image point under the cursor must stay there,
  // within 3 px, except along an axis where the step left the image flush
  // with the screen margin: containment may move it there (an image larger
  // than the screen covers it edge to edge; a smaller one stays wholly on
  // screen). Anchor px is how far the point drifted over all five steps.
  const flush = () => page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay");
    const a = window.__area(o);
    const margin = 0.025 * Math.min(a.w, a.h);
    const ob = o.getBoundingClientRect(), r = o.querySelector("img").getBoundingClientRect();
    const at = (lo, size, avail) => {
      const m = size > avail ? margin : Math.min(margin, (avail - size) / 2);
      return Math.abs(lo - m) <= 2 || Math.abs(avail - lo - size - m) <= 2;
    };
    return [at(r.left - ob.left - a.x, r.width, a.w), at(r.top - ob.top - a.y, r.height, a.h)];
  });
  out.anchorOk = true;
  let prev = r0;
  for (let i = 0; i < 5; i++) {
    const before = await transformOf(page);
    const fp = frac(prev);
    await page.mouse.wheel({ deltaY: -200 });
    await afterWheel(page, before);
    const next = await imageRect();
    const d = [fp[0] * next.width + next.left - px, fp[1] * next.height + next.top - py];
    const fl = await flush();
    (out.anchorSteps ??= []).push({ d: d.map(Math.round), flush: fl, w: Math.round(next.width), h: Math.round(next.height), left: Math.round(next.left), top: Math.round(next.top) });
    if ((Math.abs(d[0]) > 3 && !fl[0]) || (Math.abs(d[1]) > 3 && !fl[1])) out.anchorOk = false;
    prev = next;
  }
  const zoomed = await viewerTransform(page);
  out.wheelZoom = fit && zoomed ? +(zoomed.s / fit.s).toFixed(2) : null;
  const r1 = await imageRect();
  const f1 = frac(r1);
  out.anchorDrift = r0.width > 0
    ? Math.round(Math.hypot((f1[0] - f0[0]) * r1.width, (f1[1] - f0[1]) * r1.height)) : null;

  await page.mouse.move(cx, cy);

  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 80, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  const dragged = await viewerTransform(page);
  out.dragMoved = zoomed && dragged
    ? Math.round(Math.hypot(dragged.x - zoomed.x, dragged.y - zoomed.y)) : null;
  out.closedByDrag = (await state(page)).opened !== "panzoom";

  if (!out.closedByDrag) {
    // Reset is instant: right after `0` the view is back where it opened
    // (an animated reset would still be mid-way).
    await page.keyboard.press("0");
    // Two animation frames: Panzoom draws on the next one. A fixed 20 ms
    // could miss it when the machine is busy.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const back = await viewerTransform(page);
    out.resetOk = fit ? !!(back && back.s === fit.s &&
      Math.abs(back.x - fit.x) < 1 && Math.abs(back.y - fit.y) < 1) : null;  // null: no image loaded

    // Fast zoom stays on the cursor: zoom in with + until the image is larger
    // than the screen both ways (so containment can't move it), then a burst
    // of wheel steps back to back, like a fast wheel or a trackpad pinch,
    // at an off-center point. Several steps can land in one animation frame,
    // which once made the zoom drift. Skipped if max-zoom comes first.
    const area = await page.evaluate(() => {
      return window.__area(document.querySelector(".panzoom-overlay"));
    });
    let big = await imageRect();
    for (let i = 0; i < 12 && !(big.width > area.w && big.height > area.h); i++) {
      await page.keyboard.press("+");
      await settle(page);
      big = await imageRect();
    }
    out.anchorChecked = big.width > area.w && big.height > area.h;
    if (out.anchorChecked) {
      const qx = Math.round(area.w * 0.35), qy = Math.round(area.h * 0.6);
      const fq = (r) => [(qx - r.left) / r.width, (qy - r.top) / r.height];
      const g0 = fq(big);
      const beforeBurst = await transformOf(page);
      const s0 = (await viewerTransform(page)).s;
      // Dispatched from inside the page, so all four land in one frame
      // (from Puppeteer, each wheel step is a separate round trip).
      const burstTarget = await page.evaluate((qx, qy) => {
        const target = document.elementFromPoint(qx, qy);
        for (let i = 0; i < 4; i++) {
          target.dispatchEvent(new WheelEvent("wheel", {
            deltaY: -100, clientX: qx, clientY: qy, bubbles: true, cancelable: true }));
        }
        return target.tagName + "." + target.className;
      }, qx, qy);
      await afterWheel(page, beforeBurst);
      const after = await imageRect();
      const g1 = fq(after);
      out.anchorFastDrift = Math.round(Math.hypot((g1[0] - g0[0]) * after.width, (g1[1] - g0[1]) * after.height));
      // For diagnosing a failure: where the burst went and what changed.
      out.anchorFastDetail = { burstTarget, point: [qx, qy], s0, s1: (await viewerTransform(page)).s,
        before: [big.left, big.top, big.width, big.height].map(Math.round),
        after: [after.left, after.top, after.width, after.height].map(Math.round) };
      // At max-zoom the burst can't zoom; "no drift" would mean nothing.
      if ((await viewerTransform(page)).s <= s0 * 1.01) out.anchorChecked = false;
    }
    await page.keyboard.press("Escape");
    await settle(page);
    out.escCloses = (await state(page)).opened !== "panzoom";
  }
  return out;
}

// With the viewer open, keys must not reach the page, and fixed widgets from
// other extensions must not paint above it. Mimics focus-mode (page arrows,
// f/t/p/d/l, PageUp/PageDown; z-index 10000) and Quarto search (f, s, / on
// keyup) with listeners registered after panzoom's, as a late-loading
// extension would.
const ISOLATION_KEYS = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "f", "t", "p", "d", "l", "s", "/", "Enter", " "];

async function checkIsolation(page, box) {
  await page.evaluate(() => {
    window.__leaked = [];
    const spy = (where) => (e) => window.__leaked.push(`${e.type} ${JSON.stringify(e.key)} (${where})`);
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(type, spy("window capture"), true);
      document.addEventListener(type, spy("document"));
    }
    const w = document.createElement("div");
    w.id = "test-fixed-widget";
    w.style.cssText = "position:fixed;left:16px;bottom:16px;width:44px;height:44px;z-index:10000;background:red";
    document.body.appendChild(w);
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page);
  const out = { opened: (await state(page)).opened === "panzoom" };
  if (!out.opened) return out;

  for (const key of ISOLATION_KEYS) await page.keyboard.press(key);
  await settle(page);
  out.leaked = await page.evaluate(() => window.__leaked.splice(0));
  out.stillOpen = (await state(page)).opened === "panzoom";

  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  out.modifierPasses = (await page.evaluate(() => window.__leaked.splice(0))).length > 0;

  // Function keys are browser features and pass through (not F5: it would
  // reload the page).
  await page.keyboard.press("F3");
  await page.keyboard.press("F9");
  const fkeys = await page.evaluate(() => window.__leaked.splice(0));
  out.functionKeysPass = ["F3", "F9"].every((k) => fkeys.some((l) => l.startsWith(`keydown "${k}"`)));
  out.stillOpenAfterFKeys = (await state(page)).opened === "panzoom";

  out.widgetBelow = await page.evaluate(() => {
    const r = document.getElementById("test-fixed-widget").getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(top && top.closest(".panzoom-overlay"));
  });

  await page.keyboard.press("Escape");
  await settle(page);
  out.escCloses = (await state(page)).opened !== "panzoom";
  await page.evaluate(() => document.getElementById("test-fixed-widget").remove());
  return out;
}

// Keyboard access: the image (or its `a.panzoom-link`, the no-JS fallback)
// is one focusable button that opens on Enter and Space; the viewer takes
// focus, keeps Tab inside, pans with the arrows, and gives focus back to the
// image when it closes.
async function checkKeyboard(page, handle) {
  const out = {};
  const focusState = () => page.evaluate(() => {
    const a = document.activeElement;
    return {
      inViewer: !!(a && a.closest(".panzoom-overlay")),
      onClose: !!(a && a.classList.contains("panzoom-close")),
      onImage: !!(a && (a.dataset.testIdx !== undefined ||
        (a.matches("a.panzoom-link") && a.querySelector("[data-test-idx]")))),
    };
  });
  const control = await handle.evaluateHandle((el) => el.closest("a.panzoom-link") || el);
  out.focusable = await control.evaluate((el) => el.tabIndex === 0 && el.getAttribute("role") === "button");
  out.oneTabStop = await handle.evaluate((el) => !el.closest("a.panzoom-link") || el.tabIndex < 0);
  await control.focus();
  await page.keyboard.press("Enter");
  await settle(page);
  out.enterOpens = (await state(page)).opened === "panzoom";
  if (!out.enterOpens) return out;
  out.focusMovesIn = (await focusState()).inViewer;

  // The arrows pan in each direction the image is larger than the screen
  // (in a direction where it fits, containment holds it still).
  const over = await zoomPastScreen(page);
  const before = await viewerTransform(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await settle(page);  // past an end, a pan bounces and settles
  const after = await viewerTransform(page);
  const movedX = before && after && after.x < before.x - 1;
  const movedY = before && after && after.y < before.y - 1;
  out.arrowsPan = (over.x || over.y) && (!over.x || !!movedX) && (!over.y || !!movedY);
  // Left and Up pan back the other way.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await settle(page);
  const back = await viewerTransform(page);
  const backX = after && back && back.x > after.x + 1;
  const backY = after && back && back.y > after.y + 1;
  out.arrowsPanBack = (over.x || over.y) && (!over.x || !!backX) && (!over.y || !!backY);

  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  out.tabTrapped = (await focusState()).inViewer;

  await page.evaluate(() => document.querySelector(".panzoom-close").focus());
  await page.keyboard.press("Enter");
  await settle(page);
  out.closeButtonCloses = (await state(page)).opened !== "panzoom";
  out.focusReturns = (await focusState()).onImage;

  await page.keyboard.press(" ");
  await settle(page);
  out.spaceOpens = (await state(page)).opened === "panzoom";

  // c and h (or the page's `keys:`) hide the caption (with the
  // description) and the hint, and show them again; with both hidden the
  // caption band goes, and the image, still at its opening view, fits the
  // room it leaves. A key set to false does nothing, and c and h then
  // stand in for it, doing nothing either.
  const bound = await page.evaluate(() => (window.PANZOOM_OPTIONS || {}).keys || {});
  const first = (a, dflt) => (bound[a] === false ? null : (bound[a] || [dflt])[0]);
  const capKey = first("caption", "c"), hintKey = first("hint", "h");
  const named = (a, dflt) => (bound[a] === false ? [] : bound[a] || dflt).map((k) => (k === "Escape" ? "Esc" : k)).join(" or ");
  const { hintText, captioned } = await page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay");
    return { hintText: o.querySelector(".panzoom-hint-keys").textContent,
      captioned: !!o.querySelector(".panzoom-caption").innerHTML || !!o.querySelector(".panzoom-description").innerHTML.trim() };
  });
  // The caption key is named only when there is a caption or description.
  const cap = captioned ? named("caption", ["c"]) : "", hin = named("hint", ["h"]), shut = named("close", ["Escape"]);
  // Each bound key is its own item on the hint line.
  const items = hintText.split(" \u00b7 ");
  out.hintNamesKeys = (cap ? items.includes(`${cap} to hide the caption`) : !hintText.includes("caption")) &&
    (hin ? items.includes(`${hin} to hide the hint`) : !hintText.includes("the hint")) &&
    (shut ? items.includes(`${shut} to close`) : !hintText.includes("close"));
  const band = () => page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay"), f = o.querySelector(".panzoom-footer");
    const shown = (sel) => o.querySelector(sel).offsetParent !== null;
    return {
      caption: shown(".panzoom-caption"), desc: shown(".panzoom-description"), hint: shown(".panzoom-hint"),
      band: f.offsetParent !== null && f.offsetHeight > 0,
      hintKeys: o.querySelector(".panzoom-hint-keys").textContent.split(" \u00b7 "),
      imgH: o.querySelector("img").getBoundingClientRect().height,
    };
  });
  const b0 = await band();
  await page.keyboard.press(capKey || "c");
  await settle(page);
  const b1 = await band();
  await page.keyboard.press(hintKey || "h");
  await settle(page);
  const b2 = await band();
  await page.keyboard.press(capKey || "c");
  await page.keyboard.press(hintKey || "h");
  await settle(page);
  const b3 = await band();
  // With the caption hidden, the hint says its key shows it again.
  out.captionToggles = capKey
    ? !b1.caption && !b1.desc && b3.caption === b0.caption && b3.desc === b0.desc &&
      (!cap || (b1.hintKeys.includes(`${cap} to show the caption`) && b3.hintKeys.includes(`${cap} to hide the caption`)))
    : b1.caption === b0.caption && b1.desc === b0.desc;
  out.hintToggles = hintKey ? !b2.hint && b3.hint === b0.hint : b2.hint === b0.hint;
  out.bandGoes = capKey && hintKey ? !b2.band && b2.imgH >= b0.imgH - 1 : true;
  await page.keyboard.press("Escape");
  await settle(page);
  out.escReturnsFocus = (await state(page)).opened !== "panzoom" && (await focusState()).onImage;
  // The image's focus ring: shown after a viewer opened from the keyboard;
  // hidden after one opened with the mouse, though Esc closed it, until the
  // next key press.
  const ring = () => page.evaluate(() => {
    const a = document.activeElement, img = a && (a.matches("img") ? a : a.querySelector("img"));
    return !!img && getComputedStyle(img).outlineStyle !== "none";
  });
  out.ringAfterKeyboard = await ring();
  await handle.click();
  await settle(page);
  await page.keyboard.press("Escape");
  await settle(page);
  const quiet = (await focusState()).onImage && !(await ring());
  await page.keyboard.press("Shift");
  out.noRingAfterMouse = quiet && (await ring());
  // Any other close key closes too.
  out.otherKeysClose = true;
  for (const k of (bound.close || []).filter((k) => k !== "Escape")) {
    await control.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    await page.keyboard.press(k);
    await settle(page);
    if ((await state(page)).opened === "panzoom") out.otherKeysClose = false;
  }
  return out;
}

// Gallery navigation, on the first image whose viewer shows a counter.
async function checkGallery(page, handle) {
  const out = {};
  const counter = async () => (await state(page)).counter;
  await handle.click();
  await settle(page);
  const first = await counter();
  const m = /^(\d+) \/ (\d+)$/.exec(first || "");
  if (!m) return out;
  const n = +m[2];
  out.start = first;
  out.size = n;
  // Left on the first image: without `loop`, nothing happens, not even a
  // nudge; with `loop`, it goes to the last image (and back with Right).
  out.loop = await page.evaluate(() => !!(window.PANZOOM_OPTIONS || {}).loop);
  const t0 = await viewerTransform(page);
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  const tl = await viewerTransform(page);
  if (out.loop) {
    out.leftAtStartWraps = (await counter()) === `${n} / ${n}`;
    await page.keyboard.press("ArrowRight");
    await settle(page);
    out.leftAtStartStill = out.leftAtStartWraps && (await counter()) === first;
  } else {
    out.leftAtStartStill = (await counter()) === first && !!(t0 && tl) &&
      Math.abs(tl.x - t0.x) < 0.5 && Math.abs(tl.y - t0.y) < 0.5;
  }
  // PageUp/PageDown don't change image (they are swallowed, as all keys).
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageUp");
  await settle(page);
  out.pageKeysStill = (await counter()) === first;
  const next = `${+m[1] + 1} / ${n}`;
  await page.keyboard.press("ArrowRight");
  await settle(page);
  out.arrowNext = await counter();
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  out.arrowBack = (await counter()) === first;
  await page.click(".panzoom-next");
  await settle(page);
  out.buttonNext = await counter();
  await page.click(".panzoom-prev");
  await settle(page);
  // Swipe left on the background: next image.
  const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
  await page.mouse.move(cx + 120, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  out.swipeNext = await counter();
  await page.click(".panzoom-prev");
  await settle(page);
  // Zoomed in past the screen's width, Right pans instead of switching.
  const wider = (await zoomPastScreen(page, true)).x;
  const z0 = await viewerTransform(page);
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const z1 = await viewerTransform(page);
  // Same image, and moved left if it is wider than the screen.
  out.zoomedArrowPans = (await counter()) === first &&
    (!wider || !!(z0 && z1 && z1.x < z0.x - 1));
  // Without loop, the first image has no previous one; with loop it does.
  out.prevDisabledAtStart = m[1] === "1"
    ? await page.$eval(".panzoom-prev", (b) => b.disabled) : null;
  if (out.loop && out.prevDisabledAtStart !== null) out.prevDisabledAtStart = !out.prevDisabledAtStart;
  // Next to the last image: focus stays in the viewer, even when the
  // focused next button becomes disabled there.
  for (let i = +m[1]; i < n; i++) { await page.click(".panzoom-next"); await settle(page); }
  out.focusAtEnd = await page.evaluate(() => {
    const a = document.activeElement;
    return a.closest(".panzoom-overlay") ? (a.className.split(" ")[0] || a.tagName) : a.tagName;
  });
  // On the last image, the mirror of the first: without `loop`, "next" is
  // disabled and Right does nothing; with `loop`, Right goes to the first
  // image. A last image wider than the screen pans on Right instead, so
  // there the next button is pressed.
  out.nextDisabledAtEnd = await page.$eval(".panzoom-next", (b) => b.disabled);
  if (out.loop) out.nextDisabledAtEnd = !out.nextDisabledAtEnd;
  const last = await counter();
  if ((await state(page)).overX) await page.click(".panzoom-next");
  else await page.keyboard.press("ArrowRight");
  await settle(page);
  out.rightAtEnd = await counter();
  out.rightAtEndOk = out.rightAtEnd === (out.loop ? `1 / ${n}` : last);
  await closeAll(page);
  out.ok = out.pageKeysStill &&
    out.arrowNext === next && out.arrowBack && out.buttonNext === next &&
    out.swipeNext === next && out.zoomedArrowPans && out.prevDisabledAtStart !== false &&
    out.leftAtStartStill && out.focusAtEnd.startsWith("panzoom-") &&
    out.nextDisabledAtEnd && out.rightAtEndOk;
  return out;
}

const KEYBOARD_CHECKS = [
  ["focusable", "Image is focusable and a button"],
  ["oneTabStop", "One Tab stop per image"],
  ["enterOpens", "Enter on the image opens the viewer"],
  ["focusMovesIn", "Focus moves into the viewer"],
  ["arrowsPan", "Arrow keys pan (Right, Down)"],
  ["arrowsPanBack", "Arrow keys pan back (Left, Up)"],
  ["tabTrapped", "Tab and Shift+Tab stay in the viewer"],
  ["closeButtonCloses", "Enter on the close button closes"],
  ["focusReturns", "Focus returns to the image"],
  ["spaceOpens", "Space on the image opens the viewer"],
  ["escReturnsFocus", "Esc closes and returns focus"],
  ["ringAfterKeyboard", "Opened from the keyboard, the image shows its focus ring after Esc"],
  ["noRingAfterMouse", "Opened with the mouse, no focus ring after Esc until the next key press"],
  ["otherKeysClose", "Close keys other than Esc (from keys:) close"],
  ["hintNamesKeys", "The hint line names the caption, hint, and close keys"],
  ["captionToggles", "c (or its keys: key) hides the caption and description, and shows them again; the hint says which"],
  ["hintToggles", "h (or its keys: key) hides the hint, and shows it again"],
  ["bandGoes", "With both hidden, the caption band goes and the image keeps or gains room"],
];

async function checkPage(browser, base, file) {
  const name = path.basename(file, ".html");
  const outDir = path.join(RESULTS, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on("console", (m) => {
    // A failed request logs an error without its address; it is listed
    // under failed requests instead (and offline, blocked ones aren't).
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(defineTexClass);

  // Requests that leave this machine; offline, they fail as with no network.
  const external = new Set();
  const isLocal = (u) => /^(data|blob|about|file):/.test(u) || new URL(u).hostname === "127.0.0.1";
  const failed = new Set();
  const short = (u) => (u.length > 120 ? u.slice(0, 120) + "..." : u);
  page.on("requestfailed", (req) => {
    if (OFFLINE && !isLocal(req.url())) return;
    failed.add(`${isLocal(req.url()) ? "" : "external: "}${short(req.url())} (${req.failure()?.errorText})`);
  });
  if (OFFLINE) await page.setRequestInterception(true);
  page.on("request", (req) => {
    const local = isLocal(req.url());
    if (!local) external.add(short(req.url()));
    if (!OFFLINE || req.isInterceptResolutionHandled()) return;
    if (local) req.continue(); else req.abort("internetdisconnected");
  });

  const url = selfContained(file)
    ? "file://" + file
    : base + path.relative(ROOT, file).split(path.sep).join("/");
  await page.goto(url, { waitUntil: "load" });
  // MathJax 4 in a self-contained page (Quarto 1.10) never finishes
  // starting: its speech worker can't load (file:///sre/speech-worker.js).
  // Wait at most 10 s, and report it.
  const mathjaxStalled = await page.evaluate(() => Promise.race([
    Promise.resolve(window.MathJax?.startup?.promise).then(() => false),
    new Promise((r) => setTimeout(() => r(true), 10000))]));
  await settle(page);

  // How the page shows its own math, to compare the viewer's with: not the
  // viewer's, nor the hidden math panzoom adds for descriptions, unless the
  // page has no other (then that shows whether its math library loaded).
  // null: no math at all.
  const pageTeX = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".math, math")].filter((e) =>
      !e.closest(".panzoom-overlay, pre, code") && !e.parentElement.closest(".math"));
    const own = all.filter((e) => !e.closest(".panzoom-math"));
    const els = own.length ? own : all;
    const order = ["clean", "raw", "delimited"];
    return els.length ? els.map(window.__texClass).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : null;
  });

  // Record link navigations instead of following them. This listener runs in
  // the bubble phase on window, i.e. after the page's own handlers, so it only
  // sees clicks that nothing else (panzoom, GLightbox) has claimed.
  await page.evaluate(() => {
    window.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented) return;
      window.__navigatedTo = a.href;
      e.preventDefault();
    });
  });

  // Every image in a numbered case section, tagged so we can find it again.
  // An unnumbered section counts too if it states an expectation (as the
  // demo's `## Wide figure {expect-fit="height"}`), numbered by its place
  // on the page.
  const images = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("section.level2").forEach((sec, k) => {
      const h = sec.querySelector("h2");
      // Numbered by Quarto (`number-sections`, the example pages), or by hand
      // ("## 1. Title", the standalone pages).
      const num = h && h.querySelector(".header-section-number");
      let m = num ? [null, num.textContent.trim(), h.textContent.trim().slice(num.textContent.trim().length).trim()]
        : h && /^(\d+)\.\s*(.*)$/.exec(h.textContent.trim());
      if (!m && h && Object.keys(sec.dataset).some((d) => d.startsWith("expect"))) m = [null, String(k + 1), h.textContent.trim()];
      if (!m) return;
      // Not webtex's math images.
      [...sec.querySelectorAll("img")].filter((img) => !img.closest(".math")).forEach((img, i) => {
        const idx = out.length;
        img.dataset.testIdx = idx;
        const link = img.closest("a");
        out.push({
          idx, case: +m[1], caseTitle: m[2], n: i + 1,
          expectFit: sec.dataset.expectFit || null,
          shiftScroll: sec.dataset.shiftScroll || null,
          expectScale: sec.dataset.expectScale ? +sec.dataset.expectScale : null,
          expectZoomOut: sec.dataset.expectZoomOut || null,
          // `expect-scroll="description"` (or "caption"): that panel is too long
          // to fit and must be reachable with Tab and scrolled by keys.
          expectScroll: sec.dataset.expectScroll || null,
          // Option checks (pages A-D, F, G, css-class): on the image itself, or on
          // its case; a case's `expect-open` can list one value per image, in order.
          expectOpen: img.dataset.expectOpen || (() => {
            const list = (sec.dataset.expectOpen || "").split(/\s+/).filter(Boolean);
            return list.length > 1 ? list[i] || null : list[0] || null;
          })(),
          expectCaption: sec.dataset.expectCaption || null,
          expectHint: sec.dataset.expectHint || null,
          expectMaxZoom: sec.dataset.expectMaxZoom ? +sec.dataset.expectMaxZoom : null,
          expectFormat: sec.dataset.expectFormat || null,
          // Styling checks: on the image itself, or on its case.
          expectClass: img.dataset.expectClass || sec.dataset.expectClass || null,
          // A class the viewer must not have, e.g. one the image before set.
          expectNoClass: img.dataset.expectNoClass || sec.dataset.expectNoClass || null,
          expectOverlay: img.dataset.expectOverlay || sec.dataset.expectOverlay || null,
          expectBand: img.dataset.expectBand || sec.dataset.expectBand || null,
          // `expect-desc-position`: where the caption and description show
          // (top, bottom, left or right), in panzoom or lightbox.
          expectDescPosition: img.dataset.expectDescPosition || sec.dataset.expectDescPosition || null,
          // `expect-steps="true"`: a gallery stepped through (see checkPage).
          expectSteps: !!sec.dataset.expectSteps,
          expectReferences: "expectReferences" in sec.dataset,
          // `expect-anchors="fig-a fig-b"`: labeled figures that must keep their
          // id, their number and a working cross-reference, with panzoom on.
          anchors: (sec.dataset.expectAnchors || "").split(/\s+/).filter(Boolean).map((id) => {
            const fig = document.getElementById(id);
            const cap = fig && fig.querySelector("figcaption");
            return {
              id,
              exists: !!fig,
              numbered: !!cap && /^Figure\s+\d+/.test(cap.textContent.trim()),
              marked: !!fig && !!fig.querySelector("img.panzoom:not(.nopanzoom), .panzoom img:not(.nopanzoom)"),
              // Quarto's script turns cross-reference links into full URLs.
              linked: [...document.querySelectorAll("a[href]")].some((a) => a.hash === `#${id}` &&
                a.pathname === location.pathname && (!fig || !fig.contains(a))),
            };
          }),
          hasDescription: !!img.dataset.panzoomDesc,
          descriptionHasMath: !!document.getElementById(img.dataset.panzoomDesc || "-")?.querySelector(".math, math"),
          classes: img.className,
          wrapper: link ? (link.classList.contains("lightbox") ? "a.lightbox" : "a[href]") : "none",
          gallery: link?.dataset.gallery || null,
        });
      });
    });
    return out;
  });

  const results = [];
  for (const img of images) {
    const r = { ...img };
    const handle = await page.$(`img[data-test-idx="${img.idx}"]`);
    if (!handle) { r.opened = "missing from DOM"; results.push(r); continue; }
    r.revealed = await reveal(page, handle);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(page);
    const box = await handle.boundingBox();
    if (!box || box.width < 2) { r.opened = "not visible"; results.push(r); continue; }

    await page.evaluate(() => { window.__navigatedTo = null; });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page, 200);  // long enough to be sure whether anything opens
    Object.assign(r, await state(page));
    const navigatedTo = await page.evaluate(() => window.__navigatedTo);
    if (navigatedTo && r.opened === "nothing") r.opened = "navigation", r.navigatedTo = navigatedTo;

    const shot = `c${String(img.case).padStart(2, "0")}-${img.n}.png`;
    await page.screenshot({ path: path.join(outDir, shot) });
    r.screenshot = shot;

    if (r.opened === "panzoom") {
      Object.assign(r, await exercisePanzoom(page));
      // Background click: reopen, click the top-left corner.
      await closeAll(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settle(page, 200);
      if ((await state(page)).opened === "panzoom") {
        await page.mouse.click(5, 5);
        await settle(page);
        r.backgroundCloses = (await state(page)).opened !== "panzoom";
      }
    }
    await closeAll(page);
    results.push(r);
  }

  // Viewer isolation, on the first image that opens the viewer.
  let isolation = null;
  const first = results.find((r) => r.opened === "panzoom");
  if (first) {
    const handle = await page.$(`img[data-test-idx="${first.idx}"]`);
    await reveal(page, handle);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(page);
    isolation = await checkIsolation(page, await handle.boundingBox());
    isolation.image = `${first.case}. ${first.caseTitle} (img ${first.n})`;
    isolation.keyboard = await checkKeyboard(page, handle);
  }

  // Gallery navigation, on the first image that opened with a counter.
  let gallery = null;
  const firstInGallery = results.find((r) => r.opened === "panzoom" && /^1 \//.test(r.counter || "") && r.fit === "contain");
  if (firstInGallery) {
    const handle = await page.$(`img[data-test-idx="${firstInGallery.idx}"]`);
    await reveal(page, handle);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(page);
    gallery = await checkGallery(page, handle);
    gallery.image = `${firstInGallery.case}. ${firstInGallery.caseTitle} (img ${firstInGallery.n})`;
  }

  // Galleries of images that open larger than the screen: Left/Right pan
  // (a collage, opened at screen height) or do nothing (a tall strip,
  // opened at screen width: nowhere to go sideways), never switch;
  // the next button switches.
  const overflowGalleries = [];
  for (const fit of ["height", "width"]) {
    const first = results.find((r) => r.opened === "panzoom" && /^1 \//.test(r.counter || "") && r.fit === fit &&
      (fit === "height" ? r.overX : r.overY));
    if (!first) continue;
    await openImage(page, first);
    const t0 = await viewerTransform(page);
    await page.keyboard.press("ArrowRight");
    await settle(page);
    const t1 = await viewerTransform(page);
    const s1 = await state(page);
    await page.click(".panzoom-next");
    await settle(page);
    const s2 = await state(page);
    const moved = t0 && t1 ? t0.x - t1.x : null;
    const g = {
      fit, image: `${first.case}. ${first.caseTitle} (img ${first.n})`,
      arrowKeepsImage: s1.counter === first.counter,
      arrowMoves: fit === "height" ? moved > 1 : Math.abs(moved) < 0.5,
      nextSwitches: s2.counter === first.counter.replace(/^1 /, "2 "),
      nextFit: s2.fit,
    };
    g.ok = g.arrowKeepsImage && g.arrowMoves && g.nextSwitches;
    overflowGalleries.push(g);
    await closeAll(page);
  }

  // Containment: a collage stops at both ends and can't move up or down; an
  // image shown whole can't be moved at all.
  let containment = null;
  const collage = results.find((r) => r.opened === "panzoom" && r.fit === "height" && r.overX && (r.counter || "1 / 1") === "1 / 1");
  const whole = results.find((r) => r.opened === "panzoom" && r.fit === "contain" && (r.counter || "1 / 1") === "1 / 1");
  if (collage || whole) containment = {};
  if (collage) {
    const c = (containment.collage = { image: `${collage.case}. ${collage.caseTitle}` });
    await openImage(page, collage);
    const edges = () => page.evaluate(() => {
      const o = document.querySelector(".panzoom-overlay");
      const a = window.__area(o);
      const r = o.querySelector("img").getBoundingClientRect();
      const m = 0.025 * Math.min(a.w, a.h);
      // in the image space (see __area)
      return { left: r.left - a.x, right: r.right - a.x, top: r.top - a.y, w: a.w, m };
    });
    // (Waits of 600 ms let an end-of-image bounce finish: 120 + 200 ms.)
    for (let i = 0; i < 200; i++) await page.keyboard.press("ArrowRight");
    await settle(page);
    const end = await edges();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
    await settle(page);
    const past = await edges();
    c.stopsAtRightEnd = Math.abs(end.right - (end.w - end.m)) < 2 && Math.abs(past.right - end.right) < 0.5;
    // At the end, a key press goes a little past it (up to 40 px) and back.
    await page.keyboard.press("ArrowRight");
    await sleep(90);
    const out = await edges();
    await settle(page);
    const back = await edges();
    c.bounceOut = Math.round(end.right - out.right);
    c.bounces = c.bounceOut > 5 && c.bounceOut <= 41 && Math.abs(back.right - end.right) < 0.5;
    for (let i = 0; i < 250; i++) await page.keyboard.press("ArrowLeft");
    await settle(page);
    const start = await edges();
    c.stopsAtLeftEnd = Math.abs(start.left - start.m) < 2;
    // Dragging past the left end: follows with resistance (at most 80 px),
    // springs back on release.
    const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 300, cy, { steps: 10 });
    await sleep(50);
    const pulled = await edges();
    await page.mouse.up();
    await settle(page);
    const released = await edges();
    c.stretch = Math.round(pulled.left - start.left);
    c.stretches = c.stretch > 5 && c.stretch <= 81 && Math.abs(released.left - start.left) < 0.5;
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await settle(page);
    c.heldVertically = Math.abs((await edges()).top - start.top) < 0.5;
    await closeAll(page);
  }
  if (whole) {
    const w = (containment.whole = { image: `${whole.case}. ${whole.caseTitle}` });
    await openImage(page, whole);
    const t0 = await viewerTransform(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 80, { steps: 8 });
    await page.mouse.up();
    await settle(page);  // a drag stretches it, then it springs back
    const t1 = await viewerTransform(page);
    w.stays = !!(t0 && t1) && Math.abs(t1.x - t0.x) < 0.5 && Math.abs(t1.y - t0.y) < 0.5;
    await closeAll(page);
  }
  if (containment) {
    containment.ok = (!containment.collage || (containment.collage.stopsAtRightEnd &&
      containment.collage.stopsAtLeftEnd && containment.collage.heldVertically &&
      containment.collage.bounces && containment.collage.stretches)) &&
      (!containment.whole || containment.whole.stays);
  }

  // Shift+scroll: which way it moves the image, for cases that say.
  for (const r of results.filter((r) => r.opened === "panzoom" && r.shiftScroll)) {
    await openImage(page, r);
    if (r.shiftScroll.startsWith("zoomed-")) {
      for (let i = 0; i < 4; i++) await page.keyboard.press("+");
      await settle(page);
    }
    const t0 = await viewerTransform(page);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const beforeWheel = await transformOf(page);
    await page.keyboard.down("Shift");
    await page.mouse.wheel({ deltaY: 300 });
    await afterWheel(page, beforeWheel);
    await page.keyboard.up("Shift");
    const t1 = await viewerTransform(page);
    const dx = Math.abs(t1.x - t0.x), dy = Math.abs(t1.y - t0.y);
    r.shiftScrolled = t1.s !== t0.s ? "zoomed" : dx > 1 && dy < 0.5 ? "x" : dy > 1 && dx < 0.5 ? "y" :
      dx < 0.5 && dy < 0.5 ? "none" : "both";
    r.shiftScrollOk = r.shiftScrolled === r.shiftScroll.replace(/^zoomed-/, "");
    await closeAll(page);
  }

  // Clicking a strip on the page opens it at the clicked spot; `0` returns
  // there; opening from the keyboard starts at the left end (or top).
  let clickOpen = null;
  const viewAt = () => page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay");
    const a = window.__area(o);
    const r = o.querySelector("img").getBoundingClientRect();
    const w = a.w, h = a.h, m = 0.025 * Math.min(w, h);
    // the image fractions at the middle of the image space, and the edges
    // in it (see __area)
    return { fx: (a.x + w / 2 - r.left) / r.width, fy: (a.y + h / 2 - r.top) / r.height,
      left: r.left - a.x, right: r.right - a.x, top: r.top - a.y, w, m };
  });
  const clickAt = async (r, fx, fy) => {
    const handle = await page.$(`img[data-test-idx="${r.idx}"]`);
    await reveal(page, handle);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settle(page);
    const b = await handle.boundingBox();
    await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height);
    await settle(page);
  };
  const strip = results.find((r) => r.opened === "panzoom" && r.fit === "height" && r.overX && (r.counter || "1 / 1") === "1 / 1");
  const tall = results.find((r) => r.opened === "panzoom" && r.fit === "width" && r.overY && (r.counter || "1 / 1") === "1 / 1");
  if (strip || tall) clickOpen = {};
  if (strip) {
    const c = (clickOpen.collage = { image: `${strip.case}. ${strip.caseTitle}` });
    await clickAt(strip, 0.5, 0.5);
    const mid = await viewAt();
    c.middle = +mid.fx.toFixed(3);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await settle(page);
    await page.keyboard.press("0");
    await sleep(50);
    c.resetBack = Math.abs((await viewAt()).left - mid.left) < 0.5;
    await closeAll(page);
    await clickAt(strip, 0.97, 0.5);
    const end = await viewAt();
    c.rightFlush = Math.abs(end.right - (end.w - end.m)) < 2;
    await closeAll(page);
    const handle = await page.$(`img[data-test-idx="${strip.idx}"]`);
    await handle.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    c.keyboardLeft = Math.abs((await viewAt()).left - end.m) < 2;
    await closeAll(page);
    c.ok = Math.abs(c.middle - 0.5) < 0.01 && c.resetBack && c.rightFlush && c.keyboardLeft;
  }
  if (tall) {
    const c = (clickOpen.tall = { image: `${tall.case}. ${tall.caseTitle}` });
    await clickAt(tall, 0.5, 0.5);
    c.middle = +(await viewAt()).fy.toFixed(3);
    await closeAll(page);
    c.ok = Math.abs(c.middle - 0.5) < 0.01;
  }
  if (clickOpen) clickOpen.ok = (!clickOpen.collage || clickOpen.collage.ok) && (!clickOpen.tall || clickOpen.tall.ok);

  // max-zoom: zooming in as far as possible stops at the cell's limit.
  for (const r of results.filter((r) => r.opened === "panzoom" && r.expectMaxZoom)) {
    await openImage(page, r);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const beforeWheel = await transformOf(page);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel({ deltaY: -200 }); await sleep(20); }
    await afterWheel(page, beforeWheel);
    r.maxScaleReached = (await viewerTransform(page))?.s ?? null;
    await closeAll(page);
  }

  // Zoom-out room: from the opening view, zooming out as far as possible
  // goes below the opening scale only if that view is closer than the
  // whole image (`expect-zoom-out`, page H: a `fit` override that does
  // nothing visible would pass the `expect-fit` check alone).
  for (const r of results.filter((r) => r.opened === "panzoom" && r.expectZoomOut)) {
    await openImage(page, r);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const open = (await viewerTransform(page))?.s ?? null;
    const beforeWheel = await transformOf(page);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel({ deltaY: 200 }); await sleep(20); }
    await afterWheel(page, beforeWheel);
    const min = (await viewerTransform(page))?.s ?? null;
    r.zoomOut = open && min ? { open, min, room: min < open * 0.99 } : null;
    await closeAll(page);
  }

  // Long caption or description panels (`expect-scroll`, page G): Tab
  // reaches the panel, and while it has focus the scrolling keys scroll it,
  // not the image or the page.
  for (const r of results.filter((r) => r.opened === "panzoom" && r.expectScroll)) {
    await openImage(page, r);
    const sel = `.panzoom-${r.expectScroll}`;
    const panel = () => page.evaluate((sel) => {
      const p = document.querySelector(`.panzoom-overlay ${sel}`);
      return { focused: document.activeElement === p, top: p.scrollTop,
        max: p.scrollHeight - p.clientHeight, role: p.getAttribute("role") };
    }, sel);
    const view = await viewerTransform(page);
    const pageY = await page.evaluate(() => scrollY);
    const s = { overflows: (await panel()).max > 1 };
    let tabs = 0;
    while (!(await panel()).focused && tabs < 10) { await page.keyboard.press("Tab"); tabs++; }
    s.reached = (await panel()).focused;
    s.region = (await panel()).role === "region";
    await page.keyboard.press("ArrowDown");
    s.arrowScrolls = (await panel()).top > 0;
    await page.keyboard.press("PageDown");
    const afterLine = (await panel()).top;
    s.pageScrolls = afterLine > 40;
    await page.keyboard.press("End");
    const end = await panel();
    s.endReaches = Math.abs(end.top - end.max) <= 1;
    await page.keyboard.press("Home");
    s.homeReturns = (await panel()).top === 0;
    await page.keyboard.press(" ");
    s.spaceScrolls = (await panel()).top > 0;
    const after = await viewerTransform(page);
    s.imageStill = !!view && !!after && Math.abs(after.x - view.x) < 0.5 && Math.abs(after.y - view.y) < 0.5 && after.s === view.s;
    s.pageStill = (await page.evaluate(() => scrollY)) === pageY;
    s.stillOpen = (await state(page)).opened === "panzoom";
    r.panelScroll = s;
    await closeAll(page);
  }

  // A gallery case with `expect-steps`: opened on its first image and
  // stepped to the last and back with the buttons, each image must show its
  // own styling (its `expect-*`) and caption (as when opened on its own),
  // none kept from the image before it.
  for (const r of results.filter((x) => x.n === 1 && x.expectSteps && x.opened === "panzoom")) {
    const imgs = results.filter((x) => x.case === r.case);
    const order = [...imgs.keys(), ...[...imgs.keys()].reverse().slice(1)];
    r.styleSteps = [];
    await openImage(page, r);
    for (let k = 0; k < order.length; k++) {
      if (k) {
        await page.click(order[k] > order[k - 1] ? ".panzoom-next" : ".panzoom-prev");
        await settle(page);
      }
      const x = imgs[order[k]], s = await state(page);
      r.styleSteps.push({ n: x.n, counter: s.counter, overlayBg: s.overlayBg, bandBg: s.bandBg, overlayClass: s.overlayClass, caption: s.caption,
        ok: s.counter === `${order[k] + 1} / ${imgs.length}` && s.caption === x.caption && optionsOk({ ...x, ...s, opened: "panzoom" }) });
    }
    await closeAll(page);
  }

  // The opening view in other windows: the size rule must give the same
  // result in each (FIT_SIZES: laptops, a 1080p screen with and without
  // browser toolbars, and a wide screen).
  const fitCases = results.filter((r) => r.opened === "panzoom" && r.expectFit);
  if (fitCases.length) {
    for (const r of fitCases) r.fitBySize = {};
    for (const [width, height] of FIT_SIZES) {
      await page.setViewport({ width, height });
      await settle(page);
      for (const r of fitCases) {
        await openImage(page, r);
        r.fitBySize[`${width}×${height}`] = (await state(page)).fit;
        await closeAll(page);
      }
    }
    await page.setViewport(VIEWPORT);
    await settle(page);
  }

  await page.close();
  const network = { url: url.startsWith("file:") ? "file://" : "http", external: [...external], failed: [...failed], offline: OFFLINE, pageTeX, mathjaxStalled };
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ file, errors, network, results, isolation, gallery, overflowGalleries, containment, clickOpen }, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), report(file, errors, network, results, isolation, gallery, overflowGalleries, containment, clickOpen));
  return { name, outDir, errors, network, results, isolation, gallery, overflowGalleries, containment, clickOpen };
}

function isolationOk(iso) {
  return iso.opened && iso.leaked.length === 0 && iso.stillOpen && iso.modifierPasses &&
    iso.functionKeysPass && iso.stillOpenAfterFKeys && iso.widgetBelow && iso.escCloses;
}

function keyboardOk(iso) {
  return KEYBOARD_CHECKS.every(([k]) => iso.keyboard?.[k] === true);
}

// An image expected to open at a given scale (1 = real size) does, and
// still zooms in from there.
function scaleOk(r) {
  return r.expectScale === null || r.expectScale === undefined ||
    (r.fitScale !== null && Math.abs(r.fitScale - r.expectScale) < 0.001 && r.wheelZoom > 1);
}

function fitOk(r) {
  return (!r.expectFit || (r.fit === r.expectFit && Object.values(r.fitBySize || {}).every((f) => f === r.expectFit))) &&
    zoomOutOk(r);
}

// The windows where the opening view differs from what's expected.
function fitMisses(r) {
  return Object.entries(r.fitBySize || {}).filter(([, f]) => f !== r.expectFit).map(([size, f]) => `${f} at ${size}`);
}

function panelScrollOk(r) {
  const s = r.panelScroll;
  return !!s && Object.values(s).every((v) => v === true);
}

function zoomOutOk(r) {
  return !r.expectZoomOut || (!!r.zoomOut && r.zoomOut.room === (r.expectZoomOut === "yes"));
}

// Option expectations (pages F and G, css-class): what opened, whether the caption and hint
// show, and where zooming stops.
function optionsOk(r) {
  if (r.expectOpen && r.opened !== r.expectOpen) return false;
  if (r.expectCaption === "none" && r.caption) return false;
  if (r.expectHint && r.hintShown !== (r.expectHint === "shown")) return false;
  if (r.expectMaxZoom && !(Math.abs((r.maxScaleReached ?? 0) - r.expectMaxZoom) < 0.01)) return false;
  if (r.expectFormat && r.format !== r.expectFormat) return false;
  if (r.expectClass && !(r.overlayClass || "").split(/\s+/).includes(r.expectClass)) return false;
  if (r.expectNoClass && (r.overlayClass || "").split(/\s+/).includes(r.expectNoClass)) return false;
  if (r.expectOverlay && r.overlayBg !== r.expectOverlay) return false;
  if (r.expectBand && r.bandBg !== r.expectBand) return false;
  if (r.expectDescPosition && r.descPosition !== r.expectDescPosition) return false;
  return true;
}
function hasOptionChecks(r) {
  return !!(r.expectOpen || r.expectCaption || r.expectHint || r.expectMaxZoom || r.expectFormat ||
    r.expectClass || r.expectNoClass || r.expectOverlay || r.expectBand || r.expectDescPosition);
}

// An image with a description shows it in the viewer.
function descriptionOk(r) {
  return !r.hasDescription || r.descriptionShown;
}

// The viewer's caption and description have their citations and
// cross-references resolved, linking to things on the page.
// Cases marked `expect-references` (page G) must show at least one.
function anchorOk(a) {
  return a.exists && a.numbered && a.marked && a.linked;
}

function referencesOk(r) {
  return !r.unresolved?.length && !r.brokenLinks?.length && (!r.expectReferences || r.citations + r.crossrefs > 0);
}

// Math in the viewer's caption and description shows no worse than the
// page's own: typeset if the page's is; raw TeX only where the page has it
// too (the plain method, or a math library that couldn't load).
function mathOk(r, pageTeX) {
  const worst = TEX_RANK[pageTeX ?? "clean"];
  return TEX_RANK[r.captionTeX] <= worst && TEX_RANK[r.descriptionTeX] <= worst;
}
function hasMath(r) {
  return r.opened === "panzoom" && (r.captionHasMath || r.descriptionHasMath);
}
const TEX_LABEL = { clean: "typeset", raw: "raw TeX", delimited: "not typeset" };

function report(file, errors, network, results, isolation, gallery, overflowGalleries, containment, clickOpen) {
  const yn = (v) => (v === undefined || v === null ? "" : v === true ? "yes" : v === false ? "NO" : String(v));
  const lines = [
    `# ${path.basename(file)}`, "",
    `Opened from ${network.url === "file://" ? "its file:// address (self-contained)" : "the local web server"}` +
      `${network.offline ? ", offline (external requests blocked)" : ""}.`, "",
    `External requests${network.offline ? " (blocked)" : ""}: ${network.external.length ? "" : "none"}`,
    ...network.external.map((u) => `- \`${u}\``), "",
    `Failed requests${network.offline ? " (besides the blocked ones)" : ""}: ${network.failed.length ? "" : "none"}`,
    ...network.failed.map((u) => {
      const k = KNOWN_FAILED_REQUESTS.find((k) => k.url.test(u) && (!k.page || k.page.test(path.basename(file, ".html"))));
      return `- \`${u}\`` + (k ? ` (expected: ${k.why})` : u.startsWith("external: ") ? " (another site: not counted)" : " **(unexpected)**");
    }), "",
    `Math on the page: ${network.pageTeX ? TEX_LABEL[network.pageTeX] : "none"}`,
    ...(network.mathjaxStalled ? ["MathJax's startup never finished (its speech worker failed to load); waited 10 s."] : []), "",
    `Console and page errors: ${errors.length ? "" : "none"}`,
    ...errors.map((e) => {
      const k = KNOWN_ERRORS.find((k) => k.text.test(e) && (!k.page || k.page.test(path.basename(file, ".html"))) && (!k.offline || OFFLINE));
      return `- \`${e}\`` + (k ? ` (expected: ${k.why})` : " **(unexpected)**");
    }), "",
    "| Case | Img | Classes | Wrapper | Opened | Details | Zoom× | Anchor px | Drag px | Reset | Esc | Bg click |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const details = r.opened === "glightbox"
      ? `title: ${r.title || "—"}; desc: ${r.description || "—"}; slides: ${r.slides}`
      : r.opened === "panzoom" ? (r.revealed ? "tab or callout opened first; " : "") + `caption: ${r.caption || "—"}; ${r.counter || "1 / 1"}; ${r.size}; ` +
        `opens: ${r.fit || "—"}` + (r.fitBySize ? (fitMisses(r).length ? `, but ${fitMisses(r).join(", ")}` : `, the same in ${Object.keys(r.fitBySize).length} other windows`) : "") + (r.expectFit ? (fitOk(r) ? " (as expected)" : ` (**expected ${r.expectFit}${r.expectZoomOut ? `, zoom-out ${r.expectZoomOut}` : ""}**)`) : "") +
        (r.zoomOut ? `; zooms out from ${+r.zoomOut.open.toFixed(3)} to ${+r.zoomOut.min.toFixed(3)}` : "") +
        (r.expectScale ? `; opening scale ${+r.fitScale.toFixed(3)}` + (scaleOk(r) ? " (as expected)" : ` (**expected ${r.expectScale}**)`) : "") +
        (r.panelScroll ? `; long ${r.expectScroll} scrolls by keyboard: ` + (panelScrollOk(r) ? "yes" : `**NO** (${Object.entries(r.panelScroll).filter(([, v]) => !v).map(([k]) => k).join(", ")})`) : "") +
        (r.shiftScroll ? `; Shift+scroll: ${r.shiftScrolled}` + (r.shiftScrollOk ? " (as expected)" : ` (**expected ${r.shiftScroll}**)`) : "") +
        (r.captionHasMath ? ` (caption math ${TEX_LABEL[r.captionTeX]})` : "") +
        (r.citations ? `; ${r.citations} citations` : "") + (r.crossrefs ? `; ${r.crossrefs} cross-references` : "") +
        (r.unresolved?.length ? `; **unresolved: ${r.unresolved.join(", ")}**` : "") +
        (r.brokenLinks?.length ? `; **broken links: ${r.brokenLinks.join(", ")}**` : "") +
        (r.description ? `; description: ${r.description}` + (r.descriptionHasMath ? ` (math ${TEX_LABEL[r.descriptionTeX]})` : "") : "") +
        (r.opened === "panzoom" ? `; hint ${r.hintShown ? "shown" : "hidden"}` : "") +
        (r.maxScaleReached ? `; zoom stops at ${+r.maxScaleReached.toFixed(3)}` : "")
      : r.opened === "navigation" ? r.navigatedTo : "";
    lines.push(`| ${r.case}. ${r.caseTitle} | ${r.n} | \`${r.classes}\` | ${r.wrapper} | **${r.opened}** | ` +
      `${details.replace(/\|/g, "\\|")} | ${yn(r.wheelZoom)} | ${yn(r.anchorDrift)}${r.anchorOk === false ? " **NO**" : ""} | ${yn(r.dragMoved)} | ${yn(r.resetOk)} | ` +
      `${yn(r.escCloses)} | ${yn(r.backgroundCloses)} |`);
  }
  lines.push("", "## Viewer isolation", "");
  if (!isolation) lines.push("No image opens the viewer on this page; skipped.");
  else {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push(
      `Opened on case ${isolation.image}.`, "",
      `- Keys pressed: ${ISOLATION_KEYS.map((k) => `\`${k === " " ? "Space" : k}\``).join(", ")}`,
      `- Keys kept from the page: ${yes(isolation.leaked?.length === 0)}` +
        (isolation.leaked?.length ? ` (leaked: ${isolation.leaked.map((l) => `\`${l}\``).join(", ")})` : ""),
      `- Viewer still open after them: ${yes(isolation.stillOpen)}`,
      `- Ctrl+key still reaches the page: ${yes(isolation.modifierPasses)}`,
      `- F3 and F9 reach the page, viewer stays open: ${yes(isolation.functionKeysPass && isolation.stillOpenAfterFKeys)}`,
      `- A fixed widget at z-index 10000 stays below the viewer: ${yes(isolation.widgetBelow)}`,
      `- Esc closes: ${yes(isolation.escCloses)}`,
      "", "## Keyboard access", "",
      `On the same image.`, "",
      ...KEYBOARD_CHECKS.map(([k, label]) => `- ${label}: ${yes(isolation.keyboard?.[k])}`));
  }
  lines.push("", "## Gallery navigation", "");
  if (!gallery) lines.push("No panzoom gallery on this page; skipped.");
  else {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push(
      `Opened on case ${gallery.image}: ${gallery.start}.`, "",
      `- PageDown/PageUp leave the image as it is: ${yes(gallery.pageKeysStill)}`,
      `- Right arrow (not zoomed): ${gallery.arrowNext}; Left goes back: ${yes(gallery.arrowBack)}`,
      `- Next button: ${gallery.buttonNext}`,
      `- Focus after the next button reaches the last image: ${gallery.focusAtEnd}`,
      `- Swipe left: ${gallery.swipeNext}`,
      `- Zoomed in, Right pans instead: ${yes(gallery.zoomedArrowPans)}`,
      `- On the first image, "previous" is ${gallery.loop ? "enabled (loop) and Left wraps to the last" : "disabled (no loop)"}: ${yes(gallery.prevDisabledAtStart && gallery.leftAtStartStill)}`,
      `- On the last image, "next" is ${gallery.loop ? "enabled (loop) and Right wraps to the first" : "disabled (no loop) and Right stays"}: ${yes(gallery.nextDisabledAtEnd && gallery.rightAtEndOk)} (${gallery.rightAtEnd})`,
      `- All as expected: ${yes(gallery.ok)}`);
  }
  lines.push("", "## Galleries of images larger than the screen", "");
  if (!overflowGalleries.length) lines.push("None on this page; skipped.");
  for (const g of overflowGalleries) {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push(
      `Opened on case ${g.image} (opens at screen ${g.fit}).`, "",
      `- Right arrow keeps the same image: ${yes(g.arrowKeepsImage)}`,
      `- ...and ${g.fit === "height" ? "pans along it" : "doesn't move it (nowhere to go sideways)"}: ${yes(g.arrowMoves)}`,
      `- The next button switches to the next image: ${yes(g.nextSwitches)} (opens: ${g.nextFit})`, "");
  }
  const optioned = results.filter(hasOptionChecks);
  if (optioned.length) {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push("", "## Options", "");
    for (const r of optioned) {
      const want = [
        r.expectOpen && `opens ${r.expectOpen}`,
        r.expectCaption && `caption ${r.expectCaption}`,
        r.expectHint && `hint ${r.expectHint}`,
        r.expectMaxZoom && `zoom stops at ${r.expectMaxZoom}`,
        r.expectFormat && `as ${r.expectFormat}`,
        r.expectClass && `viewer class ${r.expectClass}`,
        r.expectNoClass && `no viewer class ${r.expectNoClass}`,
        r.expectOverlay && `backdrop ${r.expectOverlay}`,
        r.expectBand && `caption band ${r.expectBand}`,
        r.expectDescPosition && `caption ${r.expectDescPosition}`,
      ].filter(Boolean).join(", ");
      const got = [
        `opened ${r.opened}`,
        r.expectCaption && `caption ${r.caption ? `"${r.caption}"` : "none"}`,
        r.expectHint && `hint ${r.hintShown ? "shown" : "hidden"}`,
        r.expectMaxZoom && `zoom stopped at ${r.maxScaleReached === null || r.maxScaleReached === undefined ? "?" : +r.maxScaleReached.toFixed(3)}`,
        r.expectFormat && `as ${r.format}`,
        (r.expectClass || r.expectNoClass) && `classes "${r.overlayClass}"`,
        r.expectOverlay && `backdrop ${r.overlayBg}`,
        r.expectBand && `caption band ${r.bandBg}`,
        r.expectDescPosition && `caption ${r.descPosition || "?"}`,
      ].filter(Boolean).join(", ");
      lines.push(`- ${r.case}. ${r.caseTitle} (img ${r.n}): expected ${want}; ${got}: ${yes(optionsOk(r))}`);
    }
  }
  const anchors = [...new Map(results.flatMap((r) => r.anchors || []).map((a) => [a.id, a])).values()];
  if (anchors.length) {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push("", "## Labeled figures", "");
    for (const a of anchors) {
      lines.push(`- #${a.id}: on the page ${yes(a.exists)}, numbered ${yes(a.numbered)}, marked for panzoom ${yes(a.marked)}, ` +
        `cross-referenced ${yes(a.linked)}: ${yes(anchorOk(a))}`);
    }
  }
  lines.push("", "## Focal point (opens where clicked)", "");
  if (!clickOpen) lines.push("No single strip on this page; skipped.");
  else {
    const yes = (v) => (v ? "yes" : "**NO**");
    if (clickOpen.collage) lines.push(
      `Collage, case ${clickOpen.collage.image}:`, "",
      `- Clicked at 50% across, opens with ${(clickOpen.collage.middle * 100).toFixed(1)}% across in the middle: ${yes(Math.abs(clickOpen.collage.middle - 0.5) < 0.01)}`,
      `- After panning, \`0\` returns to the clicked view: ${yes(clickOpen.collage.resetBack)}`,
      `- Clicked at 97% across, opens flush with the right end: ${yes(clickOpen.collage.rightFlush)}`,
      `- Opened with Enter, starts at the left end: ${yes(clickOpen.collage.keyboardLeft)}`, "");
    if (clickOpen.tall) lines.push(
      `Tall strip, case ${clickOpen.tall.image}:`, "",
      `- Clicked at 50% down, opens with ${(clickOpen.tall.middle * 100).toFixed(1)}% down in the middle: ${yes(clickOpen.tall.ok)}`, "");
  }
  lines.push("", "## Containment", "");
  if (!containment) lines.push("No suitable image on this page; skipped.");
  else {
    const yes = (v) => (v ? "yes" : "**NO**");
    if (containment.collage) lines.push(
      `Collage, case ${containment.collage.image}:`, "",
      `- Right arrow stops at the right end: ${yes(containment.collage.stopsAtRightEnd)}`,
      `- Left arrow stops at the left end: ${yes(containment.collage.stopsAtLeftEnd)}`,
      `- Up/Down don't move it (it fits vertically): ${yes(containment.collage.heldVertically)}`,
      `- A key press at the end bounces ${containment.collage.bounceOut} px past it and back: ${yes(containment.collage.bounces)}`,
      `- A drag past the end stretches ${containment.collage.stretch} px and springs back: ${yes(containment.collage.stretches)}`, "");
    if (containment.whole) lines.push(
      `Image shown whole, case ${containment.whole.image}:`, "",
      `- Arrow keys don't move it, and after a drag it springs back: ${yes(containment.whole.stays)}`);
  }
  return lines.join("\n") + "\n";
}

// The page behind the viewer stays still. Opening the viewer hides the
// page's scrollbar; where scrollbars take up room (Windows, most Linux
// desktops), the page would get wider and its content shift sideways. Checked
// in a Chrome that shows scrollbars, on the first marked image: the content
// and header keep their place and width, the viewer covers the whole window,
// and closing brings the scrollbar back. null: no scrollbar, or no image.
async function checkStill(base, file) {
  const browser = await launch(false);
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    if (OFFLINE) {
      await page.setRequestInterception(true);
      page.on("request", (req) => (/^(data|blob|about|file):/.test(req.url()) || new URL(req.url()).hostname === "127.0.0.1"
        ? req.continue() : req.abort("internetdisconnected")));
    }
    const url = selfContained(file)
      ? "file://" + file
      : base + path.relative(ROOT, file).split(path.sep).join("/");
    await page.goto(url, { waitUntil: "load" });
    await settle(page);
    const measure = () => page.evaluate(() => {
      const box = (el) => el && (({ left, width }) => ({ left, width }))(el.getBoundingClientRect());
      const overlay = document.querySelector(".panzoom-overlay.open");
      return {
        bar: window.innerWidth - document.documentElement.clientWidth,
        main: box(document.querySelector("main")),
        header: box(document.querySelector("#quarto-header")),
        overlay: overlay && box(overlay),
        window: window.innerWidth,
      };
    });
    const before = await measure();
    if (!before.bar) return null;
    const opened = await page.evaluate(() => {
      const img = document.querySelector("a.panzoom-link img, img.panzoom");
      if (!img) return false;
      img.click();
      return !!document.querySelector(".panzoom-overlay.open");
    });
    if (!opened) return null;
    await settle(page);
    const open = await measure();
    await page.keyboard.press("Escape");
    await settle(page);
    const closed = await measure();
    const same = (a, b) => (!a && !b) || (a && b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5);
    const r = {
      bar: before.bar,
      still: same(before.main, open.main) && same(before.header, open.header),
      covers: !!open.overlay && open.overlay.left <= 0 && open.overlay.left + open.overlay.width >= open.window,
      restored: closed.bar === before.bar && same(before.main, closed.main),
      before, open,
    };
    r.ok = r.still && r.covers && r.restored;
    return r;
  } finally {
    await browser.close();
  }
}

let failedPages = 0;
for (const file of PAGES) {
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
    console.error(`${file} is not a file inside ${ROOT}; render first (quarto render, node standalone.mjs).`);
    process.exit(1);
  }
}
const server = await serve(ROOT);
const base = `http://127.0.0.1:${server.address().port}/`;
// The pages are checked in parallel, each in its own Chrome: tabs of one
// Chrome slow each other down (all pages together took 99 s instead of the
// slowest page's 73 s). Chrome normally slows timers in background tabs,
// which would distort the viewer's timed animations (the bounce) that the
// checks measure; turn that off.
const launch = (hideScrollbars = true) => puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--disable-gpu", ...(hideScrollbars ? ["--hide-scrollbars"] : []),
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows"],
});
const browsers = [];
try {
  // Start every page at once; report them in order as they finish.
  const runs = PAGES.map(async (file) => {
    const browser = await launch();
    browsers.push(browser);
    const checked = await checkPage(browser, base, file);
    checked.still = await checkStill(base, file);
    return checked;
  });
  for (const run of runs) {
    const { name, outDir, errors, network, results, isolation, gallery, overflowGalleries, containment, clickOpen, still } = await run;
    const counts = results.reduce((a, r) => ((a[r.opened] = (a[r.opened] || 0) + 1), a), {});
    const iso = isolation
      ? `${isolationOk(isolation) ? "isolation ok" : "ISOLATION FAILED"}, ${keyboardOk(isolation) ? "keyboard ok" : "KEYBOARD FAILED"}`
      : "isolation n/a, keyboard n/a";
    const gal = gallery ? (gallery.ok ? "gallery ok" : "GALLERY FAILED") : "gallery n/a";
    const fits = results.filter((r) => r.expectFit && r.opened === "panzoom");
    const fit = fits.length ? (fits.every(fitOk) ? "fit ok" : "FIT FAILED") : "fit n/a";
    const extra = [];
    // Every image is shown on an opaque backdrop (transparent plots stay readable).
    const opened = results.filter((r) => r.opened === "panzoom");
    if (opened.length) extra.push(opened.every((r) => /^rgb\(/.test(r.backdrop || "")) ? "backdrop ok" : "BACKDROP FAILED");
    const overlaps = opened.filter((r) => r.captionClear === false);
    if (opened.length) extra.push(overlaps.length ? `CAPTION OVERLAP (${overlaps.map((r) => `case ${r.case} img ${r.n}`).join(", ")})` : "caption clear ok");
    const hintWrong = opened.filter((r) => r.hintCaptionOk === false);
    if (opened.length) extra.push(hintWrong.length ? `HINT CAPTION KEY WRONG (${hintWrong.map((r) => `case ${r.case} img ${r.n}`).join(", ")})` : "hint keys ok");
    const anchored = opened.filter((r) => r.anchorChecked);
    if (anchored.length) extra.push(anchored.every((r) => r.anchorFastDrift <= 5) ? "fast zoom ok" : "FAST ZOOM FAILED");
    if (opened.length) extra.push(opened.every((r) => r.anchorOk) ? "zoom anchor ok" : "ZOOM ANCHOR FAILED");
    const scaled = opened.filter((r) => r.expectScale);
    if (scaled.length) extra.push(scaled.every(scaleOk) ? "real size ok" : "REAL SIZE FAILED");
    const optioned = results.filter(hasOptionChecks);
    if (optioned.length) extra.push(optioned.every(optionsOk) ? "options ok" : "OPTIONS FAILED");
    const described = opened.filter((r) => r.hasDescription);
    if (described.length) extra.push(described.every(descriptionOk) ? "descriptions ok" : "DESCRIPTIONS FAILED");
    if (opened.length) extra.push(opened.every(referencesOk) ? "references ok" : "REFERENCES FAILED");
    const labeled = results.flatMap((r) => r.anchors || []);
    if (labeled.length) extra.push(labeled.every(anchorOk) ? "anchors ok" : "ANCHORS FAILED");
    const withMath = results.filter(hasMath);
    if (withMath.length) extra.push((withMath.every((r) => mathOk(r, network.pageTeX)) ? "math ok" : "MATH FAILED") +
      ` (page: ${network.pageTeX ? TEX_LABEL[network.pageTeX] : "none"})`);
    if (network.mathjaxStalled) extra.push("MathJax startup stalled");
    const reqs = sortOut(network.failed.filter((u) => !u.startsWith("external: ")), KNOWN_FAILED_REQUESTS, "url", name);
    const externalFailed = network.failed.length - reqs.expected.length - reqs.unexpected.length;
    if (reqs.unexpected.length) extra.push(`${reqs.unexpected.length} FAILED REQUESTS`);
    if (reqs.expected.length) extra.push(`${reqs.expected.length} expected failed requests`);
    if (externalFailed) extra.push(`${externalFailed} failed requests to other sites`);
    if (network.external.length) extra.push(`${network.external.length} external requests${OFFLINE ? " blocked" : ""}`);
    if (overflowGalleries.length) extra.push(overflowGalleries.every((g) => g.ok) ? "large galleries ok" : "LARGE GALLERIES FAILED");
    if (containment) extra.push(containment.ok ? "containment ok" : "CONTAINMENT FAILED");
    if (clickOpen) extra.push(clickOpen.ok ? "focal point ok" : "FOCAL POINT FAILED");
    const scrolled = opened.filter((r) => r.expectScroll);
    if (scrolled.length) extra.push(scrolled.every(panelScrollOk) ? "panel scroll ok" : "PANEL SCROLL FAILED");
    // Only the panels meant to be long scroll (math once made short ones).
    const overScrolled = opened.filter((r) => r.overflowing?.some((p) => p !== r.expectScroll));
    if (opened.length) extra.push(overScrolled.length
      ? `SHORT PANELS SCROLL (cases ${overScrolled.map((r) => `${r.case}: ${r.overflowing.join(", ")}`).join("; ")})`
      : "short panels ok");
    const stepped = results.filter((r) => r.styleSteps);
    if (stepped.length) {
      const ok = stepped.every((r) => r.styleSteps.every((s) => s.ok));
      extra.push(ok ? "style steps ok" : "STYLE STEPS FAILED");
      fs.appendFileSync(path.join(outDir, "report.md"), ["", "## Styles while stepping through a gallery", "",
        ...stepped.flatMap((r) => [`Case ${r.case}, first image to last and back:`, "",
          ...r.styleSteps.map((s) => `- image ${s.n} (${s.counter}): caption "${s.caption}", backdrop ${s.overlayBg}, band ${s.bandBg}, classes "${s.overlayClass}": ${s.ok ? "yes" : "**NO**"}`), ""])].join("\n"));
    }
    const shift = results.filter((r) => r.shiftScroll && r.opened === "panzoom");
    if (shift.length) extra.push(shift.every((r) => r.shiftScrollOk) ? "shift-scroll ok" : "SHIFT-SCROLL FAILED");
    if (still) {
      extra.push(still.ok ? "page still ok" : "PAGE STILL FAILED");
      const yes = (v) => (v ? "yes" : "**NO**");
      fs.appendFileSync(path.join(outDir, "report.md"), [
        "", "## Page behind the viewer", "",
        `With a ${still.bar} px scrollbar, on the first marked image.`, "",
        `- Content and header keep their place and width: ${yes(still.still)}` +
          (still.still ? "" : ` (content left ${still.before.main?.left} -> ${still.open.main?.left}, header width ${still.before.header?.width} -> ${still.open.header?.width})`),
        `- The viewer covers the whole window: ${yes(still.covers)}`,
        `- Closing brings the scrollbar back: ${yes(still.restored)}`, ""].join("\n"));
    }
    const wide = extra.join(", ");
    const errs = sortOut(errors, KNOWN_ERRORS, "text", name);
    const errText = errs.unexpected.length ? `${errs.unexpected.length} CONSOLE ERRORS` : `0 console errors` +
      (errs.expected.length ? ` (${errs.expected.length} expected)` : "");
    // A check that failed is in capitals (FIT FAILED, CAPTION OVERLAP, ...).
    if ([errText, iso, gal, fit, ...extra].some((t) => /[A-Z]{3,}/.test(t))) failedPages++;
    console.log(`${name}: ${results.length} images, ${JSON.stringify(counts)}, ` +
      `${errText}, ${iso}, ${gal}, ${fit}${wide ? ", " + wide : ""} -> ${path.relative(process.cwd(), outDir)}/report.md`);
  }
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  server.close();
}
if (failedPages) {
  console.log(`${failedPages} of ${PAGES.length} pages FAILED`);
  process.exitCode = 1;
}
