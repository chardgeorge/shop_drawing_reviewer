// Copies the Tesseract OCR engine and English language data into public/ocr so the
// grid-bubble reader runs fully offline in the browser. Runs automatically after
// `npm install` (postinstall). public/ocr is generated and git-ignored.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, "public", "ocr");

function packageDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const tesseract = packageDir("tesseract.js");
const core = packageDir("tesseract.js-core");
const data = packageDir("@tesseract.js-data/eng");
if (!tesseract || !core || !data) {
  console.warn("[ocr-assets] tesseract.js packages not installed; skipping OCR asset copy.");
  process.exit(0);
}

mkdirSync(target, { recursive: true });
cpSync(path.join(tesseract, "dist", "worker.min.js"), path.join(target, "worker.min.js"));
for (const file of readdirSync(core)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(file)) {
    cpSync(path.join(core, file), path.join(target, file));
  }
}
const language = path.join(data, "4.0.0_best_int", "eng.traineddata.gz");
if (existsSync(language)) cpSync(language, path.join(target, "eng.traineddata.gz"));
console.log(`[ocr-assets] OCR engine and English data copied to ${path.relative(root, target)}`);
