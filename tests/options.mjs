/*
  Checks panzoom's option errors: renders each page in options/*.qmd with
  `quarto render <page>.qmd --to html` and compares what panzoom reports
  with the page's `expect-errors:` list, line by line and in order (the
  "property name ...", "Field ..." and "ℹ ..." lines Quarto's own YAML
  errors also have). A page that expects errors must fail to render; one
  with `expect-errors: []` must render with none.

    valid.qmd          every option with a valid value
    document.qmd       mistakes in the document's panzoom: map
    top-level.qmd      a panzoom: value that isn't true, false, auto or a map
    cells-r.qmd        mistakes in knitr cells' #| panzoom:, and a div's panzoom=
    cells-python.qmd   the same in Jupyter cells

  options/_extensions is a symlink to the repo's _extensions/, as for
  standalone/. Usage, from tests/: node options.mjs
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "options");
const PAGES = fs.readdirSync(DIR).filter((f) => f.endsWith(".qmd")).sort();
// The Python page uses the repo's venv, as the site does (_environment).
const PYTHON = path.join(HERE, "..", ".venv", "bin", "python");
const env = fs.existsSync(PYTHON) ? { ...process.env, QUARTO_PYTHON: PYTHON } : process.env;

// The page's `expect-errors:` list: single-quoted YAML strings ('' is a quote).
function expected(page) {
  const head = fs.readFileSync(path.join(DIR, page), "utf8").split(/^---$/m)[1] || "";
  const m = /^expect-errors:(.*)$/m.exec(head);
  if (!m) return null;
  if (m[1].trim() === "[]") return [];
  const rest = head.slice(m.index + m[0].length).split("\n");
  const lines = [];
  for (const l of rest.slice(1)) {
    const item = /^\s+- '(.*)'\s*$/.exec(l);
    if (!item) break;
    lines.push(item[1].replace(/''/g, "'"));
  }
  return lines;
}

function render(page) {
  return new Promise((resolve) => {
    const p = spawn("quarto", ["render", page, "--to", "html"], { cwd: DIR, env });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    p.on("close", (code) => resolve({ page, code, log: log.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

let failed = 0;
for (const { page, code, log } of await Promise.all(PAGES.map(render))) {
  const want = expected(page);
  if (want === null) { failed++; console.log(`${page}: NO expect-errors LIST`); continue; }
  const got = log.split("\n").map((l) => l.trim()).filter((l) => /^(property name |Field "|ℹ )/.test(l));
  const problems = [];
  if (want.length === 0 && code !== 0) problems.push(`render failed (exit ${code})`);
  if (want.length > 0 && code === 0) problems.push("rendered, but should have failed");
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) problems.push(`line ${i + 1}: expected ${want[i] === undefined ? "nothing" : `"${want[i]}"`}, got ${got[i] === undefined ? "nothing" : `"${got[i]}"`}`);
  }
  if (problems.length) {
    failed++;
    console.log(`${page}: FAILED\n  ${problems.join("\n  ")}`);
    if (want.length === 0 && code !== 0) console.log(log);
  } else {
    console.log(`${page}: ${want.length ? `${((n) => `${n} error${n === 1 ? "" : "s"}`)(got.filter((l) => !l.startsWith("ℹ")).length)} reported, as expected; render stopped` : "rendered, no errors"}`);
  }
}
if (failed) process.exit(1);
