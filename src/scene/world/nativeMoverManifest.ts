import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";

export const nativeMoverMapSha256 = "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4";
export interface MoverResource { file: string; sha256: string; bytes: number }
export interface NativeMoverRecord {
  id: string; modelId: string;
  serverObject: { realId: number; id: number; type: number };
  closedMatrix: number[]; openMatrix: number[]; moveTimeSeconds: number;
  initialKey: 0; initiallyClosed: true;
}
export interface NativeMoverManifest {
  schemaVersion: 1; kind: "native-map-movers";
  sourceMap: { packageSha256: string };
  models: { id: string; sourceObject: string; model: MoverResource; archive: MoverResource }[];
  movers: NativeMoverRecord[];
}
export interface TileMoverResource { readonly resource: string; readonly sha256: string; readonly bytes: number }
export interface NativeTileMoverModel { readonly id: string; readonly sourceObject: string; readonly archive: TileMoverResource; readonly model: TileMoverResource }
export interface NativeTileMoverCollision { readonly decision: string; readonly slots: readonly number[]; readonly evidence: readonly string[] }
export interface NativeTileMoverRecord extends NativeMoverRecord {
  actorName: string; exportIndex: number; collision: NativeTileMoverCollision;
}
export interface NativeTileMoverManifest {
  readonly kind: "native-tile-movers";
  readonly schemaVersion: 1;
  readonly tileId: string;
  readonly sourceMap: { readonly path: string; readonly sha256: string };
  readonly models: readonly NativeTileMoverModel[];
  readonly movers: readonly NativeTileMoverRecord[];
}
const hash = /^[a-f0-9]{64}$/;
const maximumMoverResourceBytes = 128 * 1024 * 1024;
const maximumMoverModels = 32;
const maximumMovers = 512;
const rigidTolerance = 1e-5;
const qualifiedSourceObject = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
export const moverObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const finiteMatrix = (value: unknown): value is number[] => Array.isArray(value) && value.length === 16 && value.every(n => typeof n === "number" && Number.isFinite(n));
const affineMatrix = (matrix: readonly number[]) => matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15] === 1;
const validMoveTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
function resource(value: unknown, name: string): value is MoverResource {
  return moverObject(value) && typeof value.file === "string" && new RegExp(`^models/[a-f0-9]{64}/${name}$`).test(value.file) &&
    typeof value.sha256 === "string" && hash.test(value.sha256) && positiveId(value.bytes) && value.bytes <= maximumMoverResourceBytes;
}
export function moverPose(matrix: readonly number[]): { position: Vector3; rotation: Quaternion; scale: Vector3 } {
  const value = Matrix.FromArray(matrix), scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
  if (!value.decompose(scale, rotation, position) || scale.asArray().some(n => Math.abs(n - 1) > rigidTolerance) ||
    !Matrix.Compose(scale, rotation, position).equalsWithEpsilon(value, rigidTolerance)) throw new Error("Native mover requires a rigid source transform.");
  return { position, rotation, scale };
}
export function parseNativeMoverManifest(input: unknown): NativeMoverManifest {
  if (!moverObject(input) || input.schemaVersion !== 1 || input.kind !== "native-map-movers" || !moverObject(input.sourceMap) ||
    input.sourceMap.packageSha256 !== nativeMoverMapSha256 || !Array.isArray(input.models) || !input.models.length || input.models.length > maximumMoverModels ||
    !Array.isArray(input.movers) || !input.movers.length || input.movers.length > maximumMovers) throw new Error("Native mover manifest is invalid.");
  const models = new Set<string>(), ids = new Set<string>(), serverIds = new Set<number>();
  for (const model of input.models) {
    if (!moverObject(model) || typeof model.id !== "string" || typeof model.sourceObject !== "string" || !/^l2fortress_02_s\.[A-Za-z0-9_]+$/i.test(model.sourceObject) ||
      model.id !== `interlude:${model.sourceObject}` || models.has(model.id) ||
      !resource(model.model, "model\\.glb") || !resource(model.archive, "asset\\.l2asset") ||
      model.archive.file !== `models/${model.archive.sha256}/asset.l2asset` ||
      model.model.file !== `models/${model.archive.sha256}/model.glb`) throw new Error("Native mover model identity is invalid.");
    models.add(model.id);
  }
  const usedModels = new Set<string>();
  for (const mover of input.movers) {
    if (!moverObject(mover) || typeof mover.id !== "string" || !/^interlude:20_20\.Mover\d+$/.test(mover.id) || ids.has(mover.id) ||
      typeof mover.modelId !== "string" || !models.has(mover.modelId) || !moverObject(mover.serverObject) ||
      mover.initialKey !== 0 || mover.initiallyClosed !== true ||
      !positiveId(mover.serverObject.realId) || !positiveId(mover.serverObject.id) || !positiveId(mover.serverObject.type) || serverIds.has(mover.serverObject.realId) ||
      !finiteMatrix(mover.closedMatrix) || !finiteMatrix(mover.openMatrix) || ![mover.closedMatrix, mover.openMatrix].every(affineMatrix) ||
      !validMoveTime(mover.moveTimeSeconds)) {
      throw new Error("Native mover identity, motion or timing is invalid.");
    }
    moverPose(mover.closedMatrix); moverPose(mover.openMatrix);
    ids.add(mover.id); serverIds.add(mover.serverObject.realId); usedModels.add(mover.modelId);
  }
  if (usedModels.size !== models.size) throw new Error("Native mover manifest contains unused models.");
  return input as unknown as NativeMoverManifest;
}
function tileMoverResource(value: unknown, sha256Of: (sha256: string) => string): TileMoverResource {
  if (!moverObject(value) || typeof value.sha256 !== "string" || !hash.test(value.sha256) || typeof value.resource !== "string" ||
    !positiveId(value.bytes) || value.bytes > maximumMoverResourceBytes || value.resource !== sha256Of(value.sha256)) {
    throw new Error("Native tile mover model resource is not pinned.");
  }
  return { resource: value.resource, sha256: value.sha256, bytes: value.bytes };
}
function tileMoverModel(value: unknown): NativeTileMoverModel {
  if (!moverObject(value) || typeof value.sourceObject !== "string" || !qualifiedSourceObject.test(value.sourceObject) ||
    value.id !== `interlude:${value.sourceObject}`) throw new Error("Native tile mover model identity is invalid.");
  const archive = tileMoverResource(value.archive, sha256 => `/l2/${sha256}/asset.l2asset`);
  const model = tileMoverResource(value.model, () => `/l2/${archive.sha256}/model.glb`);
  return { id: value.id, sourceObject: value.sourceObject, archive, model };
}
function tileMoverCollision(value: unknown): NativeTileMoverCollision {
  if (!moverObject(value) || typeof value.decision !== "string" || !Array.isArray(value.slots) || !value.slots.every(nonNegativeInteger) ||
    !Array.isArray(value.evidence) || !value.evidence.every(entry => typeof entry === "string")) throw new Error("Native tile mover collision decision is invalid.");
  return { decision: value.decision, slots: value.slots, evidence: value.evidence };
}
function tileMoverRecord(value: unknown, moverIdPattern: RegExp, models: ReadonlySet<string>): NativeTileMoverRecord {
  if (!moverObject(value) || typeof value.id !== "string" || !moverIdPattern.test(value.id) || typeof value.actorName !== "string" ||
    !nonNegativeInteger(value.exportIndex) || typeof value.modelId !== "string" || !models.has(value.modelId) || !moverObject(value.serverObject) ||
    !nonNegativeInteger(value.serverObject.realId) || !nonNegativeInteger(value.serverObject.id) || !nonNegativeInteger(value.serverObject.type) ||
    value.initialKey !== 0 || value.initiallyClosed !== true || !finiteMatrix(value.closedMatrix) || !finiteMatrix(value.openMatrix) ||
    ![value.closedMatrix, value.openMatrix].every(affineMatrix) || !validMoveTime(value.moveTimeSeconds)) {
    throw new Error("Native tile mover identity, motion or timing is invalid.");
  }
  moverPose(value.closedMatrix); moverPose(value.openMatrix);
  const serverObject = { realId: value.serverObject.realId, id: value.serverObject.id, type: value.serverObject.type };
  return { id: value.id, actorName: value.actorName, exportIndex: value.exportIndex, modelId: value.modelId, serverObject,
    closedMatrix: value.closedMatrix, openMatrix: value.openMatrix, moveTimeSeconds: value.moveTimeSeconds, initialKey: 0, initiallyClosed: true,
    collision: tileMoverCollision(value.collision) };
}
export function parseNativeTileMoverManifest(input: unknown): NativeTileMoverManifest {
  if (!moverObject(input) || input.kind !== "native-tile-movers" || input.schemaVersion !== 1 || typeof input.tileId !== "string" ||
    !tileIdPattern.test(input.tileId)) throw new Error("Native tile mover manifest kind, schema version or tile id is invalid.");
  const tileId = input.tileId, sourceMap = input.sourceMap;
  if (!moverObject(sourceMap) || sourceMap.path !== `maps/${tileId}.unr` || typeof sourceMap.sha256 !== "string" || !hash.test(sourceMap.sha256)) {
    throw new Error(`Native tile mover manifest ${tileId} source map is invalid.`);
  }
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > maximumMoverModels ||
    !Array.isArray(input.movers) || !input.movers.length || input.movers.length > maximumMovers) {
    throw new Error(`Native tile mover manifest ${tileId} must list 1 to ${maximumMoverModels} models and 1 to ${maximumMovers} movers.`);
  }
  const models = input.models.map(tileMoverModel), modelIds = new Set(models.map(model => model.id));
  if (modelIds.size !== models.length) throw new Error(`Native tile mover manifest ${tileId} lists a model twice.`);
  const moverIdPattern = new RegExp(`^interlude:${tileId}\\.Mover\\d+$`), ids = new Set<string>(), realIds = new Set<number>(), usedModels = new Set<string>();
  const movers = input.movers.map(value => {
    const mover = tileMoverRecord(value, moverIdPattern, modelIds);
    if (ids.has(mover.id) || (mover.serverObject.realId > 0 && realIds.has(mover.serverObject.realId))) {
      throw new Error(`Native tile mover manifest ${tileId} repeats mover ${mover.id} or its server object.`);
    }
    ids.add(mover.id); usedModels.add(mover.modelId);
    if (mover.serverObject.realId > 0) realIds.add(mover.serverObject.realId);
    return mover;
  });
  if (usedModels.size !== modelIds.size) throw new Error(`Native tile mover manifest ${tileId} contains unused models.`);
  return { kind: "native-tile-movers", schemaVersion: 1, tileId, sourceMap: { path: sourceMap.path, sha256: sourceMap.sha256 }, models, movers };
}
