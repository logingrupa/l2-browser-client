import { readFileSync } from "node:fs";

export interface StaticMeshLightingFixture {
  readonly index: number;
  readonly hour: number;
  readonly environmentType: number;
  readonly rotation: readonly [pitch: number, yaw: number, roll: number];
  readonly direction: readonly [number, number, number];
  readonly sunPlane: readonly [number, number, number, number];
  readonly ambientRGB: readonly [number, number, number];
  readonly vertexIndices: readonly number[];
  readonly instanceBGRA: readonly (readonly [number, number, number, number])[];
  readonly matrix: readonly number[];
}

export interface StaticMeshLightingFixtureMask {
  readonly light: number;
  readonly lightObject: string;
  readonly maskHex: string;
  readonly applied: number;
}

export interface StaticMeshLightingPillar {
  readonly actorExportIndex: number;
  readonly instanceExportIndex: number;
  readonly meshObject: string;
  readonly vertexCount: number;
  readonly nativeNormals: readonly number[];
  readonly primaryColoursHex: string;
  readonly alternateColoursHex: string;
  readonly ordinaryMasks: readonly StaticMeshLightingFixtureMask[];
  readonly hourlyMasks: readonly StaticMeshLightingFixtureMask[];
}

export interface StaticMeshLightingFixtureDocument {
  readonly pillar: StaticMeshLightingPillar;
  readonly fixtures: readonly StaticMeshLightingFixture[];
}

const fixtureFile = new URL("../fixtures/environment/runtime-lighting-rm10-static-fixtures.json", import.meta.url);

export function readStaticMeshLightingFixtures(): StaticMeshLightingFixtureDocument {
  return JSON.parse(readFileSync(fixtureFile, "utf8")) as StaticMeshLightingFixtureDocument;
}

export function maskBytes(maskHex: string): Uint8Array {
  return Uint8Array.from(maskHex.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}
