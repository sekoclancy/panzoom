/*
  JavaScript API checks (`window.QuartoPanzoom`), on the front page (render
  first):
  - open: an unmarked image a script made opens, anything else doesn't;
  - onClose: called once however the viewer closes (close button, Esc,
    Back, close()), and focus returns to `opener`;
  - observe: an image added later is reachable with Tab, `match` marks
    images, a second scan changes nothing, disconnect() stops it;
  - print: with the viewer open, the page prints, not the viewer.

  Usage, from tests/:
    npm run api
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
const isOpen = (page) => page.evaluate(() => !!document.querySelector(".panzoom-overlay.open"));

let failed = 0;
function check(name, ok, detail) {
  if (ok) return;
  failed++;
  console.log(`  FAILED ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`);
}

const server = await serve(SITE);
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load" });

check("api", await page.evaluate(() => ["open", "close", "observe"].every(
  (k) => typeof window.QuartoPanzoom?.[k] === "function")));

// An unmarked image and a button to open it from, as a page script would
// add them.
await page.evaluate(() => {
  const marked = document.querySelector("img.panzoom");
  const main = document.querySelector("main");
  const img = Object.assign(document.createElement("img"), { src: marked.src, alt: "Scripted", id: "api-img" });
  const button = Object.assign(document.createElement("button"), { id: "api-opener", textContent: "Open" });
  main.append(img, button);
  window.__closes = 0;
  window.__open = () => window.QuartoPanzoom.open(img, { opener: button, onClose: () => window.__closes++ });
});

check("open: not an image", await page.evaluate(() =>
  window.QuartoPanzoom.open(document.querySelector("main")) === false &&
  window.QuartoPanzoom.open(null) === false) && !(await isOpen(page)));

const CLOSERS = {
  "close button": () => page.evaluate(() => document.querySelector(".panzoom-close").click()),
  Esc: () => page.keyboard.press("Escape"),
  Back: () => page.evaluate(() => history.back()),
  "close()": () => page.evaluate(() => window.QuartoPanzoom.close())
};
let closes = 0;
for (const [name, closer] of Object.entries(CLOSERS)) {
  const opened = await page.evaluate(() => window.__open());
  await wait(150);
  check(`open, before ${name}`, opened === true && await isOpen(page));
  check(`shown, before ${name}`, await page.evaluate(() =>
    document.querySelector(".panzoom-overlay img").src === document.getElementById("api-img").src));
  await closer();
  await wait(200);
  const after = await page.evaluate(() => ({
    closes: window.__closes, focus: document.activeElement?.id, length: history.length
  }));
  check(`closed by ${name}`, !(await isOpen(page)));
  check(`onClose after ${name}`, after.closes === ++closes, after);
  check(`focus on opener after ${name}`, after.focus === "api-opener", after);
}
await page.evaluate(() => window.QuartoPanzoom.close());
check("close() while closed", await page.evaluate(() => window.__closes) === closes);

// Opened over an open viewer: the first onClose is called then, the second
// when the viewer closes.
const over = await page.evaluate(async () => {
  const log = [];
  const img = document.getElementById("api-img");
  window.QuartoPanzoom.open(img, { opener: document.getElementById("api-opener"), onClose: () => log.push("first") });
  window.QuartoPanzoom.open(document.querySelector("img.panzoom"), { onClose: () => log.push("second") });
  const mid = log.slice();
  window.QuartoPanzoom.close();
  await new Promise((r) => setTimeout(r, 200));
  return { mid, log, focus: document.activeElement?.id };
});
check("open over an open viewer", over.mid.join() === "first" && over.log.join() === "first,second" &&
  over.focus === "api-opener", over);

// observe()
const observed = await page.evaluate(async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const src = document.querySelector("img.panzoom").src;
  const root = document.createElement("div");
  document.querySelector("main").append(root);
  const add = (cls) => {
    const img = Object.assign(document.createElement("img"), { src, className: cls });
    root.append(img);
    return img;
  };
  const state = (img) => ({ marked: img.classList.contains("panzoom"), tab: img.tabIndex, role: img.getAttribute("role") });
  const out = {};
  const before = add("panzoom");
  const watch = window.QuartoPanzoom.observe(root, { match: ".late" });
  out.atStart = state(before);
  const late = add("panzoom"), matched = add("late"), other = add("other"), no = add("late nopanzoom");
  await tick();
  out.late = state(late);
  out.matched = state(matched);
  out.other = state(other);
  out.nopanzoom = state(no);
  // The marker keeps a scan from setting an image up again.
  late.removeAttribute("role");
  watch.scan();
  out.rescan = late.getAttribute("role");
  watch.disconnect();
  const after = add("late");
  await tick();
  out.afterDisconnect = state(after);
  // A function for `match`.
  const fn = window.QuartoPanzoom.observe(root, { match: (img) => img === after });
  out.byFunction = state(after);
  fn.disconnect();
  root.remove();
  return out;
});
const ready = (s) => s.marked && s.tab === 0 && s.role === "button";
check("observe: image there at the start", ready(observed.atStart), observed.atStart);
check("observe: late marked image", ready(observed.late), observed.late);
check("observe: match marks", ready(observed.matched), observed.matched);
check("observe: unmatched left alone", !observed.other.marked && observed.other.role === null, observed.other);
check("observe: .nopanzoom left alone", !observed.nopanzoom.marked && observed.nopanzoom.role === null, observed.nopanzoom);
check("observe: set up once", observed.rescan === null, observed.rescan);
check("observe: disconnect", !observed.afterDisconnect.marked, observed.afterDisconnect);
check("observe: match function", ready(observed.byFunction), observed.byFunction);

// Print with the viewer open.
await page.evaluate(() => window.__open());
await wait(150);
await page.emulateMediaType("print");
const print = await page.evaluate(() => ({
  overlay: getComputedStyle(document.querySelector(".panzoom-overlay")).display,
  overflow: getComputedStyle(document.documentElement).overflow
}));
check("print: viewer hidden, page whole", print.overlay === "none" && print.overflow === "visible", print);
await page.emulateMediaType("screen");
check("print: viewer back", await isOpen(page) && await page.evaluate(() =>
  getComputedStyle(document.querySelector(".panzoom-overlay")).display === "block"));

await browser.close();
server.close();
console.log(failed ? `api: ${failed} FAILED` : "api ok");
if (failed) process.exitCode = 1;
