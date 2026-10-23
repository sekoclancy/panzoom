/*
  Benchmark: panzoom against its own baseline, to catch regressions.

  bench/panzoom.qmd (`panzoom: true`, body in bench/_body.qmd: four photos,
  eight R plots and a figure with two subfigures) is rendered and measured,
  and each number is compared with bench/baseline.json, saved by an earlier
  run with --save on the same machine.

  Measures:
  - Render: `quarto render panzoom.qmd` wall time, `--rounds` times (median
    and fastest). R dominates it and varies by a second or so, so it is
    reported but not checked.
  - Weight: the viewer's script and stylesheet files (as written and
    gzipped, as a web server would send them) and the page's HTML.
  - Load: DOMContentLoaded and load, from navigation start, in a fresh
    browser context (no cache) each time.
  - Open and close: click an image, then time until the viewer is first
    visible and until it has settled (its image loaded, fully opaque and
    nothing moving for 100 ms); then click its close button and time until
    it's gone. The first open (which builds the viewer) is reported apart:
    the median over `--rounds` fresh page loads. Also with the CPU slowed
    4x, roughly a mid-range phone.

  A checked number is a regression when it is more than LIMITS allow above
  the baseline: a file or page 5% heavier, or a time 1.5 times the
  baseline and more than a few ms longer (small times jitter by a few ms).
  Any regression, or a viewer that never settled, fails the run (exit 1).
  Without a baseline, the run reports its numbers and passes.

  Times depend on the machine: a baseline from another CPU is compared
  anyway, with a warning. Chrome is headless and draws without a GPU.

  Usage, from tests/:
    npm run bench                   # render, measure, compare (rounds: 5)
    node bench.mjs --rounds 10
    node bench.mjs --no-render      # measure the page already rendered
    node bench.mjs --save           # ...and save this run as the baseline

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
const BASELINE = path.join(DIR, "baseline.json");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const argv = process.argv.slice(2);
const ROUNDS = Number(argv[argv.indexOf("--rounds") + 1]) || 5;
const RENDER = !argv.includes("--no-render");
const SAVE = argv.includes("--save");
const PAGE = "panzoom";
const OPENS = 6;   // images opened per CPU speed
const CPU = [1, 4];
// How much worse than the baseline counts as a regression.
const LIMITS = {
  bytes: { ratio: 1.05, abs: 0 },
  time: { ratio: 1.5, abs: 10 },     // ms
  slowTime: { ratio: 1.5, abs: 30 }, // ms; at 4x CPU, and page load
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (x) => (x === undefined || x === null ? "–" : `${Math.round(x)} ms`);
const kb = (x) => (x === undefined || x === null ? "–" : `${(x / 1024).toFixed(1)} KB`);

function render() {
  const times = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = process.hrtime.bigint();
    const res = spawnSync("quarto", ["render", `${PAGE}.qmd`, "--to", "html"], { cwd: DIR, encoding: "utf8" });
    const t = Number(process.hrtime.bigint() - t0) / 1e6;
    if (res.status !== 0) {
      console.error(`${PAGE}.qmd: render failed\n${res.stdout}${res.stderr}`);
      process.exit(1);
    }
    times.push(t);
    process.stdout.write(`render round ${r + 1}/${ROUNDS}\r`);
  }
  process.stdout.write("\n");
  return times;
}

// Weight: the viewer's own files, under <page>_files/libs/quarto-contrib/.
function weight() {
  const html = fs.readFileSync(path.join(DIR, `${PAGE}.html`));
  const contrib = path.join(DIR, `${PAGE}_files`, "libs", "quarto-contrib");
  const files = [];
  if (fs.existsSync(contrib)) {
    for (const d of fs.readdirSync(contrib)) {
      if (!d.startsWith("panzoom")) continue;
      for (const f of fs.readdirSync(path.join(contrib, d), { recursive: true })) {
        const full = path.join(contrib, d, f);
        if (/\.(js|css)$/.test(f) && fs.statSync(full).isFile()) files.push(full);
      }
    }
  }
  const raw = files.reduce((a, f) => a + fs.statSync(f).size, 0);
  const gz = files.reduce((a, f) => a + zlib.gzipSync(fs.readFileSync(f)).length, 0);
  return { html: html.length, files: files.map((f) => path.relative(DIR, f)), raw, gz };
}

function serve(root) {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
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

// In the page: what is on screen. The viewer and its image, their opacity
// and geometry; `shown` once something of the viewer is visible.
function viewerState() {
  const box = document.querySelector(".panzoom-overlay.open");
  if (!box) return { shown: false, key: "none" };
  const img = box.querySelector("img");
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
// shown) and has not changed for 100 ms. Returns the times, from just
// before `act`, of the first frame the viewer was (or stopped being) shown
// and of the settled state.
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

async function measure(browser, url) {
  const out = { load: [], dcl: [] };
  // Load: a fresh context each time, so nothing is cached.
  for (let r = 0; r < ROUNDS; r++) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "load" });
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd || performance.now() };
    });
    out.dcl.push(nav.dcl);
    out.load.push(nav.load);
    await ctx.close();
  }
  // Open and close, at each CPU speed.
  for (const rate of CPU) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.emulateCPUThrottling(rate);
    const sel = "a.panzoom-link img";
    const n = Math.min(OPENS, await page.$$eval(sel, (els) => els.length));
    const runs = [];
    for (let i = 0; i < n; i++) {
      await page.$$eval(sel, (els, i) => els[i].scrollIntoView({ block: "center" }), i);
      await new Promise((r) => setTimeout(r, 200));
      const open = await timed(page, `document.querySelectorAll(${JSON.stringify(sel)})[${i}].click()`, "open");
      const shut = await timed(page, `document.querySelector(".panzoom-close").click()`, "closed");
      runs.push({ open, close: shut });
      await new Promise((r) => setTimeout(r, 300));
    }
    out[`cpu${rate}`] = runs;
    await ctx.close();
    // The first open builds the viewer, so it happens once per page load:
    // measure it on `--rounds` fresh loads and take the median, as one
    // sample swings by 10 ms or more.
    const firsts = [];
    for (let r = 0; r < ROUNDS; r++) {
      const c = await browser.createBrowserContext();
      const pg = await c.newPage();
      await pg.setViewport({ width: 1280, height: 900 });
      await pg.goto(url, { waitUntil: "networkidle0" });
      await pg.emulateCPUThrottling(rate);
      await pg.$eval(sel, (el) => el.scrollIntoView({ block: "center" }));
      await new Promise((res) => setTimeout(res, 200));
      firsts.push(await timed(pg, `document.querySelector(${JSON.stringify(sel)}).click()`, "open"));
      await c.close();
    }
    out[`first${rate}`] = firsts;
  }
  return out;
}

// The checked numbers, by name: { value, kind }. `kind` picks the limit
// (LIMITS) and the unit.
function metrics(weights, timing) {
  const m = {
    "Viewer JS + CSS": { value: weights.raw, kind: "bytes" },
    "Viewer JS + CSS, gzipped": { value: weights.gz, kind: "bytes" },
    "Page HTML": { value: weights.html, kind: "bytes" },
    "Page load: DOMContentLoaded": { value: median(timing.dcl), kind: "slowTime" },
    "Page load: load": { value: median(timing.load), kind: "slowTime" },
  };
  for (const rate of CPU) {
    const runs = timing[`cpu${rate}`] || [], rest = runs.slice(1);
    const med = (f) => {
      const xs = rest.map(f).filter((x) => x !== null);
      return xs.length ? median(xs) : null;
    };
    const cpu = rate === 1 ? "full speed" : `CPU ${rate}x slower`;
    const kind = rate === 1 ? "time" : "slowTime";
    const firsts = (timing[`first${rate}`] || []).map((o) => o.settled).filter((x) => x !== null);
    m[`First open, settled (${cpu})`] = { value: firsts.length ? median(firsts) : null, kind };
    m[`Open, visible (${cpu})`] = { value: med((r) => r.open.first), kind };
    m[`Open, settled (${cpu})`] = { value: med((r) => r.open.settled), kind };
    m[`Close (${cpu})`] = { value: med((r) => r.close.settled), kind };
  }
  return m;
}

if (RENDER) console.log(`Rendering ${PAGE}.qmd, ${ROUNDS} rounds...`);
const renderTimes = RENDER ? render() : null;
if (!fs.existsSync(path.join(DIR, `${PAGE}.html`))) {
  console.error(`bench/${PAGE}.html is missing; run without --no-render.`);
  process.exit(1);
}
const weights = weight();

const server = await serve(ROOT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let timing;
try {
  console.log("Measuring in Chrome...");
  timing = await measure(browser, `http://127.0.0.1:${server.address().port}/tests/bench/${PAGE}.html`);
} finally {
  await browser.close();
  server.close();
}

const quarto = spawnSync("quarto", ["--version"], { encoding: "utf8" }).stdout.trim();
const machine = `${os.cpus()[0].model.trim()} (${os.cpus().length} threads)`;
const now = metrics(weights, timing);
const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
const timeouts = CPU.flatMap((r) => timing[`cpu${r}`] || []).filter((r) => r.open.timeout || r.close.timeout).length;

const lines = [
  "# Benchmark: panzoom against its baseline", "",
  `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC; Quarto ${quarto}; ${machine}; ` +
    `headless Chrome, no GPU; ${ROUNDS} rounds.`, "",
];
if (!base) lines.push("No baseline yet (`bench/baseline.json`): run `node bench.mjs --save` to save this run as one.", "");
else {
  lines.push(`Baseline: ${base.date} UTC; Quarto ${base.quarto}; ${base.machine}.`, "");
  if (base.machine !== machine) {
    lines.push(`**Warning:** the baseline was measured on another machine; times are not comparable. ` +
      "Save a new baseline here (`--save`) before relying on them.", "");
  }
}
if (renderTimes) {
  lines.push("## Render (`quarto render`, R included; not checked)", "",
    "| | Median | Fastest |", "|---|---|---|",
    `| Now | ${ms(median(renderTimes))} | ${ms(Math.min(...renderTimes))} |`);
  if (base?.render) lines.push(`| Baseline | ${ms(base.render.median)} | ${ms(base.render.fastest)} |`);
  lines.push("");
}
const fmt = (v, kind) => (kind === "bytes" ? kb(v) : ms(v));
const regressions = [];
lines.push("## Checked",  "",
  `Times are medians; *first open* builds the viewer (median of ${ROUNDS} fresh page loads), the others ` +
  `are the median of the rest (${OPENS} images opened at each CPU speed). *Visible*: the first frame showing the viewer; ` +
  "*settled*: its image loaded, fully opaque and nothing moving. " +
  `A regression is more than ${Math.round((LIMITS.bytes.ratio - 1) * 100)}% heavier, or ` +
  `${LIMITS.time.ratio} times as long and over ${LIMITS.time.abs} ms ` +
  `(${LIMITS.slowTime.abs} ms for page load and the slowed CPU) longer.`, "",
  "| | Now | Baseline | Change | |", "|---|---|---|---|---|");
for (const [name, { value, kind }] of Object.entries(now)) {
  const b = base?.metrics?.[name]?.value;
  let change = "", verdict = "";
  if (value === null) verdict = "**no value**";
  else if (b !== undefined && b !== null) {
    const d = value - b, lim = LIMITS[kind];
    change = `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), kind)}` + (b ? ` (${d >= 0 ? "+" : "−"}${Math.abs(Math.round(100 * d / b))}%)` : "");
    const worse = value > b * lim.ratio && d > lim.abs;
    verdict = worse ? "**REGRESSION**" : "ok";
    if (worse) regressions.push(name);
  }
  lines.push(`| ${name} | ${fmt(value, kind)} | ${fmt(b, kind)} | ${change} | ${verdict} |`);
}
lines.push("", `- Viewer files: ${weights.files.map((f) => `\`${f}\``).join(", ")}`);
if (timeouts) lines.push(`- **${timeouts} opens or closes never settled** (10 s).`);
const failed = regressions.length > 0 || timeouts > 0;
lines.push("", failed
  ? `**FAILED:** ${[...regressions, ...(timeouts ? ["viewer never settled"] : [])].join("; ")}.`
  : base ? "No regressions." : "Nothing to compare with.", "");

const result = {
  date: new Date().toISOString().slice(0, 16).replace("T", " "), quarto, machine, rounds: ROUNDS,
  render: renderTimes && { median: median(renderTimes), fastest: Math.min(...renderTimes) },
  metrics: now,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ ...result, renderTimes, weights, timing }, null, 2));
console.log(lines.join("\n"));
console.log(`-> ${path.relative(process.cwd(), path.join(OUT, "report.md"))}`);
if (SAVE) {
  if (timeouts) {
    console.error("Not saved as the baseline: the viewer never settled in some runs.");
    process.exit(1);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(result, null, 2) + "\n");
  console.log(`Saved as the baseline: ${path.relative(process.cwd(), BASELINE)}`);
}
process.exit(failed && !SAVE ? 1 : 0);
