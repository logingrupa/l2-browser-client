// Adapted from the audited local Lineagen terrain preview; see docs/WORLD_ASSETS.md.
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { loadWorldModel, verifiedWorldJson } from './worldAssets';
import { Material } from '@babylonjs/core/Materials/material';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { Scene } from '@babylonjs/core/scene';
import { worldModelRadius } from './worldVisibility';

interface Placement {
  id: string;
  tile: string;
  position: [number, number, number];
  rotationQuaternion: [number, number, number, number];
  scale: [number, number, number];
  mirrored?: boolean;
}

export interface GrassModel {
  id: string;
  file: string;
  category: 'grass';
  sha256: string;
  instanceSha256: string;
  instanceFile: string;
  instanceCount: number;
  instances: [];
  bounds: { minimum: number[]; maximum: number[] };
}

export interface GrassStream {
  refresh(): void;
  focuses(): { tile: string; position: [number, number, number]; placements: number }[];
  inspection(): {
    sourcePlacements: number;
    loadedModels: number;
    activeLoads: number;
    pendingBatches: number;
    requiredBatches: number;
    readyBatches: number;
    visiblePlacements: number;
    thinInstanceBatches: number;
    errors: number;
  };
  dispose(): void;
}

interface Batch {
  id: string;
  entry: Entry;
  placements: Placement[];
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
  mirrored: boolean;
  state: 'idle' | 'ready' | 'error';
  wanted: boolean;
  distance: number;
  touched: number;
  copy?: InstantiatedEntries | undefined;
  meshCount: number;
  materials: Material[];
}

interface Entry {
  model: GrassModel;
  batches: Batch[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  container?: AssetContainer;
}

const CELL_SIZE = 32;
const DRAW_RADIUS = 96;
const MAX_CACHED_BATCHES = 220;
const CREATE_PER_TICK = 4;
const finite = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);

/** Babylon thin matrices precede the mesh's base world matrix on the CPU.
 * Conjugation therefore reproduces an ordinary placement parent without
 * baking the glTF hierarchy or repeating its RH/LH loader conversion.
 */
export function grassThinInstanceMatrix(baseWorld: Matrix, placementWorld: Matrix): Matrix {
  return baseWorld.multiply(placementWorld).multiply(Matrix.Invert(baseWorld));
}

/** Thin matrix vertex buffers live on Geometry in Babylon. Clones share their
 * source geometry, so isolate each spatial batch before attaching buffers or
 * a later batch replaces earlier GPU transforms while CPU counts stay intact.
 */
export function setGrassThinInstanceBuffer(mesh: Mesh, matrices: Float32Array): void {
  mesh.makeGeometryUnique();
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(true);
}

function placementMatrix(placement: Placement, rightHanded: boolean): Matrix {
  const [x, y, z] = placement.position;
  const [qx, qy, qz, qw] = placement.rotationQuaternion;
  return Matrix.Compose(
    Vector3.FromArray(placement.scale),
    rightHanded ? new Quaternion(qx, qy, qz, qw) : new Quaternion(qx, -qy, -qz, qw),
    new Vector3(rightHanded ? x : -x, y, z),
  );
}

/** A reflected thin batch needs its own winding; retain source sidedness,
 * alpha testing, textures and other material properties. Texture objects stay
 * shared, and only these material copies are disposed with the batch.
 */
function mirroredMaterial(source: Material, meshOrientation: number, owned: Material[], suffix: string): Material {
  const copy = source.clone(`${source.name}:${suffix}`);
  if (!copy) throw new Error(`Cannot clone reflected grass material ${source.name}.`);
  owned.push(copy);
  if (source instanceof MultiMaterial && copy instanceof MultiMaterial) {
    copy.subMaterials = source.subMaterials.map(material => material ? mirroredMaterial(material, meshOrientation, owned, suffix) : null);
  } else {
    const orientation = source.sideOrientation ?? meshOrientation;
    copy.sideOrientation = orientation === Material.ClockWiseSideOrientation ?
      Material.CounterClockWiseSideOrientation : Material.ClockWiseSideOrientation;
  }
  return copy;
}

/** Source-backed visual grass. Spatial batches keep the full source placement
 * list, but allocate meshes only near the camera target; they add no collision.
 */
export async function setupGrassStream(
  scene: Scene,
  camera: Pick<ArcRotateCamera, 'getTarget'>,
  models: GrassModel[],
  isEnabled: () => boolean,
): Promise<GrassStream> {
  if (models.length && !scene.getEngine().getCaps().instancedArrays) throw new Error('This device does not support thin-instance grass rendering.');
  const entries: Entry[] = [];
  const batches: Batch[] = [];
  const focusCells = new Map<string, { tile: string; position: [number, number, number]; placements: number }>();
  const abort = new AbortController();
  let errors = 0, activeLoads = 0, clock = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sourcePlacements = 0;

  function releaseBatch(batch: Batch): void {
    batch.copy?.dispose();
    batch.copy = undefined;
    for (const material of batch.materials) material.dispose(false, false);
    batch.materials.length = 0;
    batch.meshCount = 0;
    if (batch.state !== 'error') batch.state = 'idle';
  }

  function makeBatch(batch: Batch): void {
    const container = batch.entry.container;
    if (!container) return;
    try {
      const copy = container.instantiateModelsToScene(name => `grass:${batch.id}:${name}`, false, { doNotInstantiate: true });
      batch.copy = copy;
      for (const root of copy.rootNodes) root.setEnabled(false);
      const meshes = copy.rootNodes.flatMap(root => [root, ...root.getDescendants(false)])
        .filter((node): node is Mesh => node instanceof Mesh && node.getTotalVertices() > 0);
      if (!meshes.length) throw new Error('Grass GLB contains no drawable meshes.');
      const placements = batch.placements.map(placement => placementMatrix(placement, scene.useRightHandedSystem));
      for (const mesh of meshes) {
        if (mesh.skeleton || mesh.morphTargetManager) throw new Error('Animated grass is not supported by the static batch importer.');
        const base = mesh.computeWorldMatrix(true).clone();
        if (Math.abs(base.determinant()) < 1e-10) throw new Error('Grass mesh has a singular base transform.');
        const inverse = Matrix.Invert(base);
        const matrices = new Float32Array(placements.length * 16);
        placements.forEach((placement, index) => base.multiply(placement).multiply(inverse).copyToArray(matrices, index * 16));
        if (batch.mirrored) {
          if (mesh.material) mesh.material = mirroredMaterial(mesh.material, mesh.sideOrientation, batch.materials, batch.id);
          else mesh.sideOrientation = mesh.sideOrientation === Material.ClockWiseSideOrientation ?
            Material.CounterClockWiseSideOrientation : Material.ClockWiseSideOrientation;
        }
        mesh.isPickable = false;
        setGrassThinInstanceBuffer(mesh, matrices);
        mesh.freezeWorldMatrix();
      }
      batch.meshCount = meshes.length;
      batch.state = 'ready';
      for (const root of copy.rootNodes) root.setEnabled(batch.wanted);
    } catch (error) {
      batch.state = 'error';
      releaseBatch(batch);
      errors++;
      console.error('[grass batch]', batch.id, error);
    }
  }

  function pump(): void {
    timer = undefined;
    if (disposed) return;
    const pending = batches.filter(batch => batch.wanted && batch.state === 'idle' && batch.entry.state === 'ready')
      .sort((a, b) => a.distance - b.distance);
    for (const batch of pending.slice(0, CREATE_PER_TICK)) makeBatch(batch);
    const cached = batches.filter(batch => batch.state === 'ready');
    const discard = cached.filter(batch => !batch.wanted).sort((a, b) => a.touched - b.touched);
    for (let index = 0; cached.length - index > MAX_CACHED_BATCHES && index < discard.length; index++) releaseBatch(discard[index]!);
    if (pending.length > CREATE_PER_TICK) timer = setTimeout(pump, 0);
  }

  async function load(entry: Entry): Promise<void> {
    entry.state = 'loading'; activeLoads++;
    try {
      const container = await loadWorldModel(scene, `/assets/world/world-models/${entry.model.file}`, entry.model.sha256);
      if (disposed) { container.dispose(); return; }
      if (container.skeletons.length || container.animationGroups.length) {
        container.dispose();
        throw new Error('Animated grass models require a separate importer.');
      }
      entry.container = container;
      entry.state = 'ready';
    } catch (error) {
      if (!disposed) {
        entry.state = 'error'; errors++;
        console.error('[grass model]', entry.model.id, error);
      }
    } finally {
      activeLoads--;
      if (!disposed) refresh();
    }
  }

  function refresh(): void {
    if (disposed) return;
    const target = camera.getTarget();
    const x = scene.useRightHandedSystem ? target.x : -target.x;
    const z = target.z;
    const enabled = isEnabled();
    clock++;
    for (const batch of batches) {
      const dx = Math.max(batch.minimumX - x, 0, x - batch.maximumX);
      const dz = Math.max(batch.minimumZ - z, 0, z - batch.maximumZ);
      batch.distance = Math.hypot(dx, dz);
      batch.wanted = enabled && batch.distance <= DRAW_RADIUS;
      if (batch.wanted) batch.touched = clock;
      for (const root of batch.copy?.rootNodes ?? []) root.setEnabled(batch.wanted);
    }
    const pending = entries.filter(entry => entry.state === 'idle' && entry.batches.some(batch => batch.wanted));
    pending.sort((a, b) => Math.min(...a.batches.filter(batch => batch.wanted).map(batch => batch.distance)) -
      Math.min(...b.batches.filter(batch => batch.wanted).map(batch => batch.distance)));
    for (const entry of pending) {
      if (activeLoads >= 2) break;
      void load(entry);
    }
    if (timer === undefined && batches.some(batch => batch.wanted && batch.state === 'idle' && batch.entry.state === 'ready')) {
      timer = setTimeout(pump, 0);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    abort.abort();
    if (timer !== undefined) clearTimeout(timer);
    for (const batch of batches) releaseBatch(batch);
    for (const entry of entries) entry.container?.dispose();
  }

  scene.onDisposeObservable.addOnce(dispose);
  const results = await Promise.allSettled(models.map(async model => {
    if (model.category !== 'grass' || !/^[A-Za-z0-9._-]+\.glb$/.test(model.file) ||
        !/^[A-Za-z0-9._-]+\.json$/.test(model.instanceFile) || !Number.isSafeInteger(model.instanceCount) || model.instanceCount < 0 ||
        !finite(model.bounds?.minimum, 3) || !finite(model.bounds?.maximum, 3)) throw new Error('Invalid grass model descriptor.');
    sourcePlacements += model.instanceCount;
    const document = await verifiedWorldJson<{ instances?: Placement[] }>(`/assets/world/world-models/${model.instanceFile}`, model.instanceSha256, abort.signal);
    if (!Array.isArray(document.instances) || document.instances.length !== model.instanceCount) throw new Error('Grass placement count does not match the pinned model manifest.');
    const groups = new Map<string, Batch>();
    const entry: Entry = { model, state: 'idle', batches: [] };
    const radius = worldModelRadius(model.bounds.minimum, model.bounds.maximum);
    const ids = new Set<string>();
    for (const placement of document.instances) {
      if (typeof placement.id !== 'string' || ids.has(placement.id) || typeof placement.tile !== 'string' ||
          !finite(placement.position, 3) || !finite(placement.rotationQuaternion, 4) || !finite(placement.scale, 3) ||
          Math.abs(Math.hypot(...placement.rotationQuaternion) - 1) > 0.001 || placement.scale.some(value => value === 0)) throw new Error('Invalid grass placement transform or identity.');
      ids.add(placement.id);
      const mirrored = placement.scale[0] * placement.scale[1] * placement.scale[2] < 0;
      if (placement.mirrored !== undefined && placement.mirrored !== mirrored) throw new Error('Grass reflected-transform flag does not match its signed scale.');
      const [x, , z] = placement.position;
      const cellKey = `${placement.tile}:${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}`;
      const cell = focusCells.get(cellKey) ?? { tile: placement.tile, position: [0, 0, 0], placements: 0 };
      placement.position.forEach((value, axis) => { cell.position[axis] = cell.position[axis]! + value; });
      cell.placements++;
      focusCells.set(cellKey, cell);
      const key = `${placement.tile}:${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}:${mirrored ? 'mirrored' : 'normal'}`;
      let batch = groups.get(key);
      if (!batch) {
        batch = { id: `${model.id}:${key}`, entry, placements: [], minimumX: Infinity, maximumX: -Infinity,
          minimumZ: Infinity, maximumZ: -Infinity, mirrored, state: 'idle', wanted: false, distance: Infinity,
          touched: 0, meshCount: 0, materials: [] };
        groups.set(key, batch);
      }
      const padding = radius * Math.max(...placement.scale.map(Math.abs));
      batch.minimumX = Math.min(batch.minimumX, x - padding);
      batch.maximumX = Math.max(batch.maximumX, x + padding);
      batch.minimumZ = Math.min(batch.minimumZ, z - padding);
      batch.maximumZ = Math.max(batch.maximumZ, z + padding);
      batch.placements.push(placement);
    }
    if (disposed) return;
    entry.batches.push(...groups.values());
    entries.push(entry); batches.push(...entry.batches);
  }));
  for (const result of results) {
    if (result.status === 'rejected' && !disposed) {
      errors++;
      console.error('[grass placements]', result.reason);
    }
  }
  refresh();
  return {
    refresh,
    focuses: () => [...new Set([...focusCells.values()].map(cell => cell.tile))].sort().map(tile => {
      const cell = [...focusCells.values()].filter(cell => cell.tile === tile).sort((a, b) => b.placements - a.placements)[0]!;
      return { tile, position: cell.position.map(value => value / cell.placements) as [number, number, number], placements: cell.placements };
    }),
    inspection: () => ({
      sourcePlacements,
      loadedModels: entries.filter(entry => entry.state === 'ready').length,
      activeLoads,
      pendingBatches: batches.filter(batch => batch.wanted && batch.state === 'idle' && batch.entry.state !== 'error').length,
      requiredBatches: batches.filter(batch => batch.wanted).length,
      readyBatches: batches.filter(batch => batch.wanted && batch.state === 'ready').length,
      visiblePlacements: batches.filter(batch => batch.wanted && batch.state === 'ready').reduce((sum, batch) => sum + batch.placements.length, 0),
      thinInstanceBatches: batches.reduce((sum, batch) => sum + batch.meshCount, 0),
      errors,
    }),
    dispose,
  };
}
