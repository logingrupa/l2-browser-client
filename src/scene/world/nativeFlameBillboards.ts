import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export type NativeFlamePosition = readonly [number, number, number];
export interface NativeFlameBillboardBinding {
  readonly placementId: string;
  readonly root: TransformNode;
  readonly sourceMesh: string;
  /** Original glTF-basis placement matrix, before authored extra TRS. */
  readonly sourceMatrix: readonly number[];
}
export interface NativeFlameBillboardEvaluation {
  readonly directionNative: NativeFlamePosition;
  readonly yawInteger: number;
  readonly billboardYaw: number;
  readonly sineIndex: number;
  readonly sinFloat32: number;
  readonly cosFloat32: number;
  /** Babylon row-vector matrix in the existing native-XZY browser basis. */
  readonly browserMatrix: readonly number[];
}
export interface NativeFlameBillboardInspection {
  status: "local-numeric-replay-native-parity-unverified";
  disposed: boolean;
  bindingCounts: { requested: number; active: number; released: number; held: number };
  placements: { placementId: string; active: boolean; childCount: number; held: boolean; reason: string | null; billboardYaw: number | null }[];
  numericalModel: string;
  targetPolicy: "explicit-caller-supplied-native-location";
  nativeCamera: "unverified";
  nativeLighting: "unverified";
  nativeParity: "unverified";
}
export interface NativeFlameBillboards {
  /** Caller declares whether this input is a replay proxy or a native observation. */
  update(nativeViewportActorLocation: NativeFlamePosition): void;
  inspect(): NativeFlameBillboardInspection;
  dispose(): void;
}

const SOURCE = "FX_E_S.Flameset.Default_Flame01";
const attached = new WeakSet<TransformNode>();
// Retained map actor evidence: billboard-lighting.md / placement-lighting.json.
// All twelve have zero source Rotation/PrePivot and DrawScale3D=(1,1,1).
const audited = new Map<number, readonly [number, number, number, number]>([
  [1922, [12118, 94874, -3343, .4]], [1923, [12119, 94650, -3343, .4]],
  [1924, [10957, 94875, -3343, .4]], [1925, [10958, 94651, -3343, .4]],
  [1926, [11236, 94406, -3343, .4]], [1927, [11836, 94407, -3343, .4]],
  [1928, [11795, 95098, -3257, .6]], [1930, [11289, 95099, -3257, .6]],
  [1932, [11796, 94873, -3257, .6]], [1934, [11290, 94874, -3257, .6]],
  [1936, [11796, 94649, -3257, .6]], [1938, [11290, 94650, -3257, .6]],
]);
const MODEL = "Local replay: binary32 position differences; JavaScript Math.atan2 * 65535 / (2*PI), truncation toward zero, +16384, 14-bit sine lookup with binary32 stores. Native Core CRT/FP precision, viewport actor location and lighting remain unverified.";

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native flame billboards: ${message}`);
}
function validatePosition(value: NativeFlamePosition): void {
  requireValue(value.length === 3 && value.every(Number.isFinite), "position must contain three finite coordinates.");
}
export function nativeFlameNativeToBrowser(value: NativeFlamePosition): [number, number, number] {
  validatePosition(value);
  return [value[0] * .01, value[2] * .01, value[1] * .01];
}
export function nativeFlameBrowserToNative(value: NativeFlamePosition): [number, number, number] {
  validatePosition(value);
  const result: [number, number, number] = [value[0] * 100, value[2] * 100, value[1] * 100];
  validatePosition(result);
  return result;
}

/** Recovered source equation, with explicit local transcendental arithmetic.
 * A zero horizontal direction is held by the owner: native signed-zero atan2
 * behavior has not been certified. No invented fallback facing is applied. */
export function evaluateNativeFlameBillboard(actorLocation: NativeFlamePosition, viewportActorLocation: NativeFlamePosition): NativeFlameBillboardEvaluation | null {
  validatePosition(actorLocation); validatePosition(viewportActorLocation);
  const directionNative = actorLocation.map((value, axis) => Math.fround(viewportActorLocation[axis]! - value)) as [number, number, number];
  requireValue(directionNative.every(Number.isFinite), "direction exceeds the finite binary32 model.");
  const [dx, dy] = directionNative;
  if (dx === 0 && dy === 0) return null;
  const yawInteger = Math.trunc(Math.atan2(dy, dx) * 65535 / (2 * Math.PI));
  const billboardYaw = yawInteger + 16384;
  const sineIndex = (billboardYaw >> 2) & 16383;
  const sine = (index: number) => Math.fround(Math.sin((2 * index) * Math.PI * (1 / 16384)));
  const sinFloat32 = sine(sineIndex), cosFloat32 = sine(((billboardYaw + 16384) >> 2) & 16383);
  return { directionNative, yawInteger, billboardYaw, sineIndex, sinFloat32, cosFloat32,
    browserMatrix: [cosFloat32, 0, sinFloat32, 0, 0, 1, 0, 0, -sinFloat32, 0, cosFloat32, 0, 0, 0, 0, 1] };
}

function sameMatrix(matrix: Matrix, source: readonly number[]): boolean {
  return matrix.asArray().every((value, index) => value === source[index]);
}
function validateSource(binding: NativeFlameBillboardBinding): void {
  const match = /^interlude:20_20\.StaticMeshActor(\d+)$/.exec(binding.placementId);
  const source = match ? audited.get(Number(match[1])) : undefined;
  requireValue(source && binding.sourceMesh === SOURCE, "placement is outside the twelve audited flame actors.");
  const matrix = binding.sourceMatrix, scale = Math.fround(source[3]);
  const expected = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, source[0] * .01, source[2] * .01, source[1] * .01, 1];
  requireValue(matrix.length === 16 && matrix.every((value, index) => Number.isFinite(value) && Math.fround(value) === Math.fround(expected[index]!)),
    "source matrix differs from the audited positive uniform scale, location, zero rotation and pivot.");
  // Large-world matrices retain source doubles. Existing editor scenes saved
  // float32 local matrices alongside the original source metadata. Accept only
  // either complete exact representation, never mixed components or a tolerance.
  const pivot = binding.root.getPivotMatrix();
  requireValue(!binding.root.isUsingPostMultiplyPivotMatrix() &&
    (sameMatrix(pivot, matrix) || sameMatrix(pivot, matrix.map(Math.fround))), "placement pretransform differs from its original source matrix.");
}

interface Record {
  placementId: string;
  root: TransformNode;
  originalPivotMatrix: number[];
  children: { node: TransformNode; originalParent: Node | null; released: boolean }[];
  wrapper: TransformNode | null;
  active: boolean;
  held: boolean;
  reason: string | null;
  billboardYaw: number | null;
}

/** Owns only temporary wrapper nodes. Direct parent assignment deliberately
 * preserves saved local TRS/pivots; setParent() would recompute those values.
 * No render observer, geometry write, source-matrix mutation or camera lookup. */
export function createNativeFlameBillboards(scene: Scene, bindings: readonly NativeFlameBillboardBinding[], signal: AbortSignal): NativeFlameBillboards {
  signal.throwIfAborted();
  requireValue(!scene.isDisposed && scene.useRightHandedSystem, "requires a live right-handed native section scene.");
  requireValue(bindings.length <= 12 && new Set(bindings.map(value => value.root)).size === bindings.length && new Set(bindings.map(value => value.placementId)).size === bindings.length,
    "duplicate or excessive placement bindings.");
  // Validate all records before introducing any hierarchy changes.
  const records: Record[] = bindings.map(binding => {
    const { root } = binding;
    requireValue(root.getScene() === scene && !root.isDisposed() && root.getClassName() === "TransformNode" && !attached.has(root), "placement root is unavailable or already owned.");
    validateSource(binding);
    const children = root.getChildren(undefined, true);
    requireValue(children.length > 0 && children.every(child => child instanceof TransformNode), "placement requires original transform children.");
    requireValue(root.getDescendants().every(node => !(node instanceof TransformNode) || !node.isWorldMatrixFrozen), "frozen descendants cannot follow a reversible billboard wrapper.");
    requireValue([...root.computeWorldMatrix(true).asArray()].every(Number.isFinite), "placement world matrix must be finite.");
    // Ownership tracks the actual accepted storage values, so even a later edit
    // smaller than float32 precision releases the wrapper in large-world mode.
    return { placementId: binding.placementId, root, originalPivotMatrix: [...root.getPivotMatrix().asArray()],
      children: (children as TransformNode[]).map(node => ({ node, originalParent: node.parent, released: false })),
      wrapper: null, active: true, held: false, reason: null, billboardYaw: null };
  });
  let disposed = false;
  const release = (entry: Record, reason: string | null) => {
    entry.active = false; entry.held = false; entry.reason = reason;
    const wrapper = entry.wrapper;
    if (wrapper) {
      // A child moved elsewhere by an author is never reclaimed. If the wrapper
      // itself was moved, follow its latest parent instead of restoring the root.
      const latestParent = wrapper.parent && !wrapper.parent.isDisposed() ? wrapper.parent : null;
      for (const child of wrapper.getChildren(undefined, true)) {
        const saved = entry.children.find(value => value.node === child);
        const restore = saved && !saved.released && wrapper.parent === entry.root && !entry.root.isDisposed() ? saved.originalParent : latestParent;
        child.parent = restore && !restore.isDisposed() ? restore : null;
      }
      if (!wrapper.isDisposed()) wrapper.dispose(true, false);
      entry.wrapper = null;
    }
    attached.delete(entry.root);
  };
  try {
    for (const entry of records) {
      const wrapper = new TransformNode(`native-flame-billboard:${entry.placementId}`, scene);
      entry.wrapper = wrapper;
      wrapper.parent = entry.root;
      for (const child of entry.children) child.node.parent = wrapper;
      attached.add(entry.root);
    }
  } catch (error) {
    for (const entry of records) release(entry, "creation-failed");
    throw error;
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(observer);
    for (const entry of records) if (entry.active || entry.wrapper) release(entry, entry.reason);
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    update(target) {
      if (disposed) return;
      validatePosition(target);
      // Evaluate first: a nonfinite target/difference cannot partially rotate a scene.
      const pending = records.filter(entry => entry.active).map(entry => {
        if (entry.root.isDisposed() || !entry.wrapper || entry.wrapper.isDisposed() || entry.wrapper.parent !== entry.root ||
          entry.root.isUsingPostMultiplyPivotMatrix() || !sameMatrix(entry.root.getPivotMatrix(), entry.originalPivotMatrix)) return { entry, unavailable: true, evaluation: null };
        const world = entry.root.computeWorldMatrix(true).asArray();
        const actor = nativeFlameBrowserToNative([world[12]!, world[13]!, world[14]!]);
        return { entry, unavailable: false, evaluation: evaluateNativeFlameBillboard(actor, target) };
      });
      for (const { entry, unavailable, evaluation } of pending) {
        if (unavailable) { release(entry, "placement-or-wrapper-ownership-changed"); continue; }
        for (const child of entry.children) if (child.node.isDisposed() || child.node.parent !== entry.wrapper) child.released = true;
        if (entry.children.every(child => child.released)) { release(entry, "original-children-reparented-or-disposed"); continue; }
        if (entry.root.getDescendants().some(node => node instanceof TransformNode && node.isWorldMatrixFrozen)) {
          release(entry, "descendant-frozen-after-attachment"); continue;
        }
        entry.held = !evaluation;
        entry.reason = evaluation ? null : "zero-horizontal-direction-native-atan2-unverified";
        if (!evaluation) continue;
        entry.wrapper!.setPreTransformMatrix(Matrix.FromArray(evaluation.browserMatrix));
        entry.wrapper!.computeWorldMatrix(true);
        entry.billboardYaw = evaluation.billboardYaw;
      }
    },
    inspect() {
      return { status: "local-numeric-replay-native-parity-unverified", disposed,
        bindingCounts: { requested: records.length, active: records.filter(entry => entry.active).length,
          released: records.filter(entry => !entry.active).length, held: records.filter(entry => entry.held).length },
        placements: records.map(entry => ({ placementId: entry.placementId, active: entry.active,
          childCount: entry.children.filter(child => !child.released && !child.node.isDisposed() && child.node.parent === entry.wrapper).length,
          held: entry.held, reason: entry.reason, billboardYaw: entry.billboardYaw })),
        numericalModel: MODEL, targetPolicy: "explicit-caller-supplied-native-location", nativeCamera: "unverified", nativeLighting: "unverified", nativeParity: "unverified" };
    },
    dispose,
  };
}
