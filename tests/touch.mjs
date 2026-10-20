/*
  Touch checks: the viewer on an emulated phone, driven with real
  multi-finger touch events (Chrome DevTools' Input.dispatchTouchEvent,
  which Chrome turns into pointer events, as on a phone).

  On a 390 × 844 touch screen, with the rendered site (render first):
  - tap: a tap on a marked image opens the viewer;
  - pinch: two fingers spreading apart zoom in, and the image stays on
    screen (its edges at the screen's, less the margin, where it is
    larger; whole where it is smaller);
  - drag: one finger pans a zoomed image;
  - pinch with a resting finger: a pinch whose other finger rests on the
    background, lifted first, must not close the viewer;
  - swipe: a sideways swipe on a gallery image at its opening size shows
    the next image;
  - double-tap: returns a zoomed image to its opening view;
  - tap the background: closes the viewer;
  - hint: a viewer opened by a tap has no hint line (it names mouse and
    keyboard controls); one opened with the mouse still has it.

  Emulation can't show quirks of real devices (Safari on iOS especially):
  check on a phone too.

  Usage, from tests/:
    npm run touch
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "docs");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Touch input. `fingers` are the points down after the event, by id; a
// touchEnd with fewer points lifts the missing ones.
async function touch(cdp, type, fingers) {
  await cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: fingers.map((f) => ({ x: f.x, y: f.y, id: f.id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}
async function tap(cdp, x, y) {
  await touch(cdp, "touchStart", [{ id: 1, x, y }]);
  await wait(40);
  await touch(cdp, "touchEnd", []);
}
// Moves the fingers from `from` to `to` (same ids) in `steps` steps.
async function move(cdp, from, to, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, "touchMove", from.map((f, k) => ({
      id: f.id, x: f.x + (to[k].x - f.x) * i / steps, y: f.y + (to[k].y - f.y) * i / steps,
    })));
    await wait(16);
  }
}

// The viewer's state: open, gallery counter, scale, the image's box and
// the space it is shown in (the screen above the caption band).
async function state(page) {
  return page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay.open");
    if (!o) return { open: false };
    const img = o.querySelector("img"), r = img.getBoundingClientRect();
    const m = /scale\(([-\d.e]+)\)/.exec(img.style.transform);
    const c = o.querySelector(".panzoom-counter");
    const h = o.clientHeight - o.querySelector(".panzoom-footer").offsetHeight;
    return { open: true, counter: c.hidden ? "" : c.textContent, scale: m ? +m[1] : null,
      left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: o.clientWidth, h,
      margin: 0.025 * Math.min(o.clientWidth, h), moving: o.classList.contains("panzoom-moving") };
  });
}
async function settle(page) {
  await wait(250);
  for (let i = 0; i < 40 && (await state(page)).moving; i++) await wait(50);
  await wait(100);
}

// On screen, as the viewer keeps it: where the image is larger than the
// space along an axis, it covers it to within the margin; where smaller,
// it is wholly inside.
function contained(s) {
  const tol = 1.5;
  const axis = (lo, hi, size, m) => (hi - lo > size
    ? lo <= m + tol && hi >= size - m - tol
    : lo >= -tol && hi <= size + tol);
  return axis(s.left, s.right, s.w, s.margin) && axis(s.top, s.bottom, s.h, s.margin);
}

async function openImage(page, cdp, selector) {
  const handle = await page.$(selector);
  if (!handle) throw new Error(`no image ${selector}`);
  await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await wait(300);
  const b = await handle.boundingBox();
  await tap(cdp, b.x + b.width / 2, b.y + b.height / 2);
  await settle(page);
  return state(page);
}

// A point on the background: below the image, above the caption band,
// or failing that above it (clear of the counter and close button).
// Checked in the page: what is at the point must be the overlay itself.
async function background(page, s) {
  const p = s.h - s.bottom > 30 ? { x: s.w / 2, y: (s.bottom + s.h) / 2 } : { x: s.w / 2, y: Math.max(70, s.top / 2) };
  const hit = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList.contains("panzoom-overlay");
  }, p.x, p.y);
  if (!hit) throw new Error(`no background at ${Math.round(p.x)}, ${Math.round(p.y)}: the image covers it`);
  return p;
}
// Back to the opening view (the 0 key; a phone would double-tap).
async function reset(page) {
  await page.keyboard.press("0");
  await settle(page);
  return state(page);
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/tests/pages/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const cdp = await page.createCDPSession();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // A standard plot (page B, case 6): tap, pinch, drag, double-tap, tap outside.
  await page.goto(base + "b-panzoom-lightbox.html", { waitUntil: "networkidle0" });
  let s = await openImage(page, cdp, "#c6 img.panzoom");
  check("tap opens the viewer", s.open, s.open ? `scale ${s.scale?.toFixed(3)}` : "viewer not open");
  const opening = s.scale;
  const cx = s.w / 2, cy = (s.top + s.bottom) / 2;
  await touch(cdp, "touchStart", [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }]);
  await move(cdp, [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }],
    [{ id: 1, x: cx - 150, y: cy }, { id: 2, x: cx + 150, y: cy }]);
  await touch(cdp, "touchEnd", []);
  await settle(page);
  s = await state(page);
  check("pinch zooms in", s.open && s.scale > opening * 1.5, `scale ${opening?.toFixed(3)} -> ${s.scale?.toFixed(3)}`);
  check("pinch keeps the image on screen", s.open && contained(s),
    `image ${Math.round(s.left)}..${Math.round(s.right)} × ${Math.round(s.top)}..${Math.round(s.bottom)} in ${s.w} × ${Math.round(s.h)}`);

  const before = s;
  await touch(cdp, "touchStart", [{ id: 1, x: cx, y: cy }]);
  await move(cdp, [{ id: 1, x: cx, y: cy }], [{ id: 1, x: cx + 80, y: cy + 40 }]);
  await touch(cdp, "touchEnd", []);
  await settle(page);
  s = await state(page);
  const dx = s.left - before.left, dy = s.top - before.top;
  check("one-finger drag pans", s.open && (Math.abs(dx) > 20 || Math.abs(dy) > 20) && contained(s),
    `moved ${Math.round(dx)}, ${Math.round(dy)} px`);

  await tap(cdp, cx, cy); await wait(120); await tap(cdp, cx, cy);
  await settle(page);
  s = await state(page);
  check("double-tap resets", s.open && Math.abs(s.scale - opening) < 1e-3,
    `scale ${s.scale?.toFixed(3)}, opening ${opening?.toFixed(3)}`);

  // Pinch with one finger resting on the background, lifted first.
  s = await reset(page);
  const rest = await background(page, s);
  const a0 = { id: 2, x: cx, y: cy }, a1 = { id: 2, x: cx, y: Math.max(rest.y < cy ? cy + 120 : cy - 120, 10) };
  await touch(cdp, "touchStart", [{ id: 1, ...rest }]);
  await touch(cdp, "touchStart", [{ id: 1, ...rest }, a0]);
  await move(cdp, [{ id: 1, ...rest }, a0], [{ id: 1, ...rest }, a1]);
  await touch(cdp, "touchEnd", [a1]);
  await wait(60);
  await touch(cdp, "touchEnd", []);
  await settle(page);
  s = await state(page);
  check("pinch with a resting finger (down first) keeps the viewer open", s.open,
    s.open ? `scale ${s.scale?.toFixed(3)}` : "the viewer closed");

  // The same, the resting finger down second: the viewer tracks the last
  // finger down, so this is the order that could read as a tap outside.
  if (!s.open) s = await openImage(page, cdp, "#c6 img.panzoom");
  s = await reset(page);
  await background(page, s);
  await touch(cdp, "touchStart", [a0]);
  await touch(cdp, "touchStart", [a0, { id: 1, ...rest }]);
  await move(cdp, [a0, { id: 1, ...rest }], [a1, { id: 1, ...rest }]);
  await touch(cdp, "touchEnd", [a1]);
  await wait(60);
  await touch(cdp, "touchEnd", []);
  await settle(page);
  s = await state(page);
  check("pinch with a resting finger (down second) keeps the viewer open", s.open,
    s.open ? `scale ${s.scale?.toFixed(3)}` : "the viewer closed");

  if (!s.open) s = await openImage(page, cdp, "#c6 img.panzoom");
  s = await reset(page);
  const bg = await background(page, s);
  await tap(cdp, bg.x, bg.y);
  await settle(page);
  s = await state(page);
  check("tap on the background closes", !s.open, s.open ? "still open" : "closed");

  // A gallery (page B, case 4: subfigures): swipe left at the opening size.
  s = await openImage(page, cdp, "#c4 img.panzoom");
  const first = s.counter;
  // Clear of the previous and next buttons at the screen's sides.
  const y = (s.top + s.bottom) / 2, x0 = s.w * 0.75, x1 = s.w * 0.25;
  await touch(cdp, "touchStart", [{ id: 1, x: x0, y }]);
  await move(cdp, [{ id: 1, x: x0, y }], [{ id: 1, x: x1, y }], 8);
  await touch(cdp, "touchEnd", []);
  await settle(page);
  s = await state(page);
  check("swipe shows the next image", s.open && /^1 \//.test(first) && /^2 \//.test(s.counter),
    `${first} -> ${s.counter}`);

  // The hint line (page F, case 4, which has it): not after a tap, but
  // after a mouse click.
  const hintShown = () => page.evaluate(() => {
    const h = document.querySelector(".panzoom-overlay.open .panzoom-hint");
    return !!h && !h.hidden;
  });
  await page.goto(base + "f-options.html", { waitUntil: "networkidle0" });
  s = await openImage(page, cdp, "#c4 img.panzoom");
  const tapped = await hintShown();
  check("no hint line after a tap", s.open && !tapped, s.open ? (tapped ? "shown" : "hidden") : "viewer not open");
  await page.keyboard.press("Escape");
  await settle(page);
  await page.click("#c4 img.panzoom");
  await settle(page);
  const clicked = await hintShown();
  check("hint line after a mouse click", clicked, clicked ? "shown" : "hidden");

  check("no page errors", errors.length === 0, errors.join("; ") || "none");
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "ok    " : "FAILED"}  ${r.name}: ${r.detail}`);
}
console.log(failed ? `${failed} of ${results.length} touch checks FAILED` : `all ${results.length} touch checks ok`);
process.exit(failed ? 1 : 0);
