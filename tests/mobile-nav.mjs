/*
  Mobile navigation checks: the site's menus on an emulated phone, scrolled
  with real touch events (Chrome DevTools' Input.dispatchTouchEvent).

  On a 390 × 664 and a short 375 × 560 touch screen, with the rendered site
  (render first), from an example page:
  - sidebar: the ☰ button in the title bar opens the list of examples; it
    ends at the screen's bottom, swipes scroll it to its last link, which is
    then on screen and opens its page when tapped, and the page behind it
    does not scroll (Quarto's `min-height: 100%` made the list as tall as
    the screen, below the title bar, so its last links were out of reach;
    see assets/site.scss);
  - navbar: the navbar's Examples menu, opened from the navbar's ☰ button,
    has every item on screen, and its last item opens its page when tapped.

  Emulation can't show quirks of real devices (Safari on iOS especially):
  check on a phone too.

  Usage, from tests/:
    npm run mobile-nav
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
const PHONES = [
  { width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { width: 375, height: 560, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const PAGE = "examples/a-lightbox-r.html";
const LAST_EXAMPLE = "t-renderings-python.html";

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
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

// One finger dragged from y0 to y1 at x, as a phone's swipe.
async function swipe(cdp, x, y0, y1) {
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(400);
}

// Where the link is, and whether a tap at its middle would reach it.
function reach(page, selector) {
  return page.evaluate((sel) => {
    const a = document.querySelector(sel);
    if (!a) return null;
    const r = a.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = r.top >= 0 && r.bottom <= innerHeight ? document.elementFromPoint(x, y) : null;
    return { x, y, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
      tappable: !!hit && (hit === a || a.contains(hit)) };
  }, selector);
}

// Taps the link and returns the page it opened, or null.
async function tapOpens(page, spot, file) {
  await Promise.all([
    page.waitForNavigation({ timeout: 3000 }).catch(() => {}),
    page.touchscreen.tap(spot.x, spot.y),
  ]);
  return page.url().endsWith("/" + file);
}

async function newPhonePage(browser, base, phone) {
  const page = await browser.newPage();
  await page.emulate({ viewport: phone, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" });
  await page.goto(`${base}/${PAGE}`, { waitUntil: "networkidle0" });
  return page;
}

async function checkSidebar(browser, base, phone) {
  const page = await newPhonePage(browser, base, phone);
  const cdp = await page.createCDPSession();
  const problems = [];
  await page.tap(".quarto-btn-toggle");
  await wait(600);
  const list = await page.evaluate(() => {
    const r = document.querySelector("#quarto-sidebar").getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: innerHeight };
  });
  if (list.bottom > list.vh + 1) problems.push(`list ends at ${list.bottom}, below the screen (${list.vh})`);
  const scrollBefore = await page.evaluate(() => scrollY);
  for (let i = 0; i < 6; i++) await swipe(cdp, phone.width / 2, phone.height - 60, 200);
  const scrollAfter = await page.evaluate(() => scrollY);
  if (scrollAfter !== scrollBefore) problems.push(`page behind scrolled ${scrollAfter - scrollBefore}px`);
  const last = await reach(page, `#quarto-sidebar a[href$="${LAST_EXAMPLE}"]`);
  if (!last) problems.push("no last link");
  else if (!last.tappable) problems.push(`last link at ${last.top}–${last.bottom} of ${last.vh}, out of reach`);
  else if (!(await tapOpens(page, last, LAST_EXAMPLE))) problems.push("tapping the last link opened nothing");
  await page.close();
  return problems;
}

async function checkNavbar(browser, base, phone) {
  const page = await newPhonePage(browser, base, phone);
  const problems = [];
  await page.tap(".navbar-toggler");
  await wait(600);
  await page.tap("#navbarCollapse .dropdown-toggle");
  await wait(400);
  const items = await page.$$eval("#navbarCollapse .dropdown-menu a.dropdown-item[href]",
    (as) => as.map((a) => a.getAttribute("href")));
  if (items.length === 0) problems.push("no menu items");
  for (const [i, href] of items.entries()) {
    const spot = await reach(page, `#navbarCollapse .dropdown-menu a.dropdown-item[href="${href}"]`);
    if (!spot.tappable) problems.push(`${path.basename(href)} at ${spot.top}–${spot.bottom} of ${spot.vh}, out of reach`);
    else if (i === items.length - 1 && !(await tapOpens(page, spot, path.basename(href)))) {
      problems.push(`tapping ${path.basename(href)} opened nothing`);
    }
  }
  await page.close();
  return { problems, count: items.length };
}

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
let failed = 0;
try {
  for (const phone of PHONES) {
    const size = `${phone.width}×${phone.height}`;
    const side = await checkSidebar(browser, base, phone);
    console.log(`${size} sidebar: ${side.length ? side.join("; ") + ", FAILED" : "last link reached and opened, page still, ok"}`);
    const nav = await checkNavbar(browser, base, phone);
    console.log(`${size} navbar Examples menu: ${nav.count} items, ${nav.problems.length ? nav.problems.join("; ") + ", FAILED" : "all on screen, last opened, ok"}`);
    failed += side.length + nav.problems.length;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
