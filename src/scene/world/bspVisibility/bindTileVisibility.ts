import type { VariableInfo } from "../../../ui/devSheet/types";
import type { BspVisibilityLimitRule } from "./bspVisibilityRules";
import { memberKindMapEmitter, type BspVisibilityModel } from "./core/decodeBspVisibility";
import type { TileVisibilityFrame, TileVisibilityFrameSource } from "./core/tileVisibilityFrame";
import type { ViewPose } from "./core/viewFrustum";

export interface IndexBlock {
  readonly firstIndex: number;
  readonly indexCount: number;
}

export interface VisibilityTarget {
  setVisible(visible: boolean): void;
}

export interface TranslucentSectionTarget {
  reorderIndexBlocks(blocks: readonly IndexBlock[]): void;
}

export interface TileViewSource {
  onFrame(step: () => void): () => void;
  pose(): ViewPose | null;
}

export interface ChunkVisibilityTargets {
  readonly sections: ReadonlyMap<number, VisibilityTarget>;
  readonly members: ReadonlyMap<number, VisibilityTarget>;
  readonly terrain: VisibilityTarget;
  readonly translucentSections: ReadonlyMap<number, TranslucentSectionTarget>;
  readonly translucentOrderErrors: readonly string[];
}

export interface TileVisibilityBindingInput {
  readonly tileId: string;
  readonly model: BspVisibilityModel;
  readonly view: TileViewSource;
  readonly frameSource: TileVisibilityFrameSource;
  readonly limitRules: readonly BspVisibilityLimitRule[];
}

export interface BoundTileVisibilityInspection {
  readonly tileId: string;
  readonly gap: null;
  readonly culling: boolean;
  readonly cameraZone: number;
  readonly cameraLeaf: number;
  readonly outdoorView: boolean;
  readonly zoneCount: number;
  readonly visibleZoneCount: number;
  readonly skyZones: readonly number[];
  readonly portalCount: number;
  readonly openedPortalCount: number;
  readonly sectionCount: number;
  readonly visibleSectionCount: number;
  readonly hiddenSectionCount: number;
  readonly targetChunkIds: readonly string[];
  readonly targetSectionCount: number;
  readonly translucentSectionCount: number;
  readonly translucentOrderErrors: readonly string[];
  readonly reorderedSectionWrites: number;
  readonly memberCount: number;
  readonly mapEmitterCount: number;
  readonly visibleMemberCount: number;
  readonly terrainVisible: boolean;
  readonly computedFrameCount: number;
  readonly cacheHitCount: number;
  readonly limitRules: readonly BspVisibilityLimitRule[];
}

export interface TileVisibilityGapInspection {
  readonly tileId: string;
  readonly gap: string;
  readonly culling: false;
  readonly cameraZone: -1;
}

export type TileVisibilityInspection = BoundTileVisibilityInspection | TileVisibilityGapInspection;

export interface TileVisibilityBinding {
  frame(): TileVisibilityFrame | null;
  memberVisible(exportIndex: number): boolean;
  setCulling(enabled: boolean): void;
  addChunkTargets(chunkId: string, targets: ChunkVisibilityTargets): void;
  removeChunkTargets(chunkId: string): void;
  describe(): VariableInfo[];
  inspection(): BoundTileVisibilityInspection;
  dispose(): void;
}

export const cullingVariableName = "world.visibility.culling";
const noCameraZone = -1;

function sameOrder(left: Int32Array | undefined, right: Int32Array): boolean {
  return left !== undefined && left.length === right.length && left.every((range, position) => range === right[position]);
}

function countSet(flags: Uint8Array | undefined): number {
  return flags ? flags.reduce((sum, flag) => sum + flag, 0) : 0;
}

export function bindTileVisibility(input: TileVisibilityBindingInput): TileVisibilityBinding {
  const { tileId, model, view, frameSource, limitRules } = input;
  const memberByExportIndex = new Map(Array.from(model.members.exportIndex, (exportIndex, member) => [exportIndex, member]));
  const appliedOrder = new Map<number, Int32Array>(), targetsByChunkId = new Map<string, ChunkVisibilityTargets>();
  const sectionShown = new Uint8Array(model.sections.count).fill(1), memberShown = new Uint8Array(model.members.count).fill(1);
  let sectionTargets = new Map<number, VisibilityTarget>(), memberTargets = new Map<number, VisibilityTarget>(), terrainTargets: VisibilityTarget[] = [];
  let translucentTargets = new Map<number, TranslucentSectionTarget>(), translucentOrderErrors: string[] = [];
  let terrainShown = true, cullingEnabled = false, latest: TileVisibilityFrame | null = null, reorderedSectionWrites = 0, disposed = false;
  const indexChunkTargets = () => {
    const chunks = [...targetsByChunkId.values()];
    sectionTargets = new Map(chunks.flatMap(targets => [...targets.sections]));
    memberTargets = new Map(chunks.flatMap(targets => [...targets.members]));
    terrainTargets = chunks.map(targets => targets.terrain);
    translucentTargets = new Map(chunks.flatMap(targets => [...targets.translucentSections]));
    translucentOrderErrors = chunks.flatMap(targets => targets.translucentOrderErrors);
    frameSource.setTranslucentSections([...translucentTargets.keys()].sort((left, right) => left - right));
  };
  const applyShownState = (targets: ChunkVisibilityTargets) => {
    for (const [section, target] of targets.sections) if (sectionShown[section] === 0) target.setVisible(false);
    for (const [member, target] of targets.members) if (memberShown[member] === 0) target.setVisible(false);
    if (!terrainShown) targets.terrain.setVisible(false);
  };
  const applyVisibility = (frame: TileVisibilityFrame) => {
    frame.sectionVisible.forEach((visible, section) => {
      if (visible === sectionShown[section]) return;
      sectionTargets.get(section)?.setVisible(visible === 1);
      sectionShown[section] = visible;
    });
    frame.memberVisible.forEach((visible, member) => {
      if (visible === memberShown[member]) return;
      memberTargets.get(member)?.setVisible(visible === 1);
      memberShown[member] = visible;
    });
    if (frame.terrainVisible !== terrainShown) {
      for (const target of terrainTargets) target.setVisible(frame.terrainVisible);
      terrainShown = frame.terrainVisible;
    }
  };
  const applyTranslucentOrder = (frame: TileVisibilityFrame) => {
    for (const [section, order] of frame.translucentOrder) {
      const target = translucentTargets.get(section);
      if (target === undefined || sameOrder(appliedOrder.get(section), order)) continue;
      target.reorderIndexBlocks(Array.from(order, range => ({ firstIndex: model.ranges.firstIndex[range]!, indexCount: model.ranges.indexCount[range]! })));
      appliedOrder.set(section, order);
      reorderedSectionWrites++;
    }
  };
  const step = () => {
    const pose = view.pose();
    if (pose === null) return;
    const frame = frameSource.frame(pose, cullingEnabled);
    if (frame === latest) return;
    latest = frame;
    applyVisibility(frame);
    applyTranslucentOrder(frame);
  };
  const forgetAppliedOrder = (targets: ChunkVisibilityTargets) => { for (const section of targets.translucentSections.keys()) appliedOrder.delete(section); };
  const stopFrames = view.onFrame(step);
  return {
    frame: () => latest,
    memberVisible(exportIndex) {
      const member = memberByExportIndex.get(exportIndex);
      return member === undefined || latest === null || latest.memberVisible[member] === 1;
    },
    setCulling(enabled) { cullingEnabled = enabled; },
    addChunkTargets(chunkId, targets) {
      if (disposed || targetsByChunkId.has(chunkId)) return;
      targetsByChunkId.set(chunkId, targets);
      applyShownState(targets);
      forgetAppliedOrder(targets);
      indexChunkTargets();
    },
    removeChunkTargets(chunkId) {
      const targets = targetsByChunkId.get(chunkId);
      if (targets === undefined) return;
      targetsByChunkId.delete(chunkId);
      forgetAppliedOrder(targets);
      indexChunkTargets();
    },
    describe: () => [{ name: cullingVariableName, value: () => cullingEnabled ? "on" : "off", values: "off | on",
      source: "bindTileVisibility: zone and portal culling of BSP sections, static meshes and map emitters; stays off until PERF-02 measures it",
      status: "presentation" }],
    inspection: () => ({
      tileId, gap: null, culling: cullingEnabled, cameraZone: latest?.cameraZone ?? noCameraZone, cameraLeaf: latest?.cameraLeaf ?? noCameraZone,
      outdoorView: latest?.outdoorView ?? false, zoneCount: model.zoneCount, visibleZoneCount: latest?.visibleZoneCount ?? 0, skyZones: latest?.skyZones ?? [],
      portalCount: model.portalNodes.length, openedPortalCount: latest?.openedPortalCount ?? 0, sectionCount: model.sections.count,
      visibleSectionCount: countSet(latest?.sectionVisible), hiddenSectionCount: latest ? model.sections.count - countSet(latest.sectionVisible) : 0,
      targetChunkIds: [...targetsByChunkId.keys()].sort(), targetSectionCount: sectionTargets.size,
      translucentSectionCount: translucentTargets.size, translucentOrderErrors, reorderedSectionWrites,
      memberCount: model.members.count, mapEmitterCount: model.members.kind.filter(kind => kind === memberKindMapEmitter).length,
      visibleMemberCount: countSet(latest?.memberVisible), terrainVisible: latest?.terrainVisible ?? true,
      computedFrameCount: frameSource.computedFrameCount, cacheHitCount: frameSource.cacheHitCount, limitRules,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopFrames();
    },
  };
}
