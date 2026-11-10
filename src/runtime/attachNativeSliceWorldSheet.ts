import type { DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import { attachNativeSkyEnvironmentControls } from "../scene/world/nativeSkyEnvironmentControls";
import { nativeSandboxPresentation } from "../scene/presentationConfiguration";
import type { NativeSliceSheetTools } from "./nativeSliceSheet";
import { attachScenePresentationGroup } from "./attachScenePresentationGroup";
import type { NativeSliceSheetContext } from "./attachNativeSliceSheet";

export interface NativeSliceCameraControls {
  follow: () => void;
  frameWorld: () => void;
  frameFlame: (placementId: string) => void;
  flamePlacementIds: readonly string[];
  isFollowingFighter: () => boolean;
}

export interface NativeSliceWorldSheet {
  showFlameFailure(): void;
}

function attachCameraGroup(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  const { world: { section: nativeSection, worldFailure }, cameraControls } = context;
  const cameraGroup = section.group("camera", "Camera & terrain");
  const cameraVariables = (): VariableInfo[] => [
    { name: "camera.follow", value: () => String(cameraControls.isFollowingFighter()), values: "true | false", source: "Follow fighter / Frame world", status: "presentation" },
    { name: "terrain.material", value: () => nativeSection?.inspection().terrainMaterial ?? "not loaded", values: "candidate-source-textures | neutral-inspection", source: "staged terrain layers", status: "unverified" },
  ];
  if (!nativeSection) {
    cameraGroup.note(worldFailure ? `${worldFailure} Actor inspection area retained.` : "No native world section staged. Actor inspection area retained.", { tone: "warning" });
    return;
  }
  tools.button(cameraGroup, "Frame world", cameraControls.frameWorld, { hint: "Frames the whole staged 20_20 section.", variables: cameraVariables });
  tools.button(cameraGroup, "Follow fighter", cameraControls.follow, { hint: "Returns the orbit camera to the fighter.", variables: cameraVariables });
  tools.button(cameraGroup, "Source textures", () => nativeSection.setTerrainPreview(true), { hint: "Original terrain layer textures and alpha masks (blend is a browser shader; native look unverified).", variables: cameraVariables });
  tools.button(cameraGroup, "Neutral terrain", () => nativeSection.setTerrainPreview(false), { hint: "Plain inspection material to read terrain shape and support.", variables: cameraVariables });
  const tileVisibility = nativeSection.tileVisibility;
  if (!tileVisibility) return;
  const visibilityVariables = () => tileVisibility.describe();
  tools.button(cameraGroup, "Culling on", () => tileVisibility.setCulling(true), { hint: "Hides BSP sections, static meshes and map emitters the zone and portal walk does not reach.", variables: visibilityVariables });
  tools.button(cameraGroup, "Culling off", () => tileVisibility.setCulling(false), { hint: "Draws every loaded section again; the default until PERF-02 measures culling.", variables: visibilityVariables });
}

function attachSkyGroup(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  const { sky, skyFailure } = context.world;
  const skyGroup = section.group("sky", "Sky");
  skyGroup.note(skyFailure ? `Sky preview unavailable: ${skyFailure}` : sky ? "Original sky geometry · stored colors." : "Original sky has not been staged.",
    { testId: "native-sky-status", tone: skyFailure ? "warning" : "info",
      hint: "Original sky geometry with stored colors by default. The optional source-row comparison is temporary; native time-of-day, cloud motion and visual matching remain unverified.",
      variables: () => [{ name: "sky.status", value: () => sky ? "staged" : skyFailure ? "failed" : "not staged", values: "staged | failed | not staged", source: "createNativeSkyPresentation", status: "unverified" }] });
  if (!sky) return;
  const comparisonControls = attachNativeSkyEnvironmentControls(skyGroup.element, sky);
  context.addRelease(() => comparisonControls.dispose());
  const comparisonRoot = skyGroup.element.querySelector<HTMLElement>('[data-testid="sky-environment-comparison"]');
  const comparisonNote = tools.describe.foldStaticNoteIntoDescription(comparisonRoot?.querySelectorAll<HTMLElement>("p")[1]);
  tools.describe.element(comparisonRoot, { title: "Sky color comparison", description: comparisonNote || "Temporary source-row preview; stored sky materials stay unchanged." });
}

function attachFlameGroup(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): NativeSliceWorldSheet {
  const { world: { flames }, cameraControls: { flamePlacementIds, frameFlame } } = context;
  const flameGroup = section.group("flames", "Flames");
  const flameFailureNote = document.createElement("p");
  flameFailureNote.id = "native-flame-status"; flameFailureNote.role = "status";
  const showFlameFailure = () => {
    flameFailureNote.hidden = !flames.failure;
    flameFailureNote.textContent = flames.failure ? `${flames.failure} World and saved materials retained.` : "";
  };
  showFlameFailure();
  flameGroup.element.append(flameFailureNote);
  if (flamePlacementIds.length) {
    let nextPlacement = 0;
    tools.button(flameGroup, "Inspect flame", () => { frameFlame(flamePlacementIds[nextPlacement % flamePlacementIds.length]!); nextPlacement++; },
      { hint: "Frames the next Default_Flame01 placement in turn. Flame replay timing and lighting remain unverified.",
        variables: () => [{ name: "flames.placements", value: () => String(flamePlacementIds.length), values: "FX_E_S.Flameset.Default_Flame01 placements", source: "section manifest", status: "native" },
          { name: "flames.status", value: () => flames.presentation?.inspect().status ?? (flames.failure ? "failed" : "not present"), values: "status", source: "nativeFlamePresentation", status: "unverified" }] });
  }
  if (!flamePlacementIds.length && !flames.failure) flameGroup.note("No flame placements in this section.");
  return { showFlameFailure };
}

export function attachNativeSliceWorldSheet(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): NativeSliceWorldSheet {
  attachCameraGroup(section, context, tools);
  attachSkyGroup(section, context, tools);
  const flameSheet = attachFlameGroup(section, context, tools);
  attachScenePresentationGroup(section, nativeSandboxPresentation, { sceneName: "native sandbox scene", readoutTestId: "native-scene-presentation" });
  return flameSheet;
}
