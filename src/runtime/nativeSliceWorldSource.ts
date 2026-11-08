import type { Scene } from "@babylonjs/core/scene";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { loadNativeSection, type NativeSection } from "../scene/world/loadNativeSection";

export interface NativeSliceWorldSourceResult {
  section: NativeSection | null;
  release: () => void;
}

export type NativeSliceWorldSource = (scene: Scene, camera: ArcRotateCamera, signal: AbortSignal) => Promise<NativeSliceWorldSourceResult>;

const catalogSectionNeedsNoExtraRelease = () => undefined;

export const catalogNativeSliceWorldSource: NativeSliceWorldSource = async (scene, _camera, signal) => ({
  section: await loadNativeSection(scene, signal),
  release: catalogSectionNeedsNoExtraRelease,
});
