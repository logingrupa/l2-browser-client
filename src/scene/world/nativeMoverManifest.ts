import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

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
const hash = /^[a-f0-9]{64}$/;
export const moverObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const finiteMatrix = (value: unknown): value is number[] => Array.isArray(value) && value.length === 16 && value.every(n => typeof n === "number" && Number.isFinite(n));
function resource(value: unknown, name: string): value is MoverResource {
  return moverObject(value) && typeof value.file === "string" && new RegExp(`^models/[a-f0-9]{64}/${name}$`).test(value.file) &&
    typeof value.sha256 === "string" && hash.test(value.sha256) && positiveId(value.bytes) && value.bytes <= 128 * 1024 * 1024;
}
/** These source movers are rigid. Reject shear/reflection rather than silently
 * changing them through a scale/rotation interpolation approximation. */
export function moverPose(matrix: readonly number[]): { position: Vector3; rotation: Quaternion; scale: Vector3 } {
  const value = Matrix.FromArray(matrix), scale = Vector3.One(), rotation = Quaternion.Identity(), position = Vector3.Zero();
  if (!value.decompose(scale, rotation, position) || scale.asArray().some(n => Math.abs(n - 1) > 1e-5) ||
    !Matrix.Compose(scale, rotation, position).equalsWithEpsilon(value, 1e-5)) throw new Error("Native mover requires a rigid source transform.");
  return { position, rotation, scale };
}
export function parseNativeMoverManifest(input: unknown): NativeMoverManifest {
  if (!moverObject(input) || input.schemaVersion !== 1 || input.kind !== "native-map-movers" || !moverObject(input.sourceMap) ||
    input.sourceMap.packageSha256 !== nativeMoverMapSha256 || !Array.isArray(input.models) || !input.models.length || input.models.length > 32 ||
    !Array.isArray(input.movers) || !input.movers.length || input.movers.length > 512) throw new Error("Native mover manifest is invalid.");
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
      !finiteMatrix(mover.closedMatrix) || !finiteMatrix(mover.openMatrix) ||
      [mover.closedMatrix, mover.openMatrix].some(m => m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) ||
      typeof mover.moveTimeSeconds !== "number" || !Number.isFinite(mover.moveTimeSeconds) || mover.moveTimeSeconds <= 0 || mover.moveTimeSeconds > 120) {
      throw new Error("Native mover identity, motion or timing is invalid.");
    }
    moverPose(mover.closedMatrix); moverPose(mover.openMatrix);
    ids.add(mover.id); serverIds.add(mover.serverObject.realId); usedModels.add(mover.modelId);
  }
  if (usedModels.size !== models.size) throw new Error("Native mover manifest contains unused models.");
  return input as unknown as NativeMoverManifest;
}
