import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Read-only source; only the four existing outputs are copied, never reconverted.
const source = resolve(process.argv[2] ?? "C:/laragon/www/lineagen/.assets/converted");
const destination = resolve("public/assets/characters");
await mkdir(destination, { recursive: true });
const files = [];
for (const variant of ["MFighter", "FFighter", "MMagic", "FMagic"]) {
  const name = `${variant}.glb`;
  const bytes = await readFile(resolve(source, name));
  await copyFile(resolve(source, name), resolve(destination, name));
  files.push({ name, source: resolve(source, name), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(resolve(destination, "local-inventory.json"), JSON.stringify({ stagedAt: new Date().toISOString(), files }, null, 2));
console.log(`Staged ${files.length} unchanged GLBs in ${destination}. This directory is ignored by Git.`);
