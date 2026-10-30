/*
  Checks the order of `#|` cell options in every .qmd of the repo, so the
  examples read alike: the option being demonstrated (panzoom, lightbox,
  classes) on the first line, then the label, how the cell runs, the figure
  settings, the layout, and the alt text and captions last. Markdown
  examples written as ```{{r}} count as cells too. A key with continuation
  lines (a nested map, a >- block, a list) counts as one option.

  Reads the sources, so no render is needed. Usage, from tests/:
    npm run order
*/
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = `panzoom lightbox classes
  label echo include output error cache
  fig-width fig-height fig-dpi dev dev.args fig-ext
  out-width fig-align fig-link fig-show animation.hook interval
  renderings column layout layout-ncol layout-nrow
  fig-alt fig-cap fig-subcap fig-cap-location`.split(/\s+/);
const RANK = new Map(ORDER.map((k, i) => [k, i]));
const KEY = /^#\|\s?([A-Za-z][\w.-]*):/;
const FENCE = /^```+\{\{?(r|python)/;

const files = execFileSync("git", ["ls-files", "*.qmd"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter(Boolean);
let failed = 0;
for (const file of files) {
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i])) continue;
    const start = i + 2;
    const keys = [];
    while (lines[i + 1]?.startsWith("#|")) {
      const m = lines[++i].match(KEY);
      if (m) keys.push(m[1]);
    }
    const unknown = keys.filter((k) => !RANK.has(k));
    const ranks = keys.map((k) => RANK.get(k));
    if (unknown.length) {
      console.log(`${file}:${start}: not in the order list: ${unknown.join(", ")}`);
      failed++;
    } else if (ranks.some((r, j) => j && r < ranks[j - 1])) {
      const want = [...keys].sort((a, b) => RANK.get(a) - RANK.get(b));
      console.log(`${file}:${start}: ${keys.join(", ")}\n  expected ${want.join(", ")}`);
      failed++;
    }
  }
}
console.log(failed ? `${failed} cells out of order` : `option order ok (${files.length} files)`);
if (failed) process.exitCode = 1;
