/*
  Browser checks for the panzoom extension.

  Opens each rendered test page in headless Chrome, clicks every image in every
  `## N. ...` section, and records what opened: the panzoom viewer, GLightbox,
  a link navigation, or nothing. For the panzoom viewer it also tries wheel
  zoom, drag, Esc and a background click; for GLightbox it records the slide
  title, description and gallery size. Console errors are collected per page.
  Then, with the viewer open, checks that keys don't reach the page (as
  focus-mode's and Quarto search's shortcuts would), that Ctrl+key still
  does, and that a fixed widget at z-index 10000 stays below the viewer.

  Usage (from tests/):
    npm run render && npm test         # renders the project to ../docs/, then checks the test pages
    node browser.mjs ../docs/tests/pages/d-panzoom-selective.html ...   # checks the given pages

  Pages are served from ../docs/ by a small built-in web server, as GitHub
  Pages would serve them: Quarto's scripts are JavaScript modules, which
  browsers refuse to load from file:// URLs.

  Output: results/<page>/report.md, results/<page>/results.json and one
  screenshot per image (results/<page>/<case>-<n>.png).

  Chrome: Quarto's `chrome-headless-shell` (`quarto install chrome-headless-shell`),
  or set CHROME=/path/to/chrome.
*/
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHROME = process.env.CHROME || path.join(os.homedir(),
  ".local/share/quarto/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell");
const PAGES = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : ["a-lightbox.html", "c-panzoom-auto.html", "d-panzoom-selective.html"]
      .map((p) => path.join(ROOT, "docs", "tests", "pages", p));
const VIEWPORT = { width: 1280, height: 900 };
const SITE = path.join(ROOT, "docs");

// Minimal static file server for docs/.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse Panzoom's `scale(s) translate(x px, y px)` on the viewer image. The
// translate is in unscaled px, so x and y are multiplied by s to give the
// on-screen offset.
async function viewerTransform(page) {
  return page.evaluate(() => {
    const img = document.querySelector(".panzoom-overlay img");
    const m = img && /scale\(([-\d.e]+)\)\s*translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(img.style.transform);
    return m ? { x: +m[1] * +m[2], y: +m[1] * +m[3], s: +m[1] } : null;
  });
}

async function state(page) {
  return page.evaluate(() => {
    const pz = document.querySelector(".panzoom-overlay.open");
    const glb = document.querySelector(".glightbox-container");
    if (pz) return { opened: "panzoom" };
    if (glb) {
      const slide = glb.querySelector(".gslide.current");
      const text = (sel) => slide?.querySelector(sel)?.textContent.trim() || "";
      return {
        opened: "glightbox",
        title: text(".gslide-title"),
        description: text(".gslide-desc"),
        slides: glb.querySelectorAll(".gslide").length,
        skin: [...glb.classList].filter((c) => c !== "glightbox-container").join(" "),
      };
    }
    return { opened: "nothing" };
  });
}

// Close whatever is open and wait for it to go away.
async function closeAll(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector(".panzoom-overlay.open") && !document.querySelector(".glightbox-container"),
    { timeout: 3000 }).catch(() => {});
  await sleep(200);
}

async function exercisePanzoom(page) {
  const out = {};
  const cx = VIEWPORT.width / 2, cy = VIEWPORT.height / 2;
  const fit = await viewerTransform(page);
  out.fitScale = fit?.s ?? null;

  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: -200 }); await sleep(30); }
  await sleep(100);
  const zoomed = await viewerTransform(page);
  out.wheelZoom = fit && zoomed ? +(zoomed.s / fit.s).toFixed(2) : null;

  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(100);
  const dragged = await viewerTransform(page);
  out.dragMoved = zoomed && dragged
    ? Math.round(Math.hypot(dragged.x - zoomed.x, dragged.y - zoomed.y)) : null;
  out.closedByDrag = (await state(page)).opened !== "panzoom";

  if (!out.closedByDrag) {
    await page.keyboard.press("0");
    await sleep(100);
    out.resetOk = (await viewerTransform(page))?.s === fit?.s;
    await page.keyboard.press("Escape");
    await sleep(100);
    out.escCloses = (await state(page)).opened !== "panzoom";
  }
  return out;
}

// With the viewer open, keys must not reach the page, and fixed widgets from
// other extensions must not paint above it. Mimics focus-mode (page arrows,
// f/t/p/d/l, PageUp/PageDown; z-index 10000) and Quarto search (f, s, / on
// keyup) with listeners registered after panzoom's, as a late-loading
// extension would.
const ISOLATION_KEYS = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "f", "t", "p", "d", "l", "s", "/", "Enter", " "];

async function checkIsolation(page, box) {
  await page.evaluate(() => {
    window.__leaked = [];
    const spy = (where) => (e) => window.__leaked.push(`${e.type} ${JSON.stringify(e.key)} (${where})`);
    for (const type of ["keydown", "keyup"]) {
      window.addEventListener(type, spy("window capture"), true);
      document.addEventListener(type, spy("document"));
    }
    const w = document.createElement("div");
    w.id = "test-fixed-widget";
    w.style.cssText = "position:fixed;left:16px;bottom:16px;width:44px;height:44px;z-index:10000;background:red";
    document.body.appendChild(w);
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(300);
  const out = { opened: (await state(page)).opened === "panzoom" };
  if (!out.opened) return out;

  for (const key of ISOLATION_KEYS) await page.keyboard.press(key);
  await sleep(100);
  out.leaked = await page.evaluate(() => window.__leaked.splice(0));
  out.stillOpen = (await state(page)).opened === "panzoom";

  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  out.modifierPasses = (await page.evaluate(() => window.__leaked.splice(0))).length > 0;

  out.widgetBelow = await page.evaluate(() => {
    const r = document.getElementById("test-fixed-widget").getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(top && top.closest(".panzoom-overlay"));
  });

  await page.keyboard.press("Escape");
  await sleep(200);
  out.escCloses = (await state(page)).opened !== "panzoom";
  await page.evaluate(() => document.getElementById("test-fixed-widget").remove());
  return out;
}

async function checkPage(browser, base, file) {
  const name = path.basename(file, ".html");
  const outDir = path.join(HERE, "results", name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(base + path.relative(SITE, file).split(path.sep).join("/"), { waitUntil: "load" });
  await sleep(500);

  // Record link navigations instead of following them. This listener runs in
  // the bubble phase on window, i.e. after the page's own handlers, so it only
  // sees clicks that nothing else (panzoom, GLightbox) has claimed.
  await page.evaluate(() => {
    window.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented) return;
      window.__navigatedTo = a.href;
      e.preventDefault();
    });
  });

  // Every image in a numbered case section, tagged so we can find it again.
  const images = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("section.level2").forEach((sec) => {
      const h = sec.querySelector("h2");
      const m = h && /^(\d+)\.\s*(.*)$/.exec(h.textContent.trim());
      if (!m) return;
      sec.querySelectorAll("img").forEach((img, i) => {
        const idx = out.length;
        img.dataset.testIdx = idx;
        const link = img.closest("a");
        out.push({
          idx, case: +m[1], caseTitle: m[2], n: i + 1,
          classes: img.className,
          wrapper: link ? (link.classList.contains("lightbox") ? "a.lightbox" : "a[href]") : "none",
          gallery: link?.dataset.gallery || null,
        });
      });
    });
    return out;
  });

  const results = [];
  for (const img of images) {
    const r = { ...img };
    const handle = await page.$(`img[data-test-idx="${img.idx}"]`);
    if (!handle) { r.opened = "missing from DOM"; results.push(r); continue; }
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    const box = await handle.boundingBox();
    if (!box || box.width < 2) { r.opened = "not visible"; results.push(r); continue; }

    await page.evaluate(() => { window.__navigatedTo = null; });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(900);  // GLightbox open animation
    Object.assign(r, await state(page));
    const navigatedTo = await page.evaluate(() => window.__navigatedTo);
    if (navigatedTo && r.opened === "nothing") r.opened = "navigation", r.navigatedTo = navigatedTo;

    const shot = `c${String(img.case).padStart(2, "0")}-${img.n}.png`;
    await page.screenshot({ path: path.join(outDir, shot) });
    r.screenshot = shot;

    if (r.opened === "panzoom") {
      Object.assign(r, await exercisePanzoom(page));
      // Background click: reopen, click the top-left corner.
      await closeAll(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(300);
      if ((await state(page)).opened === "panzoom") {
        await page.mouse.click(5, 5);
        await sleep(200);
        r.backgroundCloses = (await state(page)).opened !== "panzoom";
      }
    }
    await closeAll(page);
    results.push(r);
  }

  // Viewer isolation, on the first image that opens the viewer.
  let isolation = null;
  const first = results.find((r) => r.opened === "panzoom");
  if (first) {
    const handle = await page.$(`img[data-test-idx="${first.idx}"]`);
    await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(150);
    isolation = await checkIsolation(page, await handle.boundingBox());
    isolation.image = `${first.case}. ${first.caseTitle} (img ${first.n})`;
  }

  await page.close();
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ file, errors, results, isolation }, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), report(file, errors, results, isolation));
  return { name, outDir, errors, results, isolation };
}

function isolationOk(iso) {
  return iso.opened && iso.leaked.length === 0 && iso.stillOpen && iso.modifierPasses && iso.widgetBelow && iso.escCloses;
}

function report(file, errors, results, isolation) {
  const yn = (v) => (v === undefined || v === null ? "" : v === true ? "yes" : v === false ? "NO" : String(v));
  const lines = [
    `# ${path.basename(file)}`, "",
    `Console errors: ${errors.length ? "" : "none"}`,
    ...errors.map((e) => `- \`${e}\``), "",
    "| Case | Img | Classes | Wrapper | Opened | Details | Zoom× | Drag px | Reset | Esc | Bg click |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const details = r.opened === "glightbox"
      ? `title: ${r.title || "—"}; desc: ${r.description || "—"}; slides: ${r.slides}`
      : r.opened === "navigation" ? r.navigatedTo : "";
    lines.push(`| ${r.case}. ${r.caseTitle} | ${r.n} | \`${r.classes}\` | ${r.wrapper} | **${r.opened}** | ` +
      `${details.replace(/\|/g, "\\|")} | ${yn(r.wheelZoom)} | ${yn(r.dragMoved)} | ${yn(r.resetOk)} | ` +
      `${yn(r.escCloses)} | ${yn(r.backgroundCloses)} |`);
  }
  lines.push("", "## Viewer isolation", "");
  if (!isolation) lines.push("No image opens the viewer on this page; skipped.");
  else {
    const yes = (v) => (v ? "yes" : "**NO**");
    lines.push(
      `Opened on case ${isolation.image}.`, "",
      `- Keys pressed: ${ISOLATION_KEYS.map((k) => `\`${k === " " ? "Space" : k}\``).join(", ")}`,
      `- Keys kept from the page: ${yes(isolation.leaked?.length === 0)}` +
        (isolation.leaked?.length ? ` (leaked: ${isolation.leaked.map((l) => `\`${l}\``).join(", ")})` : ""),
      `- Viewer still open after them: ${yes(isolation.stillOpen)}`,
      `- Ctrl+key still reaches the page: ${yes(isolation.modifierPasses)}`,
      `- A fixed widget at z-index 10000 stays below the viewer: ${yes(isolation.widgetBelow)}`,
      `- Esc closes: ${yes(isolation.escCloses)}`);
  }
  return lines.join("\n") + "\n";
}

for (const file of PAGES) {
  if (!file.startsWith(SITE + path.sep)) {
    console.error(`${file} is not inside ${SITE}; render the project and pass pages from docs/.`);
    process.exit(1);
  }
}
const server = await serve(SITE);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});
try {
  for (const file of PAGES) {
    const { name, outDir, errors, results, isolation } = await checkPage(browser, base, file);
    const counts = results.reduce((a, r) => ((a[r.opened] = (a[r.opened] || 0) + 1), a), {});
    const iso = isolation ? (isolationOk(isolation) ? "isolation ok" : "ISOLATION FAILED") : "isolation n/a";
    console.log(`${name}: ${results.length} images, ${JSON.stringify(counts)}, ` +
      `${errors.length} console errors, ${iso} -> ${path.relative(process.cwd(), outDir)}/report.md`);
  }
} finally {
  await browser.close();
  server.close();
}
