import type { Page, Route } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeResourceUrl } from "../../../src/assets/native/nativeResourceUrl";

export interface TwoLaneStoreNames { readonly windowLane: string; readonly tileLane: string }

interface LaneCatalog { readonly tiles?: readonly { readonly id: string }[]; readonly [slice: string]: unknown }

const nativeResourcePrefix = "/l2/";
const catalogPath = "/l2/catalog.json";
const coveragePath = "/l2/coverage.json";
const mainStoreRoot = resolve("public/l2");

function laneStoreRoot(laneName: string): string {
  return resolve("artifacts/lane-store", laneName, "l2");
}

function readLaneCatalog(laneName: string): LaneCatalog {
  return JSON.parse(readFileSync(resolve(laneStoreRoot(laneName), "catalog.json"), "utf8")) as LaneCatalog;
}

function twoLaneCatalog(lanes: TwoLaneStoreNames): LaneCatalog {
  const windowCatalog = readLaneCatalog(lanes.windowLane);
  const windowTiles = windowCatalog.tiles ?? [];
  const laneTiles = readLaneCatalog(lanes.tileLane).tiles ?? [];
  const windowTileIds = new Set(windowTiles.map(tile => tile.id));
  const duplicate = laneTiles.find(tile => windowTileIds.has(tile.id));
  if (duplicate !== undefined) throw new Error(`Lanes ${lanes.windowLane} and ${lanes.tileLane} both list tile ${duplicate.id}.`);
  return { ...windowCatalog, tiles: [...windowTiles, ...laneTiles] };
}

function isBoundedNativeResourcePath(path: string): boolean {
  try {
    nativeResourceUrl(path);
    return true;
  } catch {
    return false;
  }
}

function storedResourcePath(path: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    const candidate = resolve(root, path.slice(nativeResourcePrefix.length));
    if (candidate.startsWith(root) && existsSync(candidate)) return candidate;
  }
  return null;
}

export async function routeTwoLaneStores(page: Page, lanes: TwoLaneStoreNames): Promise<void> {
  const catalogBody = JSON.stringify(twoLaneCatalog(lanes));
  const roots = [laneStoreRoot(lanes.windowLane), laneStoreRoot(lanes.tileLane), mainStoreRoot];
  await page.route(url => url.pathname.startsWith(nativeResourcePrefix), async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === catalogPath) return route.fulfill({ status: 200, contentType: "application/json", body: catalogBody });
    if (path === coveragePath) return route.fulfill({ status: 404, body: "" });
    if (!isBoundedNativeResourcePath(path)) return route.fulfill({ status: 400, body: "" });
    const storedPath = storedResourcePath(path, roots);
    if (storedPath === null) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: readFileSync(storedPath) });
  });
}
