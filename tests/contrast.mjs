/*
  Text contrast checks for the test site, in light and dark mode.

  Opens each rendered page in headless Chrome, once per color scheme
  (Quarto's toggle, set through its localStorage key before the page
  loads), and measures the WCAG contrast ratio of every visible piece of
  text in the page content and, with the first marked image opened, in
  the viewer: the text color against the background behind it, found by
  stacking the background colors of the element and its ancestors (alpha
  included). Text below 4.5:1 (3:1 for large text: 24 px, or 18.66 px
  bold) is reported, grouped by element and colors.

  The viewer must also follow the page's theme, as Quarto's lightbox
  does: its caption band takes the page's background and text colors
  (`theme ok`; `THEME FAILED` names the colors that differ).

  Not measured: text over images or gradients, typeset math (MathJax,
  KaTeX), and Quarto's page chrome (navbar, sidebar, footer).

  Usage: render first, then from tests/:
    npm run contrast                                  # every test page and index
    node contrast.mjs ../docs/tests/pages/h-wide.html ...
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SITE = path.join(ROOT, "docs");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const PAGES = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : [path.join(SITE, "index.html"),
    ...fs.readdirSync(path.join(SITE, "tests", "pages"))
      .filter((f) => f.endsWith(".html")).map((f) => path.join(SITE, "tests", "pages", f))];

// Minimal static file server for the rendered site, as in browser.mjs.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".gif": "image/gif", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
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

// Runs in the page: low-contrast text under `root`, grouped.
function measure(rootSelector) {
  // rgb()/rgba() in 0-255, or color(srgb r g b / a) in 0-1 (what color-mix() computes to).
  const parse = (s) => {
    const v = (s.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number);
    const k = s.startsWith("color(") ? 255 : 1;
    return { c: v.slice(0, 3).map((x) => x * k), a: v.length > 3 ? v[3] : 1 };
  };
  const over = (top, bottom) => bottom.map((x, i) => x * (1 - top.a) + top.c[i] * top.a);
  const lum = (rgb) => { const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const background = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let bg = [255, 255, 255];
    for (const e of chain) bg = over(parse(getComputedStyle(e).backgroundColor), bg);
    return bg;
  };
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => "." + c).join("") +
    (el.parentElement ? " in " + el.parentElement.tagName.toLowerCase() + [...el.parentElement.classList].slice(0, 1).map((c) => "." + c).join("") : "");
  const groups = new Map();
  let checked = 0;
  for (const root of document.querySelectorAll(rootSelector)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      const el = n.parentElement;
      if (!text || !el || el.closest("mjx-container, .katex, math, svg, script, style, noscript, [hidden], .panzoom-desc")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || !el.getClientRects().length) continue;
      checked++;
      const color = parse(cs.color);
      const bg = background(el);
      const r = ratio(over(color, bg), bg);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (r >= need) continue;
      const key = `${name(el)}: ${cs.color} on rgb(${bg.map(Math.round).join(", ")})`;
      const g = groups.get(key) || { key, ratio: r, need, count: 0, sample: text.slice(0, 40) };
      g.count++; g.ratio = Math.min(g.ratio, r);
      groups.set(key, g);
    }
  }
  return { checked, low: [...groups.values()] };
}

async function checkPage(browser, base, file, dark) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((d) => {
    try { localStorage.setItem("quarto-color-scheme", d ? "alternate" : "default"); } catch (e) {}
  }, dark);
  await page.goto(base + path.relative(SITE, file).split(path.sep).join("/"), { waitUntil: "networkidle0" });
  const scheme = await page.evaluate(() => document.body.classList.contains("quarto-dark") ? "dark" : "light");
  const main = await page.evaluate(measure, "main");
  const found = main.low.map((g) => ({ ...g, where: "page" }));
  const checked = { page: main.checked, viewer: 0 };
  let theme = null;
  // The viewer, on the first image that opens it.
  const img = await page.$(".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)");
  if (img) {
    await img.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await img.click();
    await new Promise((r) => setTimeout(r, 300));
    if (await page.$(".panzoom-overlay.open")) {
      const viewer = await page.evaluate(measure, ".panzoom-overlay.open");
      // The caption band in the page's colors (what the viewer shows over
      // the page, not the band's own declared value).
      theme = await page.evaluate(() => {
        // Pages that restyle the viewer (panzoom's colour options, or their own
        // --panzoom-* rules) are not expected to follow the theme.
        const restyled = [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some((r) => r.selectorText && r.selectorText !== ":where(.panzoom-overlay)" &&
              [...(r.style || [])].some((p) => p.startsWith("--panzoom-")));
          } catch { return false; }
        });
        if (restyled) return "restyled";
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const body = cs("body"), band = cs(".panzoom-overlay.open .panzoom-footer");
        const cap = cs(".panzoom-overlay.open .panzoom-caption");
        const diffs = [];
        if (band.backgroundColor !== body.backgroundColor) diffs.push(`band ${band.backgroundColor}, page ${body.backgroundColor}`);
        if (cap.color !== body.color) diffs.push(`caption ${cap.color}, page text ${body.color}`);
        return diffs;
      });
      checked.viewer = viewer.checked;
      found.push(...viewer.low.map((g) => ({ ...g, where: "viewer" })));
    }
  }
  await page.close();
  return { name: path.relative(ROOT, file), scheme, checked, found, theme };
}

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let failed = 0;
try {
  for (const dark of [false, true]) {
    const runs = PAGES.map((f) => checkPage(browser, base, f, dark));
    for (const run of runs) {
      const { name, scheme, checked, found, theme } = await run;
      failed += found.length + (Array.isArray(theme) && theme.length ? 1 : 0);
      const themeNote = theme === null ? "" : theme === "restyled" ? ", theme n/a (restyled)" :
        theme.length ? `, THEME FAILED (${theme.join("; ")})` : ", theme ok";
      console.log(`${name} (${scheme}): ${checked.page} text runs on the page, ${checked.viewer} in the viewer${themeNote}, ` +
        (found.length ? `${found.length} LOW CONTRAST` : "ok"));
      for (const g of found.sort((a, b) => a.ratio - b.ratio)) {
        console.log(`  ${g.where}: ${g.key}, ${g.ratio.toFixed(2)}:1 (needs ${g.need}), ${g.count}x, e.g. "${g.sample}"`);
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
