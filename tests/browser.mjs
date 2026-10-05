/*
  Browser checks for the panzoom extension.

  Opens each rendered test page in headless Chrome, clicks every image in every
  `## N. ...` section, and records what opened: the panzoom viewer, GLightbox,
  a link navigation, or nothing. For the panzoom viewer it also tries wheel
  zoom, drag, Esc and a background click; for GLightbox it records the slide
  title, description and gallery size. Console errors are collected per page.
  Then, with the viewer open, checks that keys don't reach the page (as
  focus-mode's and Quarto search's shortcuts would), that Ctrl+key still
  does, and that a fixed widget at z-index 10000 stays below the viewer.

  Usage (from tests/):
    npm run render && npm test         # renders the project to ../docs/, then checks the test pages
    node browser.mjs ../docs/tests/pages/d-panzoom-selective.html ...   # checks the given pages

  Pages are served from ../docs/ by a small built-in web server, as GitHub
  Pages would serve them: Quarto's scripts are JavaScript modules, which
  browsers refuse to load from file:// URLs.

  Output: results/<page>/report.md, results/<page>/results.json and one
  screenshot per image (results/<page>/<case>-<n>.png).

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
const PAGES = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : ["a-lightbox.html", "c-panzoom-auto.html", "d-panzoom-selective.html", "e-formats.html"]
      .map((p) => path.join(ROOT, "docs", "tests", "pages", p));
const VIEWPORT = { width: 1280, height: 900 };
const SITE = path.join(ROOT, "docs");

// Minimal static file server for docs/.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
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

async function state(page) {
  return page.evaluate(() => {
    const pz = document.querySelector(".panzoom-overlay.open");
    const glb = document.querySelector(".glightbox-container");
    if (pz) {
      const counter = pz.querySelector(".panzoom-counter");
      const caption = pz.querySelector(".panzoom-caption");
      const img = pz.querySelector("img");
      const r = img.getBoundingClientRect();
      return {
        size: `${img.naturalWidth}×${img.naturalHeight} px, shown ${Math.round(r.width)}×${Math.round(r.height)}` +
          (img.classList.contains("panzoom-vector") ? `, vector (will-change: ${getComputedStyle(img).willChange})` : "") +
          `, on ${getComputedStyle(img).backgroundColor}`,
        opened: "panzoom",
        caption: caption.hidden ? "" : caption.textContent.trim().replace(/\s+/g, " "),
        fit: img.dataset.fit || "",
        backdrop: getComputedStyle(img).backgroundColor,
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
  await sleep(200);
}

// Open the viewer on a result's image, from a closed viewer.
async function openImage(page, r) {
  const handle = await page.$(`img[data-test-idx="${r.idx}"]`);
  await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(150);
  await handle.click();
  await sleep(600);
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
  for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: -200 }); await sleep(30); }
  await sleep(100);
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
  await sleep(100);
  const dragged = await viewerTransform(page);
  out.dragMoved = zoomed && dragged
    ? Math.round(Math.hypot(dragged.x - zoomed.x, dragged.y - zoomed.y)) : null;
  out.closedByDrag = (await state(page)).opened !== "panzoom";

  if (!out.closedByDrag) {
    // Reset is instant: right after `0` the view is back where it opened
    // (an animated reset would still be mid-way).
    await page.keyboard.press("0");
    await sleep(20);
    const back = await viewerTransform(page);
    out.resetOk = fit ? !!(back && back.s === fit.s &&
      Math.abs(back.x - fit.x) < 1 && Math.abs(back.y - fit.y) < 1) : null;  // null: no image loaded
    await page.keyboard.press("Escape");
    await sleep(100);
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
  await sleep(300);
  const out = { opened: (await state(page)).opened === "panzoom" };
  if (!out.opened) return out;

  for (const key of ISOLATION_KEYS) await page.keyboard.press(key);
  await sleep(100);
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
  await sleep(200);
  out.escCloses = (await state(page)).opened !== "panzoom";
  await page.evaluate(() => document.getElementById("test-fixed-widget").remove());
  return out;
}

// Keyboard access: the image is a focusable button that opens on Enter and
// Space; the viewer takes focus, keeps Tab inside, pans with the arrows, and
// gives focus back to the image when it closes.
async function checkKeyboard(page, handle) {
  const out = {};
  const focusState = () => page.evaluate(() => {
    const a = document.activeElement;
    return {
      inViewer: !!(a && a.closest(".panzoom-overlay")),
      onClose: !!(a && a.classList.contains("panzoom-close")),
      onImage: !!(a && a.dataset.testIdx !== undefined),
    };
  });
  out.focusable = await handle.evaluate((el) => el.tabIndex === 0 && el.getAttribute("role") === "button");
  await handle.focus();
  await page.keyboard.press("Enter");
  await sleep(300);
  out.enterOpens = (await state(page)).opened === "panzoom";
  if (!out.enterOpens) return out;
  out.focusMovesIn = (await focusState()).inViewer;

  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await sleep(100);
  const before = await viewerTransform(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await sleep(100);
  const after = await viewerTransform(page);
  out.arrowsPan = !!(before && after && after.x < before.x - 1 && after.y < before.y - 1);

  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  out.tabTrapped = (await focusState()).inViewer;

  await page.evaluate(() => document.querySelector(".panzoom-close").focus());
  await page.keyboard.press("Enter");
  await sleep(200);
  out.closeButtonCloses = (await state(page)).opened !== "panzoom";
  out.focusReturns = (await focusState()).onImage;

  await page.keyboard.press(" ");
  await sleep(300);
  out.spaceOpens = (await state(page)).opened === "panzoom";
  await page.keyboard.press("Escape");
  await sleep(200);
  out.escReturnsFocus = (await state(page)).opened !== "panzoom" && (await focusState()).onImage;
  return out;
}

// Gallery navigation, on the first image whose viewer shows a counter.
async function checkGallery(page, handle) {
  const out = {};
  const counter = async () => (await state(page)).counter;
  await handle.click();
  await sleep(300);
  const first = await counter();
  const m = /^(\d+) \/ (\d+)$/.exec(first || "");
  if (!m) return out;
  const n = +m[2];
  out.start = first;
  out.size = n;
  // Left on the first image (no loop): nothing happens, not even a nudge.
  const t0 = await viewerTransform(page);
  await page.keyboard.press("ArrowLeft");
  await sleep(100);
  const tl = await viewerTransform(page);
  out.leftAtStartStill = (await counter()) === first && !!(t0 && tl) &&
    Math.abs(tl.x - t0.x) < 0.5 && Math.abs(tl.y - t0.y) < 0.5;
  await page.keyboard.press("PageDown");
  await sleep(100);
  out.pageDown = await counter();
  await page.keyboard.press("PageUp");
  await sleep(100);
  out.pageUpBack = (await counter()) === first;
  await page.keyboard.press("ArrowRight");
  await sleep(100);
  out.arrowNext = await counter();
  await page.keyboard.press("ArrowLeft");
  await sleep(100);
  out.arrowBack = (await counter()) === first;
  await page.click(".panzoom-next");
  await sleep(100);
  out.buttonNext = await counter();
  await page.click(".panzoom-prev");
  await sleep(100);
  // Swipe left on the background: next image.
  const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
  await page.mouse.move(cx + 120, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 8 });
  await page.mouse.up();
  await sleep(150);
  out.swipeNext = await counter();
  await page.keyboard.press("PageUp");
  await sleep(100);
  // Zoomed in, Right pans instead of switching.
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await sleep(100);
  await page.keyboard.press("ArrowRight");
  await sleep(100);
  out.zoomedArrowPans = (await counter()) === first;
  // Without loop, the first image has no previous one.
  out.prevDisabledAtStart = m[1] === "1"
    ? await page.$eval(".panzoom-prev", (b) => b.disabled) : null;
  await closeAll(page);
  out.ok = out.pageDown === `${+m[1] + 1} / ${n}` && out.pageUpBack &&
    out.arrowNext === out.pageDown && out.arrowBack && out.buttonNext === out.pageDown &&
    out.swipeNext === out.pageDown && out.zoomedArrowPans && out.prevDisabledAtStart !== false &&
    out.leftAtStartStill;
  return out;
}

const KEYBOARD_CHECKS = [
  ["focusable", "Image is focusable and a button"],
  ["enterOpens", "Enter on the image opens the viewer"],
  ["focusMovesIn", "Focus moves into the viewer"],
  ["arrowsPan", "Arrow keys pan"],
  ["tabTrapped", "Tab and Shift+Tab stay in the viewer"],
  ["closeButtonCloses", "Enter on the close button closes"],
  ["focusReturns", "Focus returns to the image"],
  ["spaceOpens", "Space on the image opens the viewer"],
  ["escReturnsFocus", "Esc closes and returns focus"],
];

async function checkPage(browser, base, file) {
  const name = path.basename(file, ".html");
  const outDir = path.join(HERE, "results", name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(base + path.relative(SITE, file).split(path.sep).join("/"), { waitUntil: "load" });
  await sleep(500);

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
  const images = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("section.level2").forEach((sec) => {
      const h = sec.querySelector("h2");
      const m = h && /^(\d+)\.\s*(.*)$/.exec(h.textContent.trim());
      if (!m) return;
      sec.querySelectorAll("img").forEach((img, i) => {
        const idx = out.length;
        img.dataset.testIdx = idx;
        const link = img.closest("a");
        out.push({
          idx, case: +m[1], caseTitle: m[2], n: i + 1,
          expectFit: sec.dataset.expectFit || null,
          shiftScroll: sec.dataset.shiftScroll || null,
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
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    const box = await handle.boundingBox();
    if (!box || box.width < 2) { r.opened = "not visible"; results.push(r); continue; }

    await page.evaluate(() => { window.__navigatedTo = null; });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(900);  // GLightbox open animation
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
      await sleep(300);
      if ((await state(page)).opened === "panzoom") {
        await page.mouse.click(5, 5);
        await sleep(200);
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
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    isolation = await checkIsolation(page, await handle.boundingBox());
    isolation.image = `${first.case}. ${first.caseTitle} (img ${first.n})`;
    isolation.keyboard = await checkKeyboard(page, handle);
  }

  // Gallery navigation, on the first image that opened with a counter.
  let gallery = null;
  const firstInGallery = results.find((r) => r.opened === "panzoom" && /^1 \//.test(r.counter || "") && r.fit === "contain");
  if (firstInGallery) {
    const handle = await page.$(`img[data-test-idx="${firstInGallery.idx}"]`);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    gallery = await checkGallery(page, handle);
    gallery.image = `${firstInGallery.case}. ${firstInGallery.caseTitle} (img ${firstInGallery.n})`;
  }

  // Galleries of images that open larger than the screen: Left/Right pan
  // (a collage, opened at screen height) or do nothing (a tall strip,
  // opened at screen width: nowhere to go sideways), never switch;
  // PageDown switches.
  const overflowGalleries = [];
  for (const fit of ["height", "width"]) {
    const first = results.find((r) => r.opened === "panzoom" && /^1 \//.test(r.counter || "") && r.fit === fit);
    if (!first) continue;
    await openImage(page, first);
    const t0 = await viewerTransform(page);
    await page.keyboard.press("ArrowRight");
    await sleep(100);
    const t1 = await viewerTransform(page);
    const s1 = await state(page);
    await page.keyboard.press("PageDown");
    await sleep(600);
    const s2 = await state(page);
    const moved = t0 && t1 ? t0.x - t1.x : null;
    const g = {
      fit, image: `${first.case}. ${first.caseTitle} (img ${first.n})`,
      arrowKeepsImage: s1.counter === first.counter,
      arrowMoves: fit === "height" ? moved > 1 : Math.abs(moved) < 0.5,
      pageDownSwitches: s2.counter === first.counter.replace(/^1 /, "2 "),
      nextFit: s2.fit,
    };
    g.ok = g.arrowKeepsImage && g.arrowMoves && g.pageDownSwitches;
    overflowGalleries.push(g);
    await closeAll(page);
  }

  // Containment: a collage stops at both ends and can't move up or down; an
  // image shown whole can't be moved at all.
  let containment = null;
  const collage = results.find((r) => r.opened === "panzoom" && r.fit === "height" && (r.counter || "1 / 1") === "1 / 1");
  const whole = results.find((r) => r.opened === "panzoom" && r.fit === "contain" && (r.counter || "1 / 1") === "1 / 1");
  if (collage || whole) containment = {};
  if (collage) {
    const c = (containment.collage = { image: `${collage.case}. ${collage.caseTitle}` });
    await openImage(page, collage);
    const edges = () => page.evaluate(() => {
      const o = document.querySelector(".panzoom-overlay");
      const f = o.querySelector(".panzoom-footer").offsetHeight;
      const r = o.querySelector("img").getBoundingClientRect();
      const m = 0.025 * Math.min(o.clientWidth, o.clientHeight - f);
      return { left: r.left, right: r.right, top: r.top, w: o.clientWidth, m };
    });
    // (Waits of 600 ms let an end-of-image bounce finish: 120 + 200 ms.)
    for (let i = 0; i < 200; i++) await page.keyboard.press("ArrowRight");
    await sleep(600);
    const end = await edges();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
    await sleep(600);
    const past = await edges();
    c.stopsAtRightEnd = Math.abs(end.right - (end.w - end.m)) < 2 && Math.abs(past.right - end.right) < 0.5;
    // At the end, a key press goes a little past it (up to 40 px) and back.
    await page.keyboard.press("ArrowRight");
    await sleep(90);
    const out = await edges();
    await sleep(600);
    const back = await edges();
    c.bounceOut = Math.round(end.right - out.right);
    c.bounces = c.bounceOut > 5 && c.bounceOut <= 41 && Math.abs(back.right - end.right) < 0.5;
    for (let i = 0; i < 250; i++) await page.keyboard.press("ArrowLeft");
    await sleep(600);
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
    await sleep(600);
    const released = await edges();
    c.stretch = Math.round(pulled.left - start.left);
    c.stretches = c.stretch > 5 && c.stretch <= 81 && Math.abs(released.left - start.left) < 0.5;
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await sleep(100);
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
    await sleep(600);  // a drag stretches it, then it springs back
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
      await sleep(100);
    }
    const t0 = await viewerTransform(page);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.wheel({ deltaY: 300 });
    await page.keyboard.up("Shift");
    await sleep(150);
    const t1 = await viewerTransform(page);
    const dx = Math.abs(t1.x - t0.x), dy = Math.abs(t1.y - t0.y);
    r.shiftScrolled = t1.s !== t0.s ? "zoomed" : dx > 1 && dy < 0.5 ? "x" : dy > 1 && dx < 0.5 ? "y" :
      dx < 0.5 && dy < 0.5 ? "none" : "both";
    r.shiftScrollOk = r.shiftScrolled === r.shiftScroll.replace(/^zoomed-/, "");
    await closeAll(page);
  }

  await page.close();
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ file, errors, results, isolation, gallery, overflowGalleries, containment }, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), report(file, errors, results, isolation, gallery, overflowGalleries, containment));
  return { name, outDir, errors, results, isolation, gallery, overflowGalleries, containment };
}

function isolationOk(iso) {
  return iso.opened && iso.leaked.length === 0 && iso.stillOpen && iso.modifierPasses &&
    iso.functionKeysPass && iso.stillOpenAfterFKeys && iso.widgetBelow && iso.escCloses;
}

function keyboardOk(iso) {
  return KEYBOARD_CHECKS.every(([k]) => iso.keyboard?.[k] === true);
}

function fitOk(r) {
  return !r.expectFit || r.fit === r.expectFit;
}

function report(file, errors, results, isolation, gallery, overflowGalleries, containment) {
  const yn = (v) => (v === undefined || v === null ? "" : v === true ? "yes" : v === false ? "NO" : String(v));
  const lines = [
    `# ${path.basename(file)}`, "",
    `Console errors: ${errors.length ? "" : "none"}`,
    ...errors.map((e) => `- \`${e}\``), "",
    "| Case | Img | Classes | Wrapper | Opened | Details | Zoom× | Anchor px | Drag px | Reset | Esc | Bg click |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const details = r.opened === "glightbox"
      ? `title: ${r.title || "—"}; desc: ${r.description || "—"}; slides: ${r.slides}`
      : r.opened === "panzoom" ? `caption: ${r.caption || "—"}; ${r.counter || "1 / 1"}; ${r.size}; ` +
        `opens: ${r.fit || "—"}` + (r.expectFit ? (fitOk(r) ? " (as expected)" : ` (**expected ${r.expectFit}**)`) : "") +
        (r.shiftScroll ? `; Shift+scroll: ${r.shiftScrolled}` + (r.shiftScrollOk ? " (as expected)" : ` (**expected ${r.shiftScroll}**)`) : "")
      : r.opened === "navigation" ? r.navigatedTo : "";
    lines.push(`| ${r.case}. ${r.caseTitle} | ${r.n} | \`${r.classes}\` | ${r.wrapper} | **${r.opened}** | ` +
      `${details.replace(/\|/g, "\\|")} | ${yn(r.wheelZoom)} | ${yn(r.anchorDrift)} | ${yn(r.dragMoved)} | ${yn(r.resetOk)} | ` +
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
      `- PageDown: ${gallery.pageDown}; PageUp goes back: ${yes(gallery.pageUpBack)}`,
      `- Right arrow (not zoomed): ${gallery.arrowNext}; Left goes back: ${yes(gallery.arrowBack)}`,
      `- Next button: ${gallery.buttonNext}`,
      `- Swipe left: ${gallery.swipeNext}`,
      `- Zoomed in, Right pans instead: ${yes(gallery.zoomedArrowPans)}`,
      `- Previous disabled on the first image: ${yes(gallery.prevDisabledAtStart)}`,
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
      `- PageDown switches to the next image: ${yes(g.pageDownSwitches)} (opens: ${g.nextFit})`, "");
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

for (const file of PAGES) {
  if (!file.startsWith(SITE + path.sep)) {
    console.error(`${file} is not inside ${SITE}; render the project and pass pages from docs/.`);
    process.exit(1);
  }
}
const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});
try {
  for (const file of PAGES) {
    const { name, outDir, errors, results, isolation, gallery, overflowGalleries, containment } = await checkPage(browser, base, file);
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
    if (overflowGalleries.length) extra.push(overflowGalleries.every((g) => g.ok) ? "large galleries ok" : "LARGE GALLERIES FAILED");
    if (containment) extra.push(containment.ok ? "containment ok" : "CONTAINMENT FAILED");
    const shift = results.filter((r) => r.shiftScroll && r.opened === "panzoom");
    if (shift.length) extra.push(shift.every((r) => r.shiftScrollOk) ? "shift-scroll ok" : "SHIFT-SCROLL FAILED");
    const wide = extra.join(", ");
    console.log(`${name}: ${results.length} images, ${JSON.stringify(counts)}, ` +
      `${errors.length} console errors, ${iso}, ${gal}, ${fit}${wide ? ", " + wide : ""} -> ${path.relative(process.cwd(), outDir)}/report.md`);
  }
} finally {
  await browser.close();
  server.close();
}
