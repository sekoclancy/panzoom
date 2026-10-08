/*
  Renders the standalone test pages, standalone/*.qmd, in place: each with
  `quarto render <page>.qmd --to html`, as a plain document with its
  options in its own YAML header.

  They aren't part of the website: standalone/ isn't in the project's
  `render:` list, so Quarto renders them without its layout. Quarto looks
  for the extension next to such a page, so standalone/_extensions is a
  symlink to the repo's _extensions/. Files starting with `_` are the
  shared page bodies the pages include.

    self-contained.qmd        embed-resources: true
    self-contained-math.qmd   ... plus self-contained-math: true
    self-contained-lightbox.qmd  self-contained.qmd with Quarto's lightbox
    math-<method>.qmd         each html-math-method

  Usage, from tests/:
    node standalone.mjs              # render
    node standalone.mjs --offline    # render with no network access (Linux:
                                     # in a new network namespace, `unshare -rn`)
  then check them with
    node browser.mjs standalone/*.html

  Quarto's warnings (for example a resource it couldn't fetch) are printed.
*/
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "standalone");
const OFFLINE = process.argv.includes("--offline");
const PAGES = fs.readdirSync(DIR).filter((f) => f.endsWith(".qmd") && !f.startsWith("_")).sort();

if (OFFLINE && spawnSync("unshare", ["-rn", "true"]).status !== 0) {
  console.error("--offline needs `unshare -rn` (Linux, with unprivileged user namespaces).");
  process.exit(1);
}

// Each page has its own output and _files folder, so they render in parallel.
function render(page) {
  const args = ["render", page, "--to", "html"];
  const [cmd, argv] = OFFLINE ? ["unshare", ["-rn", "quarto", ...args]] : ["quarto", args];
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { cwd: DIR });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    p.on("close", (code) => resolve({ page, code, log }));
  });
}

let failed = false;
for (const { page, code, log } of await Promise.all(PAGES.map(render))) {
  if (code !== 0) {
    failed = true;
    console.log(`${page}: RENDER FAILED (exit ${code})\n${log}`);
    continue;
  }
  const warnings = log.split("\n").filter((l) => /WARN/.test(l)).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim());
  console.log(`${page}: rendered${OFFLINE ? " offline" : ""}, ${warnings.length} warnings` +
    warnings.map((w) => `\n  ${w}`).join(""));
}
if (failed) process.exit(1);
