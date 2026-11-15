import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function stagedNativeTerrainPath(): string {
  const catalog = JSON.parse(readFileSync(resolve("public/l2/catalog.json"), "utf8")) as { sections: { id: string; manifest: string; manifestSha256: string }[] };
  const section = catalog.sections.find(item => item.id === "map-20-20-section");
  if (!section) throw new Error("The staged native world section is missing.");
  const manifest = JSON.parse(readFileSync(resolve("public", section.manifest.slice(1)), "utf8")) as { terrain: { file: string } };
  return `/l2/maps/${section.manifestSha256}/map-section/${manifest.terrain.file}`;
}
