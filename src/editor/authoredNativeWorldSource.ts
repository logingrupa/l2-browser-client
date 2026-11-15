import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { attachAuthoredNativeSection } from "../scene/world/loadAuthoredNativeSection";
import { restoreEditorAuthoredMaterials } from "./restoreEditorAuthoredMaterials";
import { catalogNativeSliceWorldSource, type NativeSliceWorldSource } from "../runtime/nativeSliceWorldSource";

function mirrorLeftHandedAuthoredCamera(camera: ArcRotateCamera): () => void {
  const authoredLeftHandedAlpha = camera.alpha, authoredLeftHandedTarget = camera.target.clone();
  camera.alpha = -authoredLeftHandedAlpha;
  camera.setTarget(new Vector3(authoredLeftHandedTarget.x, authoredLeftHandedTarget.y, -authoredLeftHandedTarget.z), false, false, true);
  return () => {
    camera.alpha = authoredLeftHandedAlpha;
    camera.setTarget(authoredLeftHandedTarget, false, false, true);
  };
}

export const authoredNativeWorldSource: NativeSliceWorldSource = async (scene, camera, signal) => {
  const restoreEditorMaterials = restoreEditorAuthoredMaterials(scene, signal);
  let restoreAuthoredCamera: (() => void) | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    restoreAuthoredCamera?.();
    restoreEditorMaterials();
  };
  try {
    const authoredSection = attachAuthoredNativeSection(scene, signal);
    if (!authoredSection) {
      const catalogWorld = await catalogNativeSliceWorldSource(scene, camera, signal);
      return { section: catalogWorld.section, release: () => { catalogWorld.release(); release(); } };
    }
    if (authoredSection.removedZReflection) restoreAuthoredCamera = mirrorLeftHandedAuthoredCamera(camera);
    return { section: authoredSection, release };
  } catch (error) {
    release();
    throw error;
  }
};
