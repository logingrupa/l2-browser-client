import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Rm12FloorFixture {
  readonly primitive: "Terrain" | "BSP";
  readonly branch: "downward-settle" | "close-floor-upward";
  readonly floorZ: number;
  readonly CollisionHeight: number;
  readonly geometricBottomGapNominal: number;
  readonly reportedProbeGapNominal: number;
  readonly locationZNominal: number;
}

export interface Rm12GroundSpawnConstant {
  readonly va: string;
  readonly double: number;
}

interface Rm12PawnFloorPlacementDocument {
  readonly floorPolicy: { readonly probeLength: number; readonly minimumReportedGap: number; readonly maximumReportedGap: number; readonly upwardTargetReportedGap: number };
  readonly floorFixtures: readonly Rm12FloorFixture[];
  readonly groundSpawnConstants: readonly Rm12GroundSpawnConstant[];
}

const fixturePath = fileURLToPath(new URL("./pawn-floor-placement-rm12.json", import.meta.url));

export const rm12PawnFloorPlacement = JSON.parse(readFileSync(fixturePath, "utf8")) as Rm12PawnFloorPlacementDocument;

export function rm12FloorFixture(primitive: Rm12FloorFixture["primitive"], branch: Rm12FloorFixture["branch"]): Rm12FloorFixture {
  const fixture = rm12PawnFloorPlacement.floorFixtures.find(row => row.primitive === primitive && row.branch === branch);
  if (fixture === undefined) throw new Error(`pawn-floor-placement-rm12.json holds no ${primitive} ${branch} fixture.`);
  return fixture;
}
