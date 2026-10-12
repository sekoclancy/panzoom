/*
  No-JavaScript fallback checks for the panzoom extension.

  Quarto's lightbox wraps each image in a link to the image file, so with
  JavaScript off (blocked, broken, or not loaded yet) a click still shows
  the full image. panzoom does the same with an `a.panzoom-link` wrapper
  that the viewer intercepts when JavaScript runs.

  Opens each rendered page in headless Chrome with JavaScript disabled and
  checks every image the viewer would open (`.panzoom img`, `img.panzoom`,
  not `.nopanzoom`):
    - it sits in an `a.panzoom-link` whose href is the image's own file,
      or in an author's link, which is left alone;
    - clicking it (pages served over http) goes to that file, or to the
      author's link target.
  Quarto's lightbox images (`a.lightbox`) are counted for comparison.

  Usage: render first, then from tests/:
    npm run nojs                                  # the test pages and standalone pages
    node nojs.mjs ../docs/tests/pages/b-panzoom-lightbox.html ...

  Self-contained pages (embed-resources) are opened from file:// and only
  their links are checked: Chrome won't open a data: URL from a link click.
  There the image is embedded but the link still points at the deleted
  `*_files/` copy, as Quarto's lightbox links do (panzoom.lua can't tell
  the page is self-contained). Such dead links are reported, for panzoom
  and lightbox images alike, but don't fail the run.
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const PAGES = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : [
    ...fs.readdirSync(path.join(ROOT, "docs", "tests", "pages"))
      .filter((f) => f.endsWith(".html")).map((f) => path.join(ROOT, "docs", "tests", "pages", f)),
    ...fs.readdirSync(path.join(HERE, "standalone"))
      .filter((f) => f.endsWith(".html")).map((f) => path.join(HERE, "standalone", f)),
  ];

// Same test as browser.mjs: no script or stylesheet files of its own.
function selfContained(file) {
  return !/<(script|link)\b[^>]*\s(src|href)="(?!data:|https?:|\/\/|#)/i.test(fs.readFileSync(file, "utf8"));
}

// Minimal static file server for the repo, as in browser.mjs.
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

// A file:// link to a file that doesn't exist.
const dead = (href) => href.startsWith("file:") && !fs.existsSync(fileURLToPath(href));

const short = (u) => (u && u.length > 80 ? u.slice(0, 80) + "..." : u);

async function checkPage(browser, base, file) {
  const url = selfContained(file)
    ? pathToFileURL(file).href
    : base + path.relative(ROOT, file).split(path.sep).join("/");
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.goto(url, { waitUntil: "load" });

  // Runs through DevTools, so it works with the page's scripts disabled.
  const images = await page.evaluate(() => {
    const marked = [...document.querySelectorAll(".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)")];
    marked.forEach((img, i) => { img.dataset.nojsIdx = i; });
    return {
      // `panzoom: false`: the filter is off, so marked images get no link
      // (and the page has no panzoom options script).
      off: ![...document.scripts].some((s) => s.textContent.includes("PANZOOM_OPTIONS")),
      lightbox: [...document.querySelectorAll("a.lightbox")].filter((a) => a.querySelector("img")).map((a) => a.href),
      marked: marked.map((img, i) => {
        const a = img.closest("a[href]");
        const sec = img.closest("section[id]");
        return {
          idx: i,
          where: sec ? sec.id : "",
          src: img.src,
          wrapper: !a ? "none" : a.classList.contains("panzoom-link") ? "panzoom-link"
            : a.classList.contains("lightbox") ? "lightbox" : "author",
          href: a ? a.href : null,
        };
      }),
    };
  });

  const results = [];
  for (const img of images.marked) {
    const r = { ...img, problems: [] };
    if (images.off) {
      if (img.wrapper === "panzoom-link") r.problems.push("linked, though panzoom is off");
      results.push(r);
      continue;
    }
    if (img.wrapper === "none") r.problems.push("no link");
    else if (img.wrapper === "lightbox") r.problems.push("in a lightbox link");
    else if (img.wrapper === "panzoom-link" && img.href !== img.src) {
      // Self-contained: the image is a data: URL, the link its source file,
      // which may or may not still exist next to the page.
      if (url.startsWith("file:") && img.src.startsWith("data:")) r.dead = dead(img.href);
      else r.problems.push("href is not the image");
    }

    // Click it and see where the browser goes.
    if (!url.startsWith("file:") && img.wrapper !== "none") {
      await page.goto(url, { waitUntil: "load" });
      const handle = await page.$(`img[data-nojs-idx="${img.idx}"]`);
      if (!handle) {
        // The index is set by evaluate() above, and lost on reload: set it again.
        await page.evaluate(() => document.querySelectorAll(".panzoom img:not(.nopanzoom), img.panzoom:not(.nopanzoom)")
          .forEach((el, i) => { el.dataset.nojsIdx = i; }));
      }
      const h = await page.$(`img[data-nojs-idx="${img.idx}"]`);
      await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = await h.boundingBox();
      if (!box || box.width < 2) {
        r.clicked = "not visible";
      } else {
        const [resp] = await Promise.all([
          page.waitForNavigation({ timeout: 3000 }).catch(() => null),
          page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
        ]);
        r.clicked = page.url() === url ? "nothing" : page.url();
        if (resp === null && r.clicked === "nothing") r.problems.push("click did nothing");
        else if (r.clicked !== img.href) r.problems.push("click went elsewhere");
      }
    }
    results.push(r);
  }
  await page.close();
  const lightboxDead = url.startsWith("file:") ? images.lightbox.filter(dead).length : 0;
  return { name: path.relative(ROOT, file), off: images.off, lightbox: images.lightbox.length, lightboxDead, results };
}

const server = await serve(ROOT);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});
let failed = 0;
try {
  const runs = PAGES.map((f) => checkPage(browser, base, f));
  for (const run of runs) {
    const { name, off, lightbox, lightboxDead, results } = await run;
    const bad = results.filter((r) => r.problems.length);
    failed += bad.length;
    const counts = results.reduce((a, r) => ((a[r.wrapper] = (a[r.wrapper] || 0) + 1), a), {});
    const deadNote = results.some((r) => r.dead) || lightboxDead
      ? `, dead links (self-contained, as Quarto's lightbox): ${results.filter((r) => r.dead).length} panzoom, ${lightboxDead} lightbox`
      : "";
    console.log(`${name}: ${results.length} panzoom images ${JSON.stringify(counts)}${off ? " (panzoom off: no links expected)" : ""}, ${lightbox} lightbox images${deadNote}, ` +
      (bad.length ? `${bad.length} FAILED` : "ok"));
    for (const r of bad) {
      console.log(`  #${r.where} ${short(r.src.split("/").pop())}: ${r.problems.join(", ")}` +
        (r.clicked ? ` (went to ${short(r.clicked)})` : ""));
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
