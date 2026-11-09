import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const fixtureLaneStoreRoot = join(process.cwd(), "tests", "fixtures", "lane-store", "l2");
export const fixtureTileId = "00_00";

export interface NativeTileFixtureFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentAddressedFixtureFile(parent: string, leaf: string): NativeTileFixtureFile {
  const folders = readdirSync(join(fixtureLaneStoreRoot, parent)).filter(folder => existsSync(join(fixtureLaneStoreRoot, parent, folder, leaf)));
  if (folders.length !== 1) throw new Error(`The fixture lane store must hold exactly one ${parent}/<sha256>/${leaf}.`);
  const sha256 = folders[0]!, bytes = new Uint8Array(readFileSync(join(fixtureLaneStoreRoot, parent, sha256, leaf)));
  if (sha256Hex(bytes) !== sha256) throw new Error(`Fixture ${parent}/${sha256}/${leaf} is not content addressed.`);
  return { path: `/l2/${parent}/${sha256}/${leaf}`, sha256, bytes };
}

export function readFixtureTileFiles() {
  return {
    tile: contentAddressedFixtureFile("tiles", "tile.json"),
    chunk: contentAddressedFixtureFile("maps", "native-tile-chunk-runtime/manifest.json"),
    terrain: contentAddressedFixtureFile("maps", "native-tile-chunk-terrain/terrain.glb"),
  };
}

export function decodeJsonDocument(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function jsonBytes(document: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(document));
}
