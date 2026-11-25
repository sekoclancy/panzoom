/*
  Other output formats (the Formats pages, render first):
  - revealjs (the slides U embeds): images open from a slide, the slide keys go to the viewer
    while it is open, Escape closes the viewer without the slide overview,
    the arrows move between slides again after it closes, in full screen
    the viewer adds no history entry and closes when full screen ends, a gallery steps
    within the slide, Back closes the viewer and keeps the slide, an image in
    a hidden fragment can't be clicked and opens once shown;
  - the frame on U: the slides load in it, an image there opens in the
    viewer inside the frame, and the Full screen button asks for full screen
    on the frame;
  - dashboard (V): images open from a card, the viewer covers an expanded
    card and Escape closes the viewer first, then the card, an image on a tab
    opens once the tab is selected, Back closes the viewer and keeps the
    dashboard page.
  Every image on both pages has alt text, which the viewer copies.

  Usage, from tests/:
    npm run formats
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

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".woff": "font/woff",
    ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json" };
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
const isOpen = (page) => page.evaluate(() => !!document.querySelector(".panzoom-overlay.open"));
// The viewer's label names the image's place in a gallery.
const label = (page) => page.evaluate(() => document.querySelector(".panzoom-overlay")?.getAttribute("aria-label"));
const viewerAlt = (page) => page.evaluate(() => document.querySelector(".panzoom-overlay img")?.alt);

let failed = 0;
function check(name, ok, detail) {
  if (ok) return;
  failed++;
  console.log(`  FAILED ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`);
}

// Clicks an image and waits for the viewer.
async function open(page, selector) {
  const img = await page.$(selector);
  await img.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await wait(200);
  await img.click();
  await page.waitForFunction(() => document.querySelector(".panzoom-overlay.open"), { timeout: 3000 }).catch(() => {});
  await wait(300);
}

async function close(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".panzoom-overlay.open"), { timeout: 3000 }).catch(() => {});
  await wait(300);
}

// Every image is marked for panzoom and has alt text.
async function checkImages(page, name) {
  const imgs = await page.evaluate(() => [...document.querySelectorAll("main img, #quarto-content img, .reveal .slides img")]
    .map((img) => ({ src: img.getAttribute("src"), panzoom: img.classList.contains("panzoom"), alt: img.alt })));
  check(`${name}: images found`, imgs.length > 0);
  for (const img of imgs) {
    check(`${name}: ${img.src} marked`, img.panzoom);
    check(`${name}: ${img.src} alt text`, img.alt.length > 0);
  }
  return imgs.length;
}

async function checkDeck(browser, base) {
  const name = "revealjs-slides";
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + `formats/${name}.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.Reveal?.isReady(), { timeout: 10000 });
  const n = await checkImages(page, name);

  const go = async (id) => {
    await page.evaluate((id) => {
      const i = [...document.querySelectorAll(".reveal .slides > section")].findIndex((s) => s.id === id);
      window.Reveal.slide(i);
    }, id);
    await wait(500);
  };
  const slide = () => page.evaluate(() => window.Reveal.getIndices().h);

  await go("single-image");
  const here = await slide();
  await open(page, "#single-image img");
  check(`${name}: opens`, await isOpen(page));
  check(`${name}: viewer alt`, (await viewerAlt(page)) === "Sunset over a sandy beach, with a tall rock stack against the sun",
    await viewerAlt(page));
  const fonts = await page.evaluate(() => [".reveal", ".panzoom-overlay .panzoom-caption"]
    .map((s) => getComputedStyle(document.querySelector(s)).fontFamily));
  check(`${name}: caption in the slide font`, fonts[0] === fonts[1], fonts);
  for (const key of ["ArrowRight", "ArrowLeft", " ", "PageDown", "o"]) {
    await page.keyboard.press(key);
    await wait(200);
  }
  check(`${name}: keys stay in the viewer`, (await slide()) === here && (await isOpen(page)), await slide());
  await close(page);
  check(`${name}: Escape closes`, !(await isOpen(page)));
  check(`${name}: no overview`, !(await page.evaluate(() => window.Reveal.isOverview())));
  await page.keyboard.press("ArrowRight");
  await wait(500);
  check(`${name}: arrows move between slides after closing`, (await slide()) === here + 1, await slide());

  // Full screen: the browser takes Escape to leave it, so the page never
  // sees the key; exitFullscreen() stands in for that.
  await go("single-image");
  await page.keyboard.press("f");
  await wait(500);
  const entries = await page.evaluate(() => history.length);
  await open(page, "#single-image img");
  check(`${name}: opens in full screen`, (await isOpen(page)) && (await page.evaluate(() => !!document.fullscreenElement)));
  check(`${name}: no history entry in full screen`, (await page.evaluate(() => history.length)) === entries);
  await page.evaluate(() => document.exitFullscreen());
  await wait(500);
  check(`${name}: leaving full screen closes`, !(await isOpen(page)));

  await go("gallery");
  const gallery = await slide();
  await open(page, "#gallery img");
  check(`${name}: gallery opens`, /image 1 of 3/.test(await label(page)), await label(page));
  await page.keyboard.press("ArrowRight");
  await wait(400);
  check(`${name}: gallery steps`, /image 2 of 3/.test(await label(page)) && (await slide()) === gallery, await label(page));
  await page.goBack();
  await wait(500);
  check(`${name}: Back closes`, !(await isOpen(page)));
  check(`${name}: Back keeps the slide`, (await slide()) === gallery, await slide());

  for (const id of ["plot", "wide-figure"]) {
    await go(id);
    await open(page, `#${id} img`);
    check(`${name}: ${id} opens`, await isOpen(page));
    await close(page);
  }

  await go("fragment");
  const hidden = await page.evaluate(() => {
    const img = document.querySelector("#fragment img");
    const r = img.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return getComputedStyle(img.closest(".fragment")).visibility === "hidden" || top !== img;
  });
  check(`${name}: hidden fragment can't be clicked`, hidden);
  await page.evaluate(() => window.Reveal.next());
  await wait(500);
  await open(page, "#fragment img");
  check(`${name}: shown fragment opens`, await isOpen(page));
  await close(page);

  check(`${name}: no page errors`, errors.length === 0, errors);
  await page.close();
  return n;
}

async function checkDashboard(browser, base) {
  const name = "v-dashboard-r";
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + `formats/${name}.html`, { waitUntil: "load" });
  await wait(1000);
  const n = await checkImages(page, name);
  const card = '.card[data-title="Single image"]';
  const photo = `${card} img`;
  const expanded = () => page.evaluate((c) => document.querySelector(c).dataset.fullScreen === "true", card);

  await open(page, photo);
  check(`${name}: opens`, await isOpen(page));
  check(`${name}: viewer alt`, (await viewerAlt(page)) === "Sunset over a sandy beach, with a tall rock stack against the sun",
    await viewerAlt(page));
  await close(page);
  check(`${name}: Escape closes`, !(await isOpen(page)));

  // Expand the card from its corner badge, which shows on hover.
  await page.hover(card);
  await wait(300);
  await page.click(`${card} .bslib-full-screen-enter`);
  await wait(500);
  check(`${name}: card expands`, await expanded());
  await open(page, photo);
  const onTop = await page.evaluate(() =>
    !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".panzoom-overlay"));
  check(`${name}: viewer covers the expanded card`, (await isOpen(page)) && onTop);
  await close(page);
  check(`${name}: Escape closes the viewer first`, !(await isOpen(page)) && (await expanded()));
  await page.keyboard.press("Escape");
  await wait(500);
  check(`${name}: second Escape closes the card`, !(await expanded()));

  const gallery = 'img[alt^="Waves breaking"]';
  await open(page, gallery);
  check(`${name}: gallery opens`, /image 1 of 3/.test(await label(page)), await label(page));
  await page.keyboard.press("ArrowRight");
  await wait(400);
  check(`${name}: gallery steps`, /image 2 of 3/.test(await label(page)), await label(page));
  await close(page);

  // The wide figure is on the tab not selected.
  await page.click('a[data-value="Wide figure"]');
  await wait(500);
  await open(page, 'img[alt^="A row of 12"]');
  check(`${name}: image on a tab opens`, await isOpen(page));
  await close(page);

  // The page scrolls (`scrolling: true`), and the page tabs with it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(300);
  await page.click("#tab-setup");
  await wait(500);
  await open(page, 'img[alt^="A sailboat"]');
  check(`${name}: image on a second page opens`, await isOpen(page));
  await page.goBack();
  await wait(500);
  const onSetup = await page.evaluate(() => document.querySelector("#setup").classList.contains("active"));
  check(`${name}: Back closes`, !(await isOpen(page)));
  check(`${name}: Back keeps the dashboard page`, onSetup);

  check(`${name}: no page errors`, errors.length === 0, errors);
  await page.close();
  return n;
}

async function checkFrame(browser, base) {
  const name = "u-revealjs-r";
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + `formats/${name}.html`, { waitUntil: "load" });
  const frame = await (await page.$("iframe#slides")).contentFrame();
  await frame.waitForFunction(() => window.Reveal?.isReady(), { timeout: 15000 });
  await frame.evaluate(() => {
    const i = [...document.querySelectorAll(".reveal .slides > section")].findIndex((s) => s.id === "single-image");
    window.Reveal.slide(i);
  });
  await wait(500);
  await (await frame.$("#single-image img")).click();
  await wait(800);
  check(`${name}: opens in the frame`, await frame.evaluate(() => !!document.querySelector(".panzoom-overlay.open")));
  await page.keyboard.press("Escape");
  await wait(400);
  check(`${name}: Escape closes`, !(await frame.evaluate(() => !!document.querySelector(".panzoom-overlay.open"))));

  // Headless Chrome may refuse full screen, so record the request itself.
  await page.evaluate(() => {
    Element.prototype.requestFullscreen = function () { window.__full = this.id; return Promise.resolve(); };
  });
  await page.click("#slides-full-screen");
  check(`${name}: Full screen asks for the frame`, (await page.evaluate(() => window.__full)) === "slides");
  check(`${name}: no page errors`, errors.length === 0, errors);
  await page.close();
}

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const counts = [await checkDeck(browser, base), await checkDashboard(browser, base)];
await checkFrame(browser, base);
await browser.close();
server.close();
console.log(failed ? `${failed} check(s) FAILED` : `formats: ok (${counts.join(" + ")} images)`);
process.exit(failed ? 1 : 0);
