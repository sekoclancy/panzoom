/*
  Runs every npm script in package.json, in its order, except the ones in
  SKIP; stops at the first suite that fails. A new suite runs here without
  being listed.

  Usage, from tests/ (after `quarto render` from the repo root):
    npm run all
*/
import { execSync } from "node:child_process";
import fs from "node:fs";

// Machine-dependent (bench), Linux only and slow (offline), or not a test.
const SKIP = ["all", "bench", "bench:save", "offline", "demo"];

const { scripts } = JSON.parse(fs.readFileSync(new URL("package.json", import.meta.url)));
for (const name of Object.keys(scripts).filter((n) => !SKIP.includes(n))) {
  console.log(`\n== npm run ${name}`);
  try {
    execSync(`npm run -s ${name}`, { stdio: "inherit" });
  } catch {
    console.log(`\nnpm run ${name} FAILED`);
    process.exit(1);
  }
}
