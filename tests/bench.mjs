/*
  Benchmark: panzoom against Quarto's lightbox (GLightbox), with knitr.

  bench/none.qmd, bench/lightbox.qmd (`lightbox: auto`) and
  bench/panzoom.qmd (`match: auto`) include the same body, bench/_body.qmd:
  four photos, eight R plots and a figure with two subfigures. Only the
  viewer differs, so each number is compared with the page without one.

  Measures:
  - Render: `quarto render <page>.qmd` wall time, the pages taking turns,
    `--rounds` times each (median and fastest). R runs in every render, the
    same for each page; the difference from "none" is the viewer's cost.
  - Weight: what each viewer adds to the page: its script and stylesheet
    files (as written and gzipped, as a web server would send them) and
    the HTML's growth.
  - Load: DOMContentLoaded and load, from navigation start, in a fresh
    browser context (no cache) each time.
  - Open and close: click an image, then time until the viewer is first
    visible and until it has settled (its image loaded, fully opaque and
    nothing moving for 100 ms, so an opening animation counts); then click its close button
    and time until it's gone. The first open (which builds the viewer) is
    reported apart from the rest. Also with the CPU slowed 4x, roughly a
    mid-range phone.

  Times depend on the machine; compare the rows, not the absolute numbers.
  Chrome is headless and draws without a GPU.

  Usage, from tests/:
    npm run bench                   # render and measure (rounds: 5)
    node bench.mjs --rounds 10
    node bench.mjs --no-render      # measure the pages already rendered

  Output: results/bench/report.md and results/bench/results.json.
*/
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DIR = path.join(HERE, "bench");
const OUT = path.join(HERE, "results", "bench");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const argv = process.argv.slice(2);
const ROUNDS = Number(argv[argv.indexOf("--rounds") + 1]) || 5;
const RENDER = !argv.includes("--no-render");
const PAGES = ["none", "lightbox", "panzoom"];
const OPENS = 6;   // images opened per page and CPU speed
const CPU = [1, 4];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (x) => (x === undefined || x === null ? "–" : `${Math.round(x)} ms`);
const kb = (x) => `${(x / 1024).toFixed(1)} KB`;

// Render: the pages take turns, so a slow spell hits each of them alike.
function render() {
  const times = Object.fromEntries(PAGES.map((p) => [p, []]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const p of PAGES) {
      const t0 = process.hrtime.bigint();
      const res = spawnSync("quarto", ["render", `${p}.qmd`, "--to", "html"], { cwd: DIR, encoding: "utf8" });
      const t = Number(process.hrtime.bigint() - t0) / 1e6;
      if (res.status !== 0) {
        console.error(`${p}.qmd: render failed\n${res.stdout}${res.stderr}`);
        process.exit(1);
      }
      times[p].push(t);
    }
    process.stdout.write(`render round ${r + 1}/${ROUNDS}\r`);
  }
  process.stdout.write("\n");
  return times;
}

// Weight: the viewer's own files, under <page>_files/libs/quarto-contrib/.
function weight(p) {
  const html = fs.readFileSync(path.join(DIR, `${p}.html`));
  const contrib = path.join(DIR, `${p}_files`, "libs", "quarto-contrib");
  const files = [];
  if (fs.existsSync(contrib)) {
    for (const d of fs.readdirSync(contrib)) {
      if (!/^(glightbox|panzoom)/.test(d)) continue;
      for (const f of fs.readdirSync(path.join(contrib, d), { recursive: true })) {
        const full = path.join(contrib, d, f);
        if (/\.(js|css)$/.test(f) && fs.statSync(full).isFile()) files.push(full);
      }
    }
  }
  const raw = files.reduce((a, f) => a + fs.statSync(f).size, 0);
  const gz = files.reduce((a, f) => a + zlib.gzipSync(fs.readFileSync(f)).length, 0);
  return { html: html.length, htmlGz: zlib.gzipSync(html).length, files: files.map((f) => path.relative(DIR, f)), raw, gz };
}

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const f = path.join(root, p);
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// In the page: what is on screen. The viewer's container and image, their
// opacity and geometry; `shown` once something of the viewer is visible.
function viewerState() {
  const box = document.querySelector(".panzoom-overlay.open") || document.querySelector(".glightbox-container");
  if (!box) return { shown: false, key: "none" };
  const img = box.querySelector(".panzoom-overlay img, .gslide.current img");
  const cs = getComputedStyle(box);
  const op = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const r = img && img.getBoundingClientRect();
  const shown = cs.display !== "none" && cs.visibility !== "hidden" && op(box) > 0.01;
  return {
    shown,
    loaded: !!img && img.complete && img.naturalWidth > 0,
    opaque: op(box) > 0.99 && !!img && op(img) > 0.99,
    key: JSON.stringify([shown, op(box).toFixed(3), img && op(img).toFixed(3),
      r && [r.x, r.y, r.width, r.height].map(Math.round), img && getComputedStyle(img).transform]),
  };
}

// In the page: does `act`, then watches every frame until the viewer is
// `want` (open: shown, fully opaque, with its image loaded; closed: not
// shown) and has
// not changed for 100 ms. Returns the times, from just before `act`, of the
// first frame the viewer was (or stopped being) shown and of the settled
// state.
async function timed(page, act, want) {
  return page.evaluate((act, want, stateSrc) => {
    const state = new Function(`return (${stateSrc})()`);
    return new Promise((resolve) => {
      const t0 = performance.now();
      let first = null, last = null, since = t0;
      (new Function(act))();
      const tick = () => {
        const now = performance.now(), s = state();
        const good = want === "open" ? s.shown && s.loaded && s.opaque : !s.shown;
        if (first === null && (want === "open" ? s.shown : !s.shown)) first = now - t0;
        if (s.key !== last) { last = s.key; since = now; }
        else if (good && now - since >= 100) return resolve({ first, settled: since - t0 });
        if (now - t0 > 10000) return resolve({ first, settled: null, timeout: true });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, act, want, viewerState.toString());
}

async function measure(browser, base) {
  const out = {};
  for (const p of PAGES) {
    out[p] = { load: [], dcl: [] };
    // Load: a fresh context each time, so nothing is cached.
    for (let r = 0; r < ROUNDS; r++) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${base}${p}.html`, { waitUntil: "load" });
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd || performance.now() };
      });
      out[p].dcl.push(nav.dcl);
      out[p].load.push(nav.load);
      await ctx.close();
    }
    if (p === "none") continue;
    // Open and close, at each CPU speed.
    for (const rate of CPU) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(`${base}${p}.html`, { waitUntil: "networkidle0" });
      await page.emulateCPUThrottling(rate);
      const sel = p === "panzoom" ? "a.panzoom-link img" : "a.lightbox img";
      const close = p === "panzoom" ? ".panzoom-close" : ".gclose";
      const n = Math.min(OPENS, await page.$$eval(sel, (els) => els.length));
      const runs = [];
      for (let i = 0; i < n; i++) {
        await page.$$eval(sel, (els, i) => els[i].scrollIntoView({ block: "center" }), i);
        await new Promise((r) => setTimeout(r, 200));
        const open = await timed(page, `document.querySelectorAll(${JSON.stringify(sel)})[${i}].click()`, "open");
        const shut = await timed(page, `document.querySelector(${JSON.stringify(close)}).click()`, "closed");
        runs.push({ open, close: shut });
        await new Promise((r) => setTimeout(r, 300));
      }
      out[p][`cpu${rate}`] = runs;
      await ctx.close();
    }
  }
  return out;
}

if (RENDER) console.log(`Rendering ${PAGES.length} pages, ${ROUNDS} rounds...`);
const renderTimes = RENDER ? render() : null;
for (const p of PAGES) {
  if (!fs.existsSync(path.join(DIR, `${p}.html`))) {
    console.error(`bench/${p}.html is missing; run without --no-render.`);
    process.exit(1);
  }
}
const weights = Object.fromEntries(PAGES.map((p) => [p, weight(p)]));

const server = await serve(ROOT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let timing;
try {
  console.log("Measuring in Chrome...");
  timing = await measure(browser, `http://127.0.0.1:${server.address().port}/tests/bench/`);
} finally {
  await browser.close();
  server.close();
}

const quarto = spawnSync("quarto", ["--version"], { encoding: "utf8" }).stdout.trim();
const lines = [
  "# Benchmark: panzoom vs Quarto's lightbox (knitr)", "",
  `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC; Quarto ${quarto}; ` +
    `${os.cpus()[0].model.trim()} (${os.cpus().length} threads); headless Chrome, no GPU; ` +
    `${ROUNDS} rounds. Compare the rows, not the absolute numbers.`, "",
];
const NAME = { none: "No viewer", lightbox: "Quarto's lightbox", panzoom: "panzoom" };
if (renderTimes) {
  const base = median(renderTimes.none);
  lines.push("## Render (`quarto render`, R included)", "",
    "| Page | Median | Fastest | Median vs no viewer |", "|---|---|---|---|",
    ...PAGES.map((p) => `| ${NAME[p]} | ${ms(median(renderTimes[p]))} | ${ms(Math.min(...renderTimes[p]))} | ` +
      (p === "none" ? "" : `${median(renderTimes[p]) - base >= 0 ? "+" : ""}${ms(median(renderTimes[p]) - base)}`) + " |"), "");
}
lines.push("## Weight (what the viewer adds)", "",
  "| Page | Viewer's JS + CSS | gzipped | HTML | HTML vs no viewer |", "|---|---|---|---|---|",
  ...PAGES.map((p) => {
    const w = weights[p];
    return `| ${NAME[p]} | ${p === "none" ? "" : kb(w.raw)} | ${p === "none" ? "" : kb(w.gz)} | ${kb(w.html)} | ` +
      (p === "none" ? "" : `+${kb(w.html - weights.none.html)}`) + " |";
  }), "",
  ...PAGES.filter((p) => p !== "none").map((p) => `- ${NAME[p]}: ${weights[p].files.map((f) => `\`${f}\``).join(", ")}`), "");
lines.push("## Page load (no cache, median)", "",
  "| Page | DOMContentLoaded | load |", "|---|---|---|",
  ...PAGES.map((p) => `| ${NAME[p]} | ${ms(median(timing[p].dcl))} | ${ms(median(timing[p].load))} |`), "");
lines.push("## Open and close", "",
  `Clicking ${OPENS} images in turn. *Visible*: the first frame showing the viewer; *settled*: its image ` +
  "loaded, fully opaque and nothing moving (any opening animation finished). Close: until the viewer is gone. " +
  "The first open builds the viewer; the others are the median of the rest.", "",
  "| Viewer | CPU | First open: visible / settled | Open: visible / settled | Close |", "|---|---|---|---|---|");
for (const p of PAGES.filter((p) => p !== "none")) {
  for (const rate of CPU) {
    const runs = timing[p][`cpu${rate}`];
    if (!runs?.length) { lines.push(`| ${NAME[p]} | ${rate}x | no images opened | | |`); continue; }
    const rest = runs.slice(1);
    const med = (f) => (rest.length ? median(rest.map(f).filter((x) => x !== null)) : null);
    const timeouts = runs.filter((r) => r.open.timeout || r.close.timeout).length;
    lines.push(`| ${NAME[p]} | ${rate === 1 ? "full speed" : `${rate}x slower`} | ` +
      `${ms(runs[0].open.first)} / ${ms(runs[0].open.settled)} | ${ms(med((r) => r.open.first))} / ${ms(med((r) => r.open.settled))} | ` +
      `${ms(med((r) => r.close.settled))}${timeouts ? ` (**${timeouts} timed out**)` : ""} |`);
  }
}
lines.push("");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ renderTimes, weights, timing }, null, 2));
console.log(lines.join("\n"));
console.log(`-> ${path.relative(process.cwd(), path.join(OUT, "report.md"))}`);
