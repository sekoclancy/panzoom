/*
  Records the demo from the rendered demo page: a GIF for the README, and
  an MP4 with a poster image for the demo page.

  Opens docs/index.html in headless Chrome, plays a short scripted session
  (from the gallery: open its first image, wheel-zoom, drag,
  double-click to reset, next image, Esc; open the wide figure on its
  highlighted panel and pan with Ctrl plus the right and left arrow keys), with
  a drawn mouse pointer, since headless Chrome draws none, and a label
  naming each click, key, scroll, drag, and double-click, shown before
  the action so it never trails what it names. Frames come from Chrome's screencast, each with its own timestamp,
  so the GIF plays at the session's real speed.

  Usage: render first (`quarto render` from the repo root), then from tests/:
    npm run demo                 # writes ../images/demo.gif, demo.mp4, demo-poster.png

  Nothing re-records it on its own: run it again after changing the demo
  page (index.qmd) or how the viewer looks or behaves, and commit the three
  files.

  ffmpeg: from `imageio-ffmpeg` in the repo's .venv (`uv sync --group
  demo`, from the `demo` group in pyproject.toml), or set
  FFMPEG=/path/to/ffmpeg.

  Output: ../images/demo.gif, demo.mp4, and demo-poster.png (the first
  frame); frames in results/demo/.

  Chrome: as for browser.mjs.
*/
import { execFileSync } from "node:child_process";
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
const FRAMES = path.join(HERE, "results", "demo");
const OUT = path.join(ROOT, "images", "demo.gif");
const MP4 = path.join(ROOT, "images", "demo.mp4");
const POSTER = path.join(ROOT, "images", "demo-poster.png");
const VIEWPORT = { width: 960, height: 600 };
const GIF_WIDTH = 800;
const FPS = 10;

function ffmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const py = path.join(ROOT, ".venv", "bin", "python");
  return execFileSync(py, ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
    { encoding: "utf8" }).trim();
}

// Minimal static file server for the rendered site, as in browser.mjs.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
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

// Runs in the page: a drawn pointer that follows the mouse, with a ring on
// each press, and a label at the top for `window.__label(text)`. Appended
// to <html>, after <body>, so they stay above the viewer.
function addPointer() {
  const ptr = document.createElement("div");
  ptr.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30">' +
    '<path d="M1 1 L1 23 L7 18 L11 28 L15 26 L11 16 L19 16 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(ptr.style, { position: "fixed", left: "-50px", top: "-50px", zIndex: 2147483647,
    pointerEvents: "none", width: "22px", height: "30px" });
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "fixed", zIndex: 2147483646, pointerEvents: "none",
    width: "34px", height: "34px", margin: "-17px 0 0 -17px", borderRadius: "50%",
    border: "3px solid #ff9800", opacity: 0, transition: "opacity 0.35s, transform 0.35s" });
  const label = document.createElement("div");
  Object.assign(label.style, { position: "fixed", top: "14px", left: "50%", zIndex: 2147483647,
    transform: "translateX(-50%)", pointerEvents: "none", padding: "5px 14px", borderRadius: "6px",
    background: "rgba(20, 20, 20, 0.85)", color: "#fff", font: "600 17px system-ui, sans-serif",
    opacity: 0, transition: "opacity 0.2s" });
  let hide;
  window.__label = (text, ms) => {
    label.textContent = text; label.style.opacity = 1;
    clearTimeout(hide); hide = setTimeout(() => { label.style.opacity = 0; }, ms);
  };
  // The mouse leaving the window sends no pointermove: park it by hand.
  window.__hidePointer = () => { ptr.style.left = "-50px"; ptr.style.top = "-50px"; };
  document.documentElement.append(ring, ptr, label);
  window.addEventListener("pointermove", (e) => {
    ptr.style.left = e.clientX + "px"; ptr.style.top = e.clientY + "px";
  }, true);
  window.addEventListener("pointerdown", (e) => {
    ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px";
    ring.style.transition = "none"; ring.style.opacity = 1; ring.style.transform = "scale(0.5)";
    ring.offsetWidth;
    ring.style.transition = ""; ring.style.opacity = 0; ring.style.transform = "scale(1.4)";
  }, true);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const label = (page, text, ms = 900) => page.evaluate((t, m) => window.__label(t, m), text, ms);
const START = { x: VIEWPORT.width / 2, y: VIEWPORT.height + 40 };
let mouse = { ...START };

// Moves the mouse along an eased path, about 60 steps a second.
async function moveTo(page, x, y, ms = 600) {
  const from = { ...mouse };
  const n = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await wait(16);
  }
  mouse = { x, y };
}

// Center of an element, or a point at fractions (fx, fy) of its box.
async function pointIn(page, selector, fx = 0.5, fy = 0.5) {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  return { x: box.x + box.w * fx, y: box.y + box.h * fy };
}

// Smooth-scrolls the page so the element sits at `at` of the window height,
// or to the top with no element.
async function scrollToEl(page, selector, at = 0.3, behavior = "smooth") {
  await page.evaluate((selector, at, behavior) => {
    const y = selector
      ? document.querySelector(selector).getBoundingClientRect().top + window.scrollY - window.innerHeight * at
      : 0;
    window.scrollTo({ top: y, behavior });
  }, selector, at, behavior);
  // Wait for the scroll to settle: a fixed wait is too short for long scrolls.
  let last = -1;
  for (let y = await page.evaluate(() => window.scrollY); y !== last; y = await page.evaluate(() => window.scrollY)) {
    last = y; await wait(120);
  }
  await wait(150);
}

const isOpen = (page) => page.$eval(".panzoom-overlay", (o) => o.classList.contains("open")).catch(() => false);

const WIDE = "#wide-figure img";
const GALLERY = "#captions-and-galleries img";

async function session(page) {
  // 1. A gallery: open the first image, zoom, drag, reset, step to the
  // next image, close.
  await wait(600);
  let p = await pointIn(page, GALLERY, 0.42, 0.45);
  await moveTo(page, p.x, p.y, 500);
  await label(page, "click", 1000);
  await wait(400);
  await page.mouse.click(p.x, p.y);
  await wait(600);
  if (!(await isOpen(page))) throw new Error("viewer didn't open on the gallery");
  p = await pointIn(page, ".panzoom-overlay img", 0.35, 0.4);
  await moveTo(page, p.x, p.y, 400);
  await label(page, "scroll in", 1300);
  for (let i = 0; i < 7; i++) { await page.mouse.wheel({ deltaY: -120 }); await wait(110); }
  await wait(200);
  // Drag right, down, left and up, to show panning every way.
  await label(page, "drag", 1700);
  await page.mouse.down();
  await moveTo(page, mouse.x + 250, mouse.y, 380);
  await moveTo(page, mouse.x, mouse.y + 150, 320);
  await moveTo(page, mouse.x - 300, mouse.y, 420);
  await moveTo(page, mouse.x, mouse.y - 150, 320);
  await page.mouse.up();
  await wait(250);
  await label(page, "double-click");
  await page.mouse.click(mouse.x, mouse.y, { count: 2 });
  await wait(800);
  p = await pointIn(page, ".panzoom-next");
  await moveTo(page, p.x, p.y, 450);
  await label(page, "click", 1000);
  await wait(400);
  await page.mouse.click(p.x, p.y);
  await wait(800);
  await label(page, "Esc", 700);
  await page.keyboard.press("Escape");
  await wait(300);

  // 2. The wide figure: open on the highlighted panel, pan right, then left.
  await label(page, "scroll down", 1200);
  await scrollToEl(page, WIDE, 0.4);
  p = await pointIn(page, WIDE, 5.5 / 8, 0.55);
  await moveTo(page, p.x, p.y, 500);
  await label(page, "click", 1000);
  await wait(400);
  await page.mouse.click(p.x, p.y);
  await wait(700);
  if (!(await isOpen(page))) throw new Error("viewer didn't open on the wide figure");
  await label(page, "Ctrl+right", 800);
  await page.keyboard.down("Control");
  for (let i = 0; i < 2; i++) { await page.keyboard.press("ArrowRight"); await wait(150); }
  await page.keyboard.up("Control");
  await wait(300);
  await label(page, "Ctrl+left", 900);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowLeft"); await wait(150); }
  await page.keyboard.up("Control");
  await wait(400);
  await label(page, "Esc", 700);
  await page.keyboard.press("Escape");
  await wait(300);

  // 3. Back to the gallery, pointer off screen, so the loop is seamless.
  await label(page, "scroll up", 1200);
  await Promise.all([scrollToEl(page, GALLERY, 0.3), moveTo(page, START.x, START.y, 600)]);
  await page.evaluate(() => window.__hidePointer());
  await wait(200);
}

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
const server = await serve(SITE);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "networkidle0" });
  await page.evaluate(addPointer);
  await page.mouse.move(mouse.x, mouse.y);
  // Start at the gallery, where the session also ends, reached by scrolling
  // up, as at the end, so Quarto shows the navbar both times.
  await scrollToEl(page, GALLERY, 0.1, "instant");
  await wait(300);
  await scrollToEl(page, GALLERY, 0.3, "instant");
  await wait(500);

  // Screencast frames come only when the page changes, each with its time.
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1,
    maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
  await wait(300);
  await session(page);
  const end = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");

  // Concat list: each frame shows until the next one arrived.
  const t0 = frames[0].t;
  const t1 = frames.at(-1).t + Math.max(0.3, end - frames.at(-1).t - (Date.now() / 1000 - end));
  let list = "";
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(4, "0")}.png`;
    fs.writeFileSync(path.join(FRAMES, name), Buffer.from(f.data, "base64"));
    const next = i + 1 < frames.length ? frames[i + 1].t : t1;
    list += `file '${name}'\nduration ${(next - f.t).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(4, "0")}.png'\n`;
  fs.writeFileSync(path.join(FRAMES, "frames.txt"), list);
  console.log(`${frames.length} frames, ${(t1 - t0).toFixed(1)} s`);

  execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", path.join(FRAMES, "frames.txt"),
    "-vf", `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];` +
      "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop", "0", OUT], { stdio: "inherit" });
  console.log(`${path.relative(process.cwd(), OUT)}: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);

  // The demo page plays an MP4: smaller than the GIF at the full window
  // width, and a video can be paused. Tagged as sRGB, as the frames are,
  // or browsers on a Mac play it washed out.
  execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", path.join(FRAMES, "frames.txt"),
    "-vf", `fps=30,scale=${VIEWPORT.width}:-2:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", MP4], { stdio: "inherit" });
  execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-i", path.join(FRAMES, "f0000.png"),
    "-vf", `scale=${VIEWPORT.width}:-2`, POSTER], { stdio: "inherit" });
  console.log(`${path.relative(process.cwd(), MP4)}: ${(fs.statSync(MP4).size / 1e6).toFixed(2)} MB`);
} finally {
  await browser.close();
  server.close();
}
