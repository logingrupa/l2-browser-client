import type { BspVisibilityModel } from "./core/decodeBspVisibility";
import type { TileVisibilityFrame, TileVisibilityFrameSource } from "./core/tileVisibilityFrame";
import type { ViewPose } from "./core/viewFrustum";

export interface IndexBlock {
  readonly firstIndex: number;
  readonly indexCount: number;
}

export interface TranslucentSectionTarget {
  reorderIndexBlocks(blocks: readonly IndexBlock[]): void;
}

export interface TileViewSource {
  onFrame(step: () => void): () => void;
  pose(): ViewPose | null;
}

export interface TileVisibilityTargets {
  readonly translucentSections: ReadonlyMap<number, TranslucentSectionTarget>;
  readonly translucentOrderErrors: readonly string[];
}

export interface TileVisibilityBindingInput {
  readonly tileId: string;
  readonly model: BspVisibilityModel;
  readonly view: TileViewSource;
  readonly targets: TileVisibilityTargets;
  readonly frameSource: TileVisibilityFrameSource;
}

export interface BoundTileVisibilityInspection {
  readonly tileId: string;
  readonly gap: null;
  readonly culling: boolean;
  readonly cameraZone: number;
  readonly cameraLeaf: number;
  readonly zoneCount: number;
  readonly visibleZoneCount: number;
  readonly skyZones: readonly number[];
  readonly portalCount: number;
  readonly sectionCount: number;
  readonly visibleSectionCount: number;
  readonly translucentSectionCount: number;
  readonly translucentOrderErrors: readonly string[];
  readonly reorderedSectionWrites: number;
  readonly memberCount: number;
  readonly computedFrameCount: number;
  readonly cacheHitCount: number;
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
  inspection(): BoundTileVisibilityInspection;
  dispose(): void;
}

const noCameraZone = -1;

function sameOrder(left: Int32Array | undefined, right: Int32Array): boolean {
  return left !== undefined && left.length === right.length && left.every((range, position) => range === right[position]);
}

export function bindTileVisibility(input: TileVisibilityBindingInput): TileVisibilityBinding {
  const { tileId, model, view, targets, frameSource } = input;
  const appliedOrder = new Map<number, Int32Array>();
  let latest: TileVisibilityFrame | null = null, reorderedSectionWrites = 0, disposed = false;
  const applyTranslucentOrder = (frame: TileVisibilityFrame) => {
    for (const [section, order] of frame.translucentOrder) {
      const target = targets.translucentSections.get(section);
      if (target === undefined || sameOrder(appliedOrder.get(section), order)) continue;
      target.reorderIndexBlocks(Array.from(order, range => ({ firstIndex: model.ranges.firstIndex[range]!, indexCount: model.ranges.indexCount[range]! })));
      appliedOrder.set(section, order);
      reorderedSectionWrites++;
    }
  };
  const step = () => {
    const pose = view.pose();
    if (pose === null) return;
    const frame = frameSource.frame(pose);
    if (frame === latest) return;
    latest = frame;
    applyTranslucentOrder(frame);
  };
  const stopFrames = view.onFrame(step);
  return {
    frame: () => latest,
    inspection: () => ({
      tileId, gap: null, culling: latest?.culling ?? false, cameraZone: latest?.cameraZone ?? noCameraZone, cameraLeaf: latest?.cameraLeaf ?? noCameraZone,
      zoneCount: model.zoneCount, visibleZoneCount: latest?.visibleZoneCount ?? 0, skyZones: latest?.skyZones ?? [],
      portalCount: model.portalNodes.length, sectionCount: model.sections.count,
      visibleSectionCount: latest ? latest.sectionVisible.reduce((sum, visible) => sum + visible, 0) : 0,
      translucentSectionCount: targets.translucentSections.size, translucentOrderErrors: targets.translucentOrderErrors, reorderedSectionWrites,
      memberCount: model.members.count, computedFrameCount: frameSource.computedFrameCount, cacheHitCount: frameSource.cacheHitCount,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopFrames();
    },
  };
}
