/*
  Loading checks: the viewer while an image is slow to load, or fails.
  The test server holds back or refuses chosen images, and the browser
  cache is off, so every open really loads the image.

  On page B (render first):
  - slow: a slow image shows "Loading image" (the last image doesn't show
    in its place), and fits once it arrives;
  - closed: an image that arrives after the viewer closed does nothing;
  - stale: in a gallery, an image that arrives after another was shown
    doesn't replace it;
  - failed: an image that fails shows an error message, the viewer still
    closes with Esc and gives focus back, and the image opens again later.

  Usage, from tests/:
    npm run loading
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

// Paths the server holds back (until release()) or refuses with a 404.
const held = new Map(), refused = new Set();

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const f = path.join(root, p);
    if (refused.has(p) || !f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end();
    }
    const send = () => {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    };
    if (held.has(p)) held.get(p).push(send); else send();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const hold = (p) => held.set(p, []);
function release(p) {
  const waiting = held.get(p) || [];
  held.delete(p);
  waiting.forEach((send) => send());
  return waiting.length;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The viewer's state.
async function state(page) {
  return page.evaluate(() => {
    const o = document.querySelector(".panzoom-overlay");
    const img = o && o.querySelector("img");
    const a = document.activeElement;
    return {
      open: !!(o && o.classList.contains("open")),
      loading: !!(o && o.classList.contains("panzoom-loading")),
      error: !!(o && o.classList.contains("panzoom-error")),
      status: o?.querySelector(".panzoom-status")?.textContent || "",
      imgShown: !!img && getComputedStyle(img).visibility === "visible",
      fit: img?.dataset.fit || null,
      transform: img?.style.transform || "",
      src: img?.getAttribute("src") ? new URL(img.src).pathname : null,
      counter: o?.querySelector(".panzoom-counter")?.textContent || "",
      focusIn: !!(o && o.contains(a)),
      focusOn: a?.dataset?.testId || null,
    };
  });
}

// Waits until the viewer has fitted an image (or gives up after `ms`).
async function fitted(page, ms = 3000) {
  await page.waitForFunction(() => {
    const o = document.querySelector(".panzoom-overlay.open");
    return o && !o.classList.contains("panzoom-loading") && o.querySelector("img").dataset.fit;
  }, { timeout: ms }).catch(() => {});
  await wait(100);
  return state(page);
}

async function open(page, selector) {
  await page.$eval(selector, (el) => {
    el.scrollIntoView({ block: "center" });
    document.querySelectorAll("[data-test-id]").forEach((x) => delete x.dataset.testId);
    (el.closest("a.panzoom-link") || el).dataset.testId = "opened";
  });
  await page.click(selector);
  await wait(50);
}

async function close(page) {
  await page.keyboard.press("Escape");
  await wait(50);
}

const srcOf = (page, selector) => page.$eval(selector, (el) => new URL(el.currentSrc || el.src).pathname);

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/tests/pages/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "b-panzoom-lightbox.html", { waitUntil: "networkidle0" });
  await page.setCacheEnabled(false);

  // The page keeps each image it has shown in memory and doesn't request it
  // again, so each check that holds back or refuses an image opens one the
  // viewer hasn't shown yet.
  const PLOT = "#c6 img.panzoom", SUB_A = "#c4 #fig-md-a img", SUB_B = "#c4 #fig-md-b img";
  const plot = await srcOf(page, PLOT), subA = await srcOf(page, SUB_A), subB = await srcOf(page, SUB_B);
  const others = await page.$$eval("section.level2 img", (imgs, taken) => {
    const seen = new Set(taken), out = [];
    for (const el of imgs) {
      const link = el.closest("a[href]");
      if (!el.matches(".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)") ||
        (link && !link.classList.contains("panzoom-link"))) continue;
      const p = new URL(el.currentSrc || el.src).pathname;
      if (seen.has(p)) continue;
      seen.add(p);
      el.dataset.testPick = out.length;
      out.push(p);
    }
    return out;
  }, [plot, subA, subB]);
  if (others.length < 2) throw new Error("page B needs two more marked images");
  const LATE = '[data-test-pick="0"]', BROKEN = '[data-test-pick="1"]';
  const late = others[0], broken = others[1];

  // Slow: loading shows, then the image fits.
  hold(plot);
  await open(page, PLOT);
  await wait(500);
  let s = await state(page);
  check("a slow image shows that it is loading", s.open && s.loading && /Loading/.test(s.status) && !s.imgShown,
    `loading ${s.loading}, status "${s.status}", image shown ${s.imgShown}`);
  release(plot);
  s = await fitted(page);
  check("...and fits once it arrives", s.open && !s.loading && !!s.fit && !!s.transform && s.imgShown && !s.status,
    `fit ${s.fit}, status "${s.status}"`);
  await close(page);

  // Closed: an image that arrives after the viewer closed.
  hold(late);
  await open(page, LATE);
  await close(page);
  const sent = release(late);
  await wait(500);
  s = await state(page);
  check("an image arriving after the viewer closed does nothing",
    !s.open && !s.fit && !s.transform && !s.loading,
    `${sent ? "" : "(nothing was requested) "}open ${s.open}, fit ${s.fit}, transform "${s.transform}"`);

  // Stale: in the gallery, Sub B is slow; next, then back to Sub A.
  hold(subB);
  await open(page, SUB_A);
  await fitted(page);
  await page.click(".panzoom-next");
  await wait(100);
  await page.click(".panzoom-prev");
  s = await fitted(page);
  release(subB);
  await wait(500);
  s = await state(page);
  check("a gallery image arriving late doesn't replace the one shown",
    s.open && /^1 \//.test(s.counter) && s.src === subA && !!s.fit && !s.loading,
    `counter ${s.counter}, showing ${path.basename(s.src || "none")}`);
  await close(page);

  // Failed: an error shows; Esc closes and gives focus back; opens later.
  refused.add(broken);
  await open(page, BROKEN);
  await wait(500);
  s = await state(page);
  check("a failed image shows an error", s.open && s.error && !s.loading && /could not be loaded/.test(s.status) && !s.imgShown,
    `error ${s.error}, status "${s.status}"`);
  check("...and focus stays in the viewer", s.focusIn, s.focusIn ? "in the viewer" : "left the viewer");
  await close(page);
  s = await state(page);
  check("...Esc closes and focus returns", !s.open && s.focusOn === "opened",
    `open ${s.open}, focus on ${s.focusOn || "something else"}`);
  refused.delete(broken);
  await open(page, BROKEN);
  s = await fitted(page);
  check("...and the image opens again later", s.open && !s.error && !!s.fit && !s.status,
    `error ${s.error}, fit ${s.fit}`);
  await close(page);

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
console.log(failed ? `${failed} of ${results.length} loading checks FAILED` : `all ${results.length} loading checks ok`);
process.exit(failed ? 1 : 0);
