/*
  Accessibility checks with axe-core, at WCAG 2.2 AAA plus axe's best
  practices: every rule tagged wcag2a, wcag2aa, wcag2aaa, wcag21a, wcag21aa,
  wcag22aa, or best-practice (axe-core has no rules tagged for WCAG 2.1 or
  2.2 AAA). Rules axe turns off by default, such as the AAA contrast rule,
  are named so they run too.

  Opens each rendered page in headless Chrome, once per color scheme, and
  runs axe on the whole page, then again on the viewer, opened on the
  page's first selected image. Each violation is listed once per rule, with
  how many elements it hit and one of them.

  Results axe can't decide ("incomplete", such as a code block that may
  scroll sideways without keyboard access) are listed as "needs review".

  Only panzoom's own markup fails the check: the viewer, the link panzoom
  puts around each selected image, and the hidden description blocks.
  Everything else (the theme, Quarto's page layout, lightbox, the example
  content) is listed as a page finding and doesn't fail it.

  The same check can run in Quarto itself (`axe: standard: wcag22aaa`,
  `best-practice: true`) from a newer Quarto than 1.9; Quarto's check never
  sees the viewer, which only exists once an image is opened.

  Usage: render first, then from tests/:
    npm run a11y                                  # every test page and index
    node a11y.mjs ../docs/tests/pages/h-wide.html ...
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const RULES = require("axe-core").getRules(TAGS).map((r) => r.ruleId);

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

// panzoom's own markup (see the header): the link itself, not the author's
// image inside it.
const OWNED = ".panzoom-overlay, .panzoom-desc";
const OWNED_SELF = "a.panzoom-link";

// Runs axe in the page on `include` (a selector, or the whole document),
// splitting each rule's elements into panzoom's own and the rest.
async function scan(page, include) {
  return page.evaluate(async (include, rules, owned) => {
    const r = await window.axe.run(include ? { include: [include] } : document,
      { runOnly: { type: "rule", values: rules }, resultTypes: ["violations", "incomplete"] });
    const out = [];
    for (const v of r.violations.concat(r.incomplete.map((x) => ({ ...x, review: true })))) {
      const parts = { own: [], other: [] };
      for (const n of v.nodes) {
        const el = document.querySelector(n.target.join(" "));
        (el && (el.closest(owned[0]) || el.matches(owned[1])) ? parts.own : parts.other).push(n.target.join(" "));
      }
      for (const [k, nodes] of Object.entries(parts)) {
        if (nodes.length) out.push({ own: k === "own" && !v.review, review: !!v.review, id: v.id, impact: v.impact, help: v.help, count: nodes.length, example: nodes[0] });
      }
    }
    return out;
  }, include, RULES, [OWNED, OWNED_SELF]);
}

function lines(where, violations) {
  return violations.map((v) =>
    `  ${v.review ? where + ", needs review" : where}: ${v.id} (${v.impact}), ${v.count}x: ${v.help}; e.g. ${v.example}`);
}

async function checkPage(browser, base, file, dark) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((d) => {
    try { localStorage.setItem("quarto-color-scheme", d ? "alternate" : "default"); } catch (e) {}
  }, dark);
  await page.goto(base + path.relative(SITE, file).split(path.sep).join("/"), { waitUntil: "networkidle0" });
  await page.addScriptTag({ path: AXE });
  const scheme = await page.evaluate(() => document.body.classList.contains("quarto-dark") ? "dark" : "light");
  const found = await scan(page, null);
  const out = lines("PANZOOM", found.filter((v) => v.own));
  const notes = lines("page", found.filter((v) => !v.own));
  let viewer = "no viewer";
  const img = await page.$(".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)");
  if (img) {
    await img.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await img.click();
    await page.waitForSelector(".panzoom-overlay.open", { timeout: 5000 }).catch(() => {});
    if (await page.$(".panzoom-overlay.open")) {
      const inViewer = await scan(page, ".panzoom-overlay");
      out.push(...lines("VIEWER", inViewer.filter((v) => !v.review)));
      notes.push(...lines("viewer", inViewer.filter((v) => v.review)));
      viewer = "viewer checked";
    } else {
      out.push("  viewer: DID NOT OPEN");
    }
  }
  await page.close();
  const name = path.relative(ROOT, file);
  const status = out.length ? `${out.length} RULE${out.length > 1 ? "S" : ""} FAILED` : "ok";
  console.log(`${name} (${scheme}): ${viewer}, ${status}${notes.length ? `, ${notes.length} page finding${notes.length > 1 ? "s" : ""}` : ""}`);
  for (const l of out.concat(notes)) console.log(l);
  return out.length;
}

const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
let failed = 0;
try {
  for (const dark of [false, true]) {
    for (const file of PAGES) failed += (await checkPage(browser, base, file, dark)) ? 1 : 0;
  }
  console.log(failed ? `${failed} of ${PAGES.length * 2} page checks FAILED` : `all ${PAGES.length * 2} page checks ok`);
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
