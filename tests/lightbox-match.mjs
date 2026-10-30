/*
  Checks that the viewer looks like Quarto's lightbox where the two share a
  default: the backdrop, the colors of the caption band, and the caption
  and description text.

  Opens case 3 (one markdown image with a caption and a description) on the
  lightbox page (A) and on panzoom on marked images only (D), in light and
  dark mode (Quarto's toggle, set through its localStorage key before the
  page loads), and compares the computed styles. The layout is left out on
  purpose: panzoom pins the band to the screen edge, full width, where
  lightbox keeps it beside the image.

  Usage: render first, then from tests/:
    npm run lightbox
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

// The parts compared, as selectors in each viewer, and their properties.
const TEXT = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color"];
const PARTS = [
  { name: "backdrop", lightbox: ".goverlay", panzoom: ".panzoom-overlay.open", props: ["backgroundColor"] },
  { name: "band", lightbox: ".gslide.current .gslide-description", panzoom: ".panzoom-overlay.open .panzoom-panel",
    props: ["backgroundColor", "color"] },
  { name: "caption", lightbox: ".gslide.current .gslide-title", panzoom: ".panzoom-overlay.open .panzoom-caption",
    props: TEXT },
  { name: "description", lightbox: ".gslide.current .gslide-desc", panzoom: ".panzoom-overlay.open .panzoom-description",
    props: TEXT },
];

// Opens case 3 on a page and reads each part's styles.
async function styles(browser, url, dark, which) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument((d) => {
    try { localStorage.setItem("quarto-color-scheme", d ? "alternate" : "default"); } catch (e) {}
  }, dark);
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("section[data-number='3'] img").click());
  await wait(1200);
  const out = await page.evaluate((parts, which) => {
    const dark = document.body.classList.contains("quarto-dark");
    const read = {};
    for (const p of parts) {
      const el = document.querySelector(p[which]);
      const c = el && getComputedStyle(el);
      read[p.name] = c && Object.fromEntries(p.props.map((k) => [k, c[k]]));
    }
    return { dark, read };
  }, PARTS, which);
  await page.close();
  return out;
}

const results = [];
const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/examples/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    const lb = await styles(browser, base + "a-lightbox-r.html", dark, "lightbox");
    const pz = await styles(browser, base + "d-selecting-r.html", dark, "panzoom");
    results.push({ name: `${mode} mode`, ok: lb.dark === dark && pz.dark === dark,
      detail: `lightbox page ${lb.dark ? "dark" : "light"}, panzoom page ${pz.dark ? "dark" : "light"}` });
    for (const p of PARTS) {
      const a = lb.read[p.name], z = pz.read[p.name];
      const diff = !a || !z ? ["not found"] : p.props.filter((k) => a[k] !== z[k]).map((k) => `${k} ${a[k]} vs ${z[k]}`);
      results.push({ name: `${mode} ${p.name}`, ok: diff.length === 0,
        detail: diff.length ? `lightbox vs panzoom: ${diff.join("; ")}` : p.props.map((k) => `${k} ${a[k]}`).join(", ") });
    }
  }
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "ok    " : "FAILED"}  ${r.name}: ${r.detail}`);
}
console.log(failed ? `${failed} of ${results.length} lightbox checks FAILED` : `all ${results.length} lightbox checks ok`);
process.exit(failed ? 1 : 0);
